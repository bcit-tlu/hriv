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
| POST   | `/api/collections`      | student  | Create; owner = caller (`user_id`). Body `CollectionCreate`: `name`, `description?`, `type`, `visibility` (default `private`), ordered `image_ids`, `program_ids` / `group_ids` (restricted only). **201** `CollectionOut`. |
| PATCH  | `/api/collections/{id}` | student (must pass `can_edit_collection`) | Body `CollectionUpdate`: any of `name`, `description`, `visibility`, `program_ids`, `group_ids` + required `version`. `type` is immutable (**422** if changed). Returns fresh `CollectionOut`. |
| DELETE | `/api/collections/{id}` | student (must pass `can_delete_collection`) | **204**. |
| PUT    | `/api/collections/{id}/images`   | student (must pass `can_edit_collection`) | Replace the whole ordered image list (add / remove / reorder in one call). Body `CollectionImagesUpdate`: `image_ids`, `version`. `sort_order` is rewritten to `0..n-1`. Returns fresh `CollectionOut`. |
| PUT    | `/api/collections/{id}/viewport` | student (must pass `can_edit_collection`) | Replace `viewport_state` wholesale. Body `CollectionViewportUpdate`: `viewport_state` (JSON object), `version`. Returns fresh `CollectionOut`. |

`CollectionSummaryOut`: `id`, `name`, `description`, `type`, `visibility`,
`owner` (`{user_id, name}` | `{program_id, name}` | `null` when orphaned),
`image_count` (visible-to-caller), `cover_thumb` (first visible image thumb),
`version`, `created_at`, `updated_at`, `permissions {can_edit, can_delete,
can_transfer}`.

Image URLs (`cover_thumb`, `images[].thumb`, `images[].tile_sources`) are
tokenized at serialization time exactly like `GET /api/images/{id}` (see
[tile-delivery-boundary.md](tile-delivery-boundary.md)), so the viewer's tile
token renewal keeps working from collection responses.

### Write semantics (#1412)

Every mutation re-checks authority server-side; the `permissions` block in
responses is a UX hint only.

**404 vs 403.** A caller who cannot _view_ the collection (per
`can_view_collection`) gets **404** — never 403 — so private ids cannot be
probed. A caller who can view it but fails `can_edit_collection` (PATCH,
images, viewport) or `can_delete_collection` (DELETE) gets **403**.

**Creating.** Any authenticated role may `POST`; the caller becomes the owner
(`user_id`; program ownership is only reachable via transfer, #1413).

**Restricted visibility & scope.**

- `visibility=restricted` requires an admin or instructor (**403** for staff /
  students, on create and when a PATCH sets it or touches scope).
- Every _newly attached_ id must pass `can_attach_program_to_collection` /
  `can_attach_group_to_collection` (**403**); unknown ids are **422**.
  Programs/groups already attached are kept without re-checking, so any editor
  may narrow or drop scope.
- Non-restricted collections carry no scope: `program_ids` / `group_ids` on a
  `private` / `public` create or PATCH is **422**, and a PATCH that leaves
  `restricted` clears both scope tables.

**Image list (`PUT …/images`, and `image_ids` on create).**

- Every id must exist (**422**, detail lists the offenders).
- No duplicates (**422**, rejected by the schema and again by the router).
- `synchronized` collections hold at most `SYNCHRONIZED_COLLECTION_MAX_IMAGES`
  (4) images (**422**); `sequence` has no cap.
- Students may only reference images they can open: `active` **and** category
  passing the program AND group dual gate (`get_student_excluded_category_ids`
  with both `{p.id for p in user.programs}` and `{g.id for g in user.groups}`).
  Invisible ids are **422** for students; non-students may add any existing
  image, including inactive ones.
- Membership is replaced as a whole and `sort_order` rewritten to `0..n-1` in
  request order; retained images keep their `collection_images` row.

**Viewport (`PUT …/viewport`).** `viewport_state` is overwritten with the
submitted object — never a partial JSONB merge. Any JSON object is accepted
until the synchronized viewer fixes the shape (#1417).

**Optimistic concurrency.** PATCH, images and viewport bodies carry the
`version` the client last read. The server advances it atomically
(`UPDATE collections SET version = v+1 WHERE id = :id AND version = :v`); if
no row matches, the response is **409** whose `detail` is the _current_
`CollectionOut` (same shape as a fresh GET) so the client can rebase and
retry. Every successful mutation increments `version` and returns the fresh
`CollectionOut`. Unlike images/categories, the token is in the body rather
than an `If-Match` header and is required, not optional.

_Planned_ (#1413): `POST /api/collections/{id}/transfer` and admin flows for
program-orphaned collections.

## Frontend behaviour

_Planned_ (#1414–#1419): Collections tab, `?collection={id}` deep links,
"Add to Collection" from the image view, sequence and synchronized viewers
(read-only annotations), search integration and ownership management.

## Tests

- `backend/tests/test_collections_model.py` — table/constraint/cascade contract.
- `backend/tests/test_authz.py` — collection predicate matrix.
- `backend/tests/test_router_collections.py` — list/detail per role, dual-gate
  cases, image omission, 404-not-403, admin-only `orphaned` filter; write API:
  create per role, restricted attach authority (admin any / instructor own
  programs + managed groups / staff + student 403), edit/delete matrix
  (owner, instructor-of-owning-program, orphaned = admin only), image replace
  validations (missing id, duplicates, synchronized cap, student-invisible,
  `sort_order` rewrite), viewport whole-replace, 409 + version increment.
- `backend/tests/test_schemas.py` — `CollectionCreate` / `CollectionUpdate` /
  `CollectionImagesUpdate` / `CollectionViewportUpdate` validators.
