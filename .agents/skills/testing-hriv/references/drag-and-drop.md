## Testing Drag-and-Drop (Browse Page)

The Browse page supports HTML5 native drag-and-drop for images, categories, and files.
All drag interactions are gated behind `canEditContent` — students see no drag affordances.

> **Tile move vs. reorder runs on `@dnd-kit/react` v2 (pointer sensors), not HTML5 native DnD.**
> The native MIME-type flows below cover file drops and the CategoryTile file-drop overlay.
> The move-into-category / reorder-between-tiles contract lives in `docs/drag-and-drop.md`.
> **Feel cannot be proven by a scripted/recorded drag** — discrete idealized pointer steps don't
> reproduce the acceleration/jitter where feel bugs live. Any change to collision detection, drop
> zones, collision priority, or activation constraints must be **feel-tested by a human** before
> merge; a green recording is only a mechanics smoke-test, not feel validation.
> The canonical production-scale checklist (80+ categories / 600+ images) is
> `docs/drag-and-drop.md` → Human feel-test protocol.

### Testing Browse Tile Reorder Persistence (PR #1089 / `tile-order` cache fix)

Use this flow to verify drag-and-drop reorder persists and does not silently 409
after `releaseCleanScopes` clears a stale cached `GET /api/tile-order`.

#### Auth shortcut

The MUI `LoginScreen` `TextField` controlled state may not enable the **LOGIN**
button when credentials are typed via automation. Fastest path is to inject a
current token directly and reload:

```javascript
localStorage.setItem('hriv_token', '<instructor_token>')
localStorage.setItem(
  'hriv_user',
  JSON.stringify({ id: 2, email: 'instructor@example.ca', role: 'instructor' }),
)
location.href = '/'
```

#### Root, Architecture, and Italian seed orders

- **Root:** Architecture (cat 1), Panoramas (cat 2)
- **Architecture scope:** Italian (cat 3), American (cat 4)
- **Italian scope:** Gothic (cat 5), Duomo di Milano (image 1)

#### Dragging mechanics

Browse reorders use `@dnd-kit/react` v2 pointer sensors and `farHalfReorderCollision`.
When using computer-use:

- Use the **gap between tiles** as the starting point, not the middle of the tile,
  to avoid a click being interpreted as a tile click / edit.
- Drag **well past the target tile's center** in the direction of travel.
- A small pointer wiggle is normal; the collision detector needs a clear delta
  before it commits a reorder.

#### Verifying the server state

UI status text is transient. To prove persistence and detect a stale revision
symptom, verify directly with the API after each drag:

```bash
TOKEN=<jwt>
# root
curl -sS -D - -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/tile-order
# scope
curl -sS -H "Authorization: Bearer $TOKEN" 'http://localhost:8000/api/tile-order?parent_category_id=1'
```

Expected:

- `Cache-Control: no-store, no-cache, must-revalidate`
- `Pragma: no-cache`
- `revision` increments after each successful `PUT /api/tile-order`
- `PUT /api/tile-order` returns 200 with the new order; no `409 Conflict`

#### Network capture without DevTools

Patching `window.fetch` in the browser console captures `tile-order` calls, but
the patch is lost on full page reload. If you need a continuous trace across a
reload, use CDP `Network` or log at the Vite proxy / server side.

Example interceptor:

```javascript
window.__tileOrderLogs = window.__tileOrderLogs || []
const origFetch = window.fetch
window.fetch = async (...args) => {
  const [req, init] = args
  const url = typeof req === 'string' ? req : req.url
  if (url.includes('tile-order')) {
    const entry = { method: init?.method || 'GET', url, status: null, headers: {}, body: null }
    window.__tileOrderLogs.push(entry)
    try {
      const res = await origFetch.apply(window, args)
      entry.status = res.status
      res.headers.forEach((v, k) => (entry.headers[k] = v))
      const bodyText = await res.clone().text()
      try {
        entry.body = JSON.parse(bodyText)
      } catch {
        entry.body = bodyText
      }
      return res
    } catch (e) {
      entry.status = 'NETWORK_ERROR'
      throw e
    }
  }
  return origFetch.apply(window, args)
}
```

Re-inject this **after every reload**.

#### Hidden categories/images

A hidden category/image is still visible to instructors/administrators with a
`VisibilityOff` icon and `filter: grayscale(100%)` style. Reordering a scope that
contains hidden items works the same way; visibility status is preserved via
`PATCH /api/categories/:id` (or the image endpoint).

#### Navigation edge cases

- Clicking the category **title** may open the "Edit name" modal or be intercepted
  by the drag sensor. To navigate programmatically:

  ```javascript
  const el = Array.from(document.querySelectorAll('h6')).find(
    (h) => h.textContent.trim() === 'Architecture',
  )
  el?.closest('[data-testid="category-tile-action-area"]')?.click()
  ```

- To return to root, click the **Home** breadcrumb or dispatch a navigation to `/`.

#### Cleanup / restoring seed order

After testing, reset each scope to the seed order using the current `revision`:

```bash
TOKEN=<jwt>
# root rev=<current_rev>
curl -sS -X PUT http://localhost:8000/api/tile-order \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"scope":{"parent_category_id":null},"expected_revision":<rev>,"items":[{"type":"category","id":1},{"type":"category","id":2}]}'
# architecture
curl -sS -X PUT 'http://localhost:8000/api/tile-order?parent_category_id=1' \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"scope":{"parent_category_id":1},"expected_revision":<rev>,"items":[{"type":"category","id":3},{"type":"category","id":4}]}'
# italian
curl -sS -X PUT 'http://localhost:8000/api/tile-order?parent_category_id=3' \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"scope":{"parent_category_id":3},"expected_revision":<rev>,"items":[{"type":"category","id":5},{"type":"image","id":1}]}'
```

If you hid any categories, unhide them:

```bash
curl -sS -X PATCH http://localhost:8000/api/categories/1 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"active"}'
```

### Custom MIME Types

- `application/x-hriv-image` — image tile drag payload (`{"id": <imageId>}`)
- `application/x-hriv-category` — category tile drag payload (`{"id": <categoryId>}`)
- `Files` — native file drag from OS

### DnD Interactions to Test

| Action                                   | Expected Result                                     |
| ---------------------------------------- | --------------------------------------------------- |
| Drag image tile onto category tile       | Image moves to target category                      |
| Drag category tile onto another category | Category reparented under target                    |
| Drag category onto itself                | No-op (self-drop guard)                             |
| Drop files on category tile              | Upload dialog opens with that category pre-selected |
| Drop files on grid (not on a tile)       | Upload dialog opens with current path category      |
| Student views any tile                   | `draggable="false"`, no drop handlers               |
| Drag text/URL onto category tile         | No highlight, drop rejected (MIME filtering)        |

### Testing the FileDropZone Component

The `FileDropZone` component renders a prominent drop target at the end of the card
grid **only** when files are actively being dragged into the viewport. It is gated
behind `canEditContent` (admin/instructor only).

**Key DOM selector:** `[role="region"][aria-label="Drop files here to upload images"]`

**Triggering FileDropZone visibility:**

```javascript
// Dispatch dragenter with Files type on window to activate fileDragActive state
const dt = new DataTransfer()
dt.items.add(new File(['test'], 'test.png', { type: 'image/png' }))
window.dispatchEvent(
  new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }),
)

// After ~100ms, check for the dropzone element:
const dz = document.querySelector('[role="region"][aria-label="Drop files here to upload images"]')
// dz should be non-null when fileDragActive=true
```

**Expected visual properties when visible:**

- `border: 3px dashed` with `borderColor: rgb(167, 74, 74)` (primary.main in light mode)
- `minHeight: 220px`, `maxWidth: 300px`
- `cursor: copy`
- Contains "Add images" heading + "Drop files here" subtext + circular badge with AddIcon

**Testing drop on FileDropZone:**

```javascript
const dz = document.querySelector('[role="region"][aria-label="Drop files here to upload images"]')
const dt = new DataTransfer()
dt.items.add(new File(['data'], 'photo.jpg', { type: 'image/jpeg' }))
dz.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }))
dz.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
dz.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
// After ~100ms: upload dialog (.MuiDialog-root) should open, FileDropZone should disappear
```

**Resetting drag state:** Dispatch a drop event on window with Files type to reset
`fileDragCounter` and `fileDragActive`:

```javascript
const dt = new DataTransfer()
dt.items.add(new File(['x'], 'x.png', { type: 'image/png' }))
window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
```

### Testing CategoryTile Drag-Over State

When files (or images/categories) are dragged over a CategoryTile, it shows:

- 3px dashed outline (primary color) with `outlineOffset: -3` (no box-model shift)
- `transform: scale(1.03)` for tactile feedback
- "Drop here" text overlay with move icon badge and semi-transparent primary background

**Verifying drag-over styling:**

```javascript
const card = document.querySelectorAll('.MuiCard-root')[0]
const dt = new DataTransfer()
dt.items.add(new File(['test'], 'test.png', { type: 'image/png' }))
card.dispatchEvent(
  new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }),
)
card.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))

// After ~100ms, verify computed styles:
const cs = window.getComputedStyle(card)
console.log(cs.outlineStyle) // 'dashed'
console.log(cs.outlineColor) // 'rgb(167, 74, 74)'
console.log(cs.outlineWidth) // '3px'
console.log(cs.transform) // 'matrix(1.03, 0, 0, 1.03, 0, 0)'
console.log(card.textContent.includes('Drop here')) // true
```

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
- Visual highlight (outline color change) IS observable via `getComputedStyle` with synthetic events after a short delay (~100ms) for the React re-render to complete. Use `setTimeout` or poll the DOM
- After destructive tests (moves/reparents), restore seed data via API PATCH

### Verifying MIME Type Filtering

The `isAcceptedDrag` callback checks `e.dataTransfer.types` before allowing drops.
Verify filtering by checking `defaultPrevented` on `dragover` events:

```javascript
// In browser console or Playwright evaluate:
const card = document.querySelectorAll('.MuiCard-root')[0]

// text/plain should be REJECTED (defaultPrevented = false)
const dtText = new DataTransfer()
dtText.setData('text/plain', 'test')
const textOver = new DragEvent('dragover', {
  bubbles: true,
  cancelable: true,
  dataTransfer: dtText,
})
card.dispatchEvent(textOver)
console.log('text/plain prevented:', textOver.defaultPrevented) // false

// HRIV MIME should be ACCEPTED (defaultPrevented = true)
const dtCat = new DataTransfer()
dtCat.setData('application/x-hriv-category', '{"id":2}')
const catOver = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dtCat })
card.dispatchEvent(catOver)
console.log('x-hriv-category prevented:', catOver.defaultPrevented) // true
```

### Verifying File Drop Category Pre-Selection

When files are dropped on a category tile, the upload dialog should open with that
category pre-selected. After the dialog opens, verify:

```javascript
const dialog = document.querySelector('.MuiDialog-root')
const dialogText = dialog.textContent
// Should contain "CategoryArchitecture(0)" (or whichever category was dropped on)
// NOT just "Category" with no selection
```

After closing and reopening the dialog normally (via ADD IMAGES button), the category
field should be empty (no stale pre-selection from the previous file drop).

### Data Restoration After DnD Tests

```bash
# Restore image back to original category
VERSION=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/images/1 \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])")
curl -s -X PATCH http://localhost:8000/api/images/1 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "If-Match: $VERSION" -d '{"category_id": 3}'  # Italian

# Restore category parent
curl -s -X PATCH http://localhost:8000/api/categories/2 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"parent_id": null}'  # Panoramas back to root
```

### Chrome CDP Port

When launching Chrome manually (e.g. because the CDP proxy on :29229 is not running),
use `--remote-debugging-port=9222` and connect Playwright to `http://localhost:9222`
instead of `:29229`.
