## Testing Image Upload + Processing

1. Log in as admin@example.ca.
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

## Testing Bulk Import + ManagePage Auto-Refresh

Bulk imports happen when the user uploads a ZIP file or multiple images at once.
The backend creates a `BulkImportJob` and processes images asynchronously via arq.
App.tsx polls for job status every 2 seconds and bumps an `imagesVersion` counter
when the job completes, which triggers ManagePage's `loadImages()` useEffect.

### Creating Test Images for Bulk Import

Use ImageMagick to create small test images and ZIP them:

```bash
# Create test JPEGs (PIL may not be installed)
for i in 1 2 3; do
  convert -size 200x200 "xc:rgb($((50*i)),100,150)" /tmp/test_bulk_${i}.jpg
done

# Create ZIP archive
python3 -c "
import zipfile
with zipfile.ZipFile('/tmp/test_bulk_import.zip', 'w') as zf:
    for i in range(1, 4):
        zf.write(f'/tmp/test_bulk_{i}.jpg', f'test_bulk_{i}.jpg')
"
```

### Bulk Import from ManagePage (Images Tab)

1. Navigate to **Images** tab (ManagePage) — note the current row count.
2. Click **ADD IMAGES** to open the upload modal.
3. Inject the ZIP file via Playwright (the native file picker won't work with computer-use):

   ```python
   import asyncio
   from playwright.async_api import async_playwright

   async def inject_zip():
       async with async_playwright() as p:
           browser = await p.chromium.connect_over_cdp('http://localhost:29229')
           context = browser.contexts[0]
           page = [pg for pg in context.pages if 'localhost:5173' in pg.url][0]
           file_input = page.locator('input[type="file"]')
           await file_input.set_input_files('/tmp/test_bulk_import.zip')

   asyncio.run(inject_zip())
   ```

4. Select a target category from the dropdown.
5. Click **IMPORT 1 FILE** (the button shows file count, not image count).
6. The upload modal closes, a snackbar shows import progress.
7. **Without navigating away**, wait for the import to complete (~5-10 seconds for small images).
8. Verify the image table auto-refreshes with the new rows.

**Key behavior:** The table should update automatically when the bulk import
completes. The `imagesVersion` counter in App.tsx increments on both:

- Bulk import job completion (polling path at `App.tsx:592-594`)
- Single-image processing completion (processing job path at `App.tsx:477-481`)

ManagePage watches `imagesVersion` in its useEffect dependency array (`ManagePage.tsx:223-225`).

### Verifying No Polling Churn

The old bug (#292) caused useEffect teardown/recreate on every state update, leading
to rapid burst polling. To verify this is fixed:

1. Instrument `window.fetch` before starting a bulk import:
   ```python
   # Via Playwright evaluate:
   await page.evaluate('''
       window._pollLog = [];
       const origFetch = window.fetch;
       window.fetch = function(...args) {
           const url = typeof args[0] === "string" ? args[0] : (args[0]?.url || "");
           if (url.includes("bulk-import")) {
               window._pollLog.push({ time: Date.now(), url });
           }
           return origFetch.apply(this, args);
       };
   ''')
   ```
2. Start a bulk import.
3. After completion, check the logged intervals:
   ```python
   result = await page.evaluate('''
       const log = window._pollLog;
       const intervals = [];
       for (let i = 1; i < log.length; i++)
           intervals.push(log[i].time - log[i-1].time);
       return { total: log.length, intervals };
   ''')
   ```
4. **Pass criteria:** Intervals are ~2000ms apart (the `setInterval(2000)` period). No rapid bursts.
5. **Note:** Very small test images may process within a single poll interval, so
   you may see only 1-2 requests total. That's expected — the absence of rapid
   bursts is what confirms no churn.

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
const canvas = document.createElement('canvas')
canvas.width = 4000
canvas.height = 3000
const ctx = canvas.getContext('2d')
for (let y = 0; y < 3000; y += 10)
  for (let x = 0; x < 4000; x += 10) {
    ctx.fillStyle = `rgb(${(x * y) % 256},${(x + y) % 256},${(x ^ y) % 256})`
    ctx.fillRect(x, y, 10, 10)
  }
canvas.toBlob(
  (blob) => {
    const file = new File([blob], 'test_image.jpg', { type: 'image/jpeg' })
    const dt = new DataTransfer()
    dt.items.add(file)
    const input = document.querySelector('input[type="file"]')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  },
  'image/jpeg',
  0.98,
)
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

**Precondition — the Edit Details (or Replace Image) modal must already be open.**
The `input[type="file"]` element is rendered only while that modal is mounted, so
running the snippet with the modal closed makes `page.locator('input[type="file"]')`
match nothing and `set_input_files(...)` fails with a locator timeout. Selecting the
correct page (e.g. by `localhost:5173` in `page.url`) does **not** help here — that
only picks the tab, not whether the modal is visible. Open the modal first (click the
row's ⋮ → Replace image / Edit details), then run:

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
with the native file chooser dialog (modal-open precondition above still applies).

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
