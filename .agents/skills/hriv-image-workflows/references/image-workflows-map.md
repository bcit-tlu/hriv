# Image Workflows Map

## Backend Files

| Concern | Files |
|---|---|
| Upload endpoint | `backend/app/routers/upload.py` |
| Image CRUD and metadata | `backend/app/routers/images.py` |
| Processing pipeline | `backend/app/processing.py` |
| Worker task entry | `backend/app/worker.py` |
| Validation | `backend/app/image_validation.py` |
| Models | `backend/app/models.py` (`Image`, `SourceImage`) |
| Schemas | `backend/app/schemas.py` |
| Tile/static serving setup | `backend/app/main.py` |
| OTEL spans | `backend/app/tracing.py`, `backend/app/otel_bootstrap.py` |

## Frontend Files

| Concern | Files |
|---|---|
| Viewer | `frontend/src/components/ImageViewer.tsx` |
| Canvas annotations | `frontend/src/components/CanvasOverlay.tsx`, `useCanvasAnnotations.ts` |
| Locked overlays | `useOverlayPersistence.ts` |
| Upload modal | `components/UploadImageModal.tsx` |
| Edit/replace image | `components/EditImageModal.tsx`, `useImageActions.ts` |
| Processing polling | `useProcessingJobs.ts`, `pollProcessingJob.ts` |
| Metadata form | `components/ImageMetadataFields.tsx` |
| Shareable viewer state | `useShareableImageState.ts` |

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

## Docs And Tests

- `../../../docs/image-processing-lifecycle.md`
- `../../../docs/image-metadata-and-versioning.md`
- `../../../docs/observability-conventions.md` for spans/logging
- `$testing-image-processing` for local stack and large-file verification
