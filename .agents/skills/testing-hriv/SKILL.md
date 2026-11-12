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

## Quick Start

Fast on-ramp; the `references/` files hold the detailed per-feature flows.

```bash
touch backend/.env             # docker-compose references it (create if missing)
docker compose up -d --build   # frontend :5173, backend :8000, db, redis, worker, seed
```

- **App:** http://localhost:5173 · **API:** http://localhost:8000 (wait ~10s for the db to seed).
- **Login:** any seed account (see [references/seed-data.md](references/seed-data.md)) with password `password`.
- **UI / drag-and-drop / upload scripting:** Chrome CDP is on `http://localhost:29229`
  (see [references/environment-tips.md](references/environment-tips.md)).

**Then load only the reference for what you changed:**

| Task                                                                                                                                                     | Reference                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Seed accounts/data, API auth token                                                                                                                       | [references/seed-data.md](references/seed-data.md)                                                                      |
| UI navigation, tabs, modals, category/group/program management, in-app guide                                                                             | [references/ui-navigation.md](references/ui-navigation.md)                                                              |
| Browse grid: tiles, nesting, tile order, collection filing                                                                                               | [references/ui-navigation.md](references/ui-navigation.md) + [references/drag-and-drop.md](references/drag-and-drop.md) |
| Collections pages, manage table, viewers, filters, multi-owner/program transfer, orphaned-collection admin flow, Browse drawer and cover-picker fixtures | [references/collections.md](references/collections.md)                                                                  |
| OpenSeadragon viewer toolbar, magnification badge, canvas annotation edit mode (Fabric.js)                                                               | [references/viewer.md](references/viewer.md)                                                                            |
| Metadata operations (optimistic concurrency, `metadata_extra_merge`, injecting test data)                                                                | [references/metadata-ops.md](references/metadata-ops.md)                                                                |
| Drag-and-drop, tile reorder persistence, file drops, synthetic events                                                                                    | [references/drag-and-drop.md](references/drag-and-drop.md)                                                              |
| Admin export/import, archive contents                                                                                                                    | [references/admin-export-import.md](references/admin-export-import.md)                                                  |
| Image upload/processing, bulk import + ManagePage auto-refresh, image replacement                                                                        | [references/upload-processing.md](references/upload-processing.md)                                                      |
| Browser/CDP and local-stack tips, bind-mount revision checks, localhost throttling, nginx body size                                                      | [references/environment-tips.md](references/environment-tips.md)                                                        |

## Local Setup

For invite/change/force-change validation, load
[references/password-management.md](references/password-management.md). It
includes local backend-only compose startup, curl steps, the setup fragment,
OIDC fixtures and redaction requirements. No passwordless seed guest was added;
use a disposable account and leave documented seed credentials unchanged.

The stack is docker-compose based. Full compose file: `docker-compose.yml`
(plus `docker-compose.observability.yml` for the OTel/Prometheus/Tempo overlay).

```bash
touch backend/.env
docker compose up -d --build
```

- frontend: http://localhost:5173 (Vite dev server)
- backend: http://localhost:8000 (FastAPI)
- Postgres, Redis, arq worker, and the `seed`/`migrate` jobs run in compose.

### Troubleshooting: Frontend Docker Build Fails

If the frontend image build fails on `npm ci` (e.g. lockfile drift), recreate the
lockfile locally and rebuild:

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

## Object counting (epic #1661)

Backend API, counting worker (#1665: classical cells + InstanSeg nuclei, built from the `counting-worker` Docker target) and the viewer UI
(Count objects pop-up, progress snackbar, report modal) are all available.
Enable the flag and the dedicated worker via the `counting` compose profile:

```bash
COUNTING_ENABLED=true docker compose --profile counting up -d --build
```

Then exercise the API with the synthetic student (whose Administration
program allows access to the local-tiled seed image), or an admin/instructor:

```bash
TOKEN=$(curl -s http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"synthetic.student@example.ca","password":"password"}' | jq -r .access_token)
curl -s -X POST http://localhost:8000/api/images/5/counts \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"mode":"cells","selection":{"x":10,"y":10,"width":200,"height":200}}'
# -> {"job_id": "...", "status": "queued", "queue_position": 0}
curl -s http://localhost:8000/api/counts/<job_id> -H "Authorization: Bearer $TOKEN"
curl -s -X DELETE http://localhost:8000/api/counts/<job_id> -H "Authorization: Bearer $TOKEN"
```

Until the worker's `arq:counting:health-check` key exists the POST answers
503 `counting_unavailable`. See docs/object-counting.md for the contract.
Image 5 is **Synthetic Monitoring Image** on a fresh compose seed; on an
existing database locate it by name because IDs can differ. This fixture
tests the workflow, not biological accuracy on smear/tissue images.

UI steps (frontend landed with #1667/#1668):

1. Log in as `admin@example.ca` / `password` and open image **5** (the only
   seeded image with local tiles).
2. Toolbar **selection** button → drag a rectangle. A **Count objects**
   button appears above its top-right corner.
3. Choose **Cells** or **Nuclei**. A progress snackbar shows the queue
   position; the report dialog opens on completion with outlines, an
   unnamed **Group n** legend and a total.
4. The report opens in adjust mode (#1746): click an outline to remove it
   (click again to restore), click a missed object or drag to add an
   outline, **Reset** restores, **Done** leaves view-only. Close the
   report — outlines stay on the viewer. Reopen with **View results (N)**
   on the rectangle's button; **Cancel count** lives in its dropdown.
   Clear-all removes selections, outlines and results.

## Devin Secrets Needed

None for local testing — seed users are created automatically.
Backup-service S3/Azure testing needs credentials; see `testing-backup-service`.
