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

| Task                                                                                       | Reference                                                              |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Seed accounts/data, API auth token                                                         | [references/seed-data.md](references/seed-data.md)                     |
| UI navigation, tabs, modals, category/group/program management, in-app guide               | [references/ui-navigation.md](references/ui-navigation.md)             |
| OpenSeadragon viewer toolbar, magnification badge, canvas annotation edit mode (Fabric.js) | [references/viewer.md](references/viewer.md)                           |
| Metadata operations (optimistic concurrency, `metadata_extra_merge`, injecting test data)  | [references/metadata-ops.md](references/metadata-ops.md)               |
| Drag-and-drop, tile reorder persistence, file drops, synthetic events                      | [references/drag-and-drop.md](references/drag-and-drop.md)             |
| Admin export/import, archive contents                                                      | [references/admin-export-import.md](references/admin-export-import.md) |
| Image upload/processing, bulk import + ManagePage auto-refresh, image replacement          | [references/upload-processing.md](references/upload-processing.md)     |
| Browser/CDP/test-environment tips, localhost throttling, nginx body size                   | [references/environment-tips.md](references/environment-tips.md)       |

## Local Setup

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

## Devin Secrets Needed

None for local testing — seed users are created automatically.
Backup-service S3/Azure testing needs credentials; see `testing-backup-service`.
