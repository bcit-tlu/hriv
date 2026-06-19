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
  │  arq/Redis job, or BackgroundTasks fallback if Redis unavailable
  ▼
Process (worker or in-process)
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

| Setting       | Value | Rationale                                         |
| ------------- | ----- | ------------------------------------------------- |
| `max_jobs`    | 4     | Concurrent processing slots per worker pod        |
| `job_timeout` | 7200s | 2 hours — large filesystem archives need headroom |

Task types registered on the worker:

- `process_source_image_task` — new upload
- `replace_image_task` — image replacement
- `bulk_import_task` — multi-file / ZIP ingestion

### Redis fallback

When Redis is unavailable (`get_pool()` returns `None`), the API pod
falls back to FastAPI's `BackgroundTasks`. This makes processing
synchronous from the upload handler's perspective but keeps the app
fully functional in development without Redis.

### Trace context propagation

The API pod serialises W3C trace context into arq job arguments via
`opentelemetry.propagate.inject(carrier)`. The worker extracts it so
the full upload → enqueue → worker → tile-gen → DB-write pipeline
appears as a single distributed trace.

## Tile generation

```python
# processing.py → generate_tiles()
image = pyvips.Image.new_from_file(source_path, access="sequential")
image.dzsave(output, tile_size=254, overlap=1, suffix=".jpeg[Q=85]")
```

- `access="sequential"` — memory-efficient streaming; the file is read
  once without random access.
- `tile_size=254`, `overlap=1` — standard DeepZoom parameters.
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

See [image-metadata-and-versioning.md](image-metadata-and-versioning.md)
for the full metadata preservation/clearing rules.

## File paths

| Env var             | Default               | Contents                     |
| ------------------- | --------------------- | ---------------------------- |
| `SOURCE_IMAGES_DIR` | `/data/source_images` | Uploaded raw images          |
| `TILES_DIR`         | `/data/tiles`         | Generated DZI tiles + thumbs |

Tiles are served via FastAPI `StaticFiles` mount at `/api/tiles`. In
production, nginx or a CDN should serve these directly from the PVC.

## Stale SourceImage reconciliation

`reconcile_stale_source_images()` runs on **backend (API pod) startup** and marks
SourceImages as `failed` if they have been stuck in `pending` or
`processing` for longer than a threshold (default: `job_timeout` plus
a buffer). This handles cases where the worker crashed mid-processing.

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
