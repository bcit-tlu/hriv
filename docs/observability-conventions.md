# Observability Conventions

This document is HRIV's authoritative observability contract. It defines the
stable names, fields, privacy constraints, and aggregation rules that new
metrics, traces, structured logs, frontend events, dashboards, and runbooks
must follow.

## Stack Overview

| Layer                  | Technology                                                                 | Role                                                       |
| ---------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| SDK bootstrap          | `otel_bootstrap.py`                                                        | Ensures the OTel SDK is active under `uvicorn --reload`    |
| Auto-instrumentation   | `opentelemetry-instrumentation-fastapi`, `-sqlalchemy`, `-redis`, `-httpx` | Captures HTTP, DB, cache, and outbound spans automatically |
| Backend exporter       | OTLP (gRPC) → Tempo                                                        | Ships backend traces to the cluster collector              |
| Browser trace exporter | `frontend/src/observability.ts` → OTLP/HTTP                                | Ships browser spans to the configured public OTLP gateway  |
| Frontend usage events  | Authenticated backend ingestion → structured logs                          | Validates and enriches approved browser activity events    |
| Dashboards             | Grafana (Tempo data source)                                                | Query and alert on traces                                  |
| Structured logs        | `AuditMiddleware` → NDJSON stdout → Loki                                   | Request-level audit trail with `X-Request-ID` correlation  |

Backend configuration uses `OTEL_*` environment variables set in the Helm chart
values. When all backend exporters are `"none"`, the SDK stays in no-op mode
with zero runtime overhead. Browser trace export is configured separately at
frontend build time through `VITE_OTEL_ENDPOINT`.

## Canonical Resource Attributes

Every emitted signal must identify the component and deployment using the same
base resource attributes.

| Attribute                     | Requirement                             | Notes                                                                                                 |
| ----------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `service.name`                | Required                                | Canonical service identifier used for dashboards and correlation                                      |
| `service.version`             | Required                                | Runtime application version, not a build-time placeholder                                             |
| `deployment.environment.name` | Required                                | Environment name such as `development`, `latest`, or `stable`                                         |
| `service.instance.id`         | Required where the runtime provides one | Backend pods, workers, and backup jobs should expose this through the runtime or collector enrichment |

Canonical service names:

- `hriv-frontend`
- `hriv-backend`
- `hriv-backend-worker`
- `hriv-backup`
- `hriv-synthetic`

`service_name` is the canonical aggregate field name for Prometheus and Loki
queries. Avoid mixing `service`, `service.name`, and custom aliases inside
dashboards unless a datasource adapter forces a different field name.

## Metric Label Allowlist

Prometheus labels must stay bounded and low-cardinality.

Allowed for aggregate metrics:

- `service_name`
- `component`
- `http_method`
- `http_route`
- `http_status_code`
- `status_class`
- `outcome`
- `operation`
- `job_type`
- `backup_type`
- `restore_type`
- `purpose`
- `step`
- `user_role`

Prohibited in Prometheus labels:

- `user_id`
- `user_email`
- `session_id`
- `request_id`
- `trace_id`
- `image_id`
- `category_id`
- `client_ip`
- `raw_path`
- `raw_url`
- `tile_coordinate`
- `zoom_level`
- `filename`
- `exception_message`
- `user_agent`

High-cardinality values belong in traces or structured logs. If a proposed
metric dimension is not on the allowlist, treat it as disallowed until this
document is intentionally updated.

## Canonical Event Names

Event names use dot-separated verbs and remain stable once published.

Implemented frontend-ingestion events:

- `image.view.started`
- `image.view.ready`
- `image.view.failed`
- `navigation.page_changed`

Reserved names for follow-on observability issues:

- `application.session_started`
- `auth.login_succeeded`
- `auth.login_failed`
- `auth.logout_selected`
- `navigation.category_viewed`
- `image.share_selected`
- `feedback.report_issue_opened`
- `feedback.report_issue_submitted`
- `frontend.error`
- `frontend.performance`
- `backup.completed`
- `backup.failed`
- `restore.completed`
- `restore.failed`

New events must not introduce alternate spellings or separator styles.

## Frontend Event Envelope

The browser payload schema is versioned by `schema_version`. The backend
enriches accepted events into a structured-log envelope for Loki.

| Concept                  | Browser field                          | Structured log field                            | Notes                                                                     |
| ------------------------ | -------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| Event name               | `event`                                | `event.name`                                    | Required, dotted, allowlisted                                             |
| Event version            | `schema_version`                       | `schema.version`                                | Omitted means current version; unsupported explicit versions are rejected |
| Outcome                  | `outcome`                              | `event.outcome`                                 | Defaults to `unknown`                                                     |
| Duration                 | `duration_ms`                          | `event.duration_ms`                             | Milliseconds                                                              |
| Action                   | `action`                               | `event.action`                                  | Low-cardinality only                                                      |
| Page                     | `page`                                 | `event.page`                                    | Low-cardinality only                                                      |
| Error code/category      | `error`                                | `error.type`                                    | Never free-text exception bodies                                          |
| Session id               | Header `X-Session-ID`                  | `browser.tab.session_id`                        | Stable per browser tab                                                    |
| Request correlation      | Request `traceparent` / `X-Request-ID` | `trace.parent`, request logs carry `request_id` | Used for Loki and Tempo drill-down                                        |
| User identity            | not emitted by browser                 | `user.id`, `user.role`                          | Derived from the authenticated backend user                               |
| Synthetic classification | `synthetic` hint                       | `event.synthetic`                               | Server-authoritative from user metadata                                   |
| Route                    | not emitted by browser                 | request logs carry `route`                      | Aggregate on normalized routes only                                       |
| Service version          | not emitted by browser                 | resource `service.version`                      | Derived from runtime config                                               |
| Environment              | not emitted by browser                 | resource `deployment.environment.name`          | Derived from runtime config                                               |
| Browser / OS / device    | bounded fields                         | `client.*` fields                               | Re-bounded server-side                                                    |
| Domain ids               | `image_id`, `category_id`              | `image.id`, `category.id`                       | Structured logs only, never metric labels                                 |

Reserved envelope concepts for later event families include `timestamp`,
`trace_id`, `value`, `unit`, and `error_code`. When those are implemented they
must extend this contract additively and bump the schema version if the wire
shape changes incompatibly.

## Route Normalization

Use normalized routes for every aggregate query or metric label. Raw request
paths remain diagnostic-only.

Rules:

- Prefer the framework route template when available, for example
  `/api/images/{image_id}/replace`.
- Mounted static tile requests normalize to the actual DZI artifacts HRIV
  serves, such as `/api/tiles/{image_id}/image.dzi`,
  `/api/tiles/{image_id}/thumbnail.{format}`, and
  `/api/tiles/{image_id}/image_files/{level}/{col}_{row}.{format}`.
- If no template is available, replace numeric or UUID-like path segments with
  `{id}` before using the route in logs, labels, or dashboards.
- Keep raw `path` only in restricted request logs for request-by-request
  debugging.
- Set `http.route` on spans and emit `route` on request logs.

Examples:

| Raw path                                                             | Normalized route                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `/api/images/42/replace`                                             | `/api/images/{image_id}/replace`                                 |
| `/api/admin/tasks/123e4567-e89b-12d3-a456-426614174000/artifacts/42` | `/api/admin/tasks/{id}/artifacts/{id}`                           |
| `/api/tiles/123/image.dzi`                                           | `/api/tiles/{image_id}/image.dzi`                                |
| `/api/tiles/123/image_files/4/2_2.jpeg`                              | `/api/tiles/{image_id}/image_files/{level}/{col}_{row}.{format}` |

## Tile Delivery Metrics

Tile delivery must be measured separately from general API traffic because a
student-visible incident can be isolated to DZI manifests or image tile fetches
while the rest of the backend appears healthy.

Authoritative source:

- Emit tile-delivery metrics once, in the backend ASGI audit middleware, after
  the response completes. Do not add a second counter in the static-file mount,
  tile-generation worker, or dashboard query layer.

Metric contract:

- `hriv.tile.requests`: counter for all tile responses.
- `hriv.tile.errors`: counter for tile responses with `http.status_code >= 400`.
- `hriv.tile.response.duration`: histogram in seconds.
- `hriv.tile.response.size`: histogram in bytes.

Required dimensions:

- `http.method`
- `http.route`
- `http.status_code`
- `status_class`
- `outcome`

Rules:

- Use normalized tile routes such as `/api/tiles/{image_id}/image.dzi`,
  `/api/tiles/{image_id}/thumbnail.{format}`, and
  `/api/tiles/{image_id}/image_files/{level}/{col}_{row}.{format}`.
- Emit tile metrics only for those known artifact routes. Unexpected paths under
  the static tile mount should remain visible in request logs but must not
  create new metric label values.
- Distinguish missing content (`404`) from access-control denials (`401`/`403`)
  and server failures (`5xx`) through `http.status_code`, `status_class`, and
  the bounded `outcome` attribute.
- Never use raw paths, image ids, tile coordinates, or zoom levels as metric
  labels.
- Count response bytes from streamed ASGI body chunks; do not buffer the body
  solely for observability.

## Privacy, Access, and Retention

Observability data serves two different uses and must be treated differently:

- Aggregate operational dashboards for broad operator visibility.
- Restricted investigation data in logs and traces for incident response.

Default privacy rules:

- Frontend telemetry never emits emails, access tokens, free-text feedback,
  share URLs, search text, or API payload bodies.
- Request logs may retain `client_ip`, `user_email`, and raw `path` for
  restricted operational diagnosis, but provisioned dashboards must not expose
  named-user or raw-path panels.
- Aggregate dashboards must prefer internal ids and bounded buckets over user
  names or free text.
- Synthetic traffic must be filtered using the server-authoritative synthetic
  flag, not browser-only hints.

Recommended retention:

| Signal                               | Recommendation                         | Notes                                               |
| ------------------------------------ | -------------------------------------- | --------------------------------------------------- |
| Metrics                              | 30 days minimum                        | Supports week-over-week operational comparisons     |
| Structured logs                      | 14 days minimum                        | Covers incident review and short operational audits |
| Traces                               | 7 days minimum                         | Enough for recent latency and dependency diagnosis  |
| Restricted named-user investigations | Shortest retention permitted by policy | Prefer ad-hoc queries over provisioned dashboards   |

These are repository-level recommendations. The Flux observability stack and
institutional policy remain the source of truth for actual retention settings
and access controls.

## Dashboard Authoring Rules

When adding or updating Grafana content:

- Use `service_name` consistently for service filtering.
- Aggregate HTTP activity by normalized `route`, not raw `path`.
- Exclude synthetic traffic with the server-marked synthetic fields.
- Keep named-user panels out of provisioned shared dashboards.
- Use datasource UIDs or variables rather than environment-specific URLs.
- Treat request logs, traces, and metrics as complementary signals rather than
  duplicating high-cardinality data into Prometheus.

## Contract Verification

Minimum validation for contract changes:

- Backend route-normalization and telemetry-schema tests:
  `cd backend && poetry run pytest tests/test_middleware.py tests/test_telemetry.py`
- Frontend event-contract tests:
  `cd frontend && npm test -- observability.test.ts`
- Manual cardinality review for new metrics or log fields:
  confirm proposed labels do not include ids, emails, raw URLs, user agents, or
  other open-ended values.

## Span Error Semantics

### Rule: only 5xx and non-HTTP exceptions are span errors

A span's `StatusCode` is set to `ERROR` **only** when:

1. The exception is **not** an `HTTPException`, OR
2. The exception is an `HTTPException` with `status_code >= 500`

4xx `HTTPException`s (400 Bad Request, 404 Not Found, 409 Conflict, 422
Unprocessable Entity, etc.) are **expected application behaviour** — they
represent client errors, not server failures. Recording them as span errors
would inflate error-rate metrics and make real 5xx incidents harder to spot.

### Implementation

The shared helper in `backend/app/tracing.py`:

```python
from fastapi import HTTPException
from opentelemetry.trace import Span, StatusCode


def record_exception_if_server_error(span: Span, exc: Exception) -> None:
    if isinstance(exc, HTTPException) and exc.status_code < 500:
        return
    span.record_exception(exc)
    span.set_status(StatusCode.ERROR, str(exc))
```

### Where to use it

| Context                                                   | Pattern                                                                          | Rationale                                                                                                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Endpoint handlers** (FastAPI route functions)           | `record_exception_if_server_error(span, exc)`                                    | May raise 4xx `HTTPException`s that should not be errors                                                                                                  |
| **Background tasks** (`_process_bulk_import`, arq worker) | `span.record_exception(exc)` + `span.set_status(StatusCode.ERROR, ...)` directly | These only encounter internal processing exceptions (RuntimeError, OSError, SQLAlchemy errors) — never `HTTPException`s — so the 4xx filter adds no value |
| **OIDC / auth flows**                                     | Direct `span.set_status(StatusCode.ERROR, ...)` with error-code attributes       | Auth failures need distinct error codes for diagnosis (see below)                                                                                         |

## Span Attributes

### Naming conventions

Attributes use a dot-separated namespace:

```
<domain>.<field>
```

Examples: `bulk_import.category_id`, `image.id`, `source_image.file_size`,
`oidc.error_code`, `oidc.user_id`.

### Sentinel values

When an attribute's natural value is `None`/null (which OTel span attributes
do not support), use a descriptive string sentinel rather than a numeric zero:

```python
# Good — unambiguous in dashboards
span.set_attribute("bulk_import.category_id", category_id if category_id is not None else "none")

# Bad — 0 could be confused with a real ID
span.set_attribute("bulk_import.category_id", category_id or 0)
```

### OIDC error codes

OIDC spans use structured error codes (module-level constants prefixed with
`_OIDC_ERR_`) to distinguish failure modes without parsing exception messages:

```python
span.set_attribute("oidc.error_code", _OIDC_ERR_PROVIDER_UNREACHABLE)
span.set_status(StatusCode.ERROR, str(exc))
```

## Querying 4xx in Dashboards

4xx responses are **not** lost — they are still captured by the FastAPI
auto-instrumentation as the `http.response.status_code` span attribute on the
root HTTP span. To query them:

### TraceQL (Tempo)

```traceql
# All 4xx responses
{ span.http.response.status_code >= 400 && span.http.response.status_code < 500 }

# Specific: 409 Conflicts (OCC contention)
{ span.http.response.status_code = 409 }

# Only real server errors
{ status = error }
```

### Grafana dashboard panels

| Panel                 | Query approach                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Server Error Rate** | `rate(traces_spanmetrics_calls_total{status_code="STATUS_CODE_ERROR"}[5m])` or TraceQL `{ status = error }` count |
| **Client Error Rate** | Filter on `http.response.status_code >= 400 && < 500`; this is informational, not alertable by default            |
| **OCC Contention**    | Count of `{ span.http.response.status_code = 409 }` — useful for detecting hot categories/images                  |
| **Auth Failures**     | Filter on `{ span.oidc.error_code != "" }`                                                                        |

The Data and Recovery dashboard's image-processing panels require the backend
and worker OTel metrics exporter. Set
`observability.openTelemetry.exporter.metrics=otlp` when enabling the OTel
collector; the chart default is `none` so deployments do not emit metrics
unless explicitly configured.

Prometheus scrapes `/api/metrics` directly from the backend ClusterIP through
the ServiceMonitor. The frontend nginx configuration returns `404` for the
exact `/api/metrics` path so the unauthenticated scrape endpoint is not exposed
through the public application ingress.

Backup recovery metrics are split by `backup_type="database|filesystem"`.
Prometheus uses the latest versioned `BACKUP_STATE.json` result marker for
attempt/success state and a cached retained-archive classification pass for
archive counts and oldest/newest timestamps.

Published backup gauges:

- `hriv_backup_last_attempt_timestamp_seconds{backup_type}`
- `hriv_backup_last_success_timestamp_seconds{backup_type}`
- `hriv_backup_last_outcome{backup_type}`
- `hriv_backup_last_duration_seconds{backup_type}`
- `hriv_backup_last_size_bytes{backup_type}`
- `hriv_backup_archives_retained{backup_type}`
- `hriv_backup_oldest_archive_timestamp_seconds{backup_type}`
- `hriv_backup_newest_archive_timestamp_seconds{backup_type}`

`hriv_backup_archive_listing_last_refresh_timestamp_seconds` records when the
retained-archive classification cache was last refreshed successfully, and
`hriv_backup_archive_listing_last_outcome` distinguishes success, failure, and
not-configured states. Archive listing failures must not be rendered as zero
retained archives.

For compatibility, `hriv_backup_age_seconds` remains the worst-case age across
the database and filesystem last-success timestamps. It is `+Inf` when backup
access is configured but either backup type lacks a valid successful timestamp.
This keeps the age gauge in its red threshold state instead of presenting a
missing or malformed backup as fresh.

### Alerting recommendations

| Alert                   | Condition                                                      | Severity                                                                  |
| ----------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| High 5xx rate           | Span error rate > 1% over 5 min                                | Critical                                                                  |
| Sustained 409 spike     | 409 count > 50/min for 10 min                                  | Warning (OCC contention — possible UI bug or concurrent batch operations) |
| OIDC provider down      | `oidc.error_code = PROVIDER_UNREACHABLE` > 0 for 2 min         | Critical                                                                  |
| Background task failure | Span error in `_process_bulk_import` or `process_source_image` | Warning                                                                   |

## Frontend Telemetry Ingestion

Frontend usage events (session start, logout intent, image viewer lifecycle,
share/report-issue actions, bounded frontend errors, page navigation, and a
small browser-performance set) are **not** sent directly to the OpenTelemetry
collector. Instead, the browser batches them and POSTs them to the
authenticated backend endpoint:

```
POST /api/telemetry/events
Authorization: Bearer <JWT>
X-Session-ID: <tab-session-id>
Content-Type: application/json

{"events": [{"event": "image.view.ready", "outcome": "success", "schema_version": 2, "event_version": 1, ...}]}
```

The endpoint validates each event name against an allowlist and emits a
structured log that the OTel logging handler forwards to the collector. This
keeps structured event ingestion behind application authentication and lets the
backend enforce schema validation and payload-size limits.

**Versioning.** Every event carries a `schema_version` (currently `2`) and an
`event_version` (currently `1`), emitted in logs as `schema.version` and
`event.version`. `schema_version` describes the top-level payload envelope;
`event_version` describes the event-specific field contract. Bump
`TELEMETRY_SCHEMA_VERSION` (frontend `observability.ts` and backend
`routers/telemetry.py` in lockstep) whenever the payload shape changes so log
parsers and dashboards can branch on the version rather than silently
misreading older records.

**Per-tab session id.** `X-Session-ID` is persisted in `sessionStorage`
(`hriv.session_id`), so it stays stable across in-tab reloads and SPA remounts
while remaining distinct per browser tab — giving a durable notion of a
"session" for usage analytics without any server-side session store.

**Rate limiting.** The endpoint enforces **two** shared-Redis sliding-window
budgets over the same window (`rate_limit_telemetry_window`, default 60 s):

- a **per-tab** budget keyed by authenticated user **plus a digest of the
  per-tab `X-Session-ID`** (`rate_limit_telemetry_max`, default 60 req/window),
  falling back to a user-only key when the header is absent; and
- a higher **per-user aggregate** budget keyed by user id alone
  (`rate_limit_telemetry_user_max`, default 600 req/window).

HRIV intentionally supports many students sharing a single account, so keying by
user id alone would let independent tabs collectively exhaust one budget and
throttle each other; the per-tab key gives each tab its own budget. The digest
bounds the key length and hides the raw session id (it does not reduce the
number of distinct keys). The per-user aggregate cap ensures a client that
**rotates `X-Session-ID`** on every request cannot mint unlimited per-tab
budgets and flood the log pipeline, while legitimately shared accounts keep
generous headroom. The per-tab budget is checked **first** and short-circuits:
if a tab is over its own budget it gets `429` immediately and the shared
per-user aggregate is **not** checked or incremented, so one throttled tab
hammering retries cannot exhaust the shared-account cap for everyone else. The
aggregate is only consulted for requests that pass their per-tab budget.
Exceeding either returns `429 Too Many Requests` with a `Retry-After` header.
Consistent with the login limiter, the limiter is **fail-open**: if Redis is
unavailable the request is allowed rather than rejected.

Browser trace spans are a separate signal and are exported directly to the
OTLP/HTTP gateway configured by `VITE_OTEL_ENDPOINT`. Production builds use the
standard BCIT gateway as a fallback; non-standard deployments should override
it at build time. Because this endpoint accepts browser traffic, the gateway
must enforce CORS, request-size limits, and rate limits, and downstream systems
must not trust browser-supplied identity attributes. Structured usage events
never use this direct path.

### Frontend event contract

Approved event names:

- `application.session_started`
- `auth.logout_selected`
- `feedback.report_issue_opened`
- `feedback.report_issue_submitted`
- `frontend.error`
- `frontend.performance`
- `image.share_selected`
- `image.view.started`
- `image.view.ready`
- `image.view.failed`
- `navigation.page_changed`

Common fields:

- `event_version`
- `outcome`
- `duration_ms`
- `action`
- `page`
- `image_id`
- `category_id`
- `request_id`
- `trace_id`
- bounded client environment fields:
  `browser_family`, `browser_major`, `os_family`, `device_class`,
  `viewport_bucket`, `touch_capable`

Additional frontend-error fields:

- `error`
- `error_code`

Allowed `error_code` values:

- `api_http_4xx`
- `api_http_5xx`
- `api_network_error`
- `image_viewer_init_failed`
- `image_viewer_open_failed`
- `react_render_error`
- `unhandled_promise_rejection`
- `window_runtime_error`

Additional frontend-performance fields:

- `value`
- `unit`

`frontend.performance` uses `action` as the metric name. Approved metrics are:

- `application_load`
- `lcp`
- `inp`
- `cls`
- `image_ready`

`unit` is bounded to:

- `ms`
- `score`

Privacy rules for frontend telemetry:

- Never include free-text report-issue descriptions.
- Never include full URLs or search-query values in events.
- Never include image names, category labels, email addresses, or access tokens.
- Preserve `request_id` only when the backend already generated it.
- Browser and device fields must stay inside the documented bounded sets.

When `VITE_API_URL` is set (production and staging), the frontend posts to
`${VITE_API_URL}/api/telemetry/events`. In local development, when `VITE_API_URL`
is unset, the frontend falls back to the same-origin relative path
`/api/telemetry/events` so the Vite dev proxy forwards events to the backend.

### Allowed event names

- `application.session_started`
- `auth.logout_selected`
- `feedback.report_issue_opened`
- `feedback.report_issue_submitted`
- `frontend.error`
- `frontend.performance`
- `image.share_selected`
- `image.view.started`
- `image.view.ready`
- `image.view.failed`
- `navigation.page_changed`

### Event fields

| Field             | Type                                  | Purpose                                                          |
| ----------------- | ------------------------------------- | ---------------------------------------------------------------- |
| `event`           | string (required)                     | One of the allowed event names above                             |
| `schema_version`  | integer                               | Event payload version (logged as `schema.version`)               |
| `event_version`   | integer                               | Event-specific contract version (logged as `event.version`)      |
| `outcome`         | `"success"`, `"failure"`, `"unknown"` | Result of the operation                                          |
| `duration_ms`     | number                                | End-to-end duration in milliseconds, when meaningful             |
| `action`          | string                                | Low-cardinality action label (e.g. `view`, `navigate`)           |
| `page`            | string                                | Low-cardinality page identifier for navigation events            |
| `error`           | string                                | High-level error category, never free-text or PII                |
| `error_code`      | bounded string                        | Stable error code for `frontend.error` events                    |
| `synthetic`       | boolean                               | Client hint only; server metadata is authoritative (see below)   |
| `image_id`        | integer                               | Structured domain id for image events (never a Prometheus label) |
| `category_id`     | integer                               | Structured domain id for category context (never a label)        |
| `request_id`      | string                                | Backend request identifier when already generated server-side    |
| `trace_id`        | string                                | Active trace identifier when available                           |
| `value`           | number                                | Numeric value for `frontend.performance` events                  |
| `unit`            | bounded string                        | Unit for `value` (`ms` or `score`)                               |
| `browser_family`  | bounded string                        | `chrome`/`firefox`/`safari`/`edge`/`opera`/`samsung`/`other`     |
| `browser_major`   | string                                | Major browser version only (e.g. `128`)                          |
| `os_family`       | bounded string                        | `windows`/`macos`/`ios`/`android`/`linux`/`chromeos`/`other`     |
| `device_class`    | bounded string                        | `desktop`/`mobile`/`tablet`/`other`                              |
| `viewport_bucket` | bounded string                        | `xs`/`sm`/`md`/`lg`/`xl` (Material UI breakpoints)               |
| `touch_capable`   | boolean                               | Whether the device reports touch capability                      |

Domain identifiers (`image_id`, `category_id`) are emitted only as **structured
event fields**, never as Prometheus metric labels, to keep metric cardinality
bounded. Client-environment fields are reduced to small enumerated buckets and
the backend **re-bounds** them against allowlists (coercing anything unknown to
`other`), so a client cannot inject high-cardinality or free-text values.

Client-environment values are detected once per tab (on the first telemetry
event) and cached for the tab lifetime. In particular `viewport_bucket`
reflects the **session-initial** viewport; a mid-session browser resize is not
re-sampled. Treat these fields as "environment the session started in", not a
live measurement.

### Backend enrichment

The endpoint enriches each event with:

- `schema.version` — the accepted event schema version
- `user.id` and `user.role` from the authenticated JWT
- `browser.tab.session_id` from the `X-Session-ID` header
- `event.synthetic` — **server-authoritative**: derived from the authenticated
  user's stored `metadata_.synthetic` flag. The client `synthetic` field can
  only ever _set_ this true (e.g. a real user running a manual synthetic
  journey); it can never clear a server-marked synthetic account. This lets
  reports reliably exclude synthetic-monitor traffic.
- `image.id` / `category.id` from the event's structured ids
- `client.browser.family` / `client.browser.major` / `client.os.family` /
  `client.device.class` / `client.viewport.bucket` / `client.touch_capable` —
  bounded
  client-environment buckets
- `trace.parent` from the incoming `traceparent` header, if present

## Canonical Authentication Log Fields

Local password and OIDC login flows keep their existing per-flow event names
(`auth.login_success`, `auth.login_failed`, `oidc.login_success`,
`oidc.user_created`, …) but now **additively** emit a canonical `auth.*` field
set (see `backend/app/auth_events.py`) so a single Loki query can report on
logins across every flow:

| Field            | Meaning                                                 |
| ---------------- | ------------------------------------------------------- |
| `auth.method`    | `local` or `oidc`                                       |
| `auth.outcome`   | `success` or `failure`                                  |
| `auth.user_id`   | Internal (database) user id, when known                 |
| `auth.role`      | Internal role of the user, when known                   |
| `auth.synthetic` | `true` when the account is a synthetic monitor identity |

Because new OIDC users are logged with the same canonical fields as returning
users, login reports include first-time OIDC logins; filtering
`auth.synthetic != "true"` excludes synthetic-monitor logins.

## Usage Analytics Dashboard (`HRIV Usage and Experience`)

`charts/backend/observability/dashboards/hriv-usage-and-experience.json` is a
Loki-backed, aggregate-only dashboard for decision makers, provisioned
automatically alongside the other dashboards (the ConfigMap template globs
every JSON in `observability/dashboards/`). Panels cover active users,
sessions, successful/failed logins, successful image views, unique images,
image-view success rate, activity by role, image views vs failures, and the
bounded client-environment distributions. Every panel excludes synthetic
traffic via the server-marked `event_synthetic` / `auth_synthetic` flag.

**No named-user panels are provisioned.** Grafana dashboard provisioning is
broadly readable, so listing individual users on a provisioned dashboard would
expose per-person activity to everyone with dashboard access. Per-user
drill-down is intentionally left to ad-hoc, access-controlled log queries
(`user.id` / `auth.user_id` are present in the logs). If a safe, restricted
provisioning mechanism (a separate access-scoped Grafana folder or organization)
is later established, named-user panels can be added there.

> Field-name note: the queries assume OTLP→Loki ingestion, which sanitizes
> attribute dots to underscores (`event.name` → `event_name`,
> `client.browser.family` → `client_browser_family`, etc.). Adjust the label
> names / `component` template variable if your Loki label pipeline differs.

## Structured Logging vs Tracing

HRIV uses **both** structured logs and distributed traces. They serve different
purposes:

| Signal              | Tool                     | Best for                                                                                                |
| ------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------- |
| **Traces** (spans)  | OTel → Tempo             | Latency analysis, dependency mapping, error attribution across services                                 |
| **Structured logs** | `AuditMiddleware` → Loki | Audit trail (who did what), request correlation via `X-Request-ID`, session tracking via `X-Session-ID` |

The `X-Request-ID` header (generated by `AuditMiddleware`) can be used to
correlate a log entry with its corresponding trace if both are indexed by the
same value. The OTel trace ID is separate but can be joined in Grafana via
Tempo↔Loki correlation.

## Adding New Spans

When instrumenting a new operation:

1. Use the `tracer` from `opentelemetry.trace.get_tracer(__name__)`
2. Wrap the operation in `with tracer.start_as_current_span("operation.name"):`
3. Set relevant attributes immediately after opening the span
4. Use `record_exception_if_server_error(span, exc)` in endpoint handlers
5. Use direct `span.record_exception(exc)` in background tasks
6. Never set `StatusCode.ERROR` for expected 4xx client errors

```python
from opentelemetry import trace
from opentelemetry.trace import StatusCode
from app.tracing import record_exception_if_server_error

tracer = trace.get_tracer(__name__)

async def my_endpoint(...):
    with tracer.start_as_current_span("my_operation") as span:
        span.set_attribute("my_domain.entity_id", entity_id)
        try:
            result = await do_work()
            span.set_attribute("my_domain.result_count", len(result))
            return result
        except Exception as exc:
            record_exception_if_server_error(span, exc)
            raise
```

## Adding New Telemetry

Before adding a new metric, span attribute, log field, or frontend event:

1. Reuse an existing canonical service name, event name family, and route rule.
2. Check the metric-label allowlist before introducing any new dimension.
3. Keep identifiers, raw paths, and free text out of Prometheus labels.
4. Prefer backend enrichment over trusting browser-supplied identity or
   synthetic state.
5. Update this document if the contract changes, then add or extend targeted
   tests in `backend/tests/test_middleware.py`, `backend/tests/test_telemetry.py`,
   or `frontend/tests/observability.test.ts`.
