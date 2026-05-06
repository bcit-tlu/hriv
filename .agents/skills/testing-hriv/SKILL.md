---
name: testing-hriv
description: End-to-end testing guide for the HRIV app including local stack setup, seed data, auth, UI navigation, metadata operations, admin export/import, image upload, image replacement, and tile sidecar routing.
---

# Testing HRIV

End-to-end testing guide for the HRIV app: local stack bring-up, seed data, auth,
UI navigation, metadata operations, admin export/import, and image upload. For
domain-specific flows see the sibling skills `testing-image-processing`
(tile pipeline / pyvips) and `testing-backup-service` (disaster recovery).

## Local Setup

1. Create an empty `backend/.env` file if it doesn't exist (docker-compose references it):
   ```bash
   touch backend/.env
   ```
2. Start the full stack:
   ```bash
   docker compose up -d --build
   ```
   Services: frontend (Vite on :5173), backend (FastAPI on :8000), db (PostgreSQL),
   redis, worker (arq), seed. Wait ~10s for the db to seed.
3. **arq worker:** `docker-compose.yml` now defines a `worker` service; `docker compose up -d`
   starts it automatically. If you're on an older checkout without that service,
   start the worker manually or image processing will enqueue to Redis without being processed:
   ```bash
   docker compose exec -d backend arq app.worker.WorkerSettings
   ```
4. Frontend: http://localhost:5173
5. Backend API: http://localhost:8000

### Troubleshooting: Frontend Docker Build Fails

If the frontend Docker build fails with `npm ci` errors about missing packages from
the lock file, delete the stale `frontend/package-lock.json` (it is in `.gitignore`
but may exist locally from a prior `npm install`) and rebuild:
```bash
rm -f frontend/package-lock.json
docker compose up -d --build frontend
```
### Rebuilding After Code Changes

Bind-mounts give hot-reload for most source edits. For Dockerfile / dependency / nginx
config changes, rebuild the specific service:
```bash
docker compose up -d --build frontend   # or backend, worker, etc.
```

## Devin Secrets Needed

None for local testing — seed users are created automatically.
Backup-service S3/Azure testing needs credentials; see `testing-backup-service`.

## Seed Test Accounts

All use password: `password`

| Email | Role | canEditContent | canManageUsers |
|---|---|---|---|
| admin@bcit.ca | admin | Yes | Yes |
| instructor@bcit.ca | instructor | Yes | No |
| student@bcit.ca | student | No | No |

## Seed Data

### Categories (hierarchical)
- Architecture
  - American
  - Italian
    - Gothic
- Panoramas

### Images
| ID | Name | Category | Source |
|---|---|---|---|
| 1 | Duomo di Milano | Italian | OpenSeadragon examples |
| 2 | Duomo di Milano (Gothic Detail) | Gothic | OpenSeadragon examples |
| 3 | Highsmith Panorama | American | Library of Congress |
| 4 | Library of Congress | Panoramas | Library of Congress |

## Getting an API Auth Token

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@bcit.ca","password":"password"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/images/1
```

## Key UI Navigation

### Tabs by Role
- **admin:** Home, Images, Manage, People, Admin
- **instructor:** Home, Images, Manage
- **student:** Home only

### Browse (Home)
- Category tiles + uncategorized image tiles.
- Click a tile to drill down; click an image tile to open the OpenSeadragon viewer.

### Images Tab
- Table columns: ID, Name, Category, Copyright, Note, Program, Status, Modified, Actions.
- Filter icon next to **ADD IMAGE** reveals per-column filters. The Category filter
  matches the full path (e.g. "Architecture : Italian" — partial string like `arch` matches).
- Three-dot menu on any row: View / Details / Move / Delete.
- Clicking an image name opens the **Edit Details** modal.

### Edit Details / Add Image / Bulk Import modals
- All share a category dropdown rendering the full tree with view / edit / `+` icons.
- `+` on any row opens a "New Category" dialog; the new category is auto-selected.
- **Edit Details** has a **VIEW IMAGE** button that navigates to the viewer.
- When testing auto-select, cancel without saving after verifying the dropdown value
  to avoid polluting seed data.

### Category Management
- Manage > Categories has a full dialog with drag-and-drop reordering.
- Category tree changes are reflected immediately on Browse without a refresh
  (frontend invalidates the ETag-cached `/api/categories/tree` query).

### People tab (admin only)
- Add / delete / edit users. Persistence survives a hard refresh.

### Admin tab (admin only)
- Database export/import (JSON).
- Filesystem export/import (tar.gz via background tasks with log streaming).

### Footer
- "BCIT Teaching and Learning Unit" link → https://www.bcit.ca/learning-teaching-centre/.
  Visible on all pages.

## OpenSeadragon Viewer Toolbar

Bottom-left of the viewer, left to right:

| # | Icon | Function |
|---|---|---|
| 1 | + | Zoom in |
| 2 | – | Zoom out |
| 3 | House | Home (reset view) |
| 4 | Arrows | Fullscreen toggle |
| 5 | CCW arrow | Rotate left |
| 6 | CW arrow | Rotate right |
| 7 | Diagonal arrow | Selection tool (draw rectangles) |
| 8 | Padlock | Lock / unlock overlays |
| 9 | X | Clear overlays |
| 10 | Pencil | Canvas annotation edit |

**Warning:** Fullscreen (4) is adjacent to the selection tool (7) and easy to hit
accidentally. Press Escape to exit fullscreen.

When testing viewer stability after metadata edits, watch the URL — `zoom=`, `x=`,
`y=` params should remain unchanged if the viewport was preserved.

## Testing Metadata Operations

### Optimistic Concurrency

Images use version-based optimistic concurrency; PATCH requires `If-Match`:
```bash
VERSION=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/images/1 \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])")

curl -X PATCH http://localhost:8000/api/images/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $VERSION" \
  -d '{"name": "New Name"}'
```
Always re-fetch `version` before each PATCH or you'll get 409 Conflict.

### metadata_extra_merge (Partial Updates)

`metadata_extra_merge` patches individual keys in `metadata_extra` without
overwriting the rest — this is how the frontend updates locked overlays and
measurement settings independently:
```bash
# Add / update a key
curl -X PATCH http://localhost:8000/api/images/1 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "If-Match: $VERSION" \
  -d '{"metadata_extra_merge": {"locked_overlays": [{"x":0.1,"y":0.2,"w":0.3,"h":0.4}]}}'

# Remove a key by setting it to null
curl -X PATCH http://localhost:8000/api/images/1 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "If-Match: $VERSION" \
  -d '{"metadata_extra_merge": {"locked_overlays": null}}'
```
`metadata_extra` and `metadata_extra_merge` are mutually exclusive — sending both
in one request returns 422.

`locked_overlays` entries are validated by `OverlayRectSchema` — each must have
numeric `x`, `y`, `w`, `h`. Malformed entries are silently filtered on both
backend and frontend.

### Injecting Test Data

To exercise frontend handling of malformed metadata, inject directly:
```bash
docker exec hriv-db-1 psql -U hriv -d hriv -c \
  "UPDATE images SET metadata = jsonb_set(COALESCE(metadata,'{}'), '{locked_overlays}', \
   '[{\"x\":0.1,\"y\":0.2,\"w\":0.3,\"h\":0.4},{\"garbage\":true},{\"x\":\"str\",\"y\":0,\"w\":0,\"h\":0}]') \
   WHERE id=2"
```
Then open that image in the browser to verify graceful handling.

## Testing Admin Export/Import

### Filesystem Export UI Flow

1. Admin tab → Filesystem section → **EXPORT**.
2. Task appears in "Recent Tasks" at the bottom.
3. Click the info (i) icon to open the log dialog (status badge, determinate
   progress bar, streaming logs, CANCEL/CLOSE).
4. Completed tasks show a download (↓) icon in the task row.

### Seeding Test Data for Export Testing

Default seed data is too small to exercise cancellation. Generate ~1 GB of
incompressible data inside the backend container:
```bash
docker exec hriv-backend-1 python3 -c "
import os, random
for d in range(20):
    path = f'/data/tiles/large_test/dir_{d}'
    os.makedirs(path, exist_ok=True)
    for f in range(500):
        with open(f'{path}/file_{f}.bin', 'wb') as fh:
            fh.write(random.randbytes(102400))
"
```

### Verifying Archive Contents

Archives are stored at `/data/admin_tasks/` inside the backend container:
```bash
docker exec hriv-backend-1 find /data/admin_tasks -name "*.tar.gz" -type f
docker exec hriv-backend-1 tar -tzf /data/admin_tasks/<filename>.tar.gz | head -20
# admin_tasks/ must be excluded from archives (no re-archiving of past exports):
docker exec hriv-backend-1 tar -tzf /data/admin_tasks/<filename>.tar.gz | grep admin_tasks
# (should return nothing)
```

### Backend Implementation Notes

- Archiving runs on `asyncio.to_thread`; a concurrent coroutine polls cancellation every 2s.
- Cancellation bridges async/sync via `threading.Event`.
- Log entries buffer in `queue.Queue` and flush every 2s.
- The frontend polls task status every 2s, so UI state may lag the backend slightly.

## Testing Image Upload + Processing

1. Log in as admin@bcit.ca.
2. Click **ADD IMAGE** on Browse.
3. Use Playwright CDP for file selection (native chooser doesn't cooperate with computer-use):
   ```python
   from playwright.async_api import async_playwright
   async with async_playwright() as p:
       browser = await p.chromium.connect_over_cdp("http://localhost:29229")
       page = [pg for ctx in browser.contexts for pg in ctx.pages
               if "localhost:5173" in pg.url][0]
       async with page.expect_file_chooser() as fc_info:
           await page.click('text=browse to upload')
       fc = await fc_info.value
       await fc.set_files('/path/to/image.jpg')
   ```
4. Click **ADD** to upload.
5. Processing snackbar appears bottom-right with a "View image" link on completion.

The snackbar auto-dismisses after 6 s — use Playwright `wait_for` to catch the link
deterministically. For deeper image-processing tests (progress flush timing,
synthetic large images, pyvips eval signals) see `testing-image-processing`.

## Testing Image Replacement

The Edit Details modal supports one-to-one image replacement with a two-step
confirmation flow. This replaces the image file, regenerates tiles and thumbnails,
and clears canvas metadata (`locked_overlays`, `canvas_annotations`).

### Creating Test Images

Generate synthetic test images of varying sizes:
```bash
# Small JPEG for quick tests
python3 -c "import numpy as np; from PIL import Image; Image.fromarray(np.random.randint(0,255,(600,800,3),dtype=np.uint8)).save('/tmp/test_replacement.jpg', quality=85)"

# Large PNG for processing-time tests
python3 -c "import numpy as np; from PIL import Image; Image.fromarray(np.random.randint(0,255,(2000,2000,3),dtype=np.uint8)).save('/tmp/test_replacement_large.png')"
```

Alternatively, generate a test image directly in the browser console (avoids
needing PIL/numpy and the native file picker):
```javascript
const canvas = document.createElement('canvas');
canvas.width = 4000; canvas.height = 3000;
const ctx = canvas.getContext('2d');
for (let y = 0; y < 3000; y += 10)
  for (let x = 0; x < 4000; x += 10) {
    ctx.fillStyle = `rgb(${(x*y)%256},${(x+y)%256},${(x^y)%256})`;
    ctx.fillRect(x, y, 10, 10);
  }
canvas.toBlob(blob => {
  const file = new File([blob], 'test_image.jpg', {type: 'image/jpeg'});
  const dt = new DataTransfer(); dt.items.add(file);
  const input = document.querySelector('input[type="file"]');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', {bubbles: true}));
}, 'image/jpeg', 0.98);
```

### UI Flow

1. Open Edit Details modal (click image name in Images tab, or click "Edit Details" in viewer).
2. The drop zone at the top shows "Drag and drop to replace image" with a "browse to upload" link.
3. Select a file — the drop zone turns green, shows filename + size + "Clear" button.
4. Button changes from "Save" to "Replace & Save" (blue).
5. **First click** on "Replace & Save" → warning alert appears:
   > "Replacing this image will delete the current image file, all tiles, and any canvas annotations and overlays. This cannot be undone."
6. Button changes to "Confirm Replace & Save" (orange/warning color).
7. **Second click** executes the replacement (PATCH metadata, then POST file upload).
8. During upload: "Uploading replacement — X%" text with LinearProgress bar,
   Cancel→"Close", Replace/Delete buttons disabled.
9. If modal closed mid-upload: progress transitions to an uploading snackbar.
10. After upload completes: modal auto-closes, Processing snackbar appears at bottom.

### File Injection via Playwright

Since the file input is hidden, use Playwright CDP to inject the file directly
rather than trying to interact with the OS file picker:
```python
import asyncio
from playwright.async_api import async_playwright

async def inject_file():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp("http://localhost:29229")
        context = browser.contexts[0]
        page = context.pages[0]
        file_input = page.locator('input[type="file"]')
        await file_input.set_input_files('/tmp/test_replacement.jpg')

asyncio.run(inject_file())
```
This directly sets the hidden `<input type="file">` without needing to interact
with the native file chooser dialog. The modal must be open before running this.

### Post-Replacement Verification

After the processing snackbar disappears, verify via API:
```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/images/1 | python3 -m json.tool
```

Key assertions:
- `tile_sources` changed from external URL to `/api/tiles/<id>/image.dzi`
- `thumb` changed to `/api/tiles/<id>/thumbnail.jpeg`
- `width` and `height` match the replacement image dimensions
- `file_size` is populated
- `metadata_extra` is `{}` (canvas metadata cleared)
- `name`, `category_id`, `copyright`, `note`, `program_ids` are preserved
- `version` has incremented

### Known Limitation (Issue #271)

The frontend performs two separate API calls for replacement:
1. Metadata PATCH (`apiUpdateImage`) — updates form fields
2. File POST (`apiReplaceImage`) — uploads the new file

If the file upload fails after the metadata PATCH succeeds, metadata changes are
committed but the file remains unchanged. This is a known trade-off; see issue #271
for discussion of potential atomic replacement approaches.

### Localhost Throttling Limitation

**The in-modal upload progress bar cannot be visually observed on localhost.** XHR
`upload.onprogress` tracks bytes written to the OS TCP send buffer, not bytes received
by the server. On loopback, the kernel's TCP buffers (128KB–4MB) absorb the entire
file instantly — progress jumps 0→100% before the 500ms React re-render tick fires.

Approaches that do NOT work on localhost:
- `tc qdisc` on port 8000 — wrong port (XHR tracks browser→Vite on 5173)
- `tc qdisc` on port 5173 IPv4 — Chrome uses IPv6 `::1`, bypasses filter
- `tc qdisc` on port 5173 IPv4+IPv6 — throttles ALL traffic including PATCH
- XHR monkey-patch — fake events fire but real `send()` completes instantly
- CDP `Network.emulateNetworkConditions` — not available on browser-level WebSocket
- TCP proxy with slow reads — no backpressure, OS buffers absorb all data

**To test the progress bar**, deploy to a real network environment where upload
latency is non-trivial, or use a remote server accessible over a WAN link.

### Nginx Body Size Limit (On-Cluster)

The Helm chart nginx config (`charts/frontend/files/default.conf.template`) has
`client_max_body_size 0` (unlimited) for upload endpoints and 10MB for other
`/api/` routes. The replace endpoint pattern `images/\d+/replace` must be in the
unlimited list, or large replacements will fail with 413. This doesn't affect
docker-compose testing (Vite dev proxy has no body limit).

## Browser & Test Environment Tips

- **Chrome CDP:** The provisioned Chrome exposes CDP on `http://localhost:29229`.
  Use it for Playwright scripts (`p.chromium.connect_over_cdp(...)`) when native
  computer-use is awkward (file uploads, flaky timing, snackbars).
- **Chrome binary (if you need to relaunch):** `/opt/.devin/chrome/chrome/linux-*/chrome-linux64/chrome`
  with `--user-data-dir=/home/ubuntu/.browser_data_dir` to keep profile state. The
  `google-chrome` wrapper requires the CDP proxy.
- **Maximize the window before recording** so the full app is captured:
  ```bash
  wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz
  ```
  Install `wmctrl` first if needed (`sudo apt-get install -y wmctrl`). Keyboard
  shortcuts like Super+Up only tile to half-screen on some window managers.
- **Seed images use external DZI tiles** (openseadragon.github.io). Dark/black tiles
  on first load usually mean the CDN is still warming — wait a few seconds.
- **Small vs large test images:** a 1024×1024 solid-color JPEG processes in
  milliseconds; anything beyond ~200 MB is needed to observe tile-processing progress.
