# Durable jobs

HRIV uses PostgreSQL as the authoritative record for long-running business
operations. Redis/arq schedules execution, but queue state is not durable
history and must not be the only source of user-facing task status.

Issue #1067 introduced the generic `Job` / `JobItem` schema foundation.
Existing `AdminTask` and `BulkImportJob` flows remain separate. Durable tile
rebuild scheduling is the first workflow integration: admin-only creation,
cancellation, bounded item inspection, and retry controls shipped in #1191,
still behind the default-off `REBUILD_PARALLEL_ENABLED` feature flag.

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
the lease or finalize the item. An expired lease is reconciled through the
workflow retry policy: it returns to `queued` with a persisted
`retry_not_before` timestamp when another attempt remains, or finishes as
`failed` after exhaustion. The arq ID is diagnostic metadata only; it is never
the authoritative completion record.

A claim does not mean that child execution started. Claiming sets the item to
`running`, assigns ownership and lease metadata, increments `attempts`, and
leaves `started_at` null. A delivered child atomically reserves execution by
matching its job ID, item ID, claim token, running status, and null
`started_at`. Only that successful reservation sets `started_at`; duplicate or
stale deliveries exit without processing. Recovery clears `started_at` and all
stale ownership fields so a later attempt can reserve execution.

Lease expiry is a recovery signal, not proof that the prior process stopped.
A workflow using generic reclamation must therefore isolate or make idempotent
any work performed before it revalidates the current claim. Durable tile
rebuild attempts prepare into unique temporary trees, then lock and recheck the
claim before promotion, so a stale overlapping attempt cannot publish or
finalize work after ownership has moved.

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
2. recovers expired leases and counts valid running items in PostgreSQL;
3. claims only enough queued rows to fill the persisted parallelism window;
4. persists `rebuild:{job_id}:{item_id}:{attempt}` as each attempt's arq ID;
5. commits ownership before submitting child jobs to Redis/arq.

If submission fails, the attempt is released through the same bounded retry
policy used for worker timeouts and expired leases. If the process exits
between commit and submission, periodic reconciliation recovers the lease and
assigns a new attempt-specific arq ID after the persisted backoff is due. Redis
queue depth and arq result retention never determine active work.

Children recheck the authoritative source-image and tile-provenance state after
reserving execution. Current or superseded targets are skipped. Ready targets
reuse the same prepare/promote/rollback primitives as the serial rebuild,
heartbeat their lease during processing, and finalize only with the current
claim token. The persisted child timeout is enforced inside this execution
boundary so timeout cancellation becomes a durable retry/failure and metric;
arq keeps a fixed 25-hour safety timeout above the supported 24-hour child
maximum, independent of rollout settings, for stuck cleanup. Child
completion requests another pump after its database transaction commits; a
periodic worker sweep is the backstop for lost triggers.

Cancellation and retry requests lock the supervisor before mutating state. A
cancellation request changes the supervisor to `cancelling` and cancels queued
or claimed-but-not-started items in bounded batches. Started children finish
the active libvips generation rather than being forcibly interrupted, then
recheck cancellation before promotion. The supervisor becomes `cancelled` only
after running work drains, preserving work that committed before cancellation
won the lock.

Automatic retries are limited to typed transient failures such as connection
and timeout errors, selected temporary filesystem errno values, dispatch
failure, and lease expiry. Missing inputs, permission failures, exhausted
storage, malformed input, and unclassified libvips failures are terminal.
Persisted error summaries contain only the exception category and optional
symbolic errno, not arbitrary exception messages. Attempts increment at claim
time, duplicate delivery cannot consume another attempt, and explicit retry of
failed items preserves attempt history.

The scheduler settings are:

- `REBUILD_PARALLEL_ENABLED=false`
- `REBUILD_PARALLELISM=2`
- `REBUILD_CHILD_TIMEOUT_SECONDS=1800` (maximum `86400`)
- `REBUILD_LEASE_SECONDS=2100`
- `REBUILD_HEARTBEAT_SECONDS=30`
- `REBUILD_PUMP_CADENCE_SECONDS=60`
- `REBUILD_MAX_ATTEMPTS=2`
- `REBUILD_RETRY_BACKOFF_BASE_SECONDS=60`
- `REBUILD_RETRY_BACKOFF_CAP_SECONDS=900`

Parallelism is independent of `WORKER_MAX_JOBS`. Heartbeat and child timeout
must both be shorter than the lease, and pump cadence uses whole-minute
intervals. PostgreSQL `retry_not_before` timestamps, rather than delayed Redis
jobs, determine when retry work is claimable.

Two small metadata timestamps drive the latency measurements below:

- `job_items.metadata.claimed_at` — set when a claim commits (per attempt);
  the difference to execution reservation is the queue-wait histogram.
- `jobs.metadata.cancel_requested_at` — set when a cancellation request first
  moves the supervisor to `cancelling`; the difference to the terminal
  `cancelled` transition is the cancellation-latency histogram.

## Observability

Issue #1189 added the `hriv.tile_rebuild.*` instrument contract, emitted from
`tile_rebuild_metrics.py`. Counters and histograms are recorded in whichever
process runs the code path (the arq worker for pump/child execution, the API
for creation and cancellation) and exported via OTLP; durable-state gauges are
rendered at `/api/metrics` from PostgreSQL so worker-side execution is visible
on the API pod's scrape endpoint.

OTel instruments:

- `hriv.tile_rebuild.item.duration` — histogram (seconds), reservation to
  terminal outcome per item.
- `hriv.tile_rebuild.item.queue_wait` — histogram (seconds), claim commit to
  execution reservation per attempt.
- `hriv.tile_rebuild.supervisor.duration` — histogram (seconds), supervisor
  start to terminal status.
- `hriv.tile_rebuild.cancellation.latency` — histogram (seconds), cancellation
  request to `cancelled` status.
- `hriv.tile_rebuild.items.completed` — counter, `outcome` ∈ `completed` |
  `skipped` | `failed` | `cancelled`.
- `hriv.tile_rebuild.item.retries` — counter, `reason` ∈ `transient` |
  `lease_expired` | `dispatch` | `manual`.
- `hriv.tile_rebuild.item.timeouts` — counter for failures whose exception
  chain contains a timeout.
- `hriv.tile_rebuild.lease.reclaims` — counter, `state` ∈ `claimed` |
  `started` (whether execution had begun when the lease was reclaimed).
- `hriv.tile_rebuild.pump.runs` — counter, `outcome` ∈ `dispatched` | `idle` |
  `locked` | `failed`.
- `hriv.tile_rebuild.enqueue.failures` — counter, `reason` ∈
  `queue_unavailable` | `submission_error`.
- `hriv.tile_rebuild.duplicate_deliveries` — counter for deliveries that found
  their claim already superseded.

`/api/metrics` gauges (PostgreSQL-derived, `NaN` when the read fails):

- `hriv_tile_rebuild_jobs_active` — supervisors in an active state.
- `hriv_tile_rebuild_active_children` — running items under active
  supervisors; this is the effective parallelism gauge.
- `hriv_tile_rebuild_queued_items` — queued items under active supervisors.

Structured-log events (`rebuild.*`): `rebuild.job_created`,
`rebuild.job_terminal`, `rebuild.cancel_requested`,
`rebuild.items_bulk_cancelled`, `rebuild.retry_requested`,
`rebuild.item_reserved`, `rebuild.item_terminal`,
`rebuild.leases_reclaimed`, and `rebuild.duplicate_delivery`. Job, item, and
source-image IDs appear only in these events and in span attributes — never in
metric labels (see
[observability-conventions.md](observability-conventions.md)).

Images-per-hour and throughput percentiles are derived dashboard values from
`hriv.tile_rebuild.item.duration` and the `items.completed` counter rather
than dedicated instruments.

The existing admin rebuild endpoint and automatic post-import rebuild continue
to create serial `AdminTask` work. Durable creation requires both
`REBUILD_PARALLEL_ENABLED=true` and `TASK_EXECUTION_MODE=required`; when the
flag is off the `POST /api/jobs/rebuild-tiles` route rejects with 409 and the
admin UI keeps using the serial endpoint. The serial path remains the
immediate rollback and local-development behavior, and `POST
/api/admin/tasks/rebuild-tiles` is unchanged.

## API

All durable job endpoints (`routers/jobs.py`) are admin-only. Responses carry
the supervisor aggregate counts plus derived `queued_count` and
`running_count` item tallies, and never serialize claim tokens. Error payloads
contain only the bounded, sanitized summaries the service persists.

- `GET /api/jobs/` — list recent jobs, newest first (limit 50).
- `GET /api/jobs/{job_id}` — a single job's bounded supervisor state, 404 if
  not found. Item rows are **not** embedded; use the items endpoint.
- `GET /api/jobs/{job_id}/items` — bounded keyset-paginated item inspection
  ordered by `id` ascending. Query params: `status` (one of `queued`,
  `running`, `completed`, `skipped`, `failed`, `cancelled`), `after_id`
  (numeric cursor, omit on the first page), `limit` (default 50, max 100).
  Returns `{items, next_after_id}`; `next_after_id` is `null` when exhausted.
  Invalid filters or pagination return 422.
- `GET /api/jobs/rebuild-tiles` — capability probe returning
  `{enabled, parallelism}`. `enabled` is true only when parallel rebuilds are
  flag-enabled and `TASK_EXECUTION_MODE=required`.
- `POST /api/jobs/rebuild-tiles` — create a durable rebuild job. Accepts the
  existing `RebuildTilesRequest` (`scope`, optional `image_ids`) and returns
  the created job (201). Rejects with 409 when parallel mode is disabled or
  another rebuild (serial or durable) is already active. The first pump is
  requested only after the creation commit so the worker never observes an
  invisible job; the periodic pump sweep is the backstop for lost triggers.
- `POST /api/jobs/{job_id}/cancel` — idempotently request supervisor
  cancellation. Returns the current job for `queued`, `running`,
  `cancelling`, and already-`cancelled` jobs; 409 for `completed`, `failed`,
  and `completed_with_errors`. Cancellation is cooperative: started children
  finish their active tile generation before the supervisor finalizes as
  `cancelled`.
- `POST /api/jobs/{job_id}/items/{item_id}/retry` — requeue one failed item.
  404 for an unknown job or an item outside the job; 409 for an item that is
  not `failed`. Returns `{requeued_count, job}`; successful item history and
  attempt counts are preserved.
- `POST /api/jobs/{job_id}/retry-failed` — requeue every failed item through
  the bounded service batches (the router never loads the full item set).
  Returns `{requeued_count, job}`; 409 when the job is in a state where retry
  is not permitted (e.g. `cancelling`).

All mutation routes verify `job_type="rebuild_tiles"` — a valid `Job` id of a
different type returns 404, keeping the control surface narrow while the job
model stays generic. The serial `AdminTask` rebuild endpoint is unaffected.

## Import/export boundary

Generic job records are operational history, not restored application content.
Database export/import continues to round-trip domain data such as users,
programs, groups, categories, images, source images, changelog entries, and the
announcement. Existing `AdminTask` rows are also not part of that export/import
payload, and `Job` / `JobItem` records follow the same boundary until a workflow
explicitly requires portable job history.
