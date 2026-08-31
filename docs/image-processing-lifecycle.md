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

## Filename normalization

Client-supplied filenames are normalized once at ingestion by
`sanitize_upload_filename()` (`backend/app/filenames.py`) before they are
persisted as `SourceImage.original_filename` or `AdminTask.original_filename`.
It applies to single uploads, image replacement, bulk-import members (including
ZIP entries), and filesystem-import archives, so the API, logs, span
attributes, and processing error messages all show the same value.

Normalization takes the basename (dropping `/` and `\` components), removes
control characters and newlines, collapses whitespace runs to single spaces,
NFC-normalizes unicode, truncates to the 500-character column limit, and falls
back to `unnamed` when nothing usable remains. Spaces and non-ASCII characters
are preserved, and the value is stored as plain text — markup is **not**
HTML-escaped at ingestion; renderers escape.

The on-disk copy is named from a UUID plus a bounded suffix
(`storage_extension()`); a client suffix longer than 32 bytes falls back to
`.bin`, so an over-long display name cannot produce an invalid path component.

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

### Failure messages

`_processing_failure_message()` builds the persisted `error_message`. ENOSPC
failures (including libvips write errors that carry the strerror text) become
"Insufficient storage — the tiles volume is full"; every other failure keeps the
underlying exception text after `Tile generation failed:` /
`Image replacement failed:`, collapsed to one line, with absolute paths reduced
to their basename, the generated storage name swapped for the uploaded
filename, and the detail truncated to 300 characters. The frontend
polls the source image and shows that message in the processing snackbar; for
bulk imports the per-file entries of `BulkImportJob.errors` are listed instead.

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
pending or processing import has a live coordinator registration, or while a
pending or processing row is still within the short coordinator-registration
window (covering coordinators that are queued or starting and have not
registered yet).
Staleness alone never blocks a new import, and an unreadable Redis liveness
check fails open. This prevents coordinators from consuming every worker slot
without making imports permanently un-startable. The serialization is
intentionally temporary until issue
[#1078](https://github.com/bcit-tlu/hriv/issues/1078) provides a safe
concurrent-coordinator model. A pending row blocks only while its coordinator
has a live registration; if the enqueue or coordinator is lost, the missing
registration lets a later request proceed.
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

## Surfacing failures after a reload

`SourceImage.error_message` is persisted, so failures survive a reload — but the
frontend's `useProcessingJobs` state only holds jobs created during the current
page session. `rehydrateFailedJobs()` closes that gap: on the first
admin/instructor entry it calls
`GET /api/source-images/?status=failed&limit=20` (`status` and `limit` are
optional query params on the existing admin/instructor-only list endpoint, both
applied in SQL) and restores each row as a terminal `failed` job carrying the
persisted sanitized message. Restored jobs never start a poller and never count
against `MAX_PROCESSING_JOBS`; rows older than
`REHYDRATED_FAILURE_MAX_AGE_MS` (7 days, measured from `created_at`) are
ignored, and a failed fetch clears the once-per-session guard so the next entry
retries.

Failure snackbars no longer auto-hide — an operator must dismiss them. Dismissed
source-image ids are persisted per user scope in `localStorage`
(`hrivpref:dismissed-failed-uploads:user:<scope>`, capped at 200 ids) so a
dismissed failure does not return on the next reload. Five or more image
failures collapse into a single `N uploads failed.` snackbar to avoid a pile-up.

Only server-confirmed failures (`serverFailed`, set when the backend reports the
`SourceImage` as `failed` and on rehydration) participate in dismissal
persistence and in that collapse. Client-side failures — an aborted upload, or
status tracking lost to an expired session while the server keeps working —
keep their own snackbar and are never remembered, so they cannot suppress the
genuine failure the backend may record later.

Because a collapsed snackbar cannot show every filename, the **Failed uploads**
dialog (`frontend/src/components/FailedUploadsDialog.tsx`) lists every failed
source image with its filename, failure time, and persisted reason. It is
reachable from the collapsed snackbar's _Details_ action and from the Manage
page header, so it remains available after every snackbar has been dismissed;
rows can be dismissed individually or all at once.

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
