# Durable jobs

HRIV uses PostgreSQL as the authoritative record for long-running business
operations. Redis/arq schedules execution, but queue state is not durable
history and must not be the only source of user-facing task status.

Issue #1067 introduces the generic `Job` / `JobItem` schema foundation. Existing
`AdminTask`, `BulkImportJob`, and source-image processing flows are not migrated
in the initial foundation PR; they can move onto this model incrementally as
each workflow is made resumable and cancellation-aware.

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

## Execution boundary

PostgreSQL is authoritative for business state and operator-visible history.
Redis/arq remains an execution mechanism. If Redis data disappears, the database
must still show what work was requested and which child items completed or
failed.

The schema includes `metadata` JSONB columns on both `jobs` and `job_items` for
small structured workflow details. Do not store unbounded logs there; detailed
execution logs belong in the logging/observability stack.

## API

Phase 1 exposes read-only visibility over these tables (`routers/jobs.py`),
admin-only for now since there are no producers yet and this is purely
operational visibility:

- `GET /api/jobs/` — list recent jobs, newest first (limit 50), same shape as
  the existing `AdminTask` listing.
- `GET /api/jobs/{job_id}` — a single job including its child `JobItem` rows,
  404 if not found.

No endpoint creates, updates, or cancels jobs yet — that lands with the first
workflow migrated onto this model (see phase 2 discussion below).

## Import/export boundary

Generic job records are operational history, not restored application content.
Database export/import continues to round-trip domain data such as users,
programs, groups, categories, images, source images, changelog entries, and the
announcement. Existing `AdminTask` rows are also not part of that export/import
payload, and `Job` / `JobItem` records follow the same boundary until a workflow
explicitly requires portable job history.
