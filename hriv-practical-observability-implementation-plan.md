# HRIV Practical Observability Implementation Plan

## 1. Objective

Extend HRIV’s existing OpenTelemetry and Grafana prototype into a small, maintainable observability implementation that supports:

1. Day-to-day service operation.
2. Incident detection and diagnosis.
3. Verification of the student image-viewing experience.
4. Storage, backup, and recovery monitoring.
5. Basic frontend usage reporting.
6. Privacy-conscious reporting on user, browser, device, and content activity.

The implementation should remain proportionate to HRIV’s expected scale:

- Usually only a handful of active users.
- Periodic spikes of approximately 60 concurrent students.
- Long periods of minimal or zero traffic.
- Few instructor and administrator users.
- Read-heavy student use centred on category navigation and image viewing.

The implementation should prioritize actionable signals over exhaustive telemetry.

## 2. Guiding Principles

### 2.1 Separate operational metrics from usage analytics

Use each telemetry type for the work it handles best.

#### Metrics

Use metrics for bounded, low-cardinality operational measurements such as:

- Request counts.
- Request duration.
- Error rates.
- Active requests.
- Image-processing jobs.
- Queue depth.
- Pod readiness.
- Storage capacity.
- Backup age.
- Synthetic-check status.

Do not use user IDs, image IDs, category IDs, email addresses, URLs containing identifiers, user-agent strings, or session IDs as metric labels.

#### Traces

Use traces for:

- Request latency.
- Database and Redis dependencies.
- Authentication workflows.
- Image processing.
- Upload and replacement workflows.
- Backup and restore operations.
- Correlation across frontend, backend, database, and worker activity.

Trace sampling may be reduced in production once the implementation is proven.

#### Structured logs and analytics events

Use structured events for:

- Login events.
- Image views.
- Category navigation.
- Share actions.
- Report Issue actions.
- Browser and form-factor information.
- Per-user activity.
- Per-image popularity.
- Frontend errors.
- Session lifecycle information.

These fields may have high cardinality and should be queried through Loki or another analytics store rather than Prometheus.

## 3. Required Deliverables

The completed implementation should provide:

1. A documented telemetry contract.
2. Improved backend metrics, traces, and structured events.
3. Frontend observability and usage-event collection.
4. A synthetic student-journey monitor.
5. A Grafana **HRIV Service Health** dashboard.
6. A Grafana **HRIV Data and Recovery** dashboard.
7. A Grafana **HRIV Usage Overview** dashboard.
8. A small initial alert set.
9. Deployment annotations or release metadata.
10. Automated tests and operator documentation.

Grafana dashboards, alert definitions, collector configuration, and recording rules should be stored as version-controlled configuration rather than created manually in Grafana.

## 4. Phase 1: Inventory and Baseline

### Goal

Establish exactly what telemetry already exists and identify gaps before adding new instrumentation.

### Builder activities

Review:

- Backend OpenTelemetry bootstrap.
- FastAPI, SQLAlchemy, Redis, and HTTPX instrumentation.
- Existing manual spans.
- Request audit middleware.
- Logging configuration.
- OTLP exporter configuration.
- Grafana data sources.
- Loki, Tempo, Prometheus or Mimir, and collector deployment.
- Existing dashboards and alerts.
- Kubernetes and Helm configuration.
- Backup service instrumentation.
- Image-processing worker instrumentation.
- Current health and status endpoints.
- Frontend API client and authentication flow.

Produce an observability inventory containing:

| Signal              | Current source     | Destination | Environment | Known gaps                       |
| ------------------- | ------------------ | ----------- | ----------- | -------------------------------- |
| Backend traces      | FastAPI/OTel       | Tempo       | Dev/prod    | Verify sampling and attributes   |
| Request logs        | Audit middleware   | Loki        | Dev/prod    | Verify parsing and retention     |
| Application metrics | Unknown or partial | Prometheus  | Dev/prod    | Add explicit application metrics |
| Frontend events     | None               | None        | None        | Implement                        |
| Synthetic checks    | None               | None        | None        | Implement                        |
| Storage metrics     | Cluster exporters  | Prometheus  | Cluster     | Confirm Longhorn/PVC coverage    |
| Backup status       | Backup subsystem   | Partial     | Unknown     | Expose bounded metrics           |

### Acceptance criteria

- Current telemetry flow is documented.
- The builder identifies which signals work end to end.
- Existing dashboards and alert rules are catalogued.
- No duplicate telemetry pipeline is introduced without justification.
- Development and deployed-environment differences are documented.

## 5. Phase 2: Define the Telemetry Contract

### Goal

Create stable naming, privacy, cardinality, and retention conventions before instrumentation expands.

### Required document

Add or extend an observability document with the following sections.

#### 5.1 Resource attributes

Every backend, worker, backup, frontend, or synthetic signal should identify:

- `service.name`
- `service.version`
- `deployment.environment.name`
- `service.instance.id`, where applicable
- Kubernetes namespace, pod, deployment, and node through collector enrichment

Suggested service names:

- `hriv-frontend`
- `hriv-backend`
- `hriv-worker`
- `hriv-backup`
- `hriv-synthetic`

#### 5.2 Event naming

Use namespaced event names such as:

- `auth.login_succeeded`
- `auth.login_failed`
- `navigation.category_viewed`
- `image.view_started`
- `image.view_ready`
- `image.view_failed`
- `image.share_selected`
- `feedback.report_issue_selected`
- `frontend.error`
- `frontend.performance`
- `backup.completed`
- `backup.failed`
- `restore.completed`
- `restore.failed`

#### 5.3 Common event fields

Define a bounded common envelope:

- Event name.
- Event version.
- UTC timestamp.
- Session identifier.
- Request identifier, when available.
- Trace identifier, when available.
- User role.
- Pseudonymous or internal user identifier, when approved.
- Route template.
- Application version.
- Environment.
- Browser family.
- Browser major version.
- Operating-system family.
- Form-factor class.
- Image or category identifier only where relevant.
- Outcome.
- Duration in milliseconds, where relevant.

#### 5.4 Privacy rules

The implementation must explicitly define:

- Whether named-user activity reporting is authorized.
- Which roles may access named-user panels.
- Whether user identity should be internal ID, pseudonymous ID, or email.
- Event retention period.
- Whether IP addresses are retained, truncated, hashed, or omitted.
- Whether browser details are sufficiently aggregated.
- Whether analytics collection requires a privacy notice.
- Whether analytics is considered operational logging or institutional analytics.

Default implementation behaviour should be conservative:

- Do not send access tokens.
- Do not send image titles or category names when stable IDs are sufficient.
- Do not send free-text search values.
- Do not send Report Issue text through analytics events.
- Do not send full URLs containing query parameters.
- Do not emit email addresses from the frontend.
- Prefer an internal numeric or pseudonymous user ID.
- Restrict named-user dashboards to authorized administrators.
- Keep aggregate usage dashboards separate from audit investigations.

#### 5.5 Metric cardinality budget

Document allowed metric labels.

Generally acceptable:

- Service.
- Environment.
- HTTP method.
- Normalized route.
- Status-code class.
- User role.
- Operation type.
- Job outcome.
- Backup type.

Generally prohibited:

- User ID.
- Email.
- Session ID.
- Request ID.
- Image ID.
- Category ID.
- Client IP.
- Full URL.
- Browser user-agent string.
- Exception message.

### Acceptance criteria

- Naming and privacy conventions are documented.
- Metric labels have an explicit allowlist.
- Sensitive and high-cardinality values are limited to structured events or traces.
- Event schemas are versioned.
- The implementation has a documented retention recommendation.

## 6. Phase 3: Complete Backend Operational Instrumentation

### Goal

Provide the minimum application-level metrics required for service health and incident response.

### 6.1 HTTP service metrics

Confirm or implement RED metrics:

- Request rate.
- Error rate.
- Request duration.
- In-flight requests.

Suggested logical metrics:

```text
http.server.request.duration
http.server.active_requests
```

Prefer standard OpenTelemetry semantic conventions over custom names when available.

Dashboard dimensions should remain limited to:

- Service.
- Environment.
- Method.
- Normalized route.
- Status-code class.

Avoid raw request paths because image and category identifiers could produce unbounded route labels.

### 6.2 Authentication signals

Add or confirm:

- Successful login event.
- Failed login event.
- OIDC provider failure.
- Login callback duration.
- Logout event, where reliably observable.

Metrics should aggregate by outcome and failure category.

Individual login reporting should come from structured events, not metric labels.

### 6.3 Image-viewing signals

The backend alone cannot reliably tell whether an image became usable in the browser, but it should record:

- Image metadata request.
- Tile-manifest or DZI request.
- Tile response count.
- Tile 404 count.
- Tile 5xx count.
- Tile response duration.
- Bytes served, if readily available and inexpensive.
- Access-control denial.

Normalize tile routes in metrics. Do not label metrics with image IDs, tile coordinates, or zoom levels.

Image IDs may be included in structured access events to support “top requested images.”

### 6.4 Image-processing signals

Instrument:

- Jobs queued.
- Jobs started.
- Jobs completed.
- Jobs failed.
- Current queue depth.
- Current processing jobs.
- Processing duration.
- Source-image size.
- Generated tile count.
- Failure category.

Only bounded values such as job type and outcome should become metric labels.

Image identifiers and source filenames should remain in logs or traces.

### 6.5 Backup and restore signals

Expose:

- Last successful database backup timestamp.
- Last successful filesystem/archive backup timestamp.
- Last failed backup timestamp.
- Backup duration.
- Backup archive size.
- Backup outcome.
- Restore duration.
- Last successful restore-test timestamp, where restore tests exist.
- Number of retained archives.
- Age of oldest and newest retained archives.

Use gauges for “last successful timestamp” so Grafana can calculate backup age.

### 6.6 Application information metric

Expose a stable application-build signal containing:

- Application version.
- Commit SHA.
- Environment.
- Build timestamp, where available.

This supports dashboard release panels and incident correlation.

### Acceptance criteria

- HTTP rate, error, duration, and active-request data appear in Grafana.
- Tile errors can be distinguished from general API errors.
- Image-processing failures can be alerted on.
- Backup age and outcome can be visualized.
- Metrics use normalized routes and bounded labels.
- Tests verify metric emission and error classification.
- Existing 4xx-versus-5xx trace semantics remain intact.

## 7. Phase 4: Add Frontend Observability

### Goal

Measure the user-visible experience and collect the minimum frontend activity required for operational and reporting needs.

### 7.1 Frontend telemetry architecture

Implement a small frontend telemetry module rather than adding instrumentation independently throughout React components.

Suggested responsibilities:

```text
frontend/src/observability/
  config.ts
  session.ts
  events.ts
  performance.ts
  errors.ts
  transport.ts
  types.ts
```

The module should:

- Create or reuse a browser-tab session ID.
- Attach application version and environment.
- Collect approved browser and device classifications.
- Emit typed, versioned events.
- Batch or debounce events where appropriate.
- Fail silently when telemetry is unavailable.
- Avoid interfering with image viewing.
- Respect any configured opt-out or disabled state.
- Support unit tests with a mock transport.

### 7.2 Transport choice

Prefer sending frontend activity to an authenticated HRIV backend event-ingestion endpoint rather than exporting browser telemetry directly to the collector.

Reasons:

- Reuses existing authentication.
- Avoids exposing collector endpoints publicly.
- Allows server-side validation and field filtering.
- Prevents arbitrary event and label injection.
- Provides a central place for privacy enforcement.
- Allows rate limiting and payload-size limits.
- Can enrich events with authoritative user identity and role.
- Avoids trusting user identity supplied by browser JavaScript.

The ingestion endpoint should:

- Accept a strict event schema.
- Allow only known event names and fields.
- Reject oversized batches.
- Apply per-session or per-user rate limits.
- Derive user ID and role from the authenticated token.
- Drop unknown fields.
- Generate or preserve request correlation data.
- Write approved events as structured logs or OTLP log records.
- Return quickly without blocking the UI.

### 7.3 Frontend session definition

Define a session consistently.

A practical initial definition:

- Generate a random browser-tab session ID.
- Store it in `sessionStorage`.
- Reuse it for the lifetime of the tab.
- Send it through the existing `X-Session-ID` request header.
- Do not treat it as a security credential.
- Do not attempt cross-device or long-term browser fingerprinting.

Backend request middleware already supports a validated `X-Session-ID`, so the frontend implementation should use that existing convention rather than creating a second session concept.

### 7.4 Required frontend events

#### Authentication and session

- Login initiated.
- Login succeeded.
- Login failed.
- Application session started.
- Logout selected.

The authoritative login-success event should preferably be emitted server-side after authentication completes.

#### Navigation

- Category viewed.
- Image selected.
- Image viewer opened.
- Image viewer closed.

Avoid sending every pan, zoom, or tile request as an analytics event.

#### Image experience

Emit:

- `image.view_started`
- `image.view_ready`
- `image.view_failed`

`image.view_ready` should represent a meaningful user-visible milestone, such as:

- OpenSeaDragon initialized.
- Image metadata loaded.
- Initial visible tile set successfully rendered.

Include:

- Image ID.
- Category ID, where available.
- Duration from selection to ready.
- Outcome or bounded failure category.
- User role.
- Session ID.

#### Low-frequency toolbar actions

Emit events for:

- Share selected.
- Report Issue selected.
- Other toolbar actions where reporting is useful.

Do not include share tokens, copied URLs, or issue-report text.

#### Frontend errors

Capture:

- Unhandled JavaScript errors.
- Unhandled promise rejections.
- React error-boundary failures.
- Image viewer initialization failures.
- API request failures that result in visible user impact.

Include:

- Error type.
- Sanitized message or stable error code.
- Route template.
- Component or operation.
- Application version.
- Trace or request correlation ID, where available.

Do not send arbitrary object dumps, access tokens, API response bodies, or user-entered content.

### 7.5 Browser and form-factor dimensions

Collect coarse classifications:

- Browser family.
- Browser major version.
- OS family.
- Device class: desktop, tablet, or mobile.
- Viewport-size bucket.
- Touch capability.
- Reduced-motion preference, if useful.
- Connection type only if reliable and privacy-approved.

Do not store the complete user-agent string as a dashboard dimension unless there is a clear troubleshooting need.

Recommended viewport buckets:

```text
small
medium
large
extra_large
```

Document the pixel boundaries in code.

### 7.6 Browser performance

Capture a small set of meaningful frontend performance signals:

- Application initial load duration.
- Largest Contentful Paint.
- Interaction to Next Paint.
- Cumulative Layout Shift.
- Image selection to initial image-ready duration.
- Frontend API request failure visible to the user.

Do not create dashboards for every browser performance API initially.

### 7.7 Trace propagation

Ensure frontend requests preserve W3C trace context where practical:

- `traceparent`
- `tracestate`, where used
- `baggage`, only if needed and tightly controlled

Frontend-to-backend traces should allow an operator to begin with a browser failure or slow image-open event and inspect the associated backend request.

### Acceptance criteria

- A frontend session ID is consistently attached to API calls.
- Frontend events reach the observability backend.
- Image-open time is measurable from the user’s perspective.
- Top image and aggregate user activity reports can be produced.
- Browser and device reports use bounded categories.
- Telemetry failure does not break normal application behaviour.
- Payload validation and rate limiting are tested.
- No authentication tokens or free-text user content appear in telemetry.

## 8. Phase 5: Synthetic Student Journey

### Goal

Detect failures during periods when real traffic is absent.

### Required journey

Create a synthetic monitor that periodically:

1. Opens HRIV.
2. Confirms the frontend loads.
3. Authenticates as a dedicated low-privilege monitoring student, where feasible.
4. Loads a known category.
5. Opens a designated synthetic-test image.
6. Waits for OpenSeaDragon initialization.
7. Confirms initial tiles render.
8. Optionally requests a known higher-resolution tile.
9. Records total duration and step-level outcomes.
10. Logs out or terminates the session.

The test data should:

- Use a dedicated monitoring account.
- Use a stable test category and test image.
- Be excluded from normal usage reports.
- Be clearly identified in telemetry.

### Implementation options

Use the existing project browser-testing framework if one exists. Otherwise, add a small Playwright-based monitor.

Run it:

- From outside the HRIV namespace when possible.
- At a modest interval, such as every 5 minutes during active periods.
- Less frequently during known inactive periods if desired.
- From the same network context as expected institutional users where practical.

Emit:

- Overall success.
- Step success.
- Total duration.
- Image-ready duration.
- Failure category.
- HTTP status where relevant.
- Application version.

### Acceptance criteria

- The monitor detects frontend, authentication, API, and tile failures.
- It does not require administrator privileges.
- Synthetic activity is identifiable and excluded from normal usage reports.
- A failing image-view step produces an alert after repeated failures.
- A runbook explains how to update the test account, image, and category.

## 9. Phase 6: Grafana Dashboards

### Dashboard A: HRIV Service Health

#### Purpose

Answer:

> Can students successfully navigate HRIV and view images right now?

#### Required panels

##### Summary row

- Synthetic journey status.
- Backend availability.
- Frontend availability.
- Active critical alerts.
- Current deployed version.
- Last deployment time.

##### Request health row

- Request rate.
- HTTP 5xx rate.
- HTTP 4xx count, informational.
- API p95 duration.
- Current active requests.
- Request volume by user role.

##### Image-viewing row

- Image-view-ready success rate.
- Image selection-to-ready p50 and p95.
- Tile request rate.
- Tile p95 duration.
- Tile 404 count.
- Tile 5xx count.

##### Runtime row

- Backend pod readiness.
- Worker pod readiness.
- Pod restart count.
- Image-processing queue depth.
- Failed processing jobs.
- Database availability.

##### Diagnostic row

- Recent error logs.
- Recent failed traces.
- Recent Kubernetes warning events.
- Deployment annotations.

#### Dashboard variables

- Environment.
- Service.
- Time range.
- User role.
- Application version.

Avoid user and image selectors on the primary operational dashboard.

### Dashboard B: HRIV Data and Recovery

#### Purpose

Answer:

> Is HRIV’s data safe, and is storage or recovery becoming a risk?

#### Required panels

- Longhorn volume state.
- PVC used percentage.
- PVC available bytes.
- Storage growth over 30 and 90 days.
- Database availability.
- Database size.
- Database growth.
- Last successful database backup.
- Database backup age.
- Last successful filesystem/archive backup.
- Filesystem backup age.
- Last backup outcome.
- Backup size.
- Backup duration.
- Retained archive count.
- Last restore-test date.
- TLS certificate days remaining.
- Node filesystem capacity relevant to HRIV.

Where forecast panels are reliable, include a simple storage exhaustion projection. Do not alert solely on a long-range forecast during the initial implementation.

### Dashboard C: HRIV Usage Overview

#### Purpose

Provide modest operational and program reporting without turning Grafana into a comprehensive analytics platform.

#### Required panels

##### Activity overview

- Unique active users by day or week.
- Sessions by day or week.
- Successful logins.
- Failed logins.
- Activity by role.
- Active users by hour of day.
- Activity by day of week.

##### Content use

- Image views.
- Unique images viewed.
- Top requested images.
- Top categories.
- Images with repeated view failures.
- Share-link selections.
- Report Issue selections.

##### Client environment

- Browser family.
- Browser major version.
- OS family.
- Desktop/tablet/mobile distribution.
- Viewport-size distribution.
- Touch-capable versus non-touch sessions.

##### User reporting

- Most active users by session count.
- Most active users by image-view count.
- Last activity date.

Named-user panels must:

- Be restricted to authorized viewers.
- Use internal user identity unless email display is explicitly approved.
- Clearly state that activity volume is not a measure of learning, performance, or engagement quality.
- Exclude synthetic users and system accounts.

#### Query approach

Prefer Loki queries or precomputed aggregates for high-cardinality usage data.

If Loki queries become slow or expensive, introduce a scheduled aggregation process that writes daily summaries into a dedicated reporting table. Do not respond by moving user IDs or image IDs into Prometheus labels.

## 10. Phase 7: Alerting

### Goal

Alert only on conditions that require timely operator attention.

### Initial alerts

#### Critical

- Synthetic student journey fails on multiple consecutive attempts.
- Backend unavailable.
- Frontend unavailable.
- OIDC provider unreachable.
- Database unavailable.
- Longhorn volume faulted.
- Sustained HTTP 5xx rate above agreed threshold.
- TLS certificate close to expiry.

#### Warning

- Tile 404 spike above baseline.
- Image-view-ready failure rate elevated.
- Image-processing job failure.
- Worker unavailable while jobs are queued.
- Longhorn volume degraded.
- PVC usage exceeds warning threshold.
- Backup overdue.
- Backup failed.
- Flux or Helm reconciliation failing for a sustained period.
- Repeated pod restarts.

### Suggested initial behaviour

Use conservative thresholds and require persistence to reduce noise.

Examples:

- Availability: two or three consecutive synthetic failures.
- 5xx: both a minimum event count and percentage threshold.
- Backup: alert based on expected schedule plus grace period.
- PVC: warning at 75–80%, critical at 90%.
- Certificate: warning at 30 days, critical at 14 days.
- Pod restarts: repeated restarts within a rolling interval, not a single restart.

### Non-alerting information

Do not alert because:

- Traffic is zero.
- No students have logged in recently.
- A single user receives a 4xx response.
- A single synthetic step is briefly slow.
- Seasonal usage is below historical levels.

### Acceptance criteria

- Every alert links to the relevant dashboard.
- Every alert has a short runbook.
- Alerts include environment, service, severity, and summary.
- Test alerts can be generated safely.
- Alert routing is verified in a non-production environment.
- Zero traffic does not trigger an outage alert.

## 11. Phase 8: Deployment and Change Correlation

### Goal

Make it easy to answer, “Did this start after a deployment?”

### Required implementation

Expose or annotate:

- Frontend version.
- Backend version.
- Worker version.
- Backup component version.
- Git commit SHA.
- Deployment time.
- Flux reconciliation result.
- Helm release revision.

Add Grafana annotations for:

- Deployments.
- Rollbacks.
- Maintenance mode.
- Restore operations.
- Major data imports.
- Configuration changes, where available.

### Acceptance criteria

- Service-health graphs show deployment markers.
- Current component versions are visible.
- Logs and traces carry `service.version`.
- Operators can move from a failure panel to logs and traces for the affected release.

## 12. Phase 9: Testing

### Unit tests

Test:

- Event-schema validation.
- Unknown event rejection.
- Oversized payload rejection.
- Field sanitization.
- User identity enrichment.
- Session-ID generation.
- Browser classification.
- Viewport classification.
- Metric-label normalization.
- Route normalization.
- Frontend telemetry-disabled behaviour.
- Frontend transport failure.
- Error-event sanitization.

### Integration tests

Verify:

- Backend metrics are scraped or exported.
- Traces arrive in Tempo.
- Structured logs arrive in Loki.
- Frontend events are accepted and queryable.
- Trace context crosses frontend and backend.
- Request IDs correlate logs and requests.
- Synthetic checks generate expected telemetry.
- Grafana dashboards load without broken queries.

### Load validation

Run a representative test with:

- Up to 60 concurrent student sessions.
- Category navigation.
- Image opening.
- Panning and zooming.
- A synchronized class-start spike.
- A small number of simultaneous instructor operations.

Measure:

- Image-ready p95.
- API p95.
- Tile p95.
- Error rate.
- Backend CPU and memory.
- Worker load.
- Database connections.
- Storage read latency.
- Ingress throughput.

Use the results to establish production dashboard thresholds rather than choosing arbitrary performance targets.

### Acceptance criteria

- The representative load remains within agreed service targets.
- Telemetry does not cause material performance degradation.
- High-cardinality series do not appear in Prometheus.
- Dashboards remain usable during the load test.
- Alert thresholds are adjusted using measured behaviour.

## 13. Phase 10: Documentation and Runbooks

### Required operator documentation

Create:

#### Observability architecture

- Signal flow.
- Components.
- Data sources.
- Collector configuration.
- Environment variables.
- Retention.
- Sampling.

#### Dashboard guide

For each panel:

- Operational question.
- Data source.
- Query.
- Expected normal behaviour.
- Common failure interpretation.
- Drill-down links.

#### Alert runbooks

At minimum:

- Application unavailable.
- Synthetic image view failed.
- Elevated 5xx.
- Tile failures.
- OIDC provider unavailable.
- Database unavailable.
- Image-processing failure.
- Longhorn degraded or faulted.
- PVC nearly full.
- Backup failed or overdue.
- Certificate expiry.
- Flux reconciliation failure.

#### Analytics data dictionary

Document:

- Event names.
- Fields.
- Definitions.
- Exclusions.
- Known limitations.
- Synthetic-user filtering.
- Unique-user and session calculation.
- Time-zone handling.
- Privacy and access restrictions.

### Acceptance criteria

- A new operator can understand each dashboard without reading implementation code.
- Every alert has a concrete first-response procedure.
- Usage metrics have documented definitions.
- Privacy assumptions and access controls are explicit.

## 14. Recommended Implementation Order

Implement in this sequence:

1. Inventory the existing stack.
2. Define telemetry, privacy, and cardinality conventions.
3. Finish backend RED metrics.
4. Add backup and image-processing metrics.
5. Add frontend telemetry infrastructure.
6. Instrument image-ready and frontend-error events.
7. Add basic usage events.
8. Implement the synthetic student journey.
9. Build the Service Health dashboard.
10. Build the Data and Recovery dashboard.
11. Add the initial alert set.
12. Build the Usage Overview dashboard.
13. Run the 60-user load validation.
14. Tune queries, retention, sampling, and alert thresholds.
15. Complete runbooks and dashboard documentation.

The Service Health dashboard and synthetic journey should be delivered before detailed usage reporting. They provide the greatest immediate operational value.

## 15. Explicit Non-Goals for the Initial Implementation

Do not initially build:

- Full product analytics.
- Session replay.
- User-behaviour recordings.
- Mouse-movement or clickstream capture.
- Per-pan or per-zoom analytics.
- Geographic user maps.
- Long-term learning analytics.
- Automated anomaly detection.
- Complex SLO burn-rate infrastructure.
- A separate analytics data warehouse.
- Detailed per-endpoint dashboards for every route.
- Browser fingerprinting.
- Metrics labelled by user, image, category, tile, request, or session identifiers.

These may be evaluated later if a demonstrated need emerges.

## 16. Completion Definition

The practical-minimum implementation is complete when an operator can reliably answer:

1. Is HRIV reachable?
2. Can a student log in?
3. Can a student navigate to a category and open an image?
4. Are the initial image tiles loading successfully and quickly?
5. Are API or tile errors increasing?
6. Are backend or worker pods unhealthy?
7. Are image-processing jobs failing or accumulating?
8. Is the database available?
9. Is storage healthy and sufficiently available?
10. Are backups current and successful?
11. What release is currently deployed?
12. Did an incident begin after a deployment?
13. How many users and sessions used HRIV during a reporting period?
14. Which images and categories were used most?
15. Which browsers and form factors are in use?
16. Which users were most active, where authorized?
17. Can logs, traces, metrics, and frontend events be correlated during an incident?

The implementation should answer these questions with approximately three focused dashboards, a small actionable alert set, and documented drill-down paths.
