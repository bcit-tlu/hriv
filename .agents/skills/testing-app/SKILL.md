# Testing the Corgi Frontend

## Local Development Setup

1. Start all services: `docker compose up --build` from the repo root
2. Frontend: http://localhost:5173
3. Backend: http://localhost:8000
4. Wait ~10s after containers start for the database to seed

## Seed Data

- **Login**: See `db/init.sql` for seed credentials (admin user with canEditContent and canManageUsers)
- **Categories**: Architecture (parent) > Italian > Gothic, Architecture > American, Panoramas
- **Images**: Duomo di Milano (Italian), Duomo di Milano Gothic Detail (Gothic), Highsmith Panorama (American), Library of Congress (Panoramas)

## Key UI Paths

### Images Tab (Manage > Images)
- Click the three-dot menu on any image row for View/Details/Move/Delete
- "Details" opens the Edit Details modal with form fields and View Image button
- Filter row appears when clicking the filter icon in the table header

### Category Management
- Category dropdowns appear in Edit Details, Add Image, and Bulk Import modals
- Click "+" on any category row in the dropdown to add a child category
- The Manage > Categories tab has a full category management dialog with drag-and-drop reordering

### Image Viewer
- Access via browse view (Home > click category > click image) or via View Image button in Edit Details
- OpenSeadragon-based tiled image viewer with zoom/pan/rotate controls

### Add Image / Bulk Import
- "Add Image" and "Bulk Import" buttons on the Images tab
- Image processing creates a snackbar notification with a "View image" link on completion

## Rebuilding After Code Changes

If code changes are made on the branch, rebuild the frontend container:
```bash
docker compose up -d --build frontend
```
Wait a few seconds for the container to restart, then refresh the browser.
