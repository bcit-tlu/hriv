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

## Devin Secrets Needed

No secrets needed — test credentials are seeded in the database via `db/seed.sql`.
