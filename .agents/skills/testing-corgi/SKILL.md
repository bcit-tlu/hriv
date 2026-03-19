# Testing Corgi Image Library

## Local Environment Setup

1. From the repo root, run:
   ```bash
   docker compose down -v  # Clean slate
   docker compose up --build
   ```
2. Wait for all three services to be ready:
   - `db-1`: "database system is ready to accept connections"
   - `backend-1`: "Application startup complete"
   - `frontend-1`: "VITE ready"
3. Frontend: http://localhost:5173
4. Backend API: http://localhost:8000

## Test Credentials

| User  | Email               | Password   | Role       |
|-------|---------------------|------------|------------|
| Haruki | admin@bcit.ca   | password   | admin      |

These are seeded automatically on first DB init via `db/seed.sql`.

## Docker Networking Notes

- If you see `network corgi_default was found but has incorrect label`, run:
  ```bash
  docker compose down -v
  docker network rm corgi_default  # may error if already removed, that's fine
  docker compose up --build
  ```
- The `docker compose down -v` flag removes volumes, giving a clean DB. Without `-v`, the DB persists between runs.

## Seed Data (Categories & Images)

After a fresh `docker compose up` with `-v`, the following seed data exists:

**Categories (hierarchical):**
- Architecture (root, id=1)
  - Italian (id=3, parent=1)
    - Gothic (id=5, parent=3)
  - American (id=4, parent=1)
- Panoramas (root, id=2)

**Images:**
- 4 seeded images with various category_id assignments
- Images uploaded via the Upload modal start with category_id = NULL (uncategorized)

## Testing Category Management

### Moving Categories
1. Log in as Haruki (admin)
2. Navigate to Home page — category tiles have a move icon (top-right corner, folder-arrow icon)
3. Click the move icon on a category tile to open the Move Category dialog
4. The Destination dropdown shows the full category tree with indentation, excluding the category being moved and its descendants (circular reference prevention)
5. Select a new parent (or "None (root level)" to make it a root category)
6. Click MOVE — the page refreshes to show the updated hierarchy

**Key things to verify:**
- The dropdown excludes the moving category and its descendants (prevents circular references)
- After moving, the category appears under the new parent
- Images within the moved category remain associated with it
- The move icon only appears for admin/instructor roles

### Image-Category Association (Edit Image Modal)
1. Navigate to IMAGES tab
2. Click any image row to open the Edit Image modal
3. The Category dropdown appears between Label and Copyright fields
4. The dropdown shows hierarchical options with "└" prefix indentation
5. Select a category or "None (root level)" to uncategorize
6. Click Save

**Key things to verify:**
- Category column in Images table shows hierarchical paths (e.g., "Architecture:Italian:Gothic")
- Each segment in the path is a clickable link that navigates to that category on the Home page
- After saving, the category path updates in the table
- Setting to "None (root level)" makes the image uncategorized

### Uncategorized Images on Home Page
- Images with no category (category_id = NULL) render at the root level of the Home page alongside category tiles
- After assigning a category to an image, it should disappear from the Home root
- After removing a category from an image, it should appear at the Home root

## Testing the Image Upload Pipeline

### Prerequisites
- The backend Dockerfile needs `libvips-dev`, `pkg-config`, and `gcc` for `pyvips` to install correctly. If you see `ModuleNotFoundError: No module named 'pyvips'`, check that these apt packages are in the Dockerfile.

### Upload Flow
1. Log in as Haruki (admin)
2. Navigate to IMAGES tab
3. Click "UPLOAD IMAGE" button (top right)
4. Use "browse to upload" or drag-and-drop an image file
5. Optionally edit the Label field
6. Click "Upload"
7. The modal closes and the images table reloads

### Background Processing
- After upload, VIPS tile generation runs as a background task
- The new Image record does NOT appear immediately — the frontend calls `loadImages()` right after the HTTP upload response, but background processing hasn't finished yet
- Check backend logs: `docker compose logs backend --tail=20`
- Look for: `Processed source image X -> image Y`
- After processing completes, refresh the Images page to see the new entry

### Verifying Tiles
- Check tiles on disk: `docker compose exec backend ls -la /data/tiles/{id}/`
- Expected files: `image.dzi`, `image_files/` directory, `thumbnail.jpeg`
- Verify DZI XML: `curl http://localhost:8000/api/tiles/{id}/image.dzi`
- Should return XML with `<Image>` root, `Format="jpeg"`, `TileSize="254"`, `Overlap="1"`

### Verifying in OpenSeaDragon
- On the Images table, click the three-dot menu on a row → "View"
- The viewer should display the image with zoom controls and a navigator mini-map
- Scroll to zoom in/out — this exercises the DZI tile pyramid at different levels

### Source Image Status API
- Get auth token: `curl -s http://localhost:8000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@bcit.ca","password":"password"}'`
- Query: `curl -s http://localhost:8000/api/source-images/ -H 'Authorization: Bearer {token}'`
- Verify: `status` should be `"completed"`, `image_id` should be non-null, and `stored_path` should NOT be in the response

## Creating Test Images

You can create synthetic test images with Python PIL:
```python
from PIL import Image
img = Image.new('RGB', (2000, 2000), (255, 255, 255))
pixels = img.load()
for x in range(2000):
    for y in range(2000):
        if (x // 100 + y // 100) % 2 == 0:
            pixels[x, y] = (200, 50, 50)
        else:
            pixels[x, y] = (50, 50, 200)
img.save('/tmp/test_checkerboard.jpg', quality=90)
```
A recognizable pattern like a checkerboard makes it easy to verify tile generation visually.

## Common Issues

- **pyvips ModuleNotFoundError**: Ensure `libvips-dev`, `pkg-config`, and `gcc` are installed in the Dockerfile before `poetry install`
- **Sequential access stream consumed**: When using `pyvips.Image.new_from_file(path, access="sequential")`, the pixel stream can only be read once. Use `pyvips.Image.thumbnail(path, size)` (class method, opens fresh file) instead of `image.thumbnail_image(size)` (instance method, reuses stream) for operations after `dzsave`
- **Network label conflict**: Docker compose network label mismatch — clean up with `docker compose down -v && docker network rm corgi_default`
- **Move dialog stale state**: The MoveCategoryDialog uses a `useEffect` to reset the destination when reopened. If the dialog shows a stale parent selection, check that the `useEffect` dependencies include both `open` and `category`.
- **Circular reference on move**: The backend validates `parent_id` changes by walking the ancestor chain. If a 400 error occurs when moving, check that the target is not a descendant of the category being moved.

## Devin Secrets Needed

No external secrets are required — the app uses local Docker Compose with seeded credentials.
