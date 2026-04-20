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
