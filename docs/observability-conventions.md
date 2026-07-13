# Observability Conventions

This document describes HRIV's OpenTelemetry (OTel) conventions for span
attributes, error recording, and how to query 4xx vs 5xx behaviour in
downstream dashboards.

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

`hriv_backup_age_seconds` is `+Inf` when backup access is configured but no
valid successful-backup marker exists. This keeps the age gauge in its red
threshold state instead of presenting a missing or malformed backup as fresh.

### Alerting recommendations

| Alert                   | Condition                                                      | Severity                                                                  |
| ----------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| High 5xx rate           | Span error rate > 1% over 5 min                                | Critical                                                                  |
| Sustained 409 spike     | 409 count > 50/min for 10 min                                  | Warning (OCC contention — possible UI bug or concurrent batch operations) |
| OIDC provider down      | `oidc.error_code = PROVIDER_UNREACHABLE` > 0 for 2 min         | Critical                                                                  |
| Background task failure | Span error in `_process_bulk_import` or `process_source_image` | Warning                                                                   |

## Frontend Telemetry Ingestion

Frontend usage events (image viewer lifecycle, page navigation) are **not**
sent directly to the OpenTelemetry collector. Instead, the browser batches them
and POSTs them to the authenticated backend endpoint:

```
POST /api/telemetry/events
Authorization: Bearer <JWT>
X-Session-ID: <tab-session-id>
Content-Type: application/json

{"events": [{"event": "image.view.ready", "outcome": "success", "schema_version": 1, ...}]}
```

The endpoint validates each event name against an allowlist and emits a
structured log that the OTel logging handler forwards to the collector. This
keeps structured event ingestion behind application authentication and lets the
backend enforce schema validation and payload-size limits.

**Versioning.** Every event carries a `schema_version` (currently `1`), emitted
in logs as `schema.version`. Bump `TELEMETRY_SCHEMA_VERSION` (frontend
`observability.ts` and backend `routers/telemetry.py` in lockstep) whenever the
field shape changes so log parsers and dashboards can branch on the version
rather than silently misreading older records.

**Per-tab session id.** `X-Session-ID` is persisted in `sessionStorage`
(`hriv.session_id`), so it stays stable across in-tab reloads and SPA remounts
while remaining distinct per browser tab — giving a durable notion of a
"session" for usage analytics without any server-side session store.

**Rate limiting.** The endpoint is rate limited per authenticated user via the
shared Redis sliding-window limiter (`rate_limit_telemetry_max` /
`rate_limit_telemetry_window`, default 60 events / 60 s). Exceeding the budget
returns `429 Too Many Requests` with a `Retry-After` header. Consistent with
the login limiter, the limiter is **fail-open**: if Redis is unavailable the
request is allowed rather than rejected.

Browser trace spans are a separate signal and are exported directly to the
OTLP/HTTP gateway configured by `VITE_OTEL_ENDPOINT`. Production builds use the
standard BCIT gateway as a fallback; non-standard deployments should override
it at build time. Because this endpoint accepts browser traffic, the gateway
must enforce CORS, request-size limits, and rate limits, and downstream systems
must not trust browser-supplied identity attributes. Structured usage events
never use this direct path.

When `VITE_API_URL` is set (production and staging), the frontend posts to
`${VITE_API_URL}/api/telemetry/events`. In local development, when `VITE_API_URL`
is unset, the frontend falls back to the same-origin relative path
`/api/telemetry/events` so the Vite dev proxy forwards events to the backend.

### Allowed event names

- `image.view.started`
- `image.view.ready`
- `image.view.failed`
- `navigation.page_changed`

### Event fields

| Field             | Type                                  | Purpose                                                          |
| ----------------- | ------------------------------------- | ---------------------------------------------------------------- |
| `event`           | string (required)                     | One of the allowed event names above                             |
| `schema_version`  | integer                               | Event payload version (logged as `schema.version`)               |
| `outcome`         | `"success"`, `"failure"`, `"unknown"` | Result of the operation                                          |
| `duration_ms`     | number                                | End-to-end duration in milliseconds, when meaningful             |
| `action`          | string                                | Low-cardinality action label (e.g. `view`, `navigate`)           |
| `page`            | string                                | Low-cardinality page identifier for navigation events            |
| `error`           | string                                | High-level error category, never free-text or PII                |
| `synthetic`       | boolean                               | Client hint only; server metadata is authoritative (see below)   |
| `image_id`        | integer                               | Structured domain id for image events (never a Prometheus label) |
| `category_id`     | integer                               | Structured domain id for category context (never a label)        |
| `browser_family`  | bounded string                        | `chrome`/`firefox`/`safari`/`edge`/`opera`/`samsung`/`other`     |
| `browser_major`   | string                                | Major browser version only (e.g. `128`)                          |
| `os_family`       | bounded string                        | `windows`/`macos`/`ios`/`android`/`linux`/`chromeos`/`other`     |
| `device_class`    | bounded string                        | `desktop`/`mobile`/`tablet`/`other`                              |
| `viewport_bucket` | bounded string                        | `xs`/`sm`/`md`/`lg`/`xl` (Material UI breakpoints)               |
| `touch`           | boolean                               | Whether the device reports touch capability                      |

Domain identifiers (`image_id`, `category_id`) are emitted only as **structured
event fields**, never as Prometheus metric labels, to keep metric cardinality
bounded. Client-environment fields are reduced to small enumerated buckets and
the backend **re-bounds** them against allowlists (coercing anything unknown to
`other`), so a client cannot inject high-cardinality or free-text values.

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
  `client.device.class` / `client.viewport.bucket` / `client.touch` — bounded
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

## Usage Analytics Dashboard (`HRIV Usage Overview`)

`charts/backend/observability/dashboards/hriv-usage-overview.json` is a
Loki-backed, aggregate-only dashboard for decision makers, provisioned
automatically alongside the other dashboards (the ConfigMap template globs
every JSON in `observability/dashboards/`). Panels cover page hits, active
users, sessions, successful/failed logins, activity by role, image views vs
failures, top images/categories, and the bounded client-environment
distributions. Every panel excludes synthetic traffic via the server-marked
`event_synthetic` / `auth_synthetic` flag.

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
> names / `service` template variable if your Loki label pipeline differs.

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
