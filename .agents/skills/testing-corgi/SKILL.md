# Testing Corgi App

## Local Setup

1. Create an empty `backend/.env` file if it doesn't exist (docker-compose references it):
   ```bash
   touch backend/.env
   ```
2. Start the full stack:
   ```bash
   docker compose up -d
   ```
3. Wait for all services to be healthy (db, redis, backend, frontend).
4. **Important:** The arq background worker is NOT included in `docker-compose.yml`. You must start it manually for image processing to work:
   ```bash
   docker compose exec -d backend arq app.worker.WorkerSettings
   ```
   Without this, uploaded images will be enqueued to Redis but never processed.
5. Frontend: http://localhost:5173
6. Backend API: http://localhost:8000

## Devin Secrets Needed

No external secrets needed. Seed users are created automatically.

## Seed Test Accounts

All use password: `password`

| Email | Role | Can Edit Content | Can Manage Users |
|---|---|---|---|
| admin@bcit.ca | admin | Yes | Yes |
| instructor@bcit.ca | instructor | Yes | No |
| student@bcit.ca | student | No | No |

## Key UI Navigation Paths

- **Browse page (Home):** Shows category tiles and uncategorized image tiles
- **Upload image:** Click "ADD IMAGE" button (top-right on browse page, requires admin/instructor role)
- **Add category:** Manage menu (top nav) → Categories → click "+" button next to level → enter name → Create
- **Image viewer:** Click any image tile on browse page to open OpenSeadragon viewer
- **Manage page:** Click "MANAGE" tab, then use the manage interface for bulk operations

## Testing Image Upload + Processing Flow

1. Log in as admin@bcit.ca
2. Click "ADD IMAGE" on browse page
3. Use Playwright CDP to handle file selection (native file chooser doesn't work well with computer-use tools):
   ```python
   from playwright.async_api import async_playwright
   async with async_playwright() as p:
       browser = await p.chromium.connect_over_cdp("http://localhost:29229")
       # Find the Corgi page
       page = [pg for ctx in browser.contexts for pg in ctx.pages if "localhost:5173" in pg.url][0]
       async with page.expect_file_chooser() as fc_info:
           await page.click('text=browse to upload')
       fc = await fc_info.value
       await fc.set_files('/path/to/image.jpg')
   ```
4. Click "ADD" to upload
5. Watch for processing snackbar at bottom-right
6. The snackbar auto-dismisses after 6 seconds — use Playwright to reliably catch and click the "View image" link

## Testing Tips

- The snackbar "View image" link has a 6-second auto-hide timer. For automated testing, use Playwright's `wait_for` to detect when the link appears and click it programmatically.
- Small test images (e.g., 1024x1024 solid-color JPEG) process much faster than large medical images.
- The `/api/categories/tree` endpoint uses ETag-based caching. To verify cache behavior, check the `Cache-Control` and `ETag` response headers with curl.
- Category tree changes (add/move/delete) should be immediately visible on the browse page without browser refresh.
