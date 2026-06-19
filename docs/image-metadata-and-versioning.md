# Image Metadata and Versioning

## Overview

Images use version-based optimistic concurrency control to prevent
concurrent writers from silently overwriting each other's changes.
The `Image.version` column (integer, starts at 1) increments on every
update.

## Optimistic Concurrency (If-Match / ETag)

### Single-image updates (`PATCH /api/images/{id}`)

The backend implements **atomic compare-and-swap** (CAS):

```
UPDATE images SET version = version + 1
WHERE id = :image_id AND version = :client_version
```

If the `rowcount` is 0, the resource was modified since the client last
read it → **409 Conflict**.

| Client sends          | Backend behaviour                                     |
| --------------------- | ----------------------------------------------------- |
| `If-Match: <version>` | CAS check + bump; 409 on mismatch, 400 if malformed   |
| No `If-Match` header  | Version bumped unconditionally (no concurrency check) |

On success the response includes `ETag: "<new_version>"`.

### Bulk updates (`PATCH /api/images/bulk`)

Version is incremented per image but `If-Match` is **not** checked.
This is intentional — bulk operations (move multiple images, toggle
active) are admin-only and do not race with overlay/annotation saves.

### Frontend usage

```typescript
// api.ts
export function updateImage(id, body, version?) {
  const headers = {}
  if (version !== undefined) headers['If-Match'] = String(version)
  return request(`/images/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers })
}
```

Overlay and annotation hooks (`useCanvasAnnotations.ts`,
`useOverlayPersistence`) track the latest version separately to avoid
stale 409s after background metadata refreshes. Do **not** remount the
viewer just to refresh metadata — use the version returned in the ETag.

## Metadata Fields

Image metadata is stored in a JSONB column (`Image.metadata_`, mapped
from `metadata` in the DB).

### Update semantics

| Field                  | Behaviour                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `metadata_extra`       | **Wholesale replace** — the provided dict replaces `metadata_` entirely                                                   |
| `metadata_extra_merge` | **Server-side partial merge** — provided keys are set/updated; keys with `None` values are deleted from existing metadata |

Use `metadata_extra_merge` when updating a single metadata field (e.g.
`canvas_annotations`) to avoid overwriting unrelated fields (e.g.
`measurement_scale`).

### Known metadata keys

| Key                   | Type            | Source                      | Description                             |
| --------------------- | --------------- | --------------------------- | --------------------------------------- |
| `canvas_annotations`  | JSON            | Frontend (Fabric.js)        | Serialised canvas annotation objects    |
| `locked_overlays`     | JSON array      | Frontend                    | Persistent rectangular overlay regions  |
| `measurement_scale`   | float           | Processing (pyramid detect) | Pixels per µm (derived from MPP)        |
| `measurement_unit`    | string (`"um"`) | Processing (pyramid detect) | Unit for measurement_scale              |
| `objective_power`     | float           | Processing (pyramid detect) | Objective magnification                 |
| `mpp_x`, `mpp_y`      | float           | Processing (pyramid detect) | Microns per pixel (x and y)             |
| `pyramid_detected`    | bool            | Processing                  | Whether a pyramidal structure was found |
| `pyramid_level_count` | int             | Processing                  | Number of pyramid levels                |

### Image replacement behaviour

When a source image is replaced (`process_replace_image`):

| Metadata key          | Action                                                            |
| --------------------- | ----------------------------------------------------------------- |
| `canvas_annotations`  | **Cleared** — coordinates reference old geometry                  |
| `locked_overlays`     | **Cleared** — coordinates reference old geometry                  |
| `measurement_scale`   | **Re-derived** from new file if also pyramidal; cleared otherwise |
| `measurement_unit`    | **Re-derived** from new file if also pyramidal; cleared otherwise |
| `objective_power`     | **Re-derived** from new file if also pyramidal; cleared otherwise |
| `mpp_x`, `mpp_y`      | **Re-derived** from new file if also pyramidal; cleared otherwise |
| `pyramid_detected`    | **Re-derived** from new file if also pyramidal; cleared otherwise |
| `pyramid_level_count` | **Re-derived** from new file if also pyramidal; cleared otherwise |

All pyramid-related keys are cleared first, then re-populated if the
replacement file is also pyramidal. Version is bumped unconditionally.

## Related code

- Backend model: `backend/app/models.py` → `Image.version`
- Backend update: `backend/app/routers/images.py` → `update_image()`
- Backend replacement: `backend/app/processing.py` → `process_replace_image()`
- Frontend API: `frontend/src/api.ts` → `updateImage()`
- Frontend hooks: `frontend/src/useCanvasAnnotations.ts`,
  `frontend/src/useOverlayPersistence.ts`

## Related tests

- `backend/tests/test_router_images.py` — CAS, 409 conflict, ETag round-trip
- `frontend/tests/useCanvasAnnotations.test.ts` — version tracking across saves
- `frontend/tests/useOverlayPersistence.test.ts` — overlay version tracking
- `frontend/tests/useImageActions.test.ts` — version-aware image updates
