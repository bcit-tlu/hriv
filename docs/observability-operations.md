# HRIV Observability Operations

This document is the operator-facing companion to
[`observability-conventions.md`](observability-conventions.md). The
conventions document defines the telemetry contract. This document defines how
alerts, runbooks, notification routing, validation drills, and load-validation
evidence should be organized around that contract.

## Scope And Ownership

- This repository owns:
  - telemetry names and contract semantics
  - alert catalogue definitions and severity guidance
  - runbook content
  - operational validation procedures
  - load-validation report format
- Platform deployment repos (including the Grafana git-sync repo and `bcit-tlu/flux-fleet`) own:
  - dashboard JSON provisioning and folder placement
  - Alertmanager receivers and secrets
  - environment-specific dashboard base URLs
  - PrometheusRule and Alertmanager manifests
  - Grafana permissions and retention policy

Treat this document as the source of truth for _what_ must alert and _how_ an
operator should respond. Treat `flux-fleet` as the source of truth for _where_
those rules are deployed and _who_ they notify in each environment.

## Dashboard Inventory

Use these dashboard identifiers consistently in alerts, runbooks, and
validation notes:

| Dashboard                   | Provisioning source                                     | Use for                                                               |
| --------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| `HRIV Service Health`       | Grafana git-sync repository (external to this codebase) | API availability, latency, error-rate, tile health, worker throughput |
| `HRIV Data and Recovery`    | Grafana git-sync repository (external to this codebase) | Backup freshness, backup outcomes, archive retention, restore posture |
| `HRIV Usage and Experience` | Grafana git-sync repository (external to this codebase) | Browser experience, frontend events, bounded usage analysis           |
| `HRIV Synthetic Monitoring` | Grafana git-sync repository (external to this codebase) | Synthetic journey success, duration, step breakdown, stale detection  |

Alerts should link to the most directly relevant dashboard first. When one
alert spans multiple systems, prefer the dashboard that answers the first
operator question.

## Alert Metadata Contract

Every actionable alert should carry these annotations:

| Annotation      | Requirement | Notes                                                                                 |
| --------------- | ----------- | ------------------------------------------------------------------------------------- |
| `summary`       | Required    | One-line incident summary in operator language                                        |
| `description`   | Required    | Brief condition, threshold, and likely impact                                         |
| `severity`      | Required    | `critical` or `warning`                                                               |
| `environment`   | Required    | `latest`, `stable`, or another canonical environment name                             |
| `namespace`     | Required    | Kubernetes namespace containing the workload                                          |
| `dashboard_url` | Required    | Link to the primary Grafana dashboard with the relevant environment pre-selected      |
| `runbook_url`   | Required    | Link to the exact section in [`observability-runbooks.md`](observability-runbooks.md) |

Recommended Alertmanager labels:

- `service=hriv`
- `component=frontend|backend|worker|backup|synthetic|storage`
- `team=tlu`
- `severity=critical|warning`
- `environment=<env>`

## Alert Catalogue

This catalogue is the authoritative mapping between observable conditions,
severity, dashboards, and runbooks.

| Alert                                                         | Severity | Primary dashboard           | Runbook                                                                                                      |
| ------------------------------------------------------------- | -------- | --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Synthetic journey repeatedly failing                          | Critical | `HRIV Synthetic Monitoring` | [`Synthetic Journey Failed`](observability-runbooks.md#synthetic-journey-failed)                             |
| Synthetic monitor stale / not running                         | Critical | `HRIV Synthetic Monitoring` | [`Synthetic Monitor Stale`](observability-runbooks.md#synthetic-monitor-stale)                               |
| Frontend externally unavailable                               | Critical | `HRIV Service Health`       | [`Application Unavailable`](observability-runbooks.md#application-unavailable)                               |
| Backend externally unavailable                                | Critical | `HRIV Service Health`       | [`Application Unavailable`](observability-runbooks.md#application-unavailable)                               |
| OIDC provider unreachable                                     | Critical | `HRIV Service Health`       | [`OIDC Unavailable`](observability-runbooks.md#oidc-unavailable)                                             |
| Database unavailable                                          | Critical | `HRIV Service Health`       | [`Database Unavailable`](observability-runbooks.md#database-unavailable)                                     |
| Longhorn volume faulted                                       | Critical | `HRIV Data and Recovery`    | [`Longhorn Degraded Or Faulted`](observability-runbooks.md#longhorn-degraded-or-faulted)                     |
| Sustained 5xx rate above threshold with minimum request count | Critical | `HRIV Service Health`       | [`Elevated 5xx`](observability-runbooks.md#elevated-5xx)                                                     |
| TLS certificate near expiry                                   | Critical | `HRIV Service Health`       | [`TLS Expiry`](observability-runbooks.md#tls-expiry)                                                         |
| Tile 404 spike                                                | Warning  | `HRIV Service Health`       | [`Tile 404 Or 5xx Failures`](observability-runbooks.md#tile-404-or-5xx-failures)                             |
| Tile 5xx spike                                                | Warning  | `HRIV Service Health`       | [`Tile 404 Or 5xx Failures`](observability-runbooks.md#tile-404-or-5xx-failures)                             |
| Image-view-ready failure elevated                             | Warning  | `HRIV Usage and Experience` | [`Image View Ready Failures`](observability-runbooks.md#image-view-ready-failures)                           |
| Image-processing job failed                                   | Warning  | `HRIV Service Health`       | [`Image Processing Failures`](observability-runbooks.md#image-processing-failures)                           |
| Worker unavailable while queue depth is positive              | Warning  | `HRIV Service Health`       | [`Queue Saturation Or Worker Unavailable`](observability-runbooks.md#queue-saturation-or-worker-unavailable) |
| Worker HPA at maximum with sustained queue                    | Warning  | `HRIV Service Health`       | [`Queue Saturation Or Worker Unavailable`](observability-runbooks.md#queue-saturation-or-worker-unavailable) |
| Longhorn volume degraded                                      | Warning  | `HRIV Data and Recovery`    | [`Longhorn Degraded Or Faulted`](observability-runbooks.md#longhorn-degraded-or-faulted)                     |
| Source-image PVC warning / critical utilization               | Warning  | `HRIV Data and Recovery`    | [`PVC Nearly Full`](observability-runbooks.md#pvc-nearly-full)                                               |
| Tile PVC warning / critical utilization                       | Warning  | `HRIV Data and Recovery`    | [`PVC Nearly Full`](observability-runbooks.md#pvc-nearly-full)                                               |
| Redis memory pressure, evictions, or rejected writes          | Warning  | `HRIV Service Health`       | [`Redis Memory Pressure`](observability-runbooks.md#redis-memory-pressure)                                   |
| Database backup overdue / failed                              | Warning  | `HRIV Data and Recovery`    | [`Backup Failed Or Overdue`](observability-runbooks.md#backup-failed-or-overdue)                             |
| Filesystem backup overdue / failed                            | Warning  | `HRIV Data and Recovery`    | [`Backup Failed Or Overdue`](observability-runbooks.md#backup-failed-or-overdue)                             |
| Restore test overdue / failed                                 | Warning  | `HRIV Data and Recovery`    | [`Restore Test Failed Or Overdue`](observability-runbooks.md#restore-test-failed-or-overdue)                 |
| Flux reconciliation failing                                   | Warning  | `HRIV Service Health`       | [`Flux Reconciliation Failure`](observability-runbooks.md#flux-reconciliation-failure)                       |
| Repeated pod restarts                                         | Warning  | `HRIV Service Health`       | [`Repeated Pod Restarts`](observability-runbooks.md#repeated-pod-restarts)                                   |
| Backup metrics missing                                        | Warning  | `HRIV Data and Recovery`    | [`Backup Failed Or Overdue`](observability-runbooks.md#backup-failed-or-overdue)                             |
| Synthetic metrics missing                                     | Warning  | `HRIV Synthetic Monitoring` | [`Synthetic Monitor Stale`](observability-runbooks.md#synthetic-monitor-stale)                               |

## Notification Routing Model

The deployed receiver remains environment-specific, but routing should follow
this operational policy.

### Severity routing

| Severity   | Expectation                                                                                                         | Examples                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `critical` | Immediate human attention during business hours; after-hours behavior must be explicitly agreed for the environment | synthetic repeatedly failing, app unavailable, DB unavailable, sustained 5xx, TLS near expiry |
| `warning`  | Routed to the shared operational channel with human triage during staffed hours                                     | tile 404 spike, backup stale, queue saturation, PVC pressure                                  |

### Grouping and repeat intervals

- Group by `service`, `environment`, and `severity` first.
- Keep component-specific incidents separable with `component`.
- Use a short first repeat for `critical` alerts so a dropped notification is
  detected quickly.
- Use a longer repeat for `warning` alerts to avoid channel spam during a known
  maintenance window.

### Inhibition rules

Configure inhibition so secondary symptoms do not bury the root cause:

- `Application unavailable` should inhibit `Elevated 5xx` for the same
  environment/component.
- `Database unavailable` may inhibit backend symptom alerts caused solely by DB
  failures.
- `Longhorn volume faulted` may inhibit PVC-pressure or backup-symptom alerts
  when they are clearly downstream.
- `Synthetic monitor stale` should not inhibit `Synthetic journey repeatedly
failing`; those states are deliberately distinct and both operationally
  meaningful.

### Ownership and escalation

- Primary owner: HRIV operators for the target environment.
- Secondary owner: platform / cluster operators when the incident is clearly in
  storage, ingress, certificate, or Flux control-plane scope.
- Escalate immediately when:
  - a `critical` alert persists after first mitigation,
  - data protection is at risk,
  - multiple environments are affected,
  - the incident crosses application and platform boundaries.

## Operational Validation Exercises

Record the date, environment, change window, operator, evidence links, and
final outcome for each exercise. Save screenshots, notification evidence, and
query snippets alongside the rollout or PR notes when practical.

### 1. Synthetic failure drill

1. Use the dedicated synthetic category/image target documented in
   [`synthetic-monitoring.md`](synthetic-monitoring.md).
2. Break the target safely by renaming or deactivating the test image, or by
   redirecting the synthetic job to a known-invalid target.
3. Confirm:
   - `hriv_synthetic_journey_success` flips to failure
   - step gauges identify the failing phase
   - the alert fires
   - the notification arrives
   - the runbook and dashboard links resolve
4. Restore the target and verify the alert resolves.

### 2. Backend availability drill

1. In a safe environment, make the backend unavailable without damaging data.
2. Confirm:
   - external availability checks fail
   - readiness and health reflect the outage
   - related logs and traces are visible
   - the alert fires and resolves cleanly after restoration

### 3. Tile failure drill

1. Produce a controlled missing tile or DZI artifact.
2. Confirm tile 404 panels and alerts move independently of general API health.
3. If safe, induce a controlled tile 5xx and confirm log/trace correlation.

### 4. Backup failure drill

1. Safely break storage access or credentials in a non-production environment.
2. Confirm last-attempt, last-success, and missing-metric states remain
   distinguishable in metrics and dashboards.
3. Restore access and verify the next success clears the alert.

### 5. Storage and restore drill

1. Validate Longhorn degraded/faulted alerting using a test volume or platform
   simulation.
2. Execute a documented restore test.
3. Confirm the restore-verification cadence and overdue logic are visible.

### 6. Deployment correlation drill

1. Deploy a known version.
2. Confirm dashboards, logs, and traces expose `service.version`.
3. Confirm an operator can correlate an incident with the deployment window.

## Representative Load Validation

The target model is a synchronized class/lab start with up to 60 concurrent
student sessions, a mix of category navigation and image viewing, plus light
instructor activity.

### Required measurements

- image-ready `p50` and `p95`
- API latency `p95`
- tile latency `p95`
- general 5xx rate
- tile 404 / 5xx rate
- backend, worker, and Redis CPU/memory
- worker replica count and queue depth
- database connections
- PVC capacity and storage latency indicators
- ingress throughput
- telemetry overhead

### Load-validation report template

Record the following before issue closure:

| Field               | Capture                                                            |
| ------------------- | ------------------------------------------------------------------ |
| Environment         | `latest` or `stable`                                               |
| Date / time window  | Start and end timestamp                                            |
| Version             | Frontend/backend/backup versions under test                        |
| Scenario            | Number of concurrent students, synthetic users, instructor actions |
| Image-ready latency | `p50`, `p95`, worst observed                                       |
| API latency         | `p50`, `p95`, worst observed                                       |
| Tile latency        | `p50`, `p95`, worst observed                                       |
| Error rates         | General 5xx, tile 404, tile 5xx, synthetic failures                |
| Scaling behavior    | Worker replicas, queue depth, HPA behavior                         |
| Saturated resources | CPU, memory, DB connections, PVC/storage pressure                  |
| Alert observations  | Which thresholds were too sensitive or too weak                    |
| Result              | Pass / needs tuning                                                |

If the measured behavior changes the operational thresholds, update the
PrometheusRule definitions in `flux-fleet` and leave a short rationale in the
corresponding PR or rollout note.

## Operational Readiness Checklist

Before calling observability operationally ready for an environment, confirm:

- [ ] All alerts in the catalogue are deployed from version-controlled rules.
- [ ] Every actionable alert includes `dashboard_url` and `runbook_url`.
- [ ] Alert links resolve in both `latest` and `stable`.
- [ ] A real receiver is configured and tested for the environment.
- [ ] Severity routing, grouping, repeat intervals, and inhibition rules are
      documented in `flux-fleet`.
- [ ] Synthetic failure and stale states are distinguishable.
- [ ] Backup stale, backup failure, and missing telemetry states are
      distinguishable.
- [ ] At least one controlled failure drill has been run for each major alert
      family.
- [ ] A representative load-validation report exists.
- [ ] The operator on first response can work entirely from the linked
      dashboard and runbook without tribal knowledge.

## Related Docs

- [`observability-conventions.md`](observability-conventions.md)
- [`observability-runbooks.md`](observability-runbooks.md)
- [`synthetic-monitoring.md`](synthetic-monitoring.md)
- [`backup-restore-runbook.md`](backup-restore-runbook.md)
