# Rebuild Tiles Architecture Plan

Proposal only. This document defines the target architecture for making
post-restore tile regeneration both trustworthy and realistically usable at
larger archive sizes. It is intentionally detailed enough that a fresh session
should be able to decompose it into implementation issues without re-discovering
the design.

## Context

The current rebuild flow is a single `rebuild_tiles` `AdminTask` that iterates
serially through the selected source images and calls
`processing.rebuild_source_image_tiles` one image at a time. That shape is easy
to reason about and should remain the short-term safety baseline, but it has two
practical limits:

1. A large restore can take many hours or days to finish.
2. One long-lived worker coroutine owns the whole batch, so cancellation,
   retries, leases, and progress reporting are all coupled to that single job.

Recent reliability hardening fixed immediate failure modes around restore-driven
rebuilds, but the throughput ceiling remains. The next step should therefore be
an explicit supervisor-plus-workers design with bounded parallelism, persistent
progress, and conservative failure handling.

## Goals

- Preserve the current correctness guarantees for per-image tile generation.
- Make large rebuild campaigns resumable and observable.
- Allow bounded parallelism so restore-driven rebuilds finish in operationally
  realistic time.
- Keep cancellation and retry semantics explicit and recoverable after pod
  crashes or rollouts.
- Surface failures at image granularity without losing the overall campaign
  state.
- Fail clearly when disk-space or temp-dir constraints make forward progress
  unsafe.

## Non-goals

- Replacing ARQ entirely.
- Introducing speculative or adaptive scheduling in the first implementation.
- Rebuilding every tile variant in multiple places for redundancy.
- Hiding per-image failures behind a falsely green campaign result.

## Invariants

These rules should not change:

- Source images remain authoritative; tiles remain derived data.
- Per-image tile generation stays atomic: build into scratch, then swap into
  place only on success.
- Selection semantics for `missing`, `stale`, `missing_stale`, and `all` remain
  stable and test-covered.
- Automatic rebuild after filesystem import continues to use
  `scope=missing_stale`.
- A campaign must be safe to resume after process death without duplicating or
  corrupting tile trees.
- Cancellation must prefer a clean stop, but operators still need a recovery
  path if a worker dies mid-cancel.

## Why the next step should not be "just raise the timeout again"

Increasing the ARQ timeout buys headroom for the current serial design, but it
does not solve the real operational problem:

- Wall-clock restore time still scales almost linearly with image count.
- A single wedged image can monopolize the whole campaign slot.
- Progress is coarse because only one runner owns the batch.
- Cancellation remains tied to one long-lived coroutine.

That means the hardened serial path is the right immediate safety fix, but not
the right long-term architecture for larger restores.

## Proposed target architecture

### 1. A supervisor `AdminTask` owns the rebuild campaign

Keep the existing `AdminTask` row as the operator-facing campaign object:

- `task_type = rebuild_tiles`
- one row per campaign
- current API/UI polling continues to read from this row

The supervisor is responsible for:

- computing the target set
- persisting child work items
- scheduling bounded child work
- aggregating progress and logs
- handling cancellation and resume
- deciding the final campaign status

The supervisor should not rebuild tiles itself once child fan-out exists.

### 2. Persist child work explicitly

Add a dedicated child-work table rather than overloading `admin_tasks` for each
image. A dedicated table keeps the parent campaign model stable and allows
image-specific lease and retry metadata without polluting unrelated task types.

Suggested shape:

- `rebuild_tile_jobs.id`
- `admin_task_id`
- `source_image_id`
- `status` (`pending`, `leased`, `running`, `completed`, `failed`,
  `cancelled`)
- `attempt_count`
- `last_error`
- `lease_owner`
- `lease_expires_at`
- `started_at`
- `finished_at`
- `created_at`
- `updated_at`

Recommended constraints:

- unique `(admin_task_id, source_image_id)` so one campaign cannot enqueue the
  same source twice
- index on `(admin_task_id, status)`
- index on `(status, lease_expires_at)`

This table is the durable source of truth for resume, retries, and aggregated
progress.

### 3. Use bounded parallel child workers

The child execution unit should be one source image per ARQ job. That is the
right fault boundary because the tile builder already has strong per-image
atomicity.

Recommended first-pass controls:

- `REBUILD_TILES_MAX_PARALLELISM`
- default modestly, for example `2` or `4`
- global hard ceiling in code to prevent accidental cluster overload

The supervisor loop should enqueue new child jobs only while:

- the campaign is still active
- pending work exists
- active leases are below the configured limit

This should be conservative, not elastic. Predictability matters more than peak
throughput in the first cut.

### 4. Make child jobs lease-based and idempotent

Each child worker should:

1. Claim one `pending` job with a lease.
2. Mark it `running`.
3. Re-check campaign cancellation state.
4. Rebuild that source image's authoritative tile tree.
5. Commit `completed` or `failed` with structured error detail.

If a pod dies mid-image, the lease expires and the supervisor can requeue the
job safely because per-image rebuild is already atomic.

### 5. Separate campaign cancellation from child interruption

Cancellation should become a state transition, not only a best-effort exception
path:

- operator cancels campaign
- campaign row becomes `cancelling`
- supervisor stops scheduling new child jobs
- child workers check parent status before starting new work
- already-running child jobs are allowed to finish their current image unless a
  later force-cancel mechanism explicitly marks them abandoned

This is slower than immediate hard interruption, but it is safer for fidelity
and simpler to reason about.

Force-cancel can remain an operator escape hatch for dead workers, but it
should be modeled as campaign recovery rather than the primary control path.

### 6. Resume should be automatic

When the worker or backend restarts:

- expired child leases return to `pending`
- `running` children with expired leases become retryable
- the supervisor campaign is re-enqueued if it is still active

The operator should not need to restart the entire rebuild from zero after a pod
restart or rollout.

### 7. Make disk-space safety a first-class part of the design

The stall investigation should not be treated as a one-off. Whether the trigger
was temp-dir exhaustion, slow I/O, or a wedged image, the architecture needs
clear safeguards:

- use a known scratch root on the tiles volume or another explicitly configured
  same-filesystem location
- record the scratch root in logs at campaign start
- preflight free space before leasing new child work
- maintain a minimum free-space floor for the scratch filesystem
- fail an individual child clearly on `ENOSPC`
- surface campaign-level warnings when the free-space floor is approached
- clean up abandoned scratch directories during lease recovery

This reduces the chance of "stuck but not failed" behavior when the environment
cannot safely continue.

### 8. Progress and UI should aggregate from child state

Campaign progress should be derived from child rows, not inferred from log text.

Recommended aggregated counters:

- total targets
- pending
- running
- completed
- failed
- cancelled

The existing task modal can continue to show logs, but the summary line should
come from persisted counts so it remains accurate across restarts.

### 9. Logging and observability need to become structured

At minimum, log:

- campaign created with scope, image filter, and target count
- child lease claimed/released
- per-image start and finish
- retry attempts
- cancellation transitions
- disk-space warnings
- final campaign summary

Metrics are also worth adding if this code becomes operationally important:

- campaign duration
- image rebuild duration histogram
- retry count
- child failure count
- queue depth
- free-space floor breaches

## Proposed execution flow

1. Operator or files-import completion creates a `rebuild_tiles` campaign.
2. Supervisor computes targets and inserts one child row per source image.
3. Supervisor marks the campaign `running` and schedules up to
   `REBUILD_TILES_MAX_PARALLELISM` child jobs.
4. Each child rebuilds exactly one source image and persists its result.
5. Supervisor periodically aggregates counts and schedules more work.
6. If cancellation is requested, no new child work is leased.
7. When all children are terminal, supervisor marks the campaign:
   - `completed` if every child completed
   - `failed` if any child failed
   - `cancelled` if the campaign was cancelled before completion and no running
     child remains

## Recommended implementation phases

### Phase 0: keep the hardened serial path as the production baseline

Land and stabilize the current serial reliability work first:

- restore-driven rebuilds stay automatic
- long-running admin jobs get extended timeout without weakening short-lived
  worker protections
- cancellation and stale-task reconciliation remain intact

This phase is the fallback if the parallel campaign work slips.

### Phase 1: add persistent child-work modeling with no parallelism yet

Before introducing concurrency, add the campaign/child persistence model and
drive it serially. That isolates the risky state-machine work from the risky
parallelism work.

Deliverables:

- migration for `rebuild_tile_jobs`
- supervisor that persists and aggregates child rows
- serial child execution through the new state model
- restart/resume logic
- campaign progress from child counts

If Phase 1 is solid, the old monolithic loop can be removed.

### Phase 2: enable bounded parallelism

Once the child state machine is trustworthy, allow the supervisor to keep a
small number of children in flight.

Deliverables:

- configurable parallelism
- lease expiry and retry logic
- disk-space admission checks before scheduling
- structured logs for child scheduling

### Phase 3: operator controls and observability

Deliverables:

- clearer UI counters and status text
- child failure summaries in the task log
- explicit disk-pressure warnings
- optional admin API endpoints for child-job inspection

### Phase 4: scale validation and tuning

Before treating the new architecture as the default for large restores, run
repeatable drills with representative archives and record:

- wall-clock campaign duration
- average and tail per-image rebuild time
- retry count
- free-space headroom
- CPU and I/O contention against the live backend

Tune the default parallelism only after this data exists.

## Suggested issue breakdown

This plan should be decomposed into separate implementation issues roughly in
this order:

1. Schema and state-model issue for `rebuild_tile_jobs`
2. Supervisor refactor issue for campaign persistence and aggregation
3. Resume/lease-recovery issue
4. Bounded-parallel child execution issue
5. Disk-space safeguards and scratch cleanup issue
6. UI/progress/reporting issue
7. Scale-test and operational tuning issue

If desired, a spike issue can precede these to measure scratch-space behavior on
the current cluster and confirm whether temp-dir pressure contributed to the
observed stall.

## Testing strategy

The implementation should not be considered done without:

- unit tests for child state transitions, lease expiry, retries, and
  aggregation
- integration tests for cancel, resume, and partial failure behavior
- regression tests proving automatic post-import rebuild still uses
  `missing_stale`
- tests that simulate `ENOSPC` during scratch creation or tile write
- restart/recovery tests showing expired leases are reclaimed safely
- manual cluster drills with a representative restore archive

## Rollout strategy

- ship behind a feature flag or configuration switch if practical
- keep serial mode available as a fallback for one release
- document the operational tradeoffs and default parallelism
- do not remove force-cancel until the new cancellation path has seen real
  cluster use

## Recommendation

Move forward with the hardened serial path as the immediate production-safe
baseline, then implement the supervisor-plus-bounded-workers architecture in
staged steps. That sequence keeps restore fidelity high now while still
addressing the throughput and operability limits that appear once restore size
grows.
