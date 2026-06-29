# Image Workflows Map

## Backend Files

| Concern                   | Files                                                     |
| ------------------------- | --------------------------------------------------------- |
| Upload endpoint           | `backend/app/routers/upload.py`                           |
| Image CRUD and metadata   | `backend/app/routers/images.py`                           |
| Processing pipeline       | `backend/app/processing.py`                               |
| Worker task entry         | `backend/app/worker.py`                                   |
| Validation                | `backend/app/image_validation.py`                         |
| Models                    | `backend/app/models.py` (`Image`, `SourceImage`)          |
| Schemas                   | `backend/app/schemas.py`                                  |
| Tile/static serving setup | `backend/app/main.py`                                     |
| OTEL spans                | `backend/app/tracing.py`, `backend/app/otel_bootstrap.py` |

## Frontend Files

| Concern                | Files                                                                  |
| ---------------------- | ---------------------------------------------------------------------- |
| Viewer                 | `frontend/src/components/ImageViewer.tsx`                              |
| Canvas annotations     | `frontend/src/components/CanvasOverlay.tsx`, `useCanvasAnnotations.ts` |
| Locked overlays        | `useOverlayPersistence.ts`                                             |
| Upload modal           | `components/UploadImageModal.tsx`                                      |
| Edit/replace image     | `components/EditImageModal.tsx`, `useImageActions.ts`                  |
| Processing polling     | `useProcessingJobs.ts`, `pollProcessingJob.ts`                         |
| Metadata form          | `components/ImageMetadataFields.tsx`                                   |
| Shareable viewer state | `useShareableImageState.ts`                                            |

## Lifecycle

1. User uploads a source image.
2. Backend validates and stores source file.
3. Backend enqueues arq worker task; if Redis enqueue fails, it falls back to
   FastAPI background processing.
4. Worker/libvips generates DZI tiles and thumbnail, updates progress, and saves
   image records.
5. Frontend polls processing status and then displays tiles through
   OpenSeadragon.
6. Viewer persists annotations, overlays, and metadata with version-aware API
   calls.

## Metadata Update Rules

- `metadata_extra`: replace the whole JSON object.
- `metadata_extra_merge`: patch keys server-side; `None` deletes a key.
- Use merge for `canvas_annotations`, `locked_overlays`, and measurement scale
  updates unless intentionally replacing every metadata key.

## Processing Pipeline Detail

1. **Upload** (`routers/upload.py`): file validated by extension/MIME, streamed
   to disk in 1 MiB chunks, recorded as `SourceImage(status="pending")`.
2. **Enqueue** (`worker.py`): job enqueued via arq/Redis; if Redis is
   unavailable the upload router falls back to FastAPI `BackgroundTasks`.
3. **Process** (`processing.py`):
   - Status/progress: `pending` → `processing` (5%) → tile generation (10–78%)
     → thumbnail (80–85%) → saving record (90%) → `completed` (100%) or
     `failed`.
   - `pyvips.Image.new_from_file(source_path, access="sequential")` for
     memory-efficient streaming; `pyvips.dzsave()` generates DZI tiles
     (`tile_size=254`, `overlap=1`, JPEG Q=85).
   - `ProgressTracker` maps pyvips eval callbacks into DB progress updates.
   - Thumbnail is a 256×256 center-cropped square.
   - CPU/image work runs via `asyncio.to_thread()` to keep the event loop free.
4. **Finalize**: creates/updates the `Image` record with `tile_sources` and
   thumbnail URLs under `/api/tiles/...`; links `SourceImage.image_id`.
5. **Error handling**: sets `status="failed"` and `error_message`; logs
   exceptions.

`WorkerSettings`: `max_jobs=4`, `job_timeout=7200s`. DZI tiles are mounted at
`/api/tiles`; production may serve them via the nginx tile sidecar/static path
from the PVC. Env paths: `SOURCE_IMAGES_DIR` (default `/data/source_images`),
`TILES_DIR` (default `/data/tiles`).

## Optimistic Concurrency (If-Match / ETag)

Images use version-based optimistic concurrency control. `images.version` starts
at 1 and is incremented on updates.

- Frontend `updateImage()` sends `If-Match: <version>` on PATCH when it has a
  current version. Malformed `If-Match` values return 400.
- With a client version, the backend does an atomic compare-and-swap:
  `UPDATE images SET version = version + 1 WHERE id = :image_id AND version =
:client_version`. Zero rows updated → **409 Conflict** ("Resource has been
  modified by another client").
- On success, the backend syncs the in-memory object to the new version, applies
  changes, commits, and returns the new version in the `ETag` response header.
- If `If-Match` is absent, the version is incremented unconditionally.
- `PATCH /api/images/bulk` increments versions but does **not** check `If-Match`.

This is critical for overlay locking, canvas annotation saves, and metadata
updates where multiple users/tabs race on the same image. Key implementation:
`backend/app/routers/images.py` (`update_image()`); caller:
`frontend/src/api.ts` (`updateImage()`).

## Docs And Tests

- `../../../../docs/image-processing-lifecycle.md`
- `../../../../docs/image-metadata-and-versioning.md`
- `../../../../docs/observability-conventions.md` for spans/logging
- `$testing-image-processing` for local stack and large-file verification
