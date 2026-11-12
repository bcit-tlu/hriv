# Object counting

Object counting lets any authenticated user draw a selection rectangle on an
image, pick **Count → Cells** or **Count → Nuclei**, and get back, for that
selection only, colour-coded outlines around every detected object plus a
legend of unnamed appearance groups (Group 1, 2, 3 …) and a total.

It is an **object counter, not a classifier**: objects are outlined first and
the count is the number of outlines. Groups are produced by appearance
clustering (size first, colour/texture later) and are intentionally unnamed
so students identify — or learn to identify — what each group is. Accuracy
should be good but need not be perfect; the outlines exist so the count can
be double-checked visually.

Epic: [#1661](https://github.com/bcit-tlu/hriv/issues/1661). This page is
extended as each child issue lands; sections marked _planned_ are not yet
implemented.

## User flow

1. In the image viewer — or any collection-detail viewer pane while
   counting is enabled (#1855) — the existing OSD **selection** toolbar
   button draws a rectangle; a **Count objects** button appears above its
   top-right corner and opens a small menu: **Cells** · **Nuclei**
   (`components/CountObjectsButton.tsx`).
2. The frontend `POST`s `{mode, selection}` (level-0 image pixels) and polls
   with backoff (`useSelectionCounts.ts`), showing a progress snackbar with
   the queue position (`components/CountProgressSnackbar.tsx`).
3. When the job finishes, the report dialog auto-opens (`components/
CountReportDialog.tsx`): the stitched preview with outlines clipped to
   the selection, the unnamed **Group n** legend and the total. Outlines
   also stay on the viewer itself (`components/CountOutlinesLayer.tsx`)
   until the selection is cleared.

Every selection is its own job — overlapping selections each get discrete
outlines and a discrete legend; jobs never share or merge results.

### Manual adjustment (#1746)

The report opens in **adjust** mode so the user can correct an imperfect
result client-side (**Done** leaves a view-only report; **Adjust count**
re-enters):

- **Click an outline** to remove it — it stays visible dashed and dimmed,
  and a second click restores it. Removing the last object of a group
  drops its legend row.
- **Click a missed object** to drop an outline there (sized to the median
  of the current objects), or **drag** to draw a circle of any size.
- Added outlines join the **nearest-size group** (closest mean polygon
  area), since groups are unnamed appearance clusters. **Reset** restores
  the original result.

The chip, legend and the outlines on the viewer update live. Adjustments
are React state only — nothing is written back to Redis or the database,
and they die with the ephemeral result (`countAdjust.ts` holds the pure
helpers; `useSelectionCounts` tracks `removed`/`added` per entry).

## How it works

### Server-side stitching (#1663)

The client sends only `{mode, selection}` in level-0 coordinates. The
backend reconstructs the region — selection plus a margin of roughly one
object diameter — from the image's **existing DZI tile pyramid** under
`TILES_DIR` with pyvips (`app/counting/stitch.py`). The original source
file and client-rendered pixels are never involved, so viewer zoom,
annotations and overlays can never leak into the analysed pixels.

`plan_region` picks the finest pyramid level whose stitched pixel count
fits the job's budget (`COUNTING_MAX_PIXELS` for ML outliners or the
larger `COUNTING_CLASSICAL_MAX_PIXELS` for classical/stub, with a hard
`MAX_DECODED_PIXELS = 25M` memory guard regardless of settings). The API
pre-flights with the budget of the outliner configured for the requested
mode, and the worker plans again with its own outliner's budget.

### Edge rule (centroid-in-selection)

The stitched region includes the margin so objects crossing the selection
edge are fully visible to the outliner. After outlining, only objects whose
**centroid lies inside the selection** are kept — objects centred in the
margin are discarded, which matches what a human would count.

### Ephemerality

There are **no database tables, no Alembic migration and no image
metadata**. Job state and results live only in Redis with a short TTL
(`COUNTING_RESULT_TTL_SECONDS`, default 600 s). Refresh, navigating away,
closing the viewer or removing the selection destroys results: `DELETE`
removes the keys and any late worker write fails its `SET … XX KEEPTTL`
check, so a cancelled job can never be resurrected. Jobs are owned by the
requesting user — nobody else can read or cancel them (404, never 403).

### Architecture

```
frontend ──POST /api/images/{id}/counts──▶ API pod
   (visibility gate → tile check → pre-flight plan_region →
    worker-heartbeat check → per-user cap → record → enqueue)
        │
        ▼
  Redis queue  arq:counting  ──▶ counting-worker pod (max_jobs=1)
        │                          plan → stitch → outline → filter
        │                          → group → polygons + preview
        ▼
  Redis keys: count:job:{id} (record, XX KEEPTTL updates)
              count:result:{id} (result payload)
              count:user:{uid} (active-job cap set)
              all with TTL COUNTING_RESULT_TTL_SECONDS
```

Counting runs on a **dedicated arq queue and worker**
(`COUNTING_QUEUE_NAME`, default `arq:counting`) so ML jobs never delay tile
processing — and never runs in-process in the API pod. The API refuses to
enqueue when the counting worker's arq health key is absent
(503 `counting_unavailable`). `CountingWorkerSettings`
(`app/counting/worker.py`) runs one job per process with
`allow_abort_jobs` so `DELETE` can interrupt in-flight work; burst capacity
is met by scaling replicas, not per-process concurrency.

### Outliners

`app/counting/outliners.py` defines the `Outliner` protocol
(`segment(rgb, plan, mpp) -> int32 labels`). The shipped pipeline uses
real outliners selected by the spike (#1662) —
Cells → classical scikit-image watershed, Nuclei → InstanSeg
`brightfield_nuclei` (Apache-2.0), shipped in #1665 behind the same
protocol. **`StubOutliner`** remains a deterministic, pixel-free test
stand-in that places synthetic round objects on a jittered grid; it is
not a production counting model. Cellpose `cyto3` is deferred indefinitely
by the owner until the feature has soaked: its weights are trained partly
on CC-BY-NC data and its numpy pin needs Python ≤3.12. The protocol remains
the extension point for a future opt-in plugin, not a shipped cyto3 option.

## API

All endpoints require a valid JWT (any role). Image access uses the
standard visibility gate
(`routers/images.py::_get_visible_image`), so an image a student cannot
view is indistinguishable from a missing one.

### `POST /api/images/{image_id}/counts`

Body: `{"mode": "cells"|"nuclei", "selection": {"x", "y", "width", "height"}}`
(level-0 px; width/height must be positive).

Responses:

- `202` `{"job_id", "status": "queued", "queue_position"}` — `queue_position`
  is the 0-based rank in the counting queue.
- `404` image missing, inactive-for-students, or visibility-hidden.
- `409` `{"detail": "tiles_not_ready"}` — no local tile pyramid (includes
  external/catalogued DZI URLs and inactive images).
- `422` `{"detail": "invalid_selection"}` — selection doesn't intersect the
  image; `{"detail": "selection_too_large"}` — over the pixel budget at
  every permitted level.
- `429` `{"detail": "too_many_active_counts"}` + `Retry-After: 10` — over
  `COUNTING_MAX_ACTIVE_PER_USER` queued/running jobs.
- `503` `{"detail": "counting_unavailable"}` — Redis down or no live
  counting worker (health key missing); enqueue failure.

### `GET /api/counts/{job_id}`

Owner only — missing, expired or another user's job answers 404. While
`queued`, `queue_position` is populated; while `running`/`done`/`failed` it
is `null`. Result fields are populated only when `done`.

```json
{
  "job_id": "…",
  "status": "queued | running | done | failed",
  "queue_position": 3,
  "mode": "cells",
  "selection": { "x": 1200, "y": 800, "width": 900, "height": 600 },
  "total": 77,
  "groups": [ { "group": 0, "count": 72 }, { "group": 1, "count": 5 } ],
  "objects": [
    { "group": 0, "centroid": [1234.5, 845.0],
      "polygon": [[1220.0, 830.0], [1250.0, 832.0], …] }
  ],
  "error": null,
  "preview": "data:image/jpeg;base64,…"
}
```

All coordinates are level-0 image pixels rounded to 1 decimal. Groups are
re-indexed to contiguous `0..n-1` ordered by mean object area ascending so
the frontend's colour mapping is roughly stable across selections.
`preview` (added to the epic contract) is the stitched region cropped to
the **selection** (margin excluded), downscaled so the longest side is ≤
960 px (never upscaled), JPEG Q=80 as a `data:` URI — enough for the
report modal without another tile round-trip. `error` is one of
`timeout`, `too_large`, `too_many_objects`, `no_tiles`, `internal` —
stack traces never reach the client. `cancelled`/`expired` statuses exist
in the contract but are never returned: cancellation deletes the record
and TTL expiry evicts it, so both read as 404.

### `DELETE /api/counts/{job_id}`

Owner only; always `204`. Aborts the arq job (`allow_abort_jobs`,
best-effort), then deletes record + result keys and the owner-set entry.
Missing records also answer `204` (idempotent); another user's job answers 404. The frontend calls this with a keepalive `fetch` (auth header)
instead of `sendBeacon` when a selection is destroyed.

## Settings

Counting is always on (#1859 removed the `COUNTING_ENABLED` dark-launch
flag). `GET /api/features` still reports `{"counting": true}` for one
release so SPAs built before the gate's removal keep rendering it.

| Setting                         | Default            | Purpose                                                              |
| ------------------------------- | ------------------ | -------------------------------------------------------------------- |
| `COUNTING_QUEUE_NAME`           | `arq:counting`     | Dedicated arq queue (distinct from the tile worker's `arq:queue`).   |
| `COUNTING_MAX_PIXELS`           | `750_000`          | Pre-flight budget: stitched level pixels per job. ≥ 65 536.          |
| `COUNTING_CLASSICAL_MAX_PIXELS` | `2_000_000`        | Larger stitched-pixel budget for classical/stub outliners; ≥ 65 536. |
| `COUNTING_MAX_DOWNSAMPLE`       | `8`                | Coarsest permitted level-0:level pixel ratio (power of two).         |
| `COUNTING_MARGIN_PX`            | `32`               | Margin in **level** pixels (~1 object diameter).                     |
| `COUNTING_TORCH_THREADS`        | `2`                | CPU torch threads per worker process; ≥ 1. Match the CPU limit.      |
| `COUNTING_MODELS_DIR`           | `/opt/hriv-models` | Directory containing the baked InstanSeg model; no runtime download. |
| `COUNTING_CELLS_OUTLINER`       | `classical`        | `classical` or `stub` (test-only synthetic results).                 |
| `COUNTING_NUCLEI_OUTLINER`      | `instanseg`        | `instanseg`, `classical`, or `stub` (test-only).                     |
| `COUNTING_MAX_ACTIVE_PER_USER`  | `3`                | Per-user queued+running cap; over → 429.                             |
| `COUNTING_RESULT_TTL_SECONDS`   | `600`              | TTL on job record/result/user-set keys; also the arq `_expires`.     |
| `COUNTING_JOB_TIMEOUT_SECONDS`  | `60`               | arq `func(timeout=…)`; expiry maps to `error: "timeout"`.            |
| `COUNTING_MAX_OBJECTS`          | `3000`             | Result cap; over → `error: "too_many_objects"`.                      |

### Redis keys

`count:job:{job_id}` (JSON record: job_id, user_id, image_id,
source_image_id, mode, selection, status, created/started/finished
timestamps, error), `count:result:{job_id}` (JSON result contract above),
`count:user:{user_id}` (set of job ids for the active cap). All carry the
result TTL; worker status writes use `SET … XX KEEPTTL`.

## Local development

```bash
docker compose --profile counting up --build
```

The `counting-worker` compose service (profile `counting`) runs
`arq app.counting.worker.CountingWorkerSettings` against the same Redis
and `image_data` volume. Login as a seed account with access to the image, then:

```bash
TOKEN=$(curl -s http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"synthetic.student@example.ca","password":"password"}' | jq -r .access_token)
curl -s -X POST http://localhost:8000/api/images/5/counts \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"mode":"cells","selection":{"x":10,"y":10,"width":200,"height":200}}'
# poll:  GET /api/counts/{job_id}   cancel: DELETE /api/counts/{job_id}
```

Image **5**, **Synthetic Monitoring Image**, has local tiles on a fresh
compose seed. Its category is restricted to the Administration program,
so use the synthetic student above or an admin/instructor. If the database
already contains data, find the image by name instead of assuming its ID.
This fixture exercises the workflow, not blood-smear counting accuracy.

## Remaining work

- **#1662** — spike: outliner selection (done; see the models table).
- **#1665** — real pipeline (shipped): classical cells + InstanSeg
  brightfield_nuclei, optional `counting`/`counting-ml` dependency
  groups, baked into the counting-worker image.
- **#1666** — Helm deployment of the counting-worker image (shipped; see Deployment).
- **#1667 / #1668** — frontend (landed): `api.ts` count wrappers,
  `useSelectionCounts.ts`, `components/CountObjectsButton.tsx`,
  `CountProgressSnackbar.tsx`, `CountReportDialog.tsx`,
  `CountOutlinesLayer.tsx`, `SelectionCountLayer.tsx`,
  `CountHelpDialog.tsx`, `countingUi.ts`, `countOutlines.ts`,
  `countPalette.ts`, `guide/object-counting.md` (dark-launched, not in
  `GUIDE_PAGES`).
- **#1669** — observability (shipped): OTel instruments + `/api/metrics`
  counting gauges, Grafana "Object counting" panels, flux-fleet alerts.
- **#1670** — lab-burst load test (done — see Capacity); **#1671** —
  docs/user validation.
- **#1746** — manual report adjustment (landed): click-to-remove/restore
  outlines, click/drag to add, nearest-area group assignment,
  `countAdjust.ts` + `removed`/`added` entry state.
- **#1855** — counting in collection detail viewers (landed): the shared
  `ImageViewer` mounts `SelectionCountLayer`, so sequence and synchronized
  collection panes count the same way.
- **#1859** — `COUNTING_ENABLED` dark-launch gate retired (landed): the
  setting, `CountingFeatureMiddleware`, router dependency and the
  `countingEnabled` prop chain removed; `/api/features` keeps reporting
  `counting: true` for one release for older SPAs.

## Models and pipeline (#1665)

The stub was replaced by two real outliners behind the same `segment(rgb,
plan, mpp) -> int32 labels` seam:

| Mode   | Outliner                                                                                                                    | Licence                                                        |
| ------ | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Cells  | `ClassicalCellsOutliner` — scikit-image channel-extrema + darkness signal, Otsu, distance-transform watershed (#1662 spike) | BSD-3 (scikit-image / scikit-learn)                            |
| Nuclei | `InstanSegNucleiOutliner` — InstanSeg `brightfield_nuclei` v0.1.1 on CPU                                                    | Apache-2.0 code + weights; its dep `fastremap` is **LGPL-3.0** |

Cellpose `cyto3` is **deferred indefinitely** by the owner until the
feature has soaked (numpy<2.1 pin, no py3.14 wheels, CC-BY-NC training
data) — the `Outliner` protocol remains the plugin point.

- **Level rule**: a ≤0.25 MP coarse stitch estimates the median object
  diameter via the classical mask; the worker picks the largest
  power-of-two `d ≤ counting_max_downsample` with `diameter/d ≥ native`
  (30 px cells, 12 px nuclei), or `mpp*d ≤ 0.5` for nuclei with a known
  mpp. Nuclei **without** mpp always run at d=1 — the hematoxylin-mask
  diameter estimate merges dense tissue and over-coarsens. Cells use a
  merged-field guard: a probe with fewer than 8 mask components means the
  field collapsed into blobs, so d stays 1 — and a large box over such a
  field can be rejected `too_large` rather than silently counting nothing.
  Never upscale; over budget at that `d` → `too_large`.
- **Stain filter** (nuclei only): objects with mean CIELAB `b* > -5` are
  dropped after the centroid edge rule.
- **Grouping**: GaussianMixture+BIC in `[log(area)/ln(2.5), a*/10, b*/10]`,
  union-merge components <1.0 apart, re-indexed by mean area ascending.

## Deployment (#1666)

- **Image**: `ghcr.io/bcit-tlu/hriv/hriv-counting-worker`, built from the
  `counting-worker` Dockerfile target (CPU torch, baked
  `brightfield_nuclei` model — no runtime downloads). The chart defaults
  its tag to the backend image tag; CI's `alias-counting-worker` job
  stamps the matching `backend-v<ver>-rc.*` alias on main so the tag the
  chart references always exists.
- **Helm** (`charts/backend`): `counting.*` feeds `COUNTING_*` on the API
  Deployment; `countingWorker.*` renders a dedicated Deployment (tiles
  PVC **read-only**, Redis only — no DB creds, no source-images mount),
  HPA (`countingWorker.autoscaling`), and an optional deny-ingress
  NetworkPolicy (`countingWorker.networkPolicy`, egress to Redis + DNS +
  the OTel collector only).
- **Capacity**: see [Capacity (#1670)](#capacity-1670).
- **flux-fleet overlay** (`latest` first): `counting.enabled: true`,
  `countingWorker.enabled: true`, plus `countingWorker.networkPolicy`
  peers pointed at the in-cluster Redis, kube-dns and the OTel collector.

## Capacity (#1670)

Lab-burst load test on `latest` (2026-11-03) with
`scripts/count_load_test.py` and 45 prefixed test accounts
(`scripts/count_load_accounts.py`): one counting-worker replica (2 CPU,
2 Gi request / 3 Gi limit, `torchThreads: 2`); 30 users within 30 s,
15 more over the next 4 minutes, 4 re-runs and 2 cancels — 49 jobs mixing
Cells/Nuclei from 600² up to the pre-flight budget plus deliberate
over-budget selections.

| Measure                                            | Result                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Outcomes                                           | 42 done, 5 over-budget rejections (422 at pre-flight, expected), 2 cancelled; 0 unexpected failures |
| End-to-end (client, submit → done)                 | p50 13.7 s, p95 37.9 s, max 40.9 s (target p95 ≤ 60 s)                                              |
| Queue wait (client, submit → first `running` poll) | p50 10.6 s, p95 34.8 s; peak `hriv_count_queue_depth` 7                                             |
| Worker run time (`hriv.count.run`, step `total`)   | mean Cells 0.8 s, Nuclei 4.2 s; budget-limit Nuclei (800²) ≈ 6 s                                    |
| API latency                                        | POST p50 29 ms / p95 61 ms; poll GET p50 20 ms / p95 45 ms                                          |
| Counting worker                                    | peak working set 1.08 GiB (RSS 1.0 GiB); CPU ≤ 1.5 cores (1 min rate); CFS throttling ≤ 18 %        |
| Redis                                              | ≤ 52 commands/s, ≤ 19 clients, ~19 MiB                                                              |
| Tile-processing queue                              | depth 0 throughout; tile worker idle — no impact                                                    |

Client times are quantised by the UI-like poll backoff (up to 3 s), so
they overstate server time slightly. The first run (before #1728) had a
lower p95 (22.9 s) only because the old level rule over-coarsened some
selections and returned wrong counts.

- **Sizing model**: one replica runs one job at a time, so burst latency
  ≈ queued work ÷ replicas. The realistic mixed burst above fits one
  replica. The worst case — 30 budget-limit Nuclei selections within 30 s
  (≈ 180 s of work) — needs 3–4 replicas to keep p95 ≤ 60 s.
- **Recommendations**: `latest` — 1 replica (staging). `stable` (4
  worker nodes, ~35 CPU unrequested; namespace quota `limits.memory`
  52 Gi with ~11.5 Gi used) — `countingWorker.replicaCount: 2`
  (halves burst wait and keeps counting
  available while one pod restarts); raise to 4 for labs where everyone counts Nuclei at full
  selection size. Each replica costs 2 CPU / 1.5 Gi request / 3 Gi
  limit. Keep `torchThreads: 2`, one job per process, and the 750 k (ML)
  / 2 M (classical) pixel budgets. CPU HPA is not useful for
  minute-long bursts and flux-fleet has no KEDA, so size replicas up
  front.

## Observability (#1669)

- **OTel** (`app/counting/metrics.py`): `hriv.count_jobs{mode,outcome[,reason]}`,
  `hriv.count.wait`, `hriv.count.run{mode,step}`, `hriv.count.objects`,
  `hriv.count.pixels`.
- **`/api/metrics`**:
  `hriv_count_queue_depth`, `hriv_count_queue_oldest_pending_age_seconds`,
  `hriv_count_worker_up`, `hriv_count_worker_heartbeat_age_seconds`.
- **Tracing**: `count.<step>` child spans under `count_objects_task` with
  `count.mode`/`level`/`downsample`/`pixels`/`objects`/`groups`/`outliner`.
- **Logs**: `count.completed` includes `timings_ms` per step.
  `timings_ms.serialise` now includes result JSON serialization and the
  Redis write, also recorded as `hriv.count.run{mode,step="serialise"}` and
  a `count.serialise` span. The existing `total` histogram step remains
  pipeline-only; completed `duration_ms` includes the result write.
- **Expiry observations**: `hriv.count_jobs{mode,outcome="expired"}` and
  `count.expired` record a vanished job record when the worker dequeues it.
  Mode/image ID come from enqueue arguments (legacy jobs use `unknown`/null).
  This cannot distinguish Redis TTL expiry from cancellation/deletion, so
  a cancelled job that still dequeues can also count as expired. Polls of
  missing IDs do not increment this counter because ownership and prior
  existence cannot be established.
- **Lifecycle timing fields**: `count.started.wait_seconds` measures
  enqueue-to-start; `count.cancelled.duration_ms` measures age since enqueue,
  including queue wait. Missing legacy enqueue timestamps produce null.
  Enqueued/rejected events retain their existing fields.
- Full semantics in `docs/observability-conventions.md` → Object Counting
  Metrics.

## Troubleshooting

| Symptom                                                  | Check / action                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Count button hidden                                      | Hard-reload the viewer (stale SPA). The count button mounts on every selection once a viewer is open; it hides only while a rectangle is being drawn or the canvas is in edit mode.                                                                                                |
| POST/GET/DELETE return 404                               | An invisible image (same gate as `GET /api/images/{id}`), another user's job, or an expired result.                                                                                                                                                                                |
| POST returns 503 `counting_unavailable`                  | Start the dedicated counting worker, not just the tile worker: `docker compose --profile counting up -d --build`. Check Redis connectivity and worker startup/model-loading logs. The metric outcome is `queue_unavailable`; the HTTP detail is `counting_unavailable`.            |
| Job stays queued                                         | Check the queue and heartbeat below. A worker can disappear after enqueue. Confirm the API and worker use the same Redis and `COUNTING_QUEUE_NAME`, and that the worker can read the tiles volume. Scale replicas before a lab burst; do not raise per-process concurrency.        |
| `selection_too_large` (422), or worker error `too_large` | Draw a smaller box. The API uses the configured outliner's pixel budget; the worker's size-driven level choice may still reject it to preserve object detail. Do not increase budgets without checking latency/memory and the hard stitching guard.                                |
| 429 `too_many_active_counts`                             | This user already has `COUNTING_MAX_ACTIVE_PER_USER` queued/running jobs (default 3). Cancel or wait for a job to finish, then retry; API responses include `Retry-After: 10`. Clearing finished results is not an active-job cancellation.                                        |
| Result disappears / polling returns 404                  | Redis records/results expire after `COUNTING_RESULT_TTL_SECONDS` (default 600 seconds from enqueue, not completion). Cancelling a count, or clearing all selection rectangles, also deletes the job. Draw a new selection to count again; results are not saved in image metadata. |
| 409 `tiles_not_ready`, or worker error `no_tiles`        | Counting needs a readable local DZI pyramid; external/catalogued DZI URLs are not sufficient. Wait for image processing and check the worker's read-only tiles mount. For compose, confirm `seed-media` completed and try Synthetic Monitoring Image (fresh-seed ID 5).            |

For a local diagnosis:

```bash
docker compose ps -a counting-worker seed-media
docker compose logs --tail=100 counting-worker backend
docker compose exec redis redis-cli TTL arq:counting:health-check
curl -s http://localhost:8000/api/metrics | rg 'hriv_count_'
```

Substitute the configured queue name in the heartbeat key when it is not
`arq:counting`. A Redis TTL of `-2` means the heartbeat is absent; `-1`
means a key exists without expiry (not the normal arq heartbeat). Inspect
`hriv_count_worker_up`, `hriv_count_worker_heartbeat_age_seconds`,
`hriv_count_queue_depth`, and
`hriv_count_queue_oldest_pending_age_seconds`. Gauges are absent while the
feature is off, and queue depth/age include running jobs. A NaN heartbeat
gauge means Redis could not be queried, not a confirmed worker outage.
In Kubernetes inspect the counting-worker Deployment's pods/logs and the
Grafana **Object counting** group; see [Capacity](#capacity-1670) before scaling.

Correlate structured `count.*` events by `job_id`: `count.enqueued`,
`count.started`, `count.completed`, `count.failed`, `count.cancelled`,
`count.rejected`, and `count.cleared`. Check rejection/error codes and
completed `duration_ms` / per-step `timings_ms`; IDs belong in logs, not
Prometheus labels. Do not infer a successful run from a queue-depth drop
alone. See [observability conventions](observability-conventions.md#object-counting-metrics)
for the deployed telemetry contract.

### Announcement copy

Draft for publication **when counting is enabled on stable**, after instructor
validation; this text does not announce that stable is already enabled:

> **Count objects in an image selection**
>
> Use the selection tool in the image viewer, draw a box, and choose
> **Count → Cells** or **Count → Nuclei**. Coloured outlines and an unnamed
> group legend help you compare object counts at a glance. Counting is
> available to every role on images they can view. It is a counter, not a
> classifier: always double-check the outlines visually. Results are
> temporary and disappear when you clear the selections or leave the viewer.
