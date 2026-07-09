# Admin import / export & task lifecycle

Admins can export the entire database (and the source-image filesystem) to a
downloadable archive and re-import it later. These are long-running background
jobs tracked by the `AdminTask` model. This page documents the task lifecycle,
cancellation semantics, the two-session import pattern, stale-task
reconciliation, and exactly what data round-trips.

In the frontend admin UI, these controls live under the Admin page's
**Backups** tab. The separate **Changelog** tab is the default landing view.

- Endpoints: `backend/app/routers/admin.py`
- Runners: `backend/app/admin_ops.py`
- Model: `AdminTask` in `backend/app/models.py` (see [Domain model](domain-model.md))

## Task lifecycle

`AdminTask.task_type` is one of `db_export`, `db_import`, `files_export`,
`files_import`, `rebuild_tiles`. `AdminTask.status` transitions:

```
uploading ──▶ pending ──▶ running ──▶ completed
    │            │           │     └─▶ failed
    │            │           └─▶ cancelling ──▶ cancelled
    └────────────┴──▶ cancelled (pre-runner cancel)
```

Other fields: `progress` (0–100), `log` (append-only text), `result_filename` /
`result_path` (export output), `input_path` (import source), `error_message`,
`created_by` (FK to `User`, **SET NULL** on user delete).

- **`uploading`** is only used by **filesystem imports**, which upload an archive
  before a runner exists (see below). Other task types start at `pending`.
- **Concurrency guard** (`_create_task`): creating a task is rejected with
  **409** if another task of the **same type** is already in an active status
  (`uploading`, `pending`, `running`, `cancelling`).

## Cancellation semantics

The cancel endpoint behaves differently depending on the current status:

- **`pending` / `running` → `cancelling`** (soft cancel). The runner notices via
  cancellation-aware progress updates and aborts cleanly.
- **`cancelling` → `cancelled`** (force cancel). Handles a runner that died while
  cancelling, which would otherwise leave the concurrency guard stuck.
- **`uploading` → `cancelled`** (pre-runner cancel). No runner exists yet, so the
  task is cancelled directly.

**Cancellation-aware progress.** `_update_task(..., check_cancelled=True)`
re-reads the task status from the database; if it has been set to `cancelling`,
it raises `TaskCancelled` so the runner aborts and cleans up any partial files.

## Two-session import pattern

`run_db_import` uses **two separate database sessions**:

- **`status_session`** — writes `AdminTask` progress/log updates, committed
  freely so the admin UI sees live progress.
- **`data_session`** — performs the actual destructive clear + re-import,
  committed **once atomically at the very end**.

This means a mid-import failure rolls back _all_ data changes (via
`data_session`) without losing task-status visibility (already committed via
`status_session`).

**Self-deadlock prevention for `created_by`.** Before `data_session` deletes the
`users` table, the importing task's own `created_by` FK is detached **through
`status_session`** first. Otherwise `ON DELETE SET NULL` on
`admin_tasks.created_by` would try to update this task's row from inside
`data_session` while `status_session` (same coroutine) holds it — a deadlock.

## What data is included

**Export** (`run_db_export`) writes a JSON document containing: `programs`,
`groups`, `categories` (with `program_ids` and `group_ids`), `images`,
`source_images`, `users` (with program memberships), `changelog_entries`, and
the `announcement`.

Each exported **group** carries `name`, `description`, `created_by_user_id`,
`member_ids`, and `instructor_ids`.

**Import** (`run_db_import`) clears existing data and re-inserts it. Order
matters because of foreign keys.

- **Delete order** (junctions before parents):

  ```
  source_images → images → category_groups → category_programs → categories →
  group_members → group_instructors → groups → user_programs → users →
  changelog_entries → announcements → programs
  ```

- **Insert order** (parents before junctions; groups after users because
  members/instructors/creator are users):

  ```
  programs → users → groups → categories (restoring category↔program and
  category↔group links) → images → source_images → changelog_entries →
  announcement
  ```

- **Sequence reset.** After import, PostgreSQL sequences are reset to
  `max(id) + 1` so subsequent inserts don't collide. Sequences reset:
  `programs`, `groups`, `categories`, `images`, `users`, `announcements`,
  `changelog_entries`, `source_images`.

## Filesystem export/import

The Admin page's **Filesystem Export** is intentionally **source-images only**.
It writes a `.tar.gz` of the preserved filesystem data needed to restore the
application state, but it excludes the derived DZI tile pyramid under
`/data/tiles/**`. That keeps exports much smaller and avoids spending time
walking millions of generated tile files.

- **Export contents:** source images and other authoritative filesystem data.
- **Excluded:** the tile pyramid (`image_files/`, `image.dzi`,
  `thumbnail.jpeg`, and other derived tile artifacts) plus `admin_tasks/`
  scratch files.
- **Import behavior:** filesystem imports restore the source files only. After
  a successful files import, run **Rebuild Tiles** so images get fresh tiles.
  Until then, viewers may show missing or stale tile placeholders.

For a full cross-environment clone, follow this order:

1. **Database import**
2. **Filesystem import**
3. **Rebuild Tiles**

> Compression is parallelized with `pigz` when the backend container image
> provides it (the backend Dockerfile installs it); otherwise the export falls
> back to single-threaded gzip automatically.
> Set `EXPORT_PIGZ_THREADS=2` to cap pigz at a modest thread count; use `0`
> to opt out and let pigz use all available cores.

> HRIV is **not** in production and has no legacy export archives. Imports do not
> need to support older export formats — backward-compat code can be removed
> rather than maintained.

## Filesystem import upload phase

Filesystem imports use a two-step flow to stream a potentially large archive:

1. `create_files_import` creates the task in **`uploading`** status.
2. For small archives, `upload_task_file` accepts a raw `application/octet-stream`
   request body, streams the archive directly to disk, then atomically transitions
   `uploading → pending` (a guarded `UPDATE ... WHERE status = 'uploading'`, so a
   concurrent cancel is respected). Multipart uploads are rejected with
   **415** and wrong-state uploads return **409**.
3. For archives larger than 10 MiB, the client uses the resumable chunked flow:
   `GET /api/admin/tasks/{task_id}/upload` returns the current `bytes_received`;
   `PATCH /api/admin/tasks/{task_id}/upload` appends a raw chunk with the
   `Upload-Offset` and `Upload-Length` headers; and
   `POST /api/admin/tasks/{task_id}/upload/finalize` transitions the task to
   `pending` once the total bytes match. Offset mismatches return **409** with
   the current `bytes_received` so the client can resume without re-sending data.
4. Before streaming starts, the handler compares `Content-Length` (or the chunk /
   total size for chunked uploads) against free space on the admin-tasks volume.
   If the declared size will not fit, the task is marked failed and the endpoint
   returns **507** with the required and available byte counts.

Once the task enters `pending`, `run_files_import` stages the archive under
`IMPORT_STAGING_DIR` on the same volume as `data_dir` (default:
`<data_dir>/.import-staging`), performs a coarse free-space preflight with a
small margin over the compressed archive size, and extracts the archive in a
single pass. A second runtime floor checks the staging volume during
extraction so highly compressible archives still fail before the swap if free
space drops too low. When extraction finishes, it swaps each exported top-level
entry into `/data` one by one with same-volume renames. That keeps `tiles/`
and `admin_tasks/` in place, avoids a whole-directory rename of `/data`, and
removes the extra copytree back from `/tmp`.

Archive progress is reported from compressed bytes read, so the UI can keep a
meaningful extract bar without a separate count-only scan. The implementation
uses `pigz -dc` when available and falls back to Python gzip streaming when it
is not. Filesystem-import archives remain on the data volume after import so
operators can rerun them without re-uploading; delete them when you want to
reclaim space, and be aware that retained archives can accumulate over time.
The `IMPORT_STAGING_FREE_SPACE_FACTOR` preflight is only a coarse gate for the
compressed archive size; `IMPORT_STAGING_MIN_FREE_BYTES` is the authoritative
runtime floor during extraction.

Because entries are moved into place with `os.rename`, `IMPORT_STAGING_DIR`
**must be on the same filesystem/volume as `data_dir`** (the default satisfies
this). If it is overridden to a different volume, the import fails fast at the
preflight with a clear error rather than surfacing a cryptic cross-device
(`EXDEV`) failure part-way through the swap.

The admin UI's "Previously uploaded import archives" list shows cumulative
storage usage (for example, "3 retained archives using 87.4 GiB") so operators
can see at a glance how much persistent space retained archives consume before
deciding what to reclaim.

## Stored export archives

Completed `db_export` and `files_export` tasks leave their result archive on the
admin-tasks volume so it can be re-downloaded. Over time these accumulate, so
the admin UI's "Stored export archives" panel lists each retained export
artifact with its filename, size, owning task metadata, and cumulative storage
usage, and lets operators purge individual archives.

- `GET /admin/tasks/backup-archives` (admin only) lists all on-disk export
  result archives. Only `db_export`/`files_export` tasks whose `result_path`
  resolves (via `_safe_admin_task_file`) to an existing file **inside** the
  admin-tasks directory are returned. Each entry carries a `purgeable` flag that
  is `false` while the owning task is still active.
- `DELETE /admin/tasks/backup-archives/{task_id}/{artifact_role}` (admin only)
  deletes a single archive from disk and clears the task's `result_filename` /
  `result_path` columns. Only `artifact_role="result"` is supported (400
  otherwise); the task must exist (404) and be an export task (404 otherwise),
  and it must not be active (409 while `uploading`/`pending`/`running`/
  `cancelling`). Filesystem-import archives are managed separately via
  `DELETE /tasks/files-import/archives/{id}`.

When an export task reaches a terminal state, the panel refreshes automatically
so a newly produced archive appears without switching tabs.

## Rebuild tiles

`rebuild_tiles` regenerates DZI tile trees from the **preserved source images**.
Tiles are derived data, so this is the operator-safe recovery path when a
restore brings back the database (and source-image volume) but **not** the
large tile volume, or when a pipeline change makes existing tiles stale. See
[Tile-cache provenance](tile-cache-provenance.md) for how `missing` vs `stale`
is determined.

- Endpoint: `POST /admin/tasks/rebuild-tiles` (admin only). Optional JSON body
  `{ "scope": "missing_stale", "image_ids": [..] }`.
- Runner: `run_rebuild_tiles` in `admin_ops.py`; per-image work lives in
  `processing.rebuild_source_image_tiles` and target selection in
  `processing.select_rebuild_targets`.
- Parameters are persisted to a small JSON file referenced by the task's
  `input_path` (mirroring the db-import staging pattern) and deleted when the
  task reaches a terminal state.

**Scopes** (`scope`):

- `missing` — only source images whose tile manifest is absent on disk.
- `stale` — tiles present on disk but generated under an older settings hash.
- `missing_stale` _(default)_ — either of the above.
- `all` — force-rebuild every completed, linked source image.

`image_ids` optionally narrows the population to specific images.

**Filesystem-aware selection.** Selection checks the on-disk `image.dzi`
manifest directly rather than trusting database provenance, because a DB-only
restore can leave provenance reporting `current` while the tile files are gone.
Only the _authoritative_ source image for each image (the one referenced by
`Image.tile_sources`) is rebuilt, so a source superseded by a replacement is
never resurrected.

**Idempotent and resilient.**

- Tiles are generated into a temp directory and atomically swapped into place,
  so a mid-generation failure never destroys a good tile tree.
- Each image commits independently; a per-image failure is logged and the batch
  continues. The task only ends `failed` for a fatal setup error (e.g. an
  unreadable parameters file), never because one image failed.
- A rerun skips tile sets that are already current (unless `scope = all`), so
  the operation is safe to run repeatedly.

## Per-file backup restore

The admin area also exposes a manifest-browsing restore flow for restoring a
single file out of a backup snapshot archive:

- `GET /admin/backups/snapshots`
- `GET /admin/backups/snapshots/{snapshot_name}/manifest`
- `POST /admin/tasks/file-restore`

The backend talks directly to Azure Blob Storage with a read-only SAS URL
(`AZURE_READ_SAS_URL`) and the snapshot prefix (`AZURE_BACKUP_PREFIX`).
Snapshot manifests are read from the sidecar blob when present, with a
tar-stream fallback for older snapshots. The restore task only accepts members
under `data/` and reminds operators to run Rebuild Tiles if a restored source
image needs fresh tiles.

## Stale task reconciliation

`reconcile_stale_tasks` runs on **backend startup**. It marks any task stuck in
`uploading`/`pending`/`running`/`cancelling` whose `updated_at` is older than
`ADMIN_TASK_STALE_SECONDS` (default **900s = 15 min**) as `failed`. This clears
tasks whose runner process died (pod crash, OOM, rollout) so they don't block the
`_create_task` concurrency guard forever.

The freshness check on `updated_at` makes this **multi-replica safe**: a
sibling pod actively running a task keeps writing progress to `updated_at`, so a
newly starting pod won't clobber it.

## Tests to run after touching this area

- `backend/tests/test_admin_ops.py` — runner logic, export/import round-trip,
  reconciliation, `run_rebuild_tiles` batch behaviour.
- `backend/tests/test_router_admin.py` — endpoint behaviour, cancellation,
  upload phase, concurrency guard, rebuild-tiles request handling.
- `backend/tests/test_processing.py` — `select_rebuild_targets`,
  `rebuild_source_image_tiles`, and the tile-presence helpers.

See also: [Domain model](domain-model.md), [Groups](groups.md),
[agent feature map](agent-feature-map.md).
