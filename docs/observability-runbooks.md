# HRIV Observability Runbooks

These runbooks are the alert-target destinations referenced by
[`observability-operations.md`](observability-operations.md). Each section is
written so an alert can deep-link directly to the relevant response procedure.

## Shared First Steps

For any HRIV alert:

1. Confirm the environment and namespace from the alert labels.
2. Open the linked dashboard first to avoid debugging the wrong component.
3. Check whether a deploy, restore, import, or storage event happened in the
   same time window.
4. Capture the alert labels, a screenshot, and the first confirming query so
   later tuning work uses evidence rather than memory.

Useful command skeletons:

```bash
kubectl -n hriv get pods
kubectl -n hriv logs deploy/hriv-backend --since=15m
kubectl -n hriv logs deploy/hriv-backend-worker --since=15m
kubectl -n hriv logs deploy/hriv-backup --since=15m
kubectl -n hriv get events --sort-by=.lastTimestamp
```

## Application Unavailable

**Alert meaning:** The public frontend or backend is unavailable from outside
the cluster, or the backend health surface is failing hard enough that users
cannot use HRIV.

**User impact:** Students may be unable to log in, browse categories, open
images, or load tiles at all.

**First checks:**

1. Open `HRIV Service Health`.
2. Check backend health and readiness:

   ```bash
   kubectl -n hriv get deploy,po,svc,ingress
   kubectl -n hriv describe deploy hriv-backend
   ```

3. Check for a recent rollout or crash loop.

**Dashboard links:** `HRIV Service Health`, then `HRIV Synthetic Monitoring` if
the outage was first detected by the synthetic journey.

**Loki / Tempo queries:**

- Loki: `{service_name="hriv-backend"} |= "request_id"`
- Loki: `{service_name="hriv-frontend"}`
- TraceQL: `{ resource.service.name = "hriv-backend" && status = error }`

**Kubernetes commands:**

```bash
kubectl -n hriv get pods -owide
kubectl -n hriv describe pod <backend-pod>
kubectl -n hriv logs deploy/hriv-backend --since=15m
```

**Likely causes:** bad rollout, ingress misroute, missing secret/config,
database outage, OIDC outage, failing readiness probe, or cluster/network
degradation.

**Mitigation:** Roll back the failing deployment, restore a missing dependency,
or shift focus to the deeper root-cause runbook when the outage is clearly
database, OIDC, or storage related.

**Escalation:** Escalate immediately if both `latest` and `stable` are
affected, or if rollback is blocked.

**Resolution verification:** External checks pass, synthetic journey recovers,
and health/readiness remain stable through at least one alert evaluation
window.

## Synthetic Journey Failed

**Alert meaning:** The synthetic student journey ran recently but failed one or
more required steps.

**User impact:** A real student-visible path may be broken even if generic API
health still looks acceptable.

**First checks:**

1. Open `HRIV Synthetic Monitoring`.
2. Identify the failing step from `hriv_synthetic_step_success`.
3. Review the latest synthetic job logs or report.

**Dashboard links:** `HRIV Synthetic Monitoring`, then `HRIV Service Health`.

**Loki / Tempo queries:**

- Loki: `{event_synthetic="true"}`
- Loki: `{browser_tab_session_id!=""} |= "synthetic"`
- TraceQL: `{ resource.service.name = "hriv-backend" && span.http.route != "" }`

**Kubernetes commands:**

```bash
kubectl -n hriv get jobs,cronjobs
kubectl -n hriv logs job/<synthetic-job-name>
```

**Likely causes:** login failure, category/image target drift, tile pipeline
failure, or environment reachability problems.

**Mitigation:** Restore the target image/category, fix credentials, or repair
the failing dependency the step points to.

**Escalation:** Escalate as a critical incident when repeated failures persist
after the target itself is confirmed valid.

**Resolution verification:** The next synthetic run succeeds, step durations
return to normal, and related service-health panels stabilize.

## Synthetic Monitor Stale

**Alert meaning:** No authoritative synthetic result has been published within
the expected freshness window.

**User impact:** Availability can no longer be proven during idle traffic
periods.

**First checks:**

1. Open `HRIV Synthetic Monitoring`.
2. Check `hriv_synthetic_result_age_seconds`.
3. Confirm the CronJob or external scheduler is still running.

**Dashboard links:** `HRIV Synthetic Monitoring`.

**Loki / Tempo queries:**

- Loki: `{service_name="hriv-backend"} |= "synthetic"`
- Loki: `{service_name="hriv-synthetic"}`

**Kubernetes commands:**

```bash
kubectl -n hriv get cronjobs,jobs
kubectl -n hriv describe cronjob <synthetic-cronjob-name>
kubectl -n hriv logs deploy/hriv-backend --since=30m
```

**Likely causes:** CronJob disabled, scheduler failing, secret drift, or
synthetic result ingestion no longer reaching the backend.

**Mitigation:** Restore the scheduler, rerun a one-off job, and repair any
credential or ingress issue blocking result submission.

**Escalation:** Escalate if stale synthetic metrics overlap a service-health
incident, because detection coverage is now impaired.

**Resolution verification:** A fresh run publishes new timestamps and the stale
alert clears without manual metric deletion.

## Elevated 5xx

**Alert meaning:** The backend is returning sustained server errors above the
allowed threshold with enough traffic to matter.

**User impact:** Users see broken actions, failed image loads, or incomplete
workflows.

**First checks:**

1. Open `HRIV Service Health`.
2. Identify the affected route family and time window.
3. Check whether the spike correlates with deployment, OIDC, database, or tile
   failures.

**Dashboard links:** `HRIV Service Health`.

**Loki / Tempo queries:**

- Loki: `{service_name="hriv-backend"} |= "\"status_code\": 500"`
- TraceQL: `{ resource.service.name = "hriv-backend" && status = error }`
- TraceQL: `{ span.http.response.status_code >= 500 }`

**Kubernetes commands:**

```bash
kubectl -n hriv logs deploy/hriv-backend --since=15m
kubectl -n hriv describe pod <backend-pod>
```

**Likely causes:** bad rollout, unavailable dependency, storage errors, or code
path regressions under load.

**Mitigation:** Roll back the release or repair the dependency. If a single
route is isolated, use traces and request logs to narrow the failing operation.

**Escalation:** Escalate when the spike is multi-route, cross-environment, or
survives rollback.

**Resolution verification:** 5xx rate returns below threshold and trace error
volume drops for the same interval.

## Tile 404 Or 5xx Failures

**Alert meaning:** DZI descriptors or image tiles are failing independently of
general API health.

**User impact:** Students can open the viewer but see partial, blank, or broken
image content.

**First checks:**

1. Open `HRIV Service Health`.
2. Determine whether failures are `404` or `5xx`.
3. Confirm whether the failure is isolated to one image, one route pattern, or
   the whole tile pipeline.

**Dashboard links:** `HRIV Service Health`, optionally `HRIV Synthetic
Monitoring` if the synthetic journey also failed on DZI/tile steps.

**Loki / Tempo queries:**

- Loki: `{service_name="hriv-backend"} |= "/api/tiles/"`
- TraceQL: `{ span.http.route =~ "/api/tiles/.*" }`
- TraceQL: `{ span.http.route =~ "/api/tiles/.*" && span.http.response.status_code >= 500 }`

**Kubernetes commands:**

```bash
kubectl -n hriv logs deploy/hriv-backend --since=15m | rg '/api/tiles/'
kubectl -n hriv exec deploy/hriv-backend -- ls /data/tiles | head
```

**Likely causes:** missing/stale tiles, bad Nginx or backend tile routing,
permission issues on the tiles PVC, or a broken image-processing result.

**Mitigation:** Rebuild tiles for affected images, restore a missing volume, or
roll back the routing regression.

**Escalation:** Escalate quickly if failures are widespread or affect both DZI
and tile routes across many images.

**Resolution verification:** Tile 404/5xx rates normalize and a manual viewer
check confirms full image rendering.

## Image View Ready Failures

**Alert meaning:** Frontend telemetry shows elevated `image.view.failed` or a
drop in `image.view.ready` success for real users.

**User impact:** Users can reach HRIV but are failing to get a usable image
viewer experience.

**First checks:**

1. Open `HRIV Usage and Experience`.
2. Check whether the failures cluster by browser family, device class, or
   viewport bucket.
3. Cross-check tile and API health for the same time window.

**Dashboard links:** `HRIV Usage and Experience`, then `HRIV Service Health`.

**Loki / Tempo queries:**

- Loki: `{event_name="image.view.failed"}`
- Loki: `{event_name="frontend.error"}`
- TraceQL: `{ span.http.route =~ "/api/images/.*|/api/tiles/.*" }`

**Kubernetes commands:** Usually none are needed first; start with dashboards
and logs unless the failure clearly correlates with a rollout.

**Likely causes:** frontend regression, browser-specific issue, tile outage, or
slow backend/image-processing behavior.

**Mitigation:** Roll back the frontend if rollout-correlated, or use browser
distribution panels to narrow the breakage.

**Escalation:** Escalate when the failure is broad across browsers or sharply
regresses after a deploy.

**Resolution verification:** `image.view.ready` success rate returns to
baseline and frontend error volume drops.

## OIDC Unavailable

**Alert meaning:** Authentication is failing because the OIDC provider cannot
be reached or is returning unusable responses.

**User impact:** Login may fail for OIDC-backed users, including operators.

**First checks:**

1. Open `HRIV Service Health`.
2. Confirm whether local-password login is still working.
3. Check backend logs for `oidc.error_code`.

**Dashboard links:** `HRIV Service Health`.

**Loki / Tempo queries:**

- Loki: `{service_name="hriv-backend"} |= "oidc"`
- TraceQL: `{ span.oidc.error_code != "" }`

**Kubernetes commands:**

```bash
kubectl -n hriv logs deploy/hriv-backend --since=15m | rg 'oidc|OIDC'
kubectl -n hriv exec deploy/hriv-backend -- env | rg '^OIDC_'
```

**Likely causes:** Vault OIDC outage, incorrect issuer/config, secret drift, or
network reachability changes.

**Mitigation:** Restore provider connectivity or revert the bad OIDC config.

**Escalation:** Escalate to platform/identity owners if the provider itself is
down or unreachable from the cluster.

**Resolution verification:** OIDC logins succeed again and the OIDC error
signal returns to zero.

## Database Unavailable

**Alert meaning:** The backend cannot complete normal requests because
PostgreSQL is unavailable or refusing work.

**User impact:** Most authenticated workflows fail, often with 5xx responses or
stuck admin tasks.

**First checks:**

1. Open `HRIV Service Health`.
2. Check backend readiness and logs for DB connection errors.
3. Confirm the database pod or service state in the cluster.

**Dashboard links:** `HRIV Service Health`.

**Loki / Tempo queries:**

- Loki: `{service_name="hriv-backend"} |= "database"`
- TraceQL: `{ resource.service.name = "hriv-backend" && status = error }`

**Kubernetes commands:**

```bash
kubectl -n hriv get pods,svc
kubectl -n hriv logs deploy/hriv-backend --since=15m | rg 'postgres|sqlalchemy|database'
```

**Likely causes:** CNPG outage, Vault dynamic credential drift, network policy
breakage, or exhausted DB connections.

**Mitigation:** Restore DB availability or credential validity, then restart
only the workloads that require fresh credentials if needed.

**Escalation:** Escalate immediately if backups or restores are also affected.

**Resolution verification:** Backend readiness recovers, requests succeed, and
no fresh DB connection errors appear in logs.

## Image Processing Failures

**Alert meaning:** Background image-processing tasks are failing at an elevated
rate.

**User impact:** New uploads or replacements may never produce usable tiles.

**First checks:**

1. Open `HRIV Service Health`.
2. Check image-processing throughput and failure timing.
3. Inspect backend worker logs.

**Dashboard links:** `HRIV Service Health`.

**Loki / Tempo queries:**

- Loki: `{service_name="hriv-backend-worker"}`
- TraceQL: `{ resource.service.name = "hriv-backend-worker" && status = error }`

**Kubernetes commands:**

```bash
kubectl -n hriv logs deploy/hriv-backend-worker --since=30m
kubectl -n hriv get pods -l app.kubernetes.io/component=worker
```

**Likely causes:** worker crash loops, Redis issues, missing shared storage, or
bad image-processing code/config.

**Mitigation:** Restore the worker or Redis dependency, then retry affected
jobs or rebuild tiles where appropriate.

**Escalation:** Escalate if uploads are blocked for active classes or if the
worker cannot recover without data repair.

**Resolution verification:** New image-processing tasks complete successfully
and worker error traces stop climbing.

## Queue Saturation Or Worker Unavailable

**Alert meaning:** The worker queue remains positive while workers are missing,
or the worker HPA has reached maximum replicas without clearing the backlog.

**User impact:** Uploads, replacements, rebuilds, and admin tasks lag far
beyond normal expectations.

**First checks:**

1. Open `HRIV Service Health`.
2. Check worker replicas, HPA state, and recent worker logs.
3. Confirm Redis health before assuming a pure scaling problem.

**Dashboard links:** `HRIV Service Health`.

**Loki / Tempo queries:**

- Loki: `{service_name="hriv-backend-worker"}`
- Loki: `{service_name="hriv-backend"} |= "worker.enqueue"`

**Kubernetes commands:**

```bash
kubectl -n hriv get deploy,hpa,pods
kubectl -n hriv describe hpa hriv-backend-worker
kubectl -n hriv logs deploy/hriv-backend-worker --since=15m
```

**Likely causes:** undersized worker limits, maxed HPA, Redis trouble, storage
contention, or a bad job type wedging the queue.

**Mitigation:** Increase worker capacity in a controlled way, clear the root
cause, and avoid repeatedly restarting workers without confirming queue health.

**Escalation:** Escalate if the queue is growing during a live class or if HPA
and storage behavior suggest platform saturation.

**Resolution verification:** Queue depth falls, HPA stabilizes below max, and
task latency returns to baseline.

## Longhorn Degraded Or Faulted

**Alert meaning:** One or more Longhorn-backed volumes used by HRIV are
degraded or faulted.

**User impact:** Source images, tiles, backup data, or database storage may be
at risk or already impaired.

**First checks:**

1. Open `HRIV Data and Recovery`.
2. Identify the specific PVC and workload using it.
3. Confirm whether the condition is degraded or faulted.

**Dashboard links:** `HRIV Data and Recovery`.

**Loki / Tempo queries:** Usually secondary here; prioritize storage platform
signals first.

**Kubernetes commands:**

```bash
kubectl -n hriv get pvc,pv
kubectl get volumes.longhorn.io -A
kubectl describe pvc <pvc-name> -n hriv
```

**Likely causes:** replica loss, node/storage outage, disk pressure, or
attachment issues.

**Mitigation:** Follow platform storage recovery guidance, protect current data,
and avoid restarting application pods blindly if the underlying volume is
faulted.

**Escalation:** Escalate to platform operators immediately for faulted volumes
or any condition threatening authoritative data.

**Resolution verification:** Volume health returns to normal and dependent HRIV
workloads resume stable read/write behavior.

## PVC Nearly Full

**Alert meaning:** A source-image or tile PVC is nearing or exceeding its safe
capacity threshold.

**User impact:** Uploads, tile generation, or recovery operations may fail due
to lack of storage.

**First checks:**

1. Open `HRIV Data and Recovery`.
2. Identify whether the source-images or tiles PVC is affected.
3. Check whether recent imports, rebuilds, or backups explain the growth.

**Dashboard links:** `HRIV Data and Recovery`.

**Loki / Tempo queries:** Use only if an application symptom already exists.

**Kubernetes commands:**

```bash
kubectl -n hriv get pvc
kubectl -n hriv exec deploy/hriv-backend -- df -h /data /data/tiles
```

**Likely causes:** growth from new uploads, stale generated tiles, failed
retention cleanup, or undersized PVCs.

**Mitigation:** Expand the PVC if the platform supports it, clear derived data
only when safe, or schedule a maintenance window for storage migration. If the
worker is failing with `OSError: [Errno 28] No space left on device` under
`/data/tiles/<source_image_id>`, treat that as a tiles-PVC capacity incident:
prefer expanding the tiles PVC first, and only delete/rebuild tiles during a
planned recovery action because `/data/tiles` is derived data while
`/data/source_images` remains authoritative.

**Escalation:** Escalate before the critical threshold if the source-images PVC
contains authoritative data and expansion is not immediate.

**Resolution verification:** Capacity returns below threshold and the value
stays stable after the next processing cycle.

## Redis Memory Pressure

**Alert meaning:** Redis is under memory pressure, evicting keys, or rejecting
writes.

**User impact:** Background queueing, telemetry ingestion, or rate limiting may
degrade or fall back to reduced behavior.

**First checks:**

1. Open `HRIV Service Health`.
2. Check whether worker or telemetry problems started at the same time.
3. Confirm Redis pod health and memory saturation.

**Dashboard links:** `HRIV Service Health`.

**Loki / Tempo queries:**

- Loki: `{service_name="hriv-backend"} |= "redis"`
- Loki: `{service_name="hriv-backend-worker"} |= "redis"`

**Kubernetes commands:**

```bash
kubectl -n hriv get pods
kubectl -n hriv logs <redis-pod> --since=15m
kubectl -n hriv top pod <redis-pod>
```

**Likely causes:** undersized Redis memory, queue growth, high telemetry burst,
or an unhealthy persistence/replication layer.

**Mitigation:** Reduce pressure, scale memory carefully, and confirm queue
producers do not continue flooding a degraded Redis.

**Escalation:** Escalate when queue-backed workflows are stalling or when Redis
rejects writes during active classes.

**Resolution verification:** Memory pressure, evictions, and rejected writes
return to normal; queue and telemetry behavior stabilize.

## Backup Failed Or Overdue

**Alert meaning:** Database or filesystem backups are stale, failing, or their
telemetry is missing.

**User impact:** Recovery posture is degraded and recovery point objectives may
no longer hold.

**First checks:**

1. Open `HRIV Data and Recovery`.
2. Determine whether the alert is for database, filesystem, or missing metrics.
3. Check the backup pod and backup state markers.

**Dashboard links:** `HRIV Data and Recovery`.

**Loki / Tempo queries:**

- Loki: `{service_name="hriv-backup"}`

**Kubernetes commands:**

```bash
kubectl -n hriv logs deploy/hriv-backup --since=30m
kubectl -n hriv exec deploy/hriv-backup -- python backup.py status
kubectl -n hriv exec deploy/hriv-backup -- python backup.py list
```

**Likely causes:** storage credential failure, backup pod crash, archive write
failure, or state marker drift.

**Mitigation:** Restore storage access, rerun a backup, and confirm the state
marker updates correctly. Use
[`backup-restore-runbook.md`](backup-restore-runbook.md) for hands-on restore
steps.

**Escalation:** Escalate immediately if both backup types are failing or if the
issue overlaps a storage incident.

**Resolution verification:** The next successful backup updates timestamps,
outcomes, and retained-archive state as expected.

## Restore Test Failed Or Overdue

**Alert meaning:** Recovery testing has failed or has not been performed within
the agreed cadence.

**User impact:** Fresh backups may exist without proof that they can be used
successfully.

**First checks:**

1. Open `HRIV Data and Recovery`.
2. Confirm whether the condition is "failed" or "overdue".
3. Review the most recent restore evidence or missing schedule entry.

**Dashboard links:** `HRIV Data and Recovery`.

**Loki / Tempo queries:** Secondary; rely mainly on the validation evidence and
backup logs.

**Kubernetes commands:** Use the specific commands in
[`backup-restore-runbook.md`](backup-restore-runbook.md) when executing a fresh
restore test.

**Likely causes:** restore drill not performed, restore workflow regressed, or
supporting credentials/storage changed.

**Mitigation:** Schedule and execute a restore drill, record evidence, and fix
the failing step before resetting the cadence.

**Escalation:** Escalate if the environment is production-like and no valid
restore proof exists.

**Resolution verification:** A restore drill completes successfully and the
recorded evidence resets the overdue window.

## TLS Expiry

**Alert meaning:** The public certificate is close enough to expiry that
operator action is required.

**User impact:** If ignored, users will lose trusted browser access.

**First checks:**

1. Open `HRIV Service Health`.
2. Confirm the affected hostname and remaining validity.
3. Check recent ingress or certificate-manager events.

**Dashboard links:** `HRIV Service Health`.

**Loki / Tempo queries:** Usually not primary for certificate expiry.

**Kubernetes commands:**

```bash
kubectl -n hriv get ingress
kubectl -n hriv get certificate,secret
kubectl -n hriv describe certificate <certificate-name>
```

**Likely causes:** renewal failure, issuer outage, or incorrect ingress/cert
configuration.

**Mitigation:** Repair the issuer or certificate wiring and confirm a fresh
certificate is issued before the warning window closes.

**Escalation:** Escalate quickly when expiry is near and automatic renewal is
still failing.

**Resolution verification:** The replacement certificate is present and the
alert clears with the new validity window.

## Flux Reconciliation Failure

**Alert meaning:** Flux cannot reconcile the deployed HRIV state to the desired
GitOps state.

**User impact:** Intended fixes, rollbacks, or secret/config updates may not
reach the cluster.

**First checks:**

1. Confirm whether the failure is in `latest`, `stable`, or both.
2. Check recent `flux-fleet` commits and reconciliation errors.
3. Determine whether the application is already degraded or only drifted.

**Dashboard links:** `HRIV Service Health`.

**Loki / Tempo queries:** Usually secondary; Flux/controller logs matter more.

**Kubernetes commands:**

```bash
kubectl -n flux-system get kustomizations,helmreleases
kubectl -n flux-system logs deploy/source-controller --since=15m
kubectl -n flux-system logs deploy/kustomize-controller --since=15m
```

**Likely causes:** bad manifest, failed chart pull, secret drift, or controller
health issues.

**Mitigation:** Repair the broken GitOps input, reconcile again, and avoid
manual cluster drift unless needed for emergency mitigation.

**Escalation:** Escalate to platform operators if Flux itself is unhealthy or
multiple apps are blocked.

**Resolution verification:** Reconciliation succeeds and the cluster reflects
the intended release state.

## Repeated Pod Restarts

**Alert meaning:** One or more HRIV pods are restarting frequently enough to
indicate instability.

**User impact:** Behavior ranges from hidden flakiness to active outages,
depending on redundancy and affected component.

**First checks:**

1. Open `HRIV Service Health`.
2. Identify which workload is restarting.
3. Inspect restart reasons and timing.

**Dashboard links:** `HRIV Service Health`.

**Loki / Tempo queries:**

- Loki: `{service_name=~"hriv-.*"}`

**Kubernetes commands:**

```bash
kubectl -n hriv get pods
kubectl -n hriv describe pod <pod-name>
kubectl -n hriv logs <pod-name> --previous
```

**Likely causes:** crash loops after deploy, OOM kills, readiness/liveness
misconfiguration, missing secrets, or storage/network dependency failures.

**Mitigation:** Fix the underlying crash reason before repeatedly deleting pods;
restart churn without diagnosis hides the real failure mode.

**Escalation:** Escalate if restarts affect authoritative data components or
coincide with user-visible outage alerts.

**Resolution verification:** Restart count stops climbing and the workload stays
healthy across at least one alerting interval.
