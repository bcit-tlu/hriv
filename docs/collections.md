# Collections

Collections let any authenticated user group **existing** images into a
reusable viewing resource without duplicating image or category records. Two
types exist:

- **`sequence`** — an ordered set of images stepped through one at a time.
- **`synchronized`** — up to four stored images (the initial UI renders the
  first two) whose viewports are linked; the relative viewport positions can be
  saved with the collection.

Epic: [#1409](https://github.com/bcit-tlu/hriv/issues/1409). This page is
extended as each child issue lands; sections marked _planned_ are not yet
implemented.

## Data model

Migration `0030_collections` (`backend/app/models.py`: `Collection`,
`CollectionImage`, `collection_programs`, `collection_groups`).

| Table                 | Purpose                                                                                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collections`         | `name`, `description`, `type` (`synchronized` / `sequence`, CHECK), `visibility` (`private` / `public` / `restricted`, CHECK, default `private`), `user_id`, `owner_program_id`, `viewport_state` (JSONB, default `{}`), `version` |
| `collection_images`   | Ordered membership: PK `(collection_id, image_id)`, `sort_order`; index `idx_collection_images_order (collection_id, sort_order)`                                                                                              |
| `collection_programs` | Program scope for `visibility = restricted`                                                                                                                                                                                   |
| `collection_groups`   | Group scope for `visibility = restricted`                                                                                                                                                                                     |

### Ownership

A collection is owned by **either** a user (`user_id`, FK `CASCADE`) **or** a
program (`owner_program_id`, FK `SET NULL`) — enforced by
`ck_collections_single_owner` (`num_nonnulls(user_id, owner_program_id) <= 1`).

- Deleting a **user** deletes the collections they own.
- Deleting an **image** silently removes it from every collection
  (`collection_images.image_id` `CASCADE`).
- Deleting a **program** does _not_ delete its collections: `owner_program_id`
  becomes `NULL` and the collection is **orphaned** (both owner columns
  `NULL`). Orphaned collections keep their declared visibility but are
  manageable only by admins until reassigned.
- Deleting a **group** removes its `collection_groups` rows; unlike categories,
  a group attached to a collection does not block group deletion.

Collections are included in the admin database export/import round-trip
(`collections` key with ordered `image_ids`, `program_ids`, `group_ids`); see
[admin-import-export.md](admin-import-export.md).

`viewport_state` is written as a whole-column replacement (never a partial
JSONB merge). Its shape is finalised with the synchronized viewer (#1417).

## Authorization

Pure predicates live in `backend/app/authz.py`; routers call them and the
backend is authoritative (frontend gating on `permissions` is UX only).

### Who can see a collection (`can_view_collection`)

| Caller                     | private        | public | restricted                                          |
| -------------------------- | -------------- | ------ | --------------------------------------------------- |
| admin / instructor / staff | yes (all)      | yes    | yes                                                 |
| student — owner            | yes            | yes    | yes                                                 |
| student — other            | no             | yes    | only if the **program gate AND group gate** pass    |

The restricted dual gate mirrors
[category visibility](category-visibility-and-programs.md): for each dimension
the collection either has no scope rows or shares at least one entry with the
student. An empty scope on a dimension is unrestricted on that dimension.
Callers must always pass **both** `user_program_ids` and `user_group_ids`.

### Images inside a collection

Students receive only images they could open via `GET /api/images/{id}` —
`image.active` **and** the image's category (with ancestors) passes the dual
gate. Invisible images are **omitted** from `images`, `image_count` and
`cover_thumb`; the collection itself is still returned. Non-students see every
referenced image, including inactive ones.

### Who can manage a collection

| Predicate                 | admin | owner (any role) | instructor in `owner_program_id` | others |
| ------------------------- | ----- | ---------------- | -------------------------------- | ------ |
| `can_edit_collection`     | yes   | yes              | yes                              | no     |
| `can_delete_collection`   | yes   | yes              | yes                              | no     |
| `can_transfer_collection` | yes   | instructors only | yes                              | no     |

Orphaned collections (both owner columns `NULL`) satisfy none of the
owner/program branches, so only admins may edit, delete or reassign them.

Attaching `restricted` scope follows the category rules:
`can_attach_program_to_collection` (admins any program; instructors only
programs they belong to) and `can_attach_group_to_collection` (admins any
group; instructors only groups they manage). Students and staff cannot use
`restricted` visibility.

## API surface

Base path `/api/collections` (router `backend/app/routers/collections.py`).
All endpoints require a JWT bearer token — there is no unauthenticated variant
(see [unauthenticated-routes.md](unauthenticated-routes.md)).

| Method | Endpoint                | Min role | Notes                                                                                                                                                     |
| ------ | ----------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/collections`      | student  | Visible collections as `CollectionSummaryOut[]`. Query: `type`, `mine`, `owner_user_id`, `owner_program_id`, `orphaned` (**admin only**, others **403**). Ordered by `updated_at` desc. |
| GET    | `/api/collections/{id}` | student  | `CollectionOut` (summary + ordered `images: ImageOut[]`, `program_ids`, `group_ids`, `viewport_state`). **404** when missing _or_ not visible (no existence leak). |

`CollectionSummaryOut`: `id`, `name`, `description`, `type`, `visibility`,
`owner` (`{user_id, name}` | `{program_id, name}` | `null` when orphaned),
`image_count` (visible-to-caller), `cover_thumb` (first visible image thumb),
`version`, `created_at`, `updated_at`, `permissions {can_edit, can_delete,
can_transfer}`.

Image URLs (`cover_thumb`, `images[].thumb`, `images[].tile_sources`) are
tokenized at serialization time exactly like `GET /api/images/{id}` (see
[tile-delivery-boundary.md](tile-delivery-boundary.md)), so the viewer's tile
token renewal keeps working from collection responses.

_Planned_ (#1412, #1413): `POST /api/collections`, `PATCH`/`DELETE
/api/collections/{id}`, image add/remove/reorder, `viewport` persistence with
version-based optimistic concurrency, and `POST /api/collections/{id}/transfer`.

## Frontend behaviour

_Planned_ (#1414–#1419): Collections tab, `?collection={id}` deep links,
"Add to Collection" from the image view, sequence and synchronized viewers
(read-only annotations), search integration and ownership management.

## Tests

- `backend/tests/test_collections_model.py` — table/constraint/cascade contract.
- `backend/tests/test_authz.py` — collection predicate matrix.
- `backend/tests/test_router_collections.py` — list/detail per role, dual-gate
  cases, image omission, 404-not-403, admin-only `orphaned` filter.
