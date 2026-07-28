# Reorder Operation Telemetry

Correlation, timing, and diagnostic telemetry for the Browse/Manage ordering
workflow (epic #975, issue #977). This page describes how one reorder
operation can be followed end-to-end across frontend events, backend traces,
structured logs, and metrics.

Names and labels follow the contract in
[`observability-conventions.md`](observability-conventions.md).

## Operation ID

Every ordering operation gets a client-generated `operation_id`
(`crypto.randomUUID()`, generated in
`frontend/src/reorderDiagnostics.ts`). The same ID appears in:

1. **Frontend diagnostic events** — one `reorder.operation` telemetry event
   per lifecycle state transition, sent through the authenticated ingestion
   endpoint (`POST /api/telemetry/events`).
2. **Persistence requests** — `PUT /api/categories/reorder` and
   `PUT /api/images/reorder` carry the `X-Reorder-Operation-Id` header.
3. **Backend spans** — `category.reorder` / `image.reorder` spans carry the
   `reorder.operation_id`, `reorder.entity`, and `reorder.item_count`
   attributes.
4. **Backend structured logs** — one `reorder.persisted` log line per
   persistence request with the operation ID, entity, item count, duration,
   outcome, and the request ID.

The header value is validated server-side (`^[A-Za-z0-9-]{8,64}$`); anything
else is dropped so arbitrary client text never reaches traces or logs.

## Lifecycle states

`REORDER_OPERATION_STATES` (frontend) and `REORDER_CLIENT_STATES` (backend)
share this bounded vocabulary:

| State             | Meaning                                                                          |
| ----------------- | -------------------------------------------------------------------------------- |
| `ignored`         | Drop accepted visually but discarded by the in-flight guard                      |
| `queued`          | Drop accepted and waiting behind an in-flight save (future #979)                 |
| `coalesced`       | Queued drop merged into a newer one before submission (future #979)              |
| `submitted`       | Persistence requests sent to the backend                                         |
| `committed`       | Persistence and follow-up refresh completed successfully                         |
| `conflicted`      | Backend rejected the operation due to a revision conflict (future #978/#980)     |
| `failed`          | Persistence failed (fully or partially) and the UI rolled back                   |
| `stale_discarded` | Refresh response discarded because a newer operation superseded it (future #980) |
| `abandoned`       | Component unmounted (navigation) while the operation was active                  |

`queued`, `coalesced`, `conflicted`, and `stale_discarded` are defined now so
dashboards and later sub-issues (#978–#980) can emit them without another
contract change; the current UI emits `ignored`, `submitted`, `committed`,
`failed`, and `abandoned`.

## Diagnostic event fields

`reorder.operation` events carry (all optional except `operation_id` and
`state`; bounded/coerced server-side in `backend/app/routers/telemetry.py`):

- `operation_id`, `state`, `item_type` (`category`/`image`/`mixed`)
- `category_id` (ordering scope: parent category, absent for the root scope)
- `image_id` (moved image, for single image moves)
- `from_index`, `to_index` (original and projected indices)
- `category_count`, `image_count` (items in the persisted scope)
- `queue_depth` (drops waiting behind the in-flight save)
- `local_revision` (client ordering revision; populated once #978 lands)
- `duration_ms` (for terminal states)
- `error` / `error_code` (bounded category — `api_http_4xx`, `api_http_5xx`, or `api_network_error` — for `failed`; never free-text)

Structured log fields are prefixed `reorder.*` (e.g. `reorder.state`,
`reorder.operation_id`).

## Metrics

Rendered into `/api/metrics` by `backend/app/reorder_metrics.py`. Labels are
bounded (`entity`, `outcome`, `state`); operation IDs and category IDs never
appear as metric labels.

| Metric                                  | Type      | Labels              | Meaning                                                             |
| --------------------------------------- | --------- | ------------------- | ------------------------------------------------------------------- |
| `hriv_reorder_request_duration_seconds` | Histogram | `entity`            | Server-side reorder persistence duration                            |
| `hriv_reorder_request_items`            | Histogram | `entity`            | Items per reorder persistence request                               |
| `hriv_reorder_requests_total`           | Counter   | `entity`, `outcome` | Requests by outcome (`success`/`failure`/`conflict`/`client_error`) |
| `hriv_reorder_client_operations_total`  | Counter   | `state`             | Client-reported lifecycle state transitions                         |

## Tracing one operation end-to-end

1. **Find the operation.** In Loki, query the frontend ingestion logs:
   `{service_name="hriv-backend"} | json | event_name="reorder.operation"`.
   Each state transition for the operation shares `reorder.operation_id`.
2. **Follow it to persistence.** Query
   `{service_name="hriv-backend"} | json | reorder_operation_id="<id>"` — the
   `reorder.persisted` lines give per-entity duration, item count, and
   outcome, plus `request_id` for the audit log.
3. **Open the trace.** In Tempo, search
   `{ span.reorder.operation_id = "<id>" }` to find the `category.reorder` /
   `image.reorder` spans with their database child spans.
4. **Interpret the outcome.** `abandoned` means the grid unmounted
   (navigation) while the save was active, so the outcome was unobservable to
   the user. For in-app (SPA) navigation the in-flight request keeps running,
   so the same operation usually also emits a terminal `committed` / `failed`
   afterwards — `abandoned` marks the UX gap, not the network outcome. An
   `abandoned` with no terminal event means a full page unload cut the
   operation off entirely. An `ignored` event is a drop the current UI
   silently discarded (the defect tracked by epic #975).

## Local verification

```bash
# Backend: correlation, structured logs, metrics
cd backend && poetry run pytest tests/test_reorder_telemetry.py

# Frontend: diagnostics module + grid correlation tests
cd frontend && npx vitest run tests/reorderDiagnostics.test.ts \
  tests/components/SortableTileGridReorderTelemetry.test.tsx
```
