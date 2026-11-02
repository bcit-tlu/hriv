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

1. In the image viewer, the existing OSD **selection** toolbar button draws
   a rectangle; a **Count objects** button appears above its top-right
   corner and opens a small menu: **Cells** · **Nuclei**
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

## How it works

### Server-side stitching (#1663)

The client sends only `{mode, selection}` in level-0 coordinates. The
backend reconstructs the region — selection plus a margin of roughly one
object diameter — from the image's **existing DZI tile pyramid** under
`TILES_DIR` with pyvips (`app/counting/stitch.py`). The original source
file and client-rendered pixels are never involved, so viewer zoom,
annotations and overlays can never leak into the analysed pixels.

`plan_region` picks the finest pyramid level whose stitched pixel count
fits the budget (`COUNTING_MAX_PIXELS`, with a hard
`MAX_DECODED_PIXELS = 25M` memory guard regardless of settings). The same
function runs pre-flight in the API (rejecting over-budget selections
before enqueue) and again in the worker.

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
(`outline(rgb, plan) -> [OutlinedObject]`). The pipeline currently ships
**`StubOutliner`** — a deterministic, pixel-free stand-in that places
synthetic round objects on a jittered grid so the job lifecycle, edge rule,
grouping and frontend integration can be exercised end-to-end **before the
ML pipeline exists**. The spike (#1662) selected the shipped models —
Cells → classical scikit-image watershed, Nuclei → InstanSeg
`brightfield_nuclei` (Apache-2.0) — and #1665 lands them behind the same
protocol. Cellpose `cyto3` is not shipped by default: its weights are
trained partly on CC-BY-NC data and it needs Python ≤3.12, so it is pending
an owner decision as an opt-in plugin.

## API

All endpoints require a valid JWT (any role) and are gated by
`COUNTING_ENABLED` — while off, the middleware answers the same
`404 {"detail": "Not Found"}` as an unknown route before the body is even
parsed, and `require_counting_enabled` is a router-level second layer.
Image access uses the standard visibility gate
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

## Feature flag and settings

`GET /api/features` returns `{"counting": <bool>}`; the frontend hides the
Count affordance while off. Flags are UX hints only — the backend enforces
independently.

| Setting                        | Default        | Purpose                                                            |
| ------------------------------ | -------------- | ------------------------------------------------------------------ |
| `COUNTING_ENABLED`             | `false`        | Dark-launch flag: 404s the whole surface when off.                 |
| `COUNTING_QUEUE_NAME`          | `arq:counting` | Dedicated arq queue (distinct from the tile worker's `arq:queue`). |
| `COUNTING_MAX_PIXELS`          | `750_000`      | Pre-flight budget: stitched level pixels per job. ≥ 65 536.        |
| `COUNTING_MAX_DOWNSAMPLE`      | `8`            | Coarsest permitted level-0:level pixel ratio (power of two).       |
| `COUNTING_MARGIN_PX`           | `32`           | Margin in **level** pixels (~1 object diameter).                   |
| `COUNTING_MAX_ACTIVE_PER_USER` | `3`            | Per-user queued+running cap; over → 429.                           |
| `COUNTING_RESULT_TTL_SECONDS`  | `600`          | TTL on job record/result/user-set keys; also the arq `_expires`.   |
| `COUNTING_JOB_TIMEOUT_SECONDS` | `60`           | arq `func(timeout=…)`; expiry maps to `error: "timeout"`.          |
| `COUNTING_MAX_OBJECTS`         | `3000`         | Result cap; over → `error: "too_many_objects"`.                    |

### Redis keys

`count:job:{job_id}` (JSON record: job_id, user_id, image_id,
source_image_id, mode, selection, status, created/started/finished
timestamps, error), `count:result:{job_id}` (JSON result contract above),
`count:user:{user_id}` (set of job ids for the active cap). All carry the
result TTL; worker status writes use `SET … XX KEEPTTL`.

## Local development

```bash
COUNTING_ENABLED=true docker compose --profile counting up --build
```

The `counting-worker` compose service (profile `counting`) runs
`arq app.counting.worker.CountingWorkerSettings` against the same Redis
and `image_data` volume. Login as any seed account, then:

```bash
TOKEN=$(curl -s http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"student@example.ca","password":"password"}' | jq -r .access_token)
curl -s -X POST http://localhost:8000/api/images/1/counts \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"mode":"cells","selection":{"x":10,"y":10,"width":200,"height":200}}'
# poll:  GET /api/counts/{job_id}   cancel: DELETE /api/counts/{job_id}
```

## Remaining work

- **#1662** — spike: outliner selection (done; see the models table).
- **#1665** — real pipeline (shipped): classical cells + InstanSeg
  brightfield_nuclei, optional `counting`/`counting-ml` dependency
  groups, baked into the counting-worker image.
- **#1666** — Helm deployment of the counting-worker image.
- **#1667 / #1668** — frontend (landed): `api.ts` count wrappers,
  `useSelectionCounts.ts`, `components/CountObjectsButton.tsx`,
  `CountProgressSnackbar.tsx`, `CountReportDialog.tsx`,
  `CountOutlinesLayer.tsx`, `SelectionCountLayer.tsx`,
  `CountHelpDialog.tsx`, `countingUi.ts`, `countOutlines.ts`,
  `countPalette.ts`, `guide/object-counting.md` (dark-launched, not in
  `GUIDE_PAGES`).
- **#1669** — Prometheus queue gauges/dashboards for the counting queue
  (the OTel `hriv.count_jobs` counter already lands here).
- **#1670** — lab-burst load test; **#1671** — docs/user validation.

## Models and pipeline (#1665)

The stub was replaced by two real outliners behind the same `segment(rgb,
plan, mpp) -> int32 labels` seam:

| Mode   | Outliner                                                                                                                    | Licence                                                        |
| ------ | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Cells  | `ClassicalCellsOutliner` — scikit-image channel-extrema + darkness signal, Otsu, distance-transform watershed (#1662 spike) | BSD-3 (scikit-image / scikit-learn)                            |
| Nuclei | `InstanSegNucleiOutliner` — InstanSeg `brightfield_nuclei` v0.1.1 on CPU                                                    | Apache-2.0 code + weights; its dep `fastremap` is **LGPL-3.0** |

Cellpose `cyto3` is **pending an owner decision** (numpy<2.1 pin, no py3.14
wheels, CC-BY-NC training data) — the `Outliner` protocol is the plugin
point if it ever lands.

- **Level rule**: a ≤0.25 MP coarse stitch estimates the median object
  diameter via the classical mask; the worker picks the largest
  power-of-two `d ≤ counting_max_downsample` with `diameter/d ≥ native`
  (30 px cells, 12 px nuclei), or `mpp*d ≤ 0.5` for nuclei with a known
  mpp. Never upscale; over budget at that `d` → `too_large`.
- **Stain filter** (nuclei only): objects with mean CIELAB `b* > -5` are
  dropped after the centroid edge rule.
- **Grouping**: GaussianMixture+BIC in `[log(area)/ln(2.5), a*/10, b*/10]`,
  union-merge components <1.0 apart, re-indexed by mean area ascending.
