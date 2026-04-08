# Testing Corgi Image Viewer

## Local Environment Setup

```bash
# Start all services (db, backend, frontend)
cd /home/ubuntu/repos/corgi
docker compose up --build -d

# Verify services are healthy
docker compose ps
# Expected: corgi-db-1 (healthy), corgi-backend-1 (running), corgi-frontend-1 (running)
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- Database: PostgreSQL on port 5432

### Adding Redis for Rate Limiting & Task Queue Testing

Docker Compose does not include Redis by default. To test rate limiting (Phase 5.3) and arq task queue (Phase 5.2), start a Redis container on the same Docker network:

```bash
# Start Redis on the corgi_default network with name "redis" (matches default REDIS_URL)
docker run -d --name redis --network corgi_default -p 6379:6379 redis:7-alpine

# Restart backend to pick up Redis connection
docker restart corgi-backend-1

# Verify Redis is reachable from backend
curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@bcit.ca","password":"wrong"}'
# Should return 401 (not 500)
```

Without Redis, rate limiting is a no-op and image processing falls back to BackgroundTasks.

## Test Credentials

| Email | Password | Role | Permissions |
|---|---|---|---|
| admin@bcit.ca | password | Admin | Full access, can upload/edit/manage |
| instructor@bcit.ca | password | Instructor | Can upload and edit content |
| student@bcit.ca | password | Student | View-only (no Add Image button) |

## Navigation Structure

Top nav tabs: HOME, IMAGES, MANAGE, PEOPLE, ADMIN
- HOME: Category tree + uncategorized images grid, "ADD IMAGE" button (admin/instructor only)
- IMAGES: Image listing view
- PEOPLE: User management table
- ADMIN: Admin settings
- Profile dropdown: Click the avatar (initials) at top-right → shows Update and Logout buttons

## Image Viewer Toolbar

When viewing an image, the bottom-left toolbar contains (left to right):
- Zoom in / Zoom out / Home / Toggle full page
- Rotate left / Rotate right
- Draw selection rectangle (creates red overlay rectangles with measurement labels)
- Lock overlays (padlock icon — persists overlays to image metadata)
- Clear all selection rectangles (X icon — disabled when overlays are locked)

## Testing Rate Limiting (Phase 5.3)

```bash
# Flush Redis before testing
docker exec redis redis-cli flushall

# Send failed login attempts (default limit: 5)
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w "Attempt $i: HTTP %{http_code}\n" \
    -X POST http://localhost:8000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@bcit.ca","password":"wrong"}'
done
# Expected: first N-1 return 401, Nth returns 429 with Retry-After header

# Verify successful login resets counter
docker exec redis redis-cli flushall
# Send some failed attempts, then succeed, then fail again
# The post-success failure should return 401 (not 429)
```

Note: With `rate_limit_login_max=5`, blocking may start at the 5th attempt (not 6th) due to how the sliding window counter records attempts.

## Testing Optimistic Concurrency (Phase 5.1)

```bash
# Get JWT token
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@bcit.ca","password":"password"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Get current version
VERSION=$(curl -s http://localhost:8000/api/images/1 \
  -H "Authorization: Bearer $TOKEN" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['version'])")

# PATCH with correct If-Match → 200 + ETag
curl -s -D /tmp/headers.txt -X PATCH http://localhost:8000/api/images/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $VERSION" \
  -d '{"note":"test update"}'
# Check: grep -i etag /tmp/headers.txt

# PATCH with stale If-Match → 409 Conflict
curl -s -X PATCH http://localhost:8000/api/images/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $VERSION" \
  -d '{"note":"should fail"}'
# Expected: {"detail":"Resource has been modified by another client"}
```

## Testing Overlay Lock/Clear (Phase 5.1 UI)

1. Login as admin@bcit.ca
2. Navigate: Home → Architecture → Italian → click "Duomo di Milano"
3. Click "Draw selection rectangle" button in toolbar
4. Drag on the image to draw a rectangle
5. Click the lock button (padlock icon) — should change to locked state, clear button disabled
6. Click lock again to unlock
7. Click clear (X) button — overlays should disappear with no error

This tests the `latestVersionRef` fix: locking bumps the server-side version, and clearing must use the updated version (not the stale `selectedImage.version`) to avoid 409 errors.

## Image Upload Flow

1. Click "ADD IMAGE" button (top-right of HOME page)
2. Upload modal opens with: drag-drop area, Name, Category, Copyright, Note, Program fields, Active toggle
3. Click "browse to upload" or drag-and-drop a file (supports JPEG, PNG, TIFF, BMP, GIF, WebP, SVS)
4. Fill in Name (required for identification), optionally set Category and other fields
5. Click "ADD" button to upload
6. Modal closes immediately after HTTP upload completes
7. Backend processes the image (generates DZI tiles via pyvips)
8. Processing Snackbar appears at bottom-right with spinner
9. On completion: Snackbar turns green, category tree and uncategorized images auto-refresh

## File Upload via Playwright CDP

The browser's file chooser may not trigger reliably via computer-use clicks on the "browse to upload" link. Use Playwright CDP instead:

```python
import asyncio
from playwright.async_api import async_playwright

async def upload_image(file_path, image_name):
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp("http://localhost:29229")
        page = None
        for ctx in browser.contexts:
            for pg in ctx.pages:
                if "localhost:5173" in pg.url:
                    page = pg
                    break
        
        # Click ADD IMAGE
        await page.locator('button:has-text("Add Image")').click()
        await page.wait_for_timeout(1000)
        
        # Handle file chooser
        async with page.expect_file_chooser() as fc_info:
            await page.locator('text=browse to upload').click()
        file_chooser = await fc_info.value
        await file_chooser.set_files(file_path)
        await page.wait_for_timeout(1000)
        
        # Fill name and submit
        await page.get_by_label("Name").fill(image_name)
        await page.locator('button:has-text("ADD")').last.click()

asyncio.run(upload_image('/tmp/test-image.tiff', 'My Test Image'))
```

## Creating Test Images

```python
from PIL import Image
# Small image (~0.4MB) - processes in ~2-3 seconds
img = Image.new('RGB', (4000, 3000), color='blue')
img.save('/tmp/test-image.tiff', compression='tiff_lzw')

# Larger image (~1.9MB) - processes in ~3-5 seconds
img = Image.new('RGB', (8000, 6000), color='red')
img.save('/tmp/test-large-image.tiff', compression='tiff_lzw')
```

Note: Even "large" synthetic test images process quickly (2-5 seconds). Real pathology images (hundreds of MB) take much longer. For testing processing indicators, you may need to act quickly between upload and verification.

## Key Testing Tips

- **Snackbars**: Processing indicators are rendered at the App root level (`App.tsx`), so they persist across all page/tab switches
- **z-index**: Snackbars use `zIndex: 1500` to appear above MUI Dialog modals (z-index 1300)
- **Clickaway**: MUI Snackbar clickaway is explicitly ignored for processing jobs — clicking elsewhere won't dismiss them
- **Logout cleanup**: Processing jobs are cleared in the `useEffect` that watches `currentUser` changes
- **Logout button**: Use `page.get_by_role("button", name="Logout", exact=True)` to avoid matching image names that may contain "Logout" text
- **Auto-refresh**: On processing completion, `loadCategories()` and `loadUncategorizedImages()` are called automatically
- **Polling**: Uses `setTimeout` chaining (not `setInterval`) with `AbortController` for clean cancellation
- **Rate limit flush**: Before testing rate limiting, flush Redis with `docker exec redis redis-cli flushall` to clear previous attempts
- **Docker network naming**: The Redis container must be named `redis` (not `corgi-redis`) to match the default `REDIS_URL=redis://redis:6379` in `database.py`

## Devin Secrets Needed

No secrets needed — test credentials are seeded in the database via `db/seed.sql`.
