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
`useOverlayPersistence`) track the latest version separately to avoid stale
409s after metadata operations. Canvas annotations use an explicit-save
transaction: draft changes are local only, Save & Exit sends one
`metadata_extra_merge.canvas_annotations` update without an autosave queue, and
failed saves leave the draft available for retry. Overlay lock/clear operations
never flush or persist a canvas draft. Do **not** remount the viewer just to
refresh metadata — use the version returned in the ETag.

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

The single-image edit form sends an explicit empty `description` or
`instructor_note` when the user clears that field, allowing the stored value to
be removed. Bulk edit treats a blank field as “no change” and omits it from the
request, preserving existing values on the selected images.

### Description and Instructor note

Images and source images carry two optional free-text fields (`Text`, max 500
characters each; blank normalizes to `null`):

| Field             | Visible to                    | Writable by       | Notes                                                                 |
| ----------------- | ----------------------------- | ----------------- | --------------------------------------------------------------------- |
| `description`     | All roles, including students | admin, instructor | Renamed from `note` (migration `0049_image_description_split`).       |
| `instructor_note` | admin, instructor, staff      | admin, instructor | `null` in every student payload; scrubbed server-side, not in the UI. |

Scrubbing happens in `collection_views.image_out(img, scrub_instructor_note=...)`
at the four student-reachable image read paths: `GET /images/`,
`GET /images/{id}`, the category tree (`_load_tree`) and collection detail
(`collection_out`). It clears the Pydantic copy only — never the ORM attribute,
which would mark the row dirty and persist `NULL` on a later commit. Any new
endpoint that returns `ImageOut` to students must go through `image_out`.

Every write path accepts both fields (admin/instructor only; staff are
read-only):

| Endpoint                     | Encoding              | Omitted field | Explicit `""` |
| ---------------------------- | --------------------- | ------------- | ------------- |
| `POST /images/`              | JSON                  | `null`        | `null`        |
| `PATCH /images/{id}`         | JSON                  | unchanged     | cleared       |
| `PATCH /images/bulk`         | JSON                  | unchanged     | cleared       |
| `POST /images/{id}/replace`  | multipart form fields | unchanged     | cleared       |
| `POST /source-images/upload` | multipart form fields | `null`        | `null`        |
| `POST /admin/bulk-import`    | multipart form fields | `null`        | `null`        |

Multipart endpoints reject a value over 500 characters with `400`
(`"Description must be…"` / `"Instructor note must be…"`); JSON endpoints
return `422`. Uploads and bulk imports stage both fields on the
`SourceImage`, and processing copies them onto the new `Image`. Bulk imports
apply the same values to every file; supervisor jobs created before #1780
stored the description under `note`, which a resumed job still reads.

### Known metadata keys

| Key                        | Type                            | Source                                                        | Description                                                                                                                                                                            |
| -------------------------- | ------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `canvas_annotations`       | JSON                            | Frontend (Fabric.js)                                          | Serialised canvas annotation objects                                                                                                                                                   |
| `locked_overlays`          | JSON array                      | Frontend                                                      | Persistent rectangular overlay regions                                                                                                                                                 |
| `measurement_scale`        | float                           | Processing (pyramid detect)                                   | Pixels per µm (derived from MPP, or approved via [Measurement review](measurement-review.md))                                                                                          |
| `measurement_unit`         | string (`um`, `nm`, `mm`, `cm`) | Processing (pyramid detect), Edit image, measurement approval | Unit for measurement_scale; older free-text values are kept and stay selectable                                                                                                        |
| `measurement_scale_source` | string                          | [Measurement review](measurement-review.md) approval          | How the approved scale was found (`rbc`, `manual`)                                                                                                                                     |
| `measurement_finding_id`   | int                             | [Measurement review](measurement-review.md) approval          | Approved `measurement_findings.id`                                                                                                                                                     |
| `objective_power`          | float                           | Processing (pyramid detect), Edit image, measurement approval | Objective magnification (e.g. `40.0`); shown in Image details and the optional Manage **Objective** column. Approval writes it only when absent, so embedded values stay authoritative |
| `mpp_x`, `mpp_y`           | float                           | Processing (pyramid detect)                                   | Microns per pixel (x and y)                                                                                                                                                            |
| `pyramid_detected`         | bool                            | Processing                                                    | Whether a pyramidal structure was found                                                                                                                                                |
| `pyramid_level_count`      | int                             | Processing                                                    | Number of pyramid levels                                                                                                                                                               |

The synchronized collection viewer's persisted pane positions
(`{ "<image_id>": {zoom, x, y, rotation} }`) are **not** image metadata —
they live in `Collection.viewport_state`, a separate whole-replace JSONB
column with its own `Collection.version` optimistic concurrency; see
[collections.md](collections.md#synchronized-collection-viewer-1417).

### Image replacement behaviour

When a source image is replaced (`process_replace_image`):

| Metadata key                                         | Action                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `canvas_annotations`                                 | **Cleared** — coordinates reference old geometry                                    |
| `locked_overlays`                                    | **Cleared** — coordinates reference old geometry                                    |
| `measurement_scale`                                  | **Re-derived** from new file if also pyramidal; cleared otherwise                   |
| `measurement_unit`                                   | **Re-derived** from new file if also pyramidal; cleared otherwise                   |
| `measurement_scale_source`, `measurement_finding_id` | **Cleared**; the image's measurement findings are superseded so it can be rescanned |
| `objective_power`                                    | **Re-derived** from new file if also pyramidal; cleared otherwise                   |
| `mpp_x`, `mpp_y`                                     | **Re-derived** from new file if also pyramidal; cleared otherwise                   |
| `pyramid_detected`                                   | **Re-derived** from new file if also pyramidal; cleared otherwise                   |
| `pyramid_level_count`                                | **Re-derived** from new file if also pyramidal; cleared otherwise                   |

All pyramid-related keys are cleared first, then re-populated if the
replacement file is also pyramidal. Version is bumped unconditionally.

`description` and `instructor_note` are columns, not metadata keys, so
replacement never clears them. A replace request that also sends either field
updates it atomically with the source-image insert; both are part of the
metadata snapshot, so a required-mode enqueue rejection restores the original
values along with the rest of the metadata.

Replacement deletes the image's `Inuksuk` rows in the same transaction as
the geometry update; ownership rows and Board links cascade. Boards
remain, but old coordinate bookmarks cannot survive a geometry
replacement. The old image's `inuksuks/` thumbnail directory is removed only
after the database commit succeeds. A failed replacement preserves the rows
and old thumbnails.

## Source image information

`GET /api/images/{id}/source-info` returns the original filename and its
uppercase file extension for the latest completed source image. Pending and
failed sources are ignored. The uploader's name is included only for admin and
instructor viewers; staff and students receive no uploader name.

Migration `0036_image_file_size_backfill` fills null `Image.file_size` values
from the latest completed source image when it has a size. It preserves existing
image sizes and does not fall back to an older completed source when the latest
one has no size. An admin tile rebuild fills any remaining gaps from the source
image.

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
