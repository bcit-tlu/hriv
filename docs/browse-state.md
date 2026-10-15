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
- Collection writes that change tile- or list-visible data (#1525, #1531,
  #1619) — create / update / delete, member-image and viewport replacements,
  `PUT /owners` (owner names render on tiles), `POST /move`, `POST /transfer`;
  plus the user/program deletions that alter or delete collections and group
  deletion (`DELETE /api/groups/{id}` — the `collection_groups` cascade
  changes `group_ids` on list rows and can lift a restricted collection's
  group gate). Since
  #1619 these bumps are unconditional: unfiled collections never render on
  Browse but are rows in `GET /api/collections`, and the version CAS on move /
  viewport writes advances `version`/`updated_at` even on a no-op.
- `PUT /api/tile-order` (reorder)
- Image processing completion (`process_source_image`, `process_replace_image`)
- Admin restore/import (`admin_ops.py`)

The `browse_state` row is intentionally preserved across restore/import so the
revision counter stays monotonic; clearing it as part of a future truncation
would let clients holding old low-revision ETags receive a stale `304` against
restored data.

No-op category/image edits (where the submitted values equal the current values)
do not bump the revision, so opening a dialog and clicking save without changing
anything no longer invalidates every viewer's tree cache. Image create/update/
delete/processing only bumps the revision when the image is or becomes attached
to a category OR belongs to any collection — a member image's
thumb/active/count renders on the collection's list row and Browse tile even
when the collection is unfiled (#1619); uncategorized non-member images do not
appear in either surface.

The per-entity `version` used for `If-Match` optimistic concurrency is only
incremented when the request actually changes the entity, so a no-op save does not
stale the client's ETag.

The `PUT /api/tile-order` response includes the new `browse_revision` (both in
the JSON body and the `X-Browse-Revision` header) so the frontend can decide
whether a full tree reload is needed.

## Collection tiles in the tree payload (#1529)

Each `CategoryTree` node also carries `collections: CollectionSummaryOut[]` —
the collections filed into that category — filtered by the same visibility
rules as `GET /api/collections` (the collection gate AND the category's
ancestor gate; a hidden ancestor hides its collections even when the
collection itself would be visible). Collection tiles therefore live inside
the same ETag/revision contract: any write that changes a tile-visible field
(name, visibility, owners, membership, placement) bumps the revision and
invalidates every affected viewer's cached tree.

When `COLLECTIONS_ENABLED` is off, `CategoryTree.collections` is always
empty and the collections query is skipped entirely — flag-off deployments
neither leak collection data nor grow the tree query count.

## Collections list ETag (#1619)

`GET /api/collections` rides the same `browse_state.revision`, computing:

```text
ETag = W/"collections-{revision}-{hash}"
X-Browse-Revision = {revision}
Cache-Control: private, no-cache
```

`hash` is an opaque SHA-256 (truncated) of the viewer fragment (`user_id|role|sorted
program ids|sorted group ids` — for all roles, since `can_transfer` and
`mine`/owner permissions depend on them) plus the canonical query fragment
(`type`, `mine`, `owner_user_id`, `owner_program_id`, `orphaned`,
`uncategorized`, normalized `q`, sorted `visibility`/`category_id`, `sort`,
`direction`, `limit`, `page`, `page_size`). A matching `If-None-Match`
(comma-split list or `*`) returns `304` before the collection select runs;
the validation errors (422/403) still precede the check so they are never
masked by a stale ETag.

Because the list includes unfiled collections, every collection write bumps
the revision — including writes on unfiled rows (create, move/viewport CAS,
sole-owner user deletion) and writes to images that belong to any
collection (`image_ids_in_collections` in `collection_views.py`).

Frontend: `fetchCollectionsPaged` defaults to `cache: 'no-store'` (the
browser must not synthesize a 200 from a revalidated entry), accepts
`ifNoneMatch`, and reports `etag`/`notModified`. `useCollectionsData`
stores the ETag per request key (both `paged` and `full` list modes) and
sends it on the next load or background poll for that exact key only —
never on a first load and never across a user switch. A `304` keeps the
cached rows and `X-Total-Count` total, refreshes the stored ETag, and skips
the page step-back logic.

## Frontend behavior

`frontend/src/api.ts::fetchCategoryTree` returns the response body plus exposes
`ETag` and `X-Browse-Revision` through an `onHeaders` callback.
`frontend/src/useBrowseData.ts` stores the last ETag and sends it as
`If-None-Match` on subsequent polls and refreshes. When `fetchCategoryTree`
resolves to `null` (a `304`), `useBrowseData` skips `setCategories`, avoiding a
grid re-render and a costly tree rebuild in React.
On non-root category navigation, the frontend silently revalidates the
category tree only (not uncategorized images), with a 10-second throttle from
the last successful tree read. Initial mount and root navigation do not add a
separate navigation check.

## CORS

`backend/app/main.py` exposes `ETag` and `X-Browse-Revision` and allows
`If-None-Match` so the browser can send and read these headers.

## Metrics

`GET /api/categories/tree` emits two OTel meter series (issue #1100, naming per
`docs/observability-conventions.md`):

- `hriv.browse_tree.requests` — counter, attribute `outcome` ∈
  `full` | `not_modified`. The `not_modified` share is the 304 hit rate;
  `full` counts successful builds only.
- `hriv.browse_tree.build.duration` — histogram (seconds) recorded only on the
  full-build path, i.e. the work each 304 avoids.

`GET /api/collections` emits the same pair (#1619):

- `hriv.collections_list.requests` — counter, attribute `outcome` ∈
  `full` | `not_modified`.
- `hriv.collections_list.build.duration` — histogram (seconds) recorded only
  on the full-build path.

Backend work saved ≈ `not_modified` count × mean build duration (one PromQL
expression over the two series). The same split is derivable from Loki
`http.request` logs (`route="/api/categories/tree"`, `status` 304 vs 200,
`duration_ms`) when metrics are unavailable. Client-side, `useBrowseData`
keeps cumulative poll outcomes on `window.__hrivBrowseStats` (dev-mode;
see `docs/drag-and-drop.md` → Instrumentation).

## Testing

Backend tests cover:

- `GET /api/categories/tree` returns `304` when the ETag matches and does not
  call the expensive tree loader.
- `GET /api/collections` returns `304` on a matching `If-None-Match` (or `*`)
  without running the collection select; a `200` sets `ETag`,
  `Cache-Control` and `X-Browse-Revision`; the tag varies by viewer and by
  canonical query (#1619).
- The list ETag is stable across identical calls and advances after each
  collection mutation, member-image write, and sole-owner user deletion —
  including on unfiled collections.
- The response sets `X-Browse-Revision` and an ETag on a normal `200`.
- `browse_state` helpers `get_browse_revision` / `bump_browse_revision` behave
  correctly when the singleton row is missing.
