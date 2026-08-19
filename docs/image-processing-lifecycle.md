# Image Processing Lifecycle

## Overview

The image processing pipeline converts uploaded source files into
deep-zoom (DZI) tile sets. It supports SVS, pyramidal TIFF, and
standard image formats.

## Pipeline stages

```
Upload (API pod)
  │  File validated → streamed to disk → SourceImage(status="pending")
  ▼
Enqueue
  │  arq/Redis job, or BackgroundTasks fallback in local execution mode
  ▼
Process (dedicated worker, or in-process only in local execution mode)
  │  pending → processing (5%) → tiles (10-78%) → thumbnail (80-85%)
  │  → saving record (90%) → completed (100%)
  ▼
Serve
     DZI tiles at /api/tiles/<source_id>/image.dzi
     Thumbnail at /api/tiles/<source_id>/thumbnail.jpeg
```

## Status transitions

| Status       | Progress | Description                                          |
| ------------ | -------- | ---------------------------------------------------- |
| `pending`    | 0%       | SourceImage created, awaiting processing             |
| `processing` | 5%       | Worker picked up the job                             |
| _(tiles)_    | 10-78%   | `pyvips.dzsave()` running (progress via eval signal) |
| _(thumb)_    | 80-85%   | Thumbnail generation                                 |
| _(saving)_   | 90%      | Creating/updating Image record in DB                 |
| `completed`  | 100%     | Image record created, tiles on disk                  |
| `failed`     | —        | Error; `error_message` set on SourceImage            |

Progress values in the 10-78% range come from pyvips eval signal
callbacks mapped via `ProgressTracker`. The async `_flush_progress()`
coroutine writes tracker state to the database every 1.5 seconds
without blocking tile generation.

## Worker configuration

| Setting              | Value            | Rationale                                                                                                                                                          |
| -------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WORKER_MAX_JOBS`    | 4 (configurable) | Concurrent processing slots per worker pod; also bounds in-process bulk-import concurrency in local mode                                                           |
| `WORKER_TOTAL_SLOTS` | 4 (configurable) | Cluster-wide worker-slot capacity used by starvation detection; defaults to the single-replica `WORKER_MAX_JOBS` value and can later be set to replicas × max jobs |
| `job_timeout`        | 7200s            | 2 hours — large filesystem archives need headroom                                                                                                                  |

Task types registered on the worker:

- `process_source_image_task` — new upload
- `replace_image_task` — image replacement
- `bulk_import_task` — multi-file / ZIP ingestion

### Task execution modes and Redis fallback

`TASK_EXECUTION_MODE=local` preserves the development behavior: a Redis
reachability or submission failure returns a fallback result and the caller
may use FastAPI's `BackgroundTasks`. `TASK_EXECUTION_MODE=required` never
runs image processing in the API process. A queue failure returns HTTP 503
with `Retry-After: 30`; rows created before submission are marked failed and
staged files are removed.

The dedicated worker uses arq's built-in `arq:queue:health-check` key,
refreshed independently of job slots every 30 seconds. Kubernetes liveness
should run `arq app.worker.WorkerSettings --check`; arq returns a non-zero
exit code when the key is missing or expired. The queue health endpoint
reports Redis reachability separately from worker liveness, and is
intentionally not part of the readiness probe.

### Trace context propagation

The API pod serialises W3C trace context into arq job arguments via
`opentelemetry.propagate.inject(carrier)`. The worker extracts it so
the full upload → enqueue → worker → tile-gen → DB-write pipeline
appears as a single distributed trace.

## Tile generation

```python
# processing.py → generate_tiles()
# DZI parameters live in tile_provenance.py so they also feed the settings hash.
image = pyvips.Image.new_from_file(source_path, access="sequential")
image.dzsave(
    output,
    tile_size=DZI_TILE_SIZE,    # 254
    overlap=DZI_OVERLAP,        # 1
    suffix=DZI_TILE_SUFFIX,     # ".jpeg[Q=85]"
)
```

- `access="sequential"` — memory-efficient streaming; the file is read
  once without random access.
- `tile_size=254`, `overlap=1` — standard DeepZoom parameters. These (and the
  JPEG suffix) are defined as constants in `app/tile_provenance.py`, so the
  recorded `tile_settings_hash` always reflects the parameters actually used —
  see [tile-cache-provenance.md](tile-cache-provenance.md).
- JPEG quality 85 — balance between file size and visual fidelity.
- Runs via `asyncio.to_thread()` so the event loop is not blocked.

### Thumbnail

```python
thumb = pyvips.Image.thumbnail(source_path, 256, height=256, crop="centre")
```

A fresh file handle is needed because the sequential stream was consumed
by `dzsave`. Center-cropping ensures card previews show a recognisable
portion regardless of aspect ratio.

### Tile count estimation

`_estimate_tile_count(width, height)` sums tiles across all pyramid
levels (halving dimensions each level) for progress logging and span
attributes.

## Pyramidal image detection

`detect_pyramid_info(source_path)` inspects a source file for
pre-existing pyramidal structure and microscopy metadata.

| Loader          | Detection method                   | Metadata extracted                          |
| --------------- | ---------------------------------- | ------------------------------------------- |
| `openslideload` | `openslide.level-count > 1`        | `mpp_x/y`, `objective_power` (incl. Aperio) |
| `tiffload`      | SubIFD-based or multi-page pyramid | Resolution from TIFF xres/yres              |

Derived fields:

- `measurement_scale = 1.0 / mpp_x` (pixels per µm)
- `measurement_unit = "um"` (always, when MPP is available)

TIFF resolution conversion: libvips stores resolution in pixels/mm, so
`mpp_x = 1000.0 / xres`. Values outside 0.01–100 µm/px are discarded
as unreasonable for microscopy.

## Image replacement

`process_replace_image(source_image_id, target_image_id)`:

1. Generates new tiles + thumbnail from the replacement source file
2. Updates the existing `Image` record: `tile_sources`, `thumb`,
   `width`, `height`, `file_size`, `version` (bumped)
3. Clears `canvas_annotations` and `locked_overlays` from metadata
   (coordinates reference old image geometry)
4. Re-derives pyramid metadata from the new file
5. Removes old tile directory from disk **after** the DB commit succeeds

In `required` task-execution mode, a queue rejection marks the replacement
source as failed and removes its staged file, but applies no metadata or
version changes to the target image.

See [image-metadata-and-versioning.md](image-metadata-and-versioning.md)
for the full metadata preservation/clearing rules.

## File paths

| Env var             | Default               | Contents                     |
| ------------------- | --------------------- | ---------------------------- |
| `SOURCE_IMAGES_DIR` | `/data/source_images` | Uploaded raw images          |
| `TILES_DIR`         | `/data/tiles`         | Generated DZI tiles + thumbs |

Tiles are served via FastAPI `StaticFiles` mount at `/api/tiles`. In
production, nginx or a CDN should serve these directly from the PVC.

## Tile-cache provenance

On successful tile generation (both new uploads and replacements) the
`SourceImage` records provenance so tile currentness can be evaluated later
without filesystem inspection:

- `source_checksum` — SHA-256 of the source file (best-effort; never blocks
  completion).
- `tile_settings_hash` — fingerprint of the DZI settings + pipeline version.
- `tiles_generated_at` — generation timestamp.

The effective `tile_cache_status` (`current` / `missing` / `stale` / `failed`)
is computed from these fields plus the current pipeline settings. The DZI
parameters live in `app/tile_provenance.py` and feed both `dzsave` and the
settings hash. See [tile-cache-provenance.md](tile-cache-provenance.md) for the
staleness rules and API surface.

Bulk-import coordinators distinguish a lost child job from a stopped worker.
The coordinator itself is registered with arq using `max_tries=1`: arq does not
retry a timed-out coordinator because rerunning the non-idempotent coordinator
would create duplicate `SourceImage` rows for the same files.
All coordinators register liveness in Redis, including API-hosted local
fallbacks, while a separate registration tracks only worker-hosted arq slot
occupancy. Capacity starvation counts only the latter. The bulk-import endpoint
returns HTTP 409 (`A bulk import is already in progress`) while another
pending or processing import is active, preventing coordinators from
consuming every worker slot. This serialization is intentionally temporary
until issue [#1078](https://github.com/bcit-tlu/hriv/issues/1078) provides a
safe concurrent-coordinator model. A pending row blocks only while its
coordinator has a live registration; if the enqueue or coordinator is lost,
the missing registration lets a later request proceed rather than making
imports permanently un-startable.
When a queued child observes an absent worker heartbeat for the configured
wall-clock window, it writes arq's abort latch before marking the `SourceImage`
failed. The latch narrows the race window; the processor's terminal-row guard
is what guarantees a late child cannot overwrite a recorded failure. If Redis
cannot accept the latch, the row remains pending and the coordinator keeps
waiting. The pending wait ceiling stays below the
coordinator's `job_timeout` as an evidence-gated last resort, so it can record a
child whose status has remained unknown without failing healthy queued work.
The processing backstop is above the child's `job_timeout` because its clock
starts when processing is first observed. Worker-hosted coordinators normally
rely on the 900-second no-progress stale check because arq's coordinator
timeout is reached first; the processing backstop is retained for API-hosted
coordination. Both paths use the latch before failing the row. This guarantee
relies on the pinned arq version's past-dated abort-marker behavior and is
covered by
`test_abort_latch_survives_pruning_and_is_consumed_before_job_start` in
`backend/tests/test_worker.py`.

Every source-image processor also refuses to start when its row is already
terminal, regardless of whether startup reconciliation, a bulk-import
detector, or another failure path recorded that terminal state. This prevents
late queued jobs from overwriting a recorded failure; arq retries remain
valid because retryable rows stay in `processing` rather than becoming
terminal.

## Stale SourceImage reconciliation

`reconcile_stale_source_images()` runs on **backend (API pod) startup** and marks
SourceImages as `failed` when they exceed status-specific cutoffs. `processing`
rows use the 900-second no-progress cutoff because they have started work.
`pending` rows are never failed by elapsed time alone. Once they exceed the
`job_timeout // 2` observation bound (1 hour by default), they are failed only
when Redis is reachable, a worker heartbeat is present, and the arq queue is
empty. A non-empty or unhealthy queue leaves pending rows untouched so a valid
queued job can still self-heal. This handles genuinely lost jobs without
failing healthy queued work.

`reconcile_stale_bulk_import_jobs()` also runs at startup. It marks a
`pending` or `processing` bulk-import row as terminal only when its
`updated_at` is older than the configured stale threshold and it has no live
coordinator registration: incomplete rows become `failed`, while rows whose
completed count equals their total become `completed`. A live registration
keeps a long-running import untouched.
When Redis is unavailable, startup uses the conservative stale timestamp
bound alone rather than leaving abandoned rows permanently in `processing`;
the default bound is the coordinator job timeout. API-hosted local fallbacks
register in the general coordinator liveness set and therefore use the same
conservative abandoned-row path on startup. Existing per-file `errors` and
`failed_count` accounting is preserved. This finalises coordinator rows left
behind by a cancelled or killed arq job; the coordinator uses
`max_tries=1` because retrying its non-idempotent batch would duplicate
`SourceImage` rows.

## Related code

- Upload router: `backend/app/routers/upload.py`
- Processing pipeline: `backend/app/processing.py`
- Worker config: `backend/app/worker.py`
- Image validation: `backend/app/image_validation.py`

## Related tests

- `backend/tests/test_processing.py` — tile generation, pyramid detection, replacement
- `backend/tests/test_worker.py` — enqueue, fallback, trace propagation
- `backend/tests/test_router_upload.py` — upload validation, file streaming

## Related skills

- [Testing Image Processing](../.agents/skills/testing-image-processing/SKILL.md) — hands-on testing guide
