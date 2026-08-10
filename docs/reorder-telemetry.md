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
2. **Persistence requests** — `PUT /api/tile-order` carries the operation ID
   in the request body (`operation_id`); the legacy per-entity reorder
   endpoints that carried the `X-Reorder-Operation-Id` header were removed
   in #998.
3. **Backend spans** — `tile.reorder` spans carry the
   `reorder.operation_id`, `reorder.entity`, and `reorder.item_count`
   attributes.
4. **Backend structured logs** — one `reorder.persisted` log line per
   persistence request with the operation ID, entity, item count, duration,
   outcome, and the request ID.

The request-body `operation_id` is validated server-side
(`^[A-Za-z0-9-]{8,64}$`); anything else is dropped so arbitrary client text
never reaches traces or logs.

## Lifecycle states

`REORDER_OPERATION_STATES` (frontend) and `REORDER_CLIENT_STATES` (backend)
share this bounded vocabulary:

| State             | Meaning                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `ignored`         | Drop accepted visually but discarded by the in-flight guard (legacy path, removed in #998) |
| `queued`          | Drop accepted and waiting behind an in-flight save                                         |
| `coalesced`       | Queued drop merged into a newer one before submission                                      |
| `submitted`       | Persistence requests sent to the backend                                                   |
| `committed`       | Persistence completed successfully and the authoritative order was applied                 |
| `conflicted`      | Backend rejected the operation due to a revision conflict                                  |
| `failed`          | Persistence failed (fully or partially) and the UI rolled back                             |
| `stale_discarded` | Queued snapshot or refresh response discarded because it was superseded (#980)             |
| `abandoned`       | Component unmounted (navigation) while the operation was active (legacy path)              |

The coordinator (`frontend/src/tileOrdering.ts`) emits `queued`,
`coalesced`, `submitted`, `committed`, `conflicted`, `failed`, and (since
#980) `stale_discarded` when conflict resolution discards a queued snapshot
(see below). `ignored` and `abandoned` were emitted only by the legacy
non-coordinator grid path removed in #998; they remain in the vocabulary so
historical dashboards keep working. As of #982 both reorder surfaces
persist through the same coordinator: the Browse grid and the Manage
Categories dialog both hand their full per-scope order to
`tileOrderingCoordinator.reportOrder`, so the coordinator owns the entire
lifecycle for every ordering operation (the dialog no longer emits its own
`submitted`/`committed`/`failed` events). Each coordinator save is one
operation ID per scope — a Manage drag that touches two scopes (a
cross-parent move) produces one lifecycle per affected scope rather than one
shared ID, and every surface emits exactly one `submitted` and one terminal
event per operation ID.

Three coordinator edge cases relax that pairing. Two are tied to revision
seeding (the one-time `GET /api/tile-order` that fetches a scope's CAS token
before its first save):

- A seeding failure emits a terminal `failed` for a fresh operation ID with
  no preceding `submitted` — nothing was ever submitted, so dashboards
  pairing `submitted` with terminals should treat `failed` events whose ID
  never appeared as `submitted` as pre-submission (seeding) failures.
- A drop landing while its scope's very first snapshot is still seeding
  coalesces into that snapshot and emits `coalesced` for an operation ID
  that never emitted `queued` (the seeded snapshot itself was reported via
  the dirty path, which does not mint a queue-time ID).

The third is conflict resolution (#980): drops made while a 409 conflict is
unresolved queue behind the retained local intent (the first mints a fresh
operation ID and emits `queued`; later ones emit `coalesced` for it). If the
user resolves the conflict with "Refresh" (`acceptServerOrder`), that queued
snapshot is discarded and its operation ID closes with a terminal
`stale_discarded` — such an ID never reaches `submitted`. Resolving with
"Keep my order" (`reapplyLocalOrder`) re-submits the retained intent, so the
ID continues its normal `submitted` → terminal lifecycle.

Server-side, an event that omits `state` entirely is logged with
`reorder.state: "missing"` and skipped by the client-operations counter, so
the `other` bucket only ever means "unrecognized state" (vocabulary drift).
Synthetic-monitor traffic is also excluded from
`hriv_reorder_client_operations_total`; structured logs keep
`event.synthetic` for both real and synthetic events. Note the asymmetry:
the server-side `hriv_reorder_requests_total` and duration/item histograms
still include synthetic journeys (consistent with the other server request
metrics), so client-vs-server comparisons will show a gap proportional to
synthetic reorder volume.

## Diagnostic event fields

`reorder.operation` events carry (all optional except `operation_id` and
`state`; bounded/coerced server-side in `backend/app/routers/telemetry.py`):

- `operation_id`, `state`, `item_type` (`category`/`image`/`mixed`)
- `category_id` (ordering scope: parent category, absent for the root scope)
- `item_id` (the dragged tile's ID, regardless of `item_type` — including
  `mixed` scopes and category moves)
- `image_id` (moved image, for single image moves; also drives the ingestion
  display-name lookup)
- `from_index`, `to_index` (original and projected indices)
- `category_count`, `image_count` (items in the persisted scope)
- `queue_depth` (coordinator coalescing depth; capped at 1 because a newer queued snapshot replaces the older one)
- `local_revision` (the client's ordering revision for the scope at submission time)
- `duration_ms` (for terminal states)
- `error` / `error_code` (bounded category — `api_http_4xx`, `api_http_5xx`, or `api_network_error` — for `failed`; never free-text)

Structured log fields are prefixed `reorder.*` (e.g. `reorder.state`,
`reorder.operation_id`).

## Metrics

Rendered into `/api/metrics` by `backend/app/reorder_metrics.py`. Labels are
bounded (`entity` — `category`, `image`, or `tile` for the atomic
`PUT /api/tile-order` endpoint (`docs/tile-ordering.md`) — plus `outcome`
and `state`); operation IDs and category IDs never appear as metric labels.

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
   `{ span.reorder.operation_id = "<id>" }` to find the `tile.reorder`
   spans with their database child spans.
4. **Interpret the outcome.** `abandoned` means the grid unmounted
   (navigation) while the save was active, so the outcome was unobservable to
   the user. For in-app (SPA) navigation the in-flight request keeps running,
   so the same operation usually also emits a terminal `committed` / `failed`
   afterwards — `abandoned` marks the UX gap, not the network outcome. An
   `abandoned` with no terminal event means a full page unload cut the
   operation off entirely. An `ignored` event is a drop the legacy
   (pre-#998) UI silently discarded (the defect tracked by epic #975);
   the current UI never emits it.

## Local verification

```bash
# Backend: correlation, structured logs, metrics
cd backend && poetry run pytest tests/test_reorder_telemetry.py

# Frontend: diagnostics module + coordinator correlation tests
cd frontend && npx vitest run tests/reorderDiagnostics.test.ts \
  tests/tileOrdering.test.ts
```
