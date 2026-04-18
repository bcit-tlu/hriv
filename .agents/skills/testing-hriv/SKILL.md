# Testing HRIV App

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
- **Add category:** Manage menu (top nav) > Categories > click "+" button next to level > enter name > Create
- **Image viewer:** Click any image tile on browse page to open OpenSeadragon viewer
- **Manage page:** Click "MANAGE" tab, then use the manage interface for bulk operations
- **Admin page:** Click "ADMIN" tab (admin role required) for database/filesystem export/import

## Testing Admin Export/Import

### Filesystem Export UI Flow

1. Log in as `admin@bcit.ca`
2. Navigate to ADMIN tab
3. Scroll to "Filesystem" section
4. Click "EXPORT" button to start a filesystem export task
5. The task appears in "Recent Tasks" at the bottom of the page
6. Click the info (i) icon on the task row to open the log dialog
7. The log dialog shows:
   - Task title with status badge (running/completed/cancelled)
   - Progress bar (determinate while running, indeterminate while cancelling)
   - Log output with streaming entries
   - CANCEL button (while running) or CLOSE button (when done)
8. Completed tasks show a download (arrow) icon in the task row

### Seeding Test Data for Export Testing

The default seed data may not contain enough files for meaningful export testing. To test cancellation responsiveness, you need enough data that archiving takes several seconds. Create test files inside the Docker container:

```bash
# Create ~1GB of test files (20 dirs x 500 files x 100KB each)
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

This creates incompressible random data that forces the tar.gz archiver to work slowly, making it possible to test cancellation mid-archive.

### Verifying Archive Contents

Exported archives are stored at `/data/admin_tasks/` inside the backend container. To verify contents:

```bash
# List archive files
docker exec hriv-backend-1 find /data/admin_tasks -name "*.tar.gz" -type f

# Check archive contents (should have tiles/ and source_images/, no admin_tasks/)
docker exec hriv-backend-1 tar -tzf /data/admin_tasks/<filename>.tar.gz | head -20

# Verify admin_tasks/ exclusion
docker exec hriv-backend-1 tar -tzf /data/admin_tasks/<filename>.tar.gz | grep admin_tasks
# (should return no output)
```

### Key Backend Implementation Notes

- Export archiving runs in a background thread via `asyncio.to_thread`
- A concurrent polling coroutine checks for cancellation every 2 seconds
- Cancellation uses `threading.Event` to bridge async/sync boundaries
- Verbose log entries are buffered in a `queue.Queue` and flushed every 2 seconds
- The `admin_tasks/` directory is excluded from archives to avoid re-archiving previous exports

## Testing Image Upload + Processing Flow

1. Log in as admin@bcit.ca
2. Click "ADD IMAGE" on browse page
3. Use Playwright CDP to handle file selection (native file chooser doesn't work well with computer-use tools):
   ```python
   from playwright.async_api import async_playwright
   async with async_playwright() as p:
       browser = await p.chromium.connect_over_cdp("http://localhost:29229")
       # Find the HRIV page
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
- For export cancellation testing, the data volume needs to be large enough (~1GB+) that archiving takes more than a few seconds, otherwise the archive completes before you can click Cancel.
- The frontend polls for task status every 2 seconds, so UI status transitions may lag slightly behind the actual backend state.
