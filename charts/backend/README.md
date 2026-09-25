# hriv-backend chart notes

## Feedback delivery (`feedback.provider`)

The backend accepts in-app feedback via `POST /api/issues/report`, then routes
the submission through the configured delivery provider. The generic chart config
uses `feedback.provider`. Email is the primary delivery method for the in-app
"Send Feedback" flow, and the MS Teams provider is retained for future use.

### Values

- `feedback.provider` (string, default `""`; supported: `email`, `teams`)
- `feedback.email.existingSecret` (string, default `""`) — secret containing SMTP
  relay credentials (`smtp_server`, `smtp_port`, `username`, `password`) and
  optional `from` / `to` overrides
- `feedback.email.to` (string, default `""`) — recipient address; defaults to
  `tlu_techops@bcit.ca` when empty
- `feedback.email.from` (string, default `""`) — sender address; defaults to the
  SMTP username when empty
- `feedback.email.smtpSecurity` (string, default `""`) — SMTP security mode
  (`starttls`, `ssl`, `none`); defaults to `auto` when empty, which infers
  `ssl` for port `465` and `starttls` otherwise
- `feedback.teams.webhook.existingSecret` (string, default `""`)

### Behavior

When `feedback.provider: ""`:

- no feedback delivery env vars are injected
- no feedback secret is referenced

When `feedback.provider: email`:

- `FEEDBACK_DELIVERY_PROVIDER=email` is injected
- `FEEDBACK_EMAIL_SMTP_SERVER`, `FEEDBACK_EMAIL_SMTP_PORT`,
  `FEEDBACK_EMAIL_USERNAME`, and `FEEDBACK_EMAIL_PASSWORD` are read from
  `feedback.email.existingSecret`
- `FEEDBACK_EMAIL_TO` and `FEEDBACK_EMAIL_FROM` are injected from chart values
  when set, or sourced from the same `existingSecret` under keys `to` and `from`
  (optional); otherwise they are left unset so the backend defaults apply
- `FEEDBACK_EMAIL_SMTP_SECURITY` is injected from chart values when set, or left
  unset so the backend defaults apply
- chart render fails if the SMTP secret is missing

When `feedback.provider: teams`:

- `FEEDBACK_DELIVERY_PROVIDER=teams` is injected
- `FEEDBACK_TEAMS_WEBHOOK_URL` is read from secret
  `feedback.teams.webhook.existingSecret`, key `url`
- chart render fails if the webhook secret is missing

### Example (email)

```yaml
feedback:
  provider: email
  email:
    existingSecret: hriv-feedback-smtp-relay
    to: tlu_techops@bcit.ca
    from: hriv-no-reply@bcit.ca
    smtpSecurity: starttls
```

Create the referenced secret:

```bash
kubectl create secret generic hriv-feedback-smtp-relay \
  --from-literal=smtp_server=smtp.relay.bcit.ca \
  --from-literal=smtp_port=587 \
  --from-literal=username=tlu_alertmanager@relay.bcit.ca \
  --from-literal=password='YOUR_SMTP_PASSWORD' \
  --from-literal=from=tlu_alertmanager@relay.bcit.ca \
  --from-literal=to=tlu_techops@bcit.ca \
  -n <namespace>
```

`Flux` users typically create this secret with a `VaultStaticSecret` instead.

### Example (Teams)

```yaml
feedback:
  provider: teams
  teams:
    webhook:
      existingSecret: hriv-feedback-teams-webhook
```

Create the referenced secret:

```bash
kubectl create secret generic hriv-feedback-teams-webhook \
  --from-literal=url=https://outlook.office.com/webhook/... \
  -n <namespace>
```

## Persistence Layout

When `persistence.enabled=true`, the chart now expects two storage concerns:

- `persistence.sourceImages` mounts at `/data`
- `persistence.tiles` mounts at `/data/tiles`

The source-images PVC remains the `/data` root on purpose so the backend can
keep using `/data/.maintenance` and `/data/admin_tasks` without changing the
runtime paths stored in the database:

- `SOURCE_IMAGES_DIR=/data/source_images`
- `TILES_DIR=/data/tiles`

For multi-replica API or worker deployments, both PVCs must use
`ReadWriteMany`.

## Tiles sidecar and tile authorization (`tiles.*`)

When `tiles.enabled=true`, an `nginx:alpine` sidecar container serves
`/api/tiles/` directly from the tiles PVC, keeping the Python process out of
the per-tile hot path.

Tiles are authorized content (see `docs/tile-delivery-boundary.md`, issues
#1064/#1069). The sidecar enforces an image-scoped `tile_token` query
parameter on every tile request:

- nginx `auth_request` sends a subrequest to the FastAPI app container in the
  same pod (`127.0.0.1:8000`, `GET /api/tiles-auth`), forwarding only
  `X-Original-URI: $request_uri`; the validator extracts the token from the
  original URI's query string. 204 allows, 401 means missing/expired/tampered
  token, 403 means the token is bound to a different image.
- Auth verdicts are cached in a `proxy_cache` zone (`tile_auth`, 1m keys,
  8m max) keyed on `$tile_auth_token:$tile_image_id` — never on client
  identity. Valid (204) verdicts are cached for 30 seconds (≤ 60s); 401/403
  verdicts are not cached. Requests without a token bypass the cache entirely.
- Tile responses carry `Cache-Control: private, max-age=2592000` — browsers
  cache aggressively, but shared caches/CDNs must not store them.
- `access_log off` on the tile and auth locations keeps tokens out of logs.

**Rollout gate:** `tiles.enabled=true` requires a backend image that serves
`GET /api/tiles-auth` and issues tile tokens (the backend release containing
PR #1159). Deploying the chart with the sidecar enabled against an older
backend image makes every tile request fail authorization.

## Task execution mode (`tasks.executionMode`)

`tasks.executionMode` renders `TASK_EXECUTION_MODE` on both the API and worker
pods and governs what happens when queue-backed work (image processing, bulk
import, admin tasks) cannot be submitted to Redis/arq:

- `local` (default) — prefer Redis/arq when available, but fall back to
  in-process FastAPI BackgroundTasks when the queue is down. This matches the
  historical chart behavior and keeps dev/test installs working without Redis.
- `required` — queue-backed work must run in dedicated worker pods. Enqueue
  failures return HTTP 503 (`Retry-After: 30`) instead of running expensive
  jobs inside the API process, and `/api/health` reports degraded when the
  queue or worker heartbeat is missing.

Chart rendering fails when `tasks.executionMode=required` and either
`redis.enabled` or `redis.worker.enabled` is false — required mode without a
Redis-backed worker Deployment could never execute background work. Production
overlays should set `required`; leave `local` everywhere else.

### Durable tile-rebuild scheduler (`tasks.rebuild`)

`tasks.rebuild.parallelEnabled` renders `REBUILD_PARALLEL_ENABLED` on both the
API and worker pods and defaults to `false`. Enabling it requires
`tasks.executionMode=required`; serial admin rebuilds remain the rollback path.
Following the #1189 rehearsal series, the `latest` cluster overrides this to
`true` in its `flux-fleet` overlay (the chart default here stays `false`);
`stable` passed a bounded validation on 2026-09-22 with the flag
temporarily enabled via its overlay; the keep/revert decision follows a
full `scope=all` run in a weekend window. The
remaining values render the independently tunable PostgreSQL-authoritative
execution window and recovery settings:

- `parallelism` (`REBUILD_PARALLELISM`, default `2`);
- `childTimeoutSeconds` (`REBUILD_CHILD_TIMEOUT_SECONDS`, default `3600`, maximum `86400`);
- `leaseSeconds` (`REBUILD_LEASE_SECONDS`, default `3900`);
- `heartbeatSeconds` (`REBUILD_HEARTBEAT_SECONDS`, default `30`);
- `pumpCadenceSeconds` (`REBUILD_PUMP_CADENCE_SECONDS`, default `60`);
- `maxAttempts` (`REBUILD_MAX_ATTEMPTS`, default `2`);
- `retryBackoffBaseSeconds`
  (`REBUILD_RETRY_BACKOFF_BASE_SECONDS`, default `60`);
- `retryBackoffCapSeconds`
  (`REBUILD_RETRY_BACKOFF_CAP_SECONDS`, default `900`).

`parallelism` is intentionally independent from `redis.worker.maxJobs`.
Heartbeat and child timeout values must remain shorter than the lease, and the
pump cadence must be a whole-minute interval. Retry eligibility is stored in
PostgreSQL and the retry base must not exceed the cap.

## API configuration

The API (backend) Deployment carries its own component profile via the
top-level `api.*` values and `resources`, mirroring the worker profile:

- `api.db.poolSize` / `api.db.maxOverflow` (defaults `10`/`20`) — rendered as
  `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` on the API pod. The defaults match the
  backend code defaults in `backend/app/database.py`, so adopting this chart
  version with no overlay change is a runtime no-op; the values only become
  visible and tunable per component.
- `api.vipsConcurrency` (default `1`) — rendered as `VIPS_CONCURRENCY` on the
  API pod. With `tasks.executionMode=required` (the deployed overlays) no
  image processing ever runs in-process on the API, so the value is inert but
  explicit; it only matters for `local`-mode installs where the in-process
  fallback can run libvips work.
- `resources` — the chart now ships an explicit default
  (`requests: 250m/512Mi/128Mi`, `limits: cpu "2", memory 1Gi, eph 1Gi`)
  instead of `{}`. Previously the API pod silently inherited the namespace
  LimitRange; the 1Gi memory limit matches that ceiling, so the deployed
  outcome is unchanged except for the new CPU limit of 2 and the raised,
  honest requests. Set `resources: null` in an overlay to restore
  LimitRange-inherited sizing (`resources: {}` is a merge no-op over the
  chart defaults, not an override).

### Database connection budget

Each pod can hold at most `poolSize + maxOverflow` PostgreSQL connections.
That per-pod ceiling assumes the stable image's single-process uvicorn
(`--workers 1`, see `backend/Dockerfile`) — a multi-worker image would run
one SQLAlchemy pool per worker process and multiply the ceiling. Budget the
totals against the shared pg-core CNPG cluster, which runs the default
`max_connections=100` across all app databases:

| Component | `poolSize` | `maxOverflow` | Per-pod ceiling | Pod ceiling                   | Worst-case connections        |
| --------- | ---------- | ------------- | --------------- | ----------------------------- | ----------------------------- |
| API       | 10         | 20            | 30              | `replicaCount` + 1 surge      | ~60–120 at `replicaCount` 2–3 |
| Worker    | 5          | 5             | 10              | HPA `maxReplicas` 6 + 2 surge | up to ~80                     |

Combined, the theoretical ceiling is roughly 125–170 concurrent connections —
above pg-core's shared `max_connections=100` — so treat the chart defaults as
an upper bound to tune _down_ from, not a target. The measured peak during
the 3,349-item rebuild rehearsal at 6 workers was only ~31 connections. The
`flux-fleet` overlays pin tighter values than the chart defaults (e.g.
`api.db.poolSize: 5` / `api.db.maxOverflow: 10`).

Live pool occupancy is observable via the `hriv_db_pool_*` gauges — emitted
over OTLP per pod class (`service_name` = `hriv-backend` /
`hriv-backend-worker`) and, for the API pool only, at `/api/metrics`. See
`docs/observability-conventions.md` → Database Pool Metrics.

## Worker configuration

Beyond resources, the worker Deployment exposes:

- `redis.worker.maxJobs` (default `4`, minimum 2) — rendered as
  `WORKER_MAX_JOBS`, the max concurrent arq jobs per worker pod. Also rendered
  on the API pod, where it bounds the API-hosted bulk-import coordinator's
  child scheduling concurrency and in-process local-mode fallback concurrency.
- `redis.worker.totalSlots` (default empty) — deprecated compatibility value.
  It is no longer rendered as `WORKER_TOTAL_SLOTS` because bulk-import
  coordinator slot-starvation detection has been removed.
- `redis.worker.db.poolSize` / `redis.worker.db.maxOverflow` (defaults `5`/`5`)
  — rendered as `DB_POOL_SIZE` / `DB_MAX_OVERFLOW`. The backend defaults
  (10/20) are sized for the API; a worker running at most `maxJobs` jobs needs
  far fewer connections.
- `redis.worker.terminationGracePeriodSeconds` (default `300`) — the
  Kubernetes default of 30s interrupts in-flight tile-generation and
  import/export jobs on every rollout.
- `redis.worker.autoscaling.scaleDownStabilizationWindowSeconds` (default
  `3600`) — delays HPA scale-down long enough for default-timeout tile-rebuild
  children to drain. The #1189 `latest` rehearsal observed ordinary HPA
  scale-down terminate workers holding active claims; PostgreSQL lease recovery
  succeeded, but added about 39 minutes from last heartbeat to resumed execution.
  Do not shorten this below the measured child execution/recovery horizon without
  another worker-loss rehearsal.
- `redis.worker.probes.liveness` (enabled by default) — an exec probe running
  `arq --check app.worker.WorkerSettings`, which verifies the arq health key
  in Redis is fresh. A wedged worker main loop gets restarted instead of
  sitting idle while the queue grows. Caveats: the health key is shared per
  queue, so with multiple replicas the probe only catches the case where every
  worker stopped heartbeating, and the generous `failureThreshold` (10 × 60s)
  is deliberate so a brief Redis outage does not restart workers mid-job.

## Health probes and worker resources

The backend pod's probe settings are configurable through `probes.backend.*`.
The defaults are chosen to tolerate transient node or database load:

- liveness: `GET /api/health`, `timeoutSeconds: 5`, `failureThreshold: 6`
- readiness: `GET /api/health/ready`, `timeoutSeconds: 5`, `failureThreshold: 3`

Initial delays and periods remain the same defaults as the previous chart
behavior, but both probes can be overridden in values if a cluster needs
different timings.

The arq worker inherits its CPU and memory limits from
`redis.worker.resources` and now also carries modest ephemeral-storage defaults
for defense in depth:

- `resources.requests.ephemeral-storage: 256Mi`
- `resources.limits.ephemeral-storage: 1Gi`

These defaults are intentionally small because import staging now lives on the
`/data` PVC. Overlays that already set worker CPU/memory continue to merge with
the chart defaults; no overlay change is required for the new storage keys to
take effect.

## Bootstrap admin seed (`bootstrapAdmin.*`)

When `bootstrapAdmin.enabled=true` (the default), the chart renders a
one-shot post-install Job (`templates/job-seed-admin.yaml`) that inserts a
single admin user and bootstrap program on first install only. The Job's
psql client image comes from `bootstrapAdmin.image` (default
`postgres:16-alpine`), deliberately decoupled from `postgres.cluster.image`
so installs with `postgres.enabled=false` (external database) do not pull
the CNPG cluster image just to run psql.

## Upgrade Notes

The legacy flat backend persistence keys are deprecated but still honored as
fallbacks during upgrade:

- `persistence.storageClass`
- `persistence.size`
- `persistence.accessModes`

Move those values into `persistence.sourceImages.*` and set
`persistence.tiles.*` explicitly in your overlay when you adopt the split-PVC
layout.

Also note that older releases created a single PVC named
`{fullname}-data`. This chart now creates `{fullname}-source-images` and
`{fullname}-tiles`, so the upgrade requires a manual cutover. Helm will not
migrate or delete the old data PVC for you.
