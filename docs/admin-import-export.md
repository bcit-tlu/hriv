# Admin import / export & task lifecycle

Admins can export the entire database (and the source-image filesystem) to a
downloadable archive and re-import it later. These are long-running background
jobs tracked by the `AdminTask` model. This page documents the task lifecycle,
cancellation semantics, the two-session import pattern, stale-task
reconciliation, and exactly what data round-trips.

- Endpoints: `backend/app/routers/admin.py`
- Runners: `backend/app/admin_ops.py`
- Model: `AdminTask` in `backend/app/models.py` (see [Domain model](domain-model.md))

## Task lifecycle

`AdminTask.task_type` is one of `db_export`, `db_import`, `files_export`,
`files_import`. `AdminTask.status` transitions:

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

This means a mid-import failure rolls back *all* data changes (via
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
`source_images`, `users` (with program memberships), and the `announcement`.

Each exported **group** carries `name`, `description`, `created_by_user_id`,
`member_ids`, and `instructor_ids`.

**Import** (`run_db_import`) clears existing data and re-inserts it. Order
matters because of foreign keys.

- **Delete order** (junctions before parents):

  ```
  source_images → images → category_groups → category_programs → categories →
  group_members → group_instructors → groups → user_programs → users →
  announcements → programs
  ```

- **Insert order** (parents before junctions; groups after users because
  members/instructors/creator are users):

  ```
  programs → users → groups → categories (restoring category↔program and
  category↔group links) → images → source_images → announcement
  ```

- **Sequence reset.** After import, PostgreSQL sequences are reset to
  `max(id) + 1` so subsequent inserts don't collide. Sequences reset:
  `programs`, `groups`, `categories`, `images`, `users`, `announcements`,
  `source_images`.

> HRIV is **not** in production and has no legacy export archives. Imports do not
> need to support older export formats — backward-compat code can be removed
> rather than maintained.

## Filesystem import upload phase

Filesystem imports use a two-step flow to stream a potentially large archive:

1. `create_files_import` creates the task in **`uploading`** status.
2. `upload_task_file` streams the archive, then atomically transitions
   `uploading → pending` (a guarded `UPDATE ... WHERE status = 'uploading'`, so a
   concurrent cancel is respected). Wrong-state uploads return **409**.

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
  reconciliation.
- `backend/tests/test_router_admin.py` — endpoint behaviour, cancellation,
  upload phase, concurrency guard.

See also: [Domain model](domain-model.md), [Groups](groups.md),
[agent feature map](agent-feature-map.md).
