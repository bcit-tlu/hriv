# Browse state revision

A singleton `browse_state` row (`backend/app/models.py::BrowseState`, migration
`0020_browse_state`) holds a monotonic `revision` that changes whenever any data
affecting the Browse page category tree changes. It is the implementation of
issue #1066.

## Why

`GET /api/categories/tree` builds and serializes the full visible category tree
on every request. For background polls and post-reorder refreshes this is
wasted work when nothing has changed. A cheap per-user ETag lets the endpoint
return `304 Not Modified` without building the tree.

## Model

- `browse_state.id` — always `1` (singleton primary key).
- `browse_state.revision` — monotonically increasing `BigInteger`, starting at
  `0`.
- `browse_state.updated_at` — last bump timestamp.

## ETag / revision contract

`GET /api/categories/tree` computes:

```text
ETag = W/"browse-{revision}-{viewer_hash}"
X-Browse-Revision = {revision}
```

`viewer_hash` is an opaque MD5 of `role|sorted_program_ids|sorted_group_ids`
so students with different program/group memberships do not share an ETag.

If the client's `If-None-Match` matches, the endpoint returns `304` immediately
without loading the tree.

## Mutations that bump the revision

The revision is incremented inside the same transaction as the data change for:

- Category create/update/delete (`/api/categories/*`)
- Image create/update/delete (`/api/images/*`)
- `PUT /api/tile-order` (reorder)
- Image processing completion (`process_source_image`, `process_replace_image`)
- Admin restore/import (`admin_ops.py`)

No-op category/image edits (where the submitted values equal the current values)
do not bump the revision, so opening a dialog and clicking save without changing
anything no longer invalidates every viewer's tree cache. Image create/update/
delete/processing only bumps the revision when the image is or becomes attached
to a category; uncategorized images do not appear in the browse tree.

The per-entity `version` used for `If-Match` optimistic concurrency is only
incremented when the request actually changes the entity, so a no-op save does not
stale the client's ETag.

The `PUT /api/tile-order` response includes the new `browse_revision` (both in
the JSON body and the `X-Browse-Revision` header) so the frontend can decide
whether a full tree reload is needed.

## Frontend behavior

`frontend/src/api.ts::fetchCategoryTree` returns the response body plus exposes
`ETag` and `X-Browse-Revision` through an `onHeaders` callback.
`frontend/src/useBrowseData.ts` stores the last ETag and sends it as
`If-None-Match` on subsequent polls and refreshes. When `fetchCategoryTree`
resolves to `null` (a `304`), `useBrowseData` skips `setCategories`, avoiding a
grid re-render and a costly tree rebuild in React.

## CORS

`backend/app/main.py` exposes `ETag` and `X-Browse-Revision` and allows
`If-None-Match` so the browser can send and read these headers.

## Testing

Backend tests cover:

- `GET /api/categories/tree` returns `304` when the ETag matches and does not
  call the expensive tree loader.
- The response sets `X-Browse-Revision` and an ETag on a normal `200`.
- `browse_state` helpers `get_browse_revision` / `bump_browse_revision` behave
  correctly when the singleton row is missing.
