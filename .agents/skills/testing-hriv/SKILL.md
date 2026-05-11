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

### Programs
| ID | Name |
|---|---|
| 1 | Administration |
| 2 | Digital Design |
| 3 | Photography |

### Images
| ID | Name | Category | Program | Source |
|---|---|---|---|---|
| 1 | Duomo di Milano | Italian | Digital Design | OpenSeadragon examples |
| 2 | Duomo di Milano (Gothic Detail) | Gothic | Digital Design | OpenSeadragon examples |
| 3 | Highsmith Panorama | American | Photography | Library of Congress |
| 4 | Library of Congress | Panoramas | Photography | Library of Congress |

### Direct Image Counts per Category
These are direct (first-child) counts, not subtree sums:
| Category | Direct Image Count |
|---|---|
| Architecture | 0 |
| American | 1 |
| Italian | 1 |
| Gothic | 1 |
| Panoramas | 1 |

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

### Edit Details / Add Image / Bulk Edit modals
- All share a category dropdown rendering the full tree with view / edit / `+` icons.
- `+` on any row opens a "New Category" dialog; the new category is auto-selected.
- **Edit Details** has a **VIEW IMAGE** button that navigates to the viewer.
- When testing auto-select, cancel without saving after verifying the dropdown value
  to avoid polluting seed data.

#### Category Dropdown Image Counts
The category dropdown (`CategoryPickerSelect`) shows direct image counts next to
each category name — e.g. `Architecture (0)`, `Italian (1)`. These are **direct**
counts (images directly in that category), not subtree sums. When testing:
- Verify Architecture shows `(0)` not `(3)` — it has no direct images
- Verify leaf categories (American, Italian, Gothic, Panoramas) each show `(1)`

#### Program Chip Toggles
All image metadata forms (Edit Details, Add Images, Bulk Edit) use a **chip toggle
panel** for program multi-select — not a Select dropdown. The pattern:
- "Program" appears as a Typography heading above a row of Chip components
- **Filled/primary** = selected, **outlined/default** = unselected
- Click a chip to toggle its state (no Ctrl key needed)
- Multiple chips can be selected simultaneously
- In **Edit Details**: chips reflect the image's current program assignments
- In **Add Images**: all chips start outlined (no pre-selection)
- In **Bulk Edit**: all chips start outlined (changes apply to all selected images)

**Testing flow:**
1. Open Edit Details for an image with a known program (e.g. Duomo di Milano → Digital Design)
2. Verify the correct chip is filled, others are outlined
3. Click an unselected chip → verify it becomes filled (others unchanged)
4. Click a selected chip → verify it becomes outlined (others unchanged)
5. Cancel to discard changes
6. Repeat in Add Images and Bulk Edit modals to verify consistent behavior

### Category Management
- Manage > Categories has a full dialog with drag-and-drop reordering.
- Category tree changes are reflected immediately on Browse without a refresh
  (frontend invalidates the ETag-cached `/api/categories/tree` query).

#### Category Program Visibility
Edit Category dialog has a "Visible to" radio group:
- **All students** (default): no program restriction, chip panel hidden
- **Specific programs**: shows chip toggle panel to select which programs can see the category

Key behaviors:
- Save/Create disabled when "Specific programs" selected but no chips toggled
- Save disabled when label is empty (even if programs changed)
- Inline rename (via category picker in image modals) does NOT show visibility controls
  and does NOT wipe existing program associations

#### Duplicate Category Name Validation

The backend returns `409 Conflict` when creating or renaming a category to a name
that already exists among its siblings (same `parent_id`). The frontend dialogs
(AddCategoryDialog, EditCategoryDialog) show an inline red Alert and keep the dialog
open for retry.

**Key behaviors to verify:**
- Creating a category with the same name as an existing sibling → 409 error, dialog stays open
- Creating a category with a name that exists under a *different* parent → allowed (succeeds)
- Renaming a category to match an existing sibling → 409 error, dialog stays open
- After a 409 error: Create/Save button re-enables (not stuck in saving state)
- The error Alert is dismissible via its close (X) button
- Validation is sibling-scoped (same `parent_id`), not global

**Testing flow (Manage > Categories):**
1. Click `+` next to "Root level" → type an existing root name (e.g. "Architecture") → Create → expect error
2. Click `+` next to a different parent (e.g. Panoramas) → type a name that exists elsewhere (e.g. "American") → Create → expect success
3. Click pencil on a category → type an existing sibling name → Save → expect error
4. **Clean up** any test categories created during step 2 (delete via the trash icon)

###
# Category Program Visibility Picker

The Add/Edit Category dialogs include a "Visible to" radio group:
- **"All students"** (default for new categories) — `program_ids=[]`, chip panel hidden
- **"Specific programs"** — reveals clickable chip toggles for each program; filled/primary = selected, outlined = unselected

**Key behaviors to verify:**
- Edit dialog pre-populates radio state from existing `program_ids` (non-empty → "Specific programs" selected)
- Edit dialog pre-selects the correct program chips based on `program_ids`
- Toggling a chip enables the Save button (change detection compares against original set)
- Save persists changes; re-opening the dialog reflects the updated associations
- Add dialog defaults to "All students" with chip panel hidden
- Switching to "Specific programs" reveals all program chips (all unselected initially)
- Creating with programs selected sends `program_ids` to API
- Inline category rename (via CategoryPickerSelect in EditImageModal, etc.) does NOT wipe program associations — `programIds` parameter is optional and only included when explicitly provided

**Testing flow (Manage > Categories):**
1. Click pencil on "Architecture" → expect "Specific programs" radio selected, "Digital Design" chip filled
2. Toggle another chip (e.g. "Photography") → Save → re-open → expect both chips filled
3. Click `+` at root level → expect "All students" radio, no chip panel → switch to "Specific programs" → select a chip → Create
4. Verify via API: `GET /api/categories/tree` returns correct `program_ids` arrays
5. **Clean up** test data: restore Architecture to original `program_ids=[2]`, delete test categories

**Testing flow (inline rename via EditImageModal):**
1. Check precondition via API: Italian (id=3) has `program_ids=[2]`
2. Navigate to Architecture > Italian > click "Duomo di Milano" image tile
3. Click "Edit Details" to open EditImageModal
4. Open the Category dropdown (CategoryPickerSelect)
5. Click pencil icon next to "Italian" in the dropdown → Edit Category dialog opens
6. Verify: dialog shows **only** the name field — no "Visible to" radio or chip panel (because `programs` prop is omitted, meaning no program context)
7. Rename "Italian" to "Italian2" → Save
8. Verify via API: `GET /api/categories/tree` → Italian2 still has `program_ids=[2]` (not wiped to `[]`)
9. **Clean up**: rename back to "Italian" via same flow

**Note:** CategoryPickerSelect is used in 5 components (EditImageModal, UploadImageModal, BulkEditImagesModal, MoveImageDialog, MoveCategoryDialog). All render EditCategoryDialog without `programs` prop, so all follow the same code path. Testing via EditImageModal covers the shared behavior.

**API verification pattern:**
```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@bcit.ca","password":"password"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/categories/tree \
  | python3 -c "import sys,json; tree=json.load(sys.stdin); [print(f'{c[\"label\"]}: program_ids={c[\"program_ids\"]}') for c in tree]"
```

#### Button Guard / Form Validation States

The Save (Edit) and Create (Add) buttons have multi-condition disabled guards. Key invalid states to test:

- **Empty label + programs changed**: Save stays disabled even though `programsChanged=true` (prevents confusing no-op submission)
- **"Specific programs" with zero chips**: Save/Create disabled (prevents sending `program_ids=[]` which means "visible to all" — contradicting the explicit "Specific programs" selection)
- **Positive control**: Once a valid state is restored (label filled + at least one chip selected), button re-enables immediately

**Testing tip:** The category name input is a React-controlled Autocomplete (Combobox). Standard keyboard clearing (triple-click + Delete) may be intercepted by the autocomplete. If keyboard clearing doesn't work, use the browser console to clear it programmatically:
```javascript
const input = document.querySelector('input[type="text"]');
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
nativeInputValueSetter.call(input, '');
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
```

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

## Magnification Badge (Navigator Mini-Map)

The viewer displays a real-time magnification badge (`NX`) in the **bottom-left
corner of the navigator mini-map** (the mini-map itself is in the bottom-right
of the viewer). The badge updates on every zoom animation frame.

### Two display modes

| Condition | Display |
|---|---|
| No measurement settings on image | Raw image-zoom ratio (e.g. `<1X`, `1X`, `4X`) |
| Measurement scale + unit configured | Real-world magnification (e.g. `155X`, `2117X`) |

Seed images have no measurement settings by default, so the badge shows `<1X` at
home zoom. To test measurement-aware magnification:

1. Click **Edit Details** on any image.
2. Set **Scale** = `8`, **Unit** = `um` (8 pixels per micrometre).
3. Save → badge immediately shows a high value (e.g. `155X` at home zoom).
4. **Clean up after testing** — clear Scale and Unit fields and save again.

### Expected badge values

- At home zoom without measurement: `<1X` (image is smaller than viewport)
- At home zoom with 8px/µm: ~`155X` (depends on image dimensions and viewport)
- Zooming in increases the value linearly
- Sub-unity magnification displays `<1X` instead of `0X`

### Key implementation details for testing

- Badge uses `pointerEvents: none` — it should never block clicks on the navigator
- Badge is appended to `viewer.navigator.element`, NOT added via `viewer.addControl()`
- Updates on both `animation` and `animation-finish` events (matches `repositionLabels` pattern)
- After page reload with a share-link URL, the badge should show the correct value
  for the restored viewport (not stale `1X`)

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
