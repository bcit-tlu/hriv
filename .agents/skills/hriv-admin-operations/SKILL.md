---
name: hriv-admin-operations
description: Work on HRIV admin workflows including database export/import, filesystem export/import, AdminTask lifecycle, task cancellation, stale task reconciliation, background task workers, changelog entries, announcements, maintenance mode, issue reports, admin UI, and admin operation tests.
---

# HRIV Admin Operations

Use this skill for administrator-facing operations and long-running task flows.

## Start Here

1. Read `references/admin-operations-map.md`.
2. Read `../../../docs/admin-import-export.md` for task lifecycle, cancellation,
   import transaction boundaries, and export/import ordering.
3. Read `../../../docs/changelog-notifications.md` when changing changelog,
   announcements, notification UI, or release-note admin behavior.
4. Use `$hriv-backend-api` for router/schema/model changes and
   `$hriv-frontend-ui` for admin UI changes.

## Fragile Contracts

- `AdminTask` active statuses block another task of the same type.
- Filesystem import starts in `uploading`; the upload endpoint atomically moves
  it to `pending` so cancellation remains race-safe.
- Filesystem import stages on the data volume via `IMPORT_STAGING_DIR` (default
  `<data_dir>/.import-staging`) and swaps exported top-level entries into `/data`
  one by one; do not reintroduce `/tmp` staging or whole-directory restore/copy
  behavior. Retained filesystem-import archives stay on disk for reruns; add a
  cleanup path when operators need to reclaim space.
- `run_db_import` uses separate status and data sessions so progress commits
  while destructive data import remains atomic.
- Keep DB import delete/insert ordering aligned with foreign keys, groups,
  categories, images, source images, changelog entries, and announcements.
- Reset PostgreSQL sequences after import.
- `reconcile_stale_tasks` must remain multi-replica safe by using freshness on
  `updated_at`.
- `rebuild_tiles` regenerates tiles from preserved source images. Selection is
  filesystem-aware (checks the on-disk `image.dzi`, not just DB provenance),
  only rebuilds the authoritative source per image, generates into a temp dir
  then atomically swaps, commits per image, isolates per-image failures, and is
  idempotent (skips already-current tiles unless `scope = all`). See
  `../../../docs/admin-import-export.md#rebuild-tiles` and
  `../../../docs/tile-cache-provenance.md`.

## Validation

Common targeted tests:

```bash
cd backend && poetry run pytest tests/test_admin_ops.py tests/test_router_admin.py
```

For admin UI changes, also run the relevant frontend component tests and use
`$testing-hriv` for browser flows when behavior crosses the API/UI boundary.
