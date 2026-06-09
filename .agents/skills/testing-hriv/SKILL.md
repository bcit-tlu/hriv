---
name: testing-hriv
description: End-to-end testing guide for the HRIV app including local stack setup, seed data, auth, UI navigation, metadata operations, admin export/import, image upload, image replacement, drag-and-drop, tile sidecar routing, bulk import with ManagePage auto-refresh, and canvas annotation edit mode.
---

# Testing HRIV

End-to-end testing guide for the HRIV app: local stack bring-up, seed data, auth,
UI navigation, metadata operations, admin export/import, drag-and-drop, image upload,
and bulk import. For domain-specific flows see the sibling skills
`testing-image-processing` (tile pipeline / pyvips) and `testing-backup-service`
(disaster recovery).

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

### Testing Reorder Persistence (Drag-and-Drop)

When testing that tile reorder persists after drag-and-drop:

**Automated drag technique:** Use `mouse_move` → `left_mouse_down` → incremental `mouse_move` steps → `left_mouse_up`. The single-action `left_click_drag` often moves too fast for `@dnd-kit/react` v2's optimistic reflow to register the collision properly. Move in ~30px increments and ensure the pointer crosses past the target tile's center (the "far half" of the neighbor tile).

**Verification steps after a reorder:**
1. Check backend state: `GET /api/categories/tree` (authenticated) — verify `sort_order` values reflect new order
2. Navigate to a different tab (e.g. People) and back to Home — verify order persists
3. Full page reload (F5) — verify order persists

**Reorder API schema:**
```bash
curl -X PUT http://localhost:8000/api/categories/reorder \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"id":1,"parent_id":null,"sort_order":0},{"id":2,"parent_id":null,"sort_order":1}]}'
```

**Key insight:** After `@dnd-kit/react` v2's optimistic reflow, the collision detector may report `target.id === source.id`. This is expected — the `move()` helper uses the source's projected sortable index (not the target) to compute the correct reordered array. The drop event log will show e.g. `"Draggable item cat-2 was dropped over droppable target cat-2"` — this is normal and means the reorder succeeded.
