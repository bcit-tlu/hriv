---
name: testing-hriv
description: End-to-end testing guide for the HRIV app including local stack setup, seed data, auth, UI navigation, metadata operations, admin export/import, image upload, image replacement, drag-and-drop, tile sidecar routing, and bulk import with ManagePage auto-refresh.
---

# Testing HRIV

End-to-end testing guide for the HRIV app: local stack bring-up, seed data, auth,
UI navigation, metadata operations, admin export/import, drag-and-drop, image upload,
and bulk import. For domain-specific flows see the sibling skills
`testing-image-processing` (tile pipeline / pyvips) and `testing-backup-service`
(disaster recovery).

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
| admin@example.ca | admin | Yes | Yes |
| instructor@example.ca | instructor | Yes | No |
| student@example.ca | student | No | No |

## Key UI Navigation

### Tabs by Role
- **admin:** Home, Images, Manage, People, Admin
- **instructor:** Home, Images, Manage
- **student:** Home only

### Browse (Home)
- Category tiles + uncategorized image tiles.
- Click a tile to drill down; click an image tile to open the OpenSeadragon viewer.

## Testing Drag-and-Drop (Browse Page)

The Browse page supports HTML5 native drag-and-drop for images, categories, and files.
All drag interactions are gated behind `canEditContent` — students see no drag affordances.

### Custom MIME Types
- `application/x-hriv-image` — image tile drag payload (`{"id": <imageId>}`)
- `application/x-hriv-category` — category tile drag payload (`{"id": <categoryId>}`)
- `Files` — native file drag from OS

### DnD Interactions to Test

| Action | Expected Result |
|---|---|
| Drag image tile onto category tile | Image moves to target category |
| Drag category tile onto another category | Category reparented under target |
| Drag category onto itself | No-op (self-drop guard) |
| Drop files on category tile | Upload dialog opens with that category pre-selected |
| Drop files on grid (not on a tile) | Upload dialog opens with current path category |
| Student views any tile | `draggable="false"`, no drop handlers |
| Drag text/URL onto category tile | No highlight, drop rejected (MIME filtering) |

### Testing the FileDropZone Component

The `FileDropZone` component renders a prominent drop target at the end of the card
grid **only** when files are actively being dragged into the viewport. It is gated
behind `canEditContent` (admin/instructor only).

**Key DOM selector:** `[role="region"][aria-label="Drop files here to upload images"]`

**Triggering FileDropZone visibility:**
```javascript
// Dispatch dragenter with Files type on window to activate fileDragActive state
const dt = new DataTransfer();
dt.items.add(new File(['test'], 'test.png', { type: 'image/png' }));
window.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));

// After ~100ms, check for the dropzone element:
const dz = document.querySelector('[role="region"][aria-label="Drop files here to upload images"]');
// dz should be non-null when fileDragActive=true
```

**Expected visual properties when visible:**
- `border: 3px dashed` with `borderColor: rgb(167, 74, 74)` (primary.main in light mode)
- `minHeight: 220px`, `maxWidth: 300px`
- `cursor: copy`
- Contains "Add images" heading + "Drop files here" subtext + circular badge with AddIcon

**Testing drop on FileDropZone:**
```javascript
const dz = document.querySelector('[role="region"][aria-label="Drop files here to upload images"]');
const dt = new DataTransfer();
dt.items.add(new File(['data'], 'photo.jpg', { type: 'image/jpeg' }));
dz.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
dz.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
dz.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
// After ~100ms: upload dialog (.MuiDialog-root) should open, FileDropZone should disappear
```

**Resetting drag state:** Dispatch a drop event on window with Files type to reset
`fileDragCounter` and `fileDragActive`:
```javascript
const dt = new DataTransfer();
dt.items.add(new File(['x'], 'x.png', { type: 'image/png' }));
window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
```

### Testing CategoryTile Drag-Over State

When files (or images/categories) are dragged over a CategoryTile, it shows:
- 3px dashed outline (primary color) with `outlineOffset: -3` (no box-model shift)
- `transform: scale(1.03)` for tactile feedback
- "Drop here" text overlay with move icon badge and semi-transparent primary background

**Verifying drag-over styling:**
```javascript
const card = document.querySelectorAll('.MuiCard-root')[0];
const dt = new DataTransfer();
dt.items.add(new File(['test'], 'test.png', { type: 'image/png' }));
card.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
card.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));

// After ~100ms, verify computed styles:
const cs = window.getComputedStyle(card);
console.log(cs.outlineStyle);   // 'dashed'
console.log(cs.outlineColor);   // 'rgb(167, 74, 74)'
console.log(cs.outlineWidth);   // '3px'
console.log(cs.transform);      // 'matrix(1.03, 0, 0, 1.03, 0, 0)'
console.log(card.textContent.includes('Drop here')); // true
```

**Note on computed styles with synthetic events:** React state updates are asynchronous,
but computed styles ARE observable via `getComputedStyle` after a short delay (~100ms)
for the React re-render to complete. Use `setTimeout` or poll the DOM.

### Testing DnD with Synthetic Events

Native HTML5 DnD requires physical mouse gestures that computer-use tools may not
reliably trigger. Use Playwright CDP with synthetic `DragEvent` dispatch instead:

```python
import asyncio
from playwright.async_api import async_playwright

async def drag_image_to_category():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp("http://localhost:9222")
        page = browser.contexts[0].pages[0]

        result = await page.evaluate("""
            () => {
                const cards = document.querySelectorAll('.MuiCard-root');
                const sourceCard = cards[1]; // image tile
                const targetCard = cards[0]; // category tile

                const dt = new DataTransfer();
                dt.setData('application/x-hriv-image', JSON.stringify({ id: 1 }));

                sourceCard.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
                targetCard.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt }));
                targetCard.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
                targetCard.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
                sourceCard.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));

                return 'DnD dispatched';
            }
        """)
        print(result)

asyncio.run(drag_image_to_category())
```

**Important notes for synthetic DnD:**
- The full event sequence is required: `dragstart` → `dragenter` → `dragover` → `drop` → `dragend`
- `dragover` must have `cancelable: true` and the handler must call `preventDefault()` to allow the drop
- For file drops, use `dt.items.add(new File(['test'], 'test.jpg', { type: 'image/jpeg' }))` to populate the `Files` type
- After destructive tests (moves/reparents), restore seed data via API PATCH

### Chrome CDP Port

When launching Chrome manually (e.g. because the CDP proxy on :29229 is not running),
use `--remote-debugging-port=9222` and connect Playwright to `http://localhost:9222`
instead of `:29229`.
