# Scalable Rebuild Architecture for Backup Restores (Design)

Proposal only — this document plans the next-stage rebuild architecture for
production-scale restore fidelity (issue #863). Nothing here is implemented;
it exists so a fresh session can decompose the plan into concrete sub-tasks
and PRs.

## Problem

After a restore that brings back the database and source-image volume but not
the tile volume, `rebuild_tiles` regenerates every DZI tree from preserved
source images. The current runner (`run_rebuild_tiles` in
`backend/app/admin_ops.py`) is a **single long-lived arq job** that iterates
targets serially:

- One `AdminTask` row is both the unit of scheduling and the unit of progress.
- Per-image work (`processing.rebuild_source_image_tiles`) is committed as it
  completes, so reruns skip current tile sets — but the batch itself is one
  job bounded by `WorkerSettings.job_timeout` (2 h) and one worker slot.
- Observed per-image rebuild times mean a peak-sized restore (thousands of
  pyramidal TIFF/SVS sources) runs for many hours to days on one worker,
  monopolizes one of `max_jobs = 4` slots, and any worker restart converts the
  whole batch into a `failed` task that must be re-triggered manually.
- Progress is a log stream plus a single percentage; there is no persisted
  per-image state an operator (or the UI) can query, retry, or resume from.

Correctness is fine; **throughput, resumability, and observability are not.**

## Goals

- Preserve per-image rebuild fidelity and atomicity (per-image commit,
  provenance verification via `source_checksum` — see
  [tile-cache-provenance.md](tile-cache-provenance.md)).
- Realistic end-to-end restore times at peak scale via bounded parallelism.
- Reliable cancellation, retry, resume, and operator observability.
- A migration path that keeps the current serial flow working until the new
  path is proven.

Non-goals: changing tile generation itself (libvips pipeline), changing what
counts as `missing`/`stale`, or introducing new infrastructure beyond the
existing Postgres + Redis/arq pair.

## Proposed architecture

### 1. Supervisor task model with persisted child work items

Keep the operator-facing `AdminTask` (`task_type="rebuild_tiles"`) as the
**supervisor**. Add a persisted work-item table:

```text
rebuild_work_items
  id                PK
  task_id           FK → admin_tasks.id (supervisor)
  source_image_id   FK → source_images.id
  status            pending | running | completed | failed | skipped | cancelled
  attempts          int, default 0
  error_message     text NULL
  started_at / finished_at  timestamptz NULL
  UNIQUE (task_id, source_image_id)
```

The supervisor's job becomes: select targets
(`processing.select_rebuild_targets`), bulk-insert work items, fan out, and
aggregate. All rebuild state lives in Postgres, so it survives worker
restarts and is queryable by the API/UI.

### 2. Bounded parallelism and worker isolation

Fan-out executes as **per-image arq jobs** (`rebuild_tile_set(work_item_id)`),
each short-lived and independently retryable:

- Concurrency is bounded by a new setting
  `REBUILD_MAX_PARALLELISM` (default 2), enforced by the supervisor: it keeps
  at most N child jobs in flight (claim next `pending` item with
  `SELECT ... FOR UPDATE SKIP LOCKED`, enqueue, repeat). This bounds both
  Redis queue depth and libvips memory/CPU pressure independently of
  `max_jobs`.
- Child jobs are plain arq functions with a per-image `job_timeout` (e.g.
  30 min) instead of the batch-wide 2 h bound.
- Worker isolation: a crashing/OOMing image kills one child job, not the
  batch. The item is marked `failed` with `attempts` incremented; the
  supervisor continues.
- Redis-less fallback: when arq is unavailable the supervisor degrades to the
  current in-process serial loop over the same work items, so behavior on
  single-container/dev setups is unchanged in shape but gains persistence.

### 3. Idempotency, deduplication, and rerun semantics

- A child job is idempotent: it re-checks the item's tile-set status
  (missing/stale per provenance) before doing work and marks the item
  `skipped` if already current — safe against duplicate delivery.
- Work items are deduplicated by `UNIQUE (task_id, source_image_id)`; the
  single-active-rebuild guard (`_queue_rebuild_tiles_after_import` /
  `ACTIVE_TASK_STATUSES`) is preserved so at most one supervisor is active.
- **Resume**: re-running a rebuild after interruption creates a new supervisor
  that selects targets the same way; already-rebuilt images evaluate as
  current and produce `skipped` items cheaply. Optionally (phase 3) a
  `POST /admin/tasks/rebuild-tiles/{id}/resume` can reuse an interrupted
  supervisor's remaining `pending`/`failed` items directly.
- **Retry**: failed items can be retried up to `REBUILD_MAX_ATTEMPTS`
  (default 2) automatically; beyond that they stay `failed` for manual
  inspection, and the supervisor completes with a failure summary (matching
  today's "batch never fails because one image failed" semantics).

### 4. Cancellation

Cancellation stays status-driven: setting the supervisor to `cancelling`
stops new claims; in-flight child jobs observe the same DB poll between
pipeline stages that `run_files_import` uses and abort at the next
checkpoint. Remaining `pending` items are marked `cancelled`; completed
rebuilds are retained (same contract as today).

### 5. Progress aggregation, failure reporting, and UI state model

- Supervisor progress = `completed+failed+skipped / total` derived from work
  items with a periodic aggregate query — no more log-line-driven progress.
- New read endpoint `GET /admin/tasks/rebuild-tiles/{id}/items?status=failed`
  lists items (paginated) so the UI can show a per-image table: counts by
  status, error messages, attempts.
- The existing task log remains for coarse operator narrative; structured
  events (`admin_task.rebuild_tiles_*`) gain `work_item_id` /
  `source_image_id` attributes for tracing, consistent with
  [observability-conventions.md](observability-conventions.md).
- UI: the Admin task panel adds a "rebuild details" drawer fed by the items
  endpoint — status breakdown, failed-item list with per-item retry.

### 6. Migration path from the serial flow

The serial runner stays the default until the parallel path is validated:

1. Ship schema + work-item bookkeeping _inside_ the existing serial loop
   (items recorded, still executed serially). No behavior change; UI gains
   the items view.
2. Ship the supervisor/fan-out path behind `REBUILD_PARALLELISM_ENABLED`
   (default off). The automatic post-import rebuild keeps using the serial
   path until the flag flips.
3. Enable by default after validation; remove the flag one release later.
   The serial in-process loop survives as the Redis-less fallback.

## Validation strategy for large restore scenarios

- **Unit**: work-item claiming (SKIP LOCKED under concurrency), idempotent
  child re-check, retry/attempt accounting, cancellation checkpoints,
  aggregation math (`backend/tests/test_admin_ops.py`,
  `test_processing.py`).
- **Scale rehearsal**: a fixture-driven rehearsal (mirroring the reorder
  fixture approach) that seeds N synthetic source images with tiny valid
  TIFFs and drives a full supervisor run at parallelism 1 vs N, asserting:
  statement counts bounded, no lost/duplicated items, resume after a
  simulated worker kill completes the remainder.
- **Staging drill**: extend the DR runbook
  ([backup-restore-runbook.md](backup-restore-runbook.md)) with a timed
  rebuild drill; record images/hour at parallelism 1/2/4 to pick the default.
- **Acceptance**: a peak-scale restore completes within the DR RTO with
  parallelism ≥ 2; a worker restart mid-run loses at most in-flight items;
  operator can enumerate and retry every failure from the UI.

## Phased implementation breakdown (follow-on sub-issues)

| Phase | Scope                                                                                                                                        | Outcome                                          |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1     | `rebuild_work_items` schema + Alembic migration; serial runner records items; items read endpoint                                            | Persistence + observability, no execution change |
| 2     | Per-image arq job + supervisor claim/fan-out loop behind `REBUILD_PARALLELISM_ENABLED`; bounded by `REBUILD_MAX_PARALLELISM`; retry/attempts | Parallel execution path, flagged off             |
| 3     | Cancellation/resume endpoints wired to work items; UI details drawer + per-item retry                                                        | Operator control surface                         |
| 4     | Scale rehearsal fixture + staging drill; tune defaults; flip flag on                                                                         | Validated defaults, enabled                      |
| 5     | Cleanup: remove flag, fold serial loop into Redis-less fallback docs                                                                         | Steady state                                     |

Each phase is independently shippable and reversible; phases 1–2 are
backend-only.
