# Durable jobs

HRIV uses PostgreSQL as the authoritative record for long-running business
operations. Redis/arq schedules execution, but queue state is not durable
history and must not be the only source of user-facing task status.

Issue #1067 introduced the generic `Job` / `JobItem` schema foundation.
Existing `AdminTask` and `BulkImportJob` flows remain separate. Durable tile
rebuild scheduling is the first workflow integration, shipped behind a
default-off feature flag while its public creation and cancellation controls
remain deferred.

## State model

Supervisor `Job.status` values:

```text
queued
running
completed
completed_with_errors
failed
cancelling
cancelled
```

Child `JobItem.status` values:

```text
queued
running
completed
skipped
failed
cancelled
```

`queued`, `running`, and `cancelling` are active supervisor states. Terminal
supervisor states are `completed`, `completed_with_errors`, `failed`, and
`cancelled`.

## Supervisor and child items

A `Job` represents one logical operation, such as a future tile rebuild or
multi-resource maintenance task. A `JobItem` represents one independently
processable unit inside that operation.

Each supervisor stores aggregate counts (`total_count`, `completed_count`,
`skipped_count`, `failed_count`, `cancelled_count`) plus a coarse `progress`
percentage. Each item stores its own `attempts`, `progress`, timestamps,
optional `resource_type` / `resource_id`, and summarized error details.

Workers should update persisted state as execution proceeds:

1. create the supervisor record;
2. enumerate child items;
3. schedule bounded child work;
4. update item status and aggregate counts;
5. stop scheduling when cancellation is requested;
6. finish as `completed`, `completed_with_errors`, `failed`, or `cancelled`.

For child execution, a `running` item has a per-attempt claim token, heartbeat,
lease expiry, and optional arq job ID. Only the current claim token may extend
the lease or finalize the item. An expired lease may be returned to `queued` by
reconciliation. The arq ID is diagnostic metadata only; it is never the
authoritative completion record.

A claim does not mean that child execution started. Claiming sets the item to
`running`, assigns ownership and lease metadata, increments `attempts`, and
leaves `started_at` null. A delivered child atomically reserves execution by
matching its job ID, item ID, claim token, running status, and null
`started_at`. Only that successful reservation sets `started_at`; duplicate or
stale deliveries exit without processing. Reclamation clears `started_at` so a
later attempt can reserve execution.

## Execution boundary

PostgreSQL is authoritative for business state and operator-visible history.
Redis/arq remains an execution mechanism. If Redis data disappears, the database
must still show what work was requested and which child items completed or
failed.

The schema includes `metadata` JSONB columns on both `jobs` and `job_items` for
small structured workflow details. Do not store unbounded logs there; detailed
execution logs belong in the logging/observability stack.

## Durable tile rebuild scheduler

Durable tile rebuild jobs use `job_type="rebuild_tiles"` and snapshot one
`JobItem` per authoritative source image selected at creation time. The
supervisor metadata preserves the requested scope, selected image IDs, and the
execution settings for that run.

PostgreSQL enforces at most one active durable rebuild through a partial unique
index covering `queued`, `running`, and `cancelling` rebuild jobs. A shared
transaction-level PostgreSQL advisory lock also serializes durable job creation
with the existing serial `AdminTask` creation paths. This prevents a serial and
durable rebuild from starting concurrently without relying on Redis locks.

Each pump:

1. takes a non-blocking, per-job PostgreSQL advisory transaction lock;
2. reclaims expired leases and counts valid running items in PostgreSQL;
3. claims only enough queued rows to fill the persisted parallelism window;
4. persists `rebuild:{job_id}:{item_id}:{attempt}` as each attempt's arq ID;
5. commits ownership before submitting child jobs to Redis/arq.

If submission fails, an unstarted claim may be released immediately. If the
process exits between commit and submission, periodic reconciliation reclaims
the lease and assigns a new attempt-specific arq ID. Redis queue depth and arq
result retention never determine active work.

Children recheck the authoritative source-image and tile-provenance state after
reserving execution. Current or superseded targets are skipped. Ready targets
reuse the same prepare/promote/rollback primitives as the serial rebuild,
heartbeat their lease during processing, and finalize only with the current
claim token. Child completion requests another pump after its database
transaction commits; a periodic worker sweep is the backstop for lost triggers.

The scheduler settings are:

- `REBUILD_PARALLEL_ENABLED=false`
- `REBUILD_PARALLELISM=2`
- `REBUILD_CHILD_TIMEOUT_SECONDS=1800`
- `REBUILD_LEASE_SECONDS=2100`
- `REBUILD_HEARTBEAT_SECONDS=30`
- `REBUILD_PUMP_CADENCE_SECONDS=60`

Parallelism is independent of `WORKER_MAX_JOBS`. Heartbeat and child timeout
must both be shorter than the lease, and pump cadence uses whole-minute
intervals.

The existing admin rebuild endpoint and automatic post-import rebuild continue
to create serial `AdminTask` work. Parallel creation requires both
`REBUILD_PARALLEL_ENABLED=true` and `TASK_EXECUTION_MODE=required`, and no
public parallel creation API or UI is exposed in this phase. The serial path is
the immediate rollback and local-development behavior.

## API

The read-only visibility endpoints (`routers/jobs.py`) remain admin-only:

- `GET /api/jobs/` — list recent jobs, newest first (limit 50), same shape as
  the existing `AdminTask` listing.
- `GET /api/jobs/{job_id}` — a single job including its child `JobItem` rows,
  404 if not found.

No public endpoint creates, updates, or cancels durable jobs yet. Durable tile
rebuild creation is an internal service boundary until the later admin-control
phase supplies its API and UI.

## Import/export boundary

Generic job records are operational history, not restored application content.
Database export/import continues to round-trip domain data such as users,
programs, groups, categories, images, source images, changelog entries, and the
announcement. Existing `AdminTask` rows are also not part of that export/import
payload, and `Job` / `JobItem` records follow the same boundary until a workflow
explicitly requires portable job history.
