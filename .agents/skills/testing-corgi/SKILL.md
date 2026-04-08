# Testing the Corgi Image Library

## Local Dev Environment

```bash
# Start all services (PostgreSQL, backend, frontend)
docker compose up -d
# Frontend: http://localhost:5173
# Backend: http://localhost:8000
```

Wait for all containers to be healthy before testing:
```bash
docker compose ps
```

## Seed User Credentials

All seed users share the password: `password`

| Email | Role | Program |
|---|---|---|
| admin@bcit.ca | admin | Administration |
| instructor@bcit.ca | instructor | Digital Design |
| student@bcit.ca | student | Digital Design |

Use `admin@bcit.ca` for full access to all features (Images tab, Manage menu, Admin tab, People tab).

## Navigation

- **Images tab**: Click "IMAGES" in the top nav bar. Requires `admin` or `instructor` role (`canEditContent`).
  - **Add Image modal**: Click "ADD IMAGE" button (top right of Images page)
  - **Bulk Import modal**: Click "BULK IMPORT" button (top right of Images page)
  - **Edit Details modal**: Click the 3-dot menu (Actions column) on any image row → "Details"
- **Manage menu**: Click "MANAGE" tab → dropdown with Categories, Programs, Announcements
- **Admin tab**: Click "ADMIN" in the top nav. Requires `admin` role.
- **People tab**: Click "PEOPLE" in the top nav. Requires `admin` role.

## File Uploads in Testing

The native file chooser may not open in the testing environment. Use Playwright via CDP to set files on hidden `<input type="file">` elements:

```python
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp("http://localhost:29229")
        context = browser.contexts[0]
        page = None
        for pg in context.pages:
            if "localhost:5173" in pg.url:
                page = pg
                break
        if not page:
            print("ERROR: Could not find Corgi page")
            return
        # Use .last to get the most recently rendered file input (in the open modal)
        file_input = page.locator('input[type="file"]').last
        await file_input.set_input_files(['/tmp/test_image.png'])
        print("File uploaded successfully")

asyncio.run(main())
```

## Creating Test Images

```python
from PIL import Image
img = Image.new('RGB', (100, 100), color='red')
img.save('/tmp/test_image.png')
```

## Seed Data

- **Programs**: Administration (1), Digital Design (2), Photography (3)
- **Categories**: Architecture (root), Panoramas (root), Italian (under Architecture), American (under Architecture), Gothic (under Italian)
- **Images**: 4 seed images (Duomo di Milano, Gothic Detail, Highsmith Panorama, Library of Congress)

## Key Testing Flows

1. **Image Upload (Add Image)**: Login → Images tab → ADD IMAGE → select file → fill Name, Category, Copyright, Note, Program, Active → ADD
2. **Bulk Import**: Login → Images tab → BULK IMPORT → select files → pick Target Category + metadata → IMPORT N FILES → wait for job completion → DONE
3. **Edit Image Details**: Images tab → 3-dot menu → Details → verify/modify fields → SAVE
4. **Category Management**: Manage menu → Categories
5. **User Management**: People tab (admin only)

## Devin Secrets Needed

No secrets required for local testing — all credentials are in the seed data.
