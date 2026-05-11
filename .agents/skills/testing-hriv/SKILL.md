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

### Images
| ID | Name | Category | Source |
|---|---|---|---|
| 1 | Duomo di Milano | Italian | OpenSeadragon examples |
| 2 | Duomo di Milano (Gothic Detail) | Gothic | OpenSeadragon examples |
| 3 | Highsmith Panorama | American | Library of Congress |
| 4 | Library of Congress | Panoramas | Library of Congress |

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

### Edit Details / Add Image / Bulk Import modals
- All share a category dropdown rendering the full tree with view / edit / `+` icons.
- `+` on any row opens a "New Category" dialog; the new category is auto-selected.
- **Edit Details** has a **VIEW IMAGE** button that navigates to the viewer.
- When testing auto-select, cancel without saving after verifying the dropdown value
  to avoid polluting seed data.

### Category Management
- Manage > Categories has a full dialog with drag-and-drop reordering.
- Category tree changes are reflected immediately on Browse without a refresh
  (frontend invalidates the ETag-cached `/api/categories/tree` query).

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