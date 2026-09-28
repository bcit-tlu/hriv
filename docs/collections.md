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

| Table                 | Purpose                                                                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collections`         | `name`, `description`, `type` (`synchronized` / `sequence`, CHECK), `visibility` (`private` / `public` / `restricted`, CHECK, default `private`), `user_id`, `owner_program_id`, `viewport_state` (JSONB, default `{}`), `version` |
| `collection_images`   | Ordered membership: PK `(collection_id, image_id)`, `sort_order`; index `idx_collection_images_order (collection_id, sort_order)`                                                                                                  |
| `collection_programs` | Program scope for `visibility = restricted`                                                                                                                                                                                        |
| `collection_groups`   | Group scope for `visibility = restricted`                                                                                                                                                                                          |

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

| Caller                     | private   | public | restricted                                       |
| -------------------------- | --------- | ------ | ------------------------------------------------ |
| admin / instructor / staff | yes (all) | yes    | yes                                              |
| student — owner            | yes       | yes    | yes                                              |
| student — other            | no        | yes    | only if the **program gate AND group gate** pass |

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

| Method | Endpoint                         | Min role                                                               | Notes                                                                                                                                                                                                                                                                                                                                 |
| ------ | -------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/collections`               | student                                                                | Visible collections as `CollectionSummaryOut[]`. Query: `type`, `mine`, `owner_user_id`, `owner_program_id`, `orphaned` (**admin only**, others **403**). Ordered by `updated_at` desc.                                                                                                                                               |
| GET    | `/api/collections/{id}`          | student                                                                | `CollectionOut` (summary + ordered `images: ImageOut[]`, `program_ids`, `group_ids`, `viewport_state`). **404** when missing _or_ not visible (no existence leak).                                                                                                                                                                    |
| POST   | `/api/collections`               | student                                                                | Create; owner = caller (`user_id`). Body `CollectionCreate`: `name`, `description?`, `type`, `visibility` (default `private`), ordered `image_ids`, `program_ids` / `group_ids` (restricted only). **201** `CollectionOut`.                                                                                                           |
| PATCH  | `/api/collections/{id}`          | student (must pass `can_edit_collection`)                              | Body `CollectionUpdate`: any of `name`, `description`, `visibility`, `program_ids`, `group_ids` + required `version`. `type` is immutable (**422** if changed). Returns fresh `CollectionOut`.                                                                                                                                        |
| DELETE | `/api/collections/{id}`          | student (must pass `can_delete_collection`)                            | **204**.                                                                                                                                                                                                                                                                                                                              |
| PUT    | `/api/collections/{id}/images`   | student (must pass `can_edit_collection`)                              | Replace the whole ordered image list (add / remove / reorder in one call). Body `CollectionImagesUpdate`: `image_ids`, `version`. `sort_order` is rewritten to `0..n-1`. Returns fresh `CollectionOut`.                                                                                                                               |
| PUT    | `/api/collections/{id}/viewport` | student (must pass `can_edit_collection`)                              | Replace `viewport_state` wholesale. Body `CollectionViewportUpdate`: `viewport_state` (JSON object), `version`. Returns fresh `CollectionOut`.                                                                                                                                                                                        |
| POST   | `/api/collections/{id}/transfer` | instructor (must pass `can_transfer_collection`; to a user: **admin**) | Reassign ownership. Body `CollectionTransfer`: exactly one of `user_id` / `program_id` (**422** otherwise) + required `version`. **404** if not visible, **403** if not transferable, **422** unknown / deactivated target, **409** stale version. Returns fresh `CollectionOut` with the new `owner` and re-evaluated `permissions`. |

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

### Ownership transfer (#1413)

`POST /api/collections/{id}/transfer` moves a collection to a new owner. The
body names **exactly one** destination (`user_id` _or_ `program_id`; both or
neither is **422**) plus the `version` token, and follows the same
optimistic-concurrency rule as PATCH (**409** with the current `CollectionOut`
on a stale `version`; success increments it).

Authority is checked in this order, and every rule is enforced server-side:

1. The caller must be able to **view** the collection, else **404** (no
   existence leak — same as every other write).
2. The caller must pass `can_transfer_collection`, else **403**: admins for
   any collection; instructors only for a collection they own (`user_id` =
   self) or one owned by a program they belong to. Staff and students can
   never transfer, not even their own collections. Orphaned collections fail
   both instructor branches, so only admins can reassign them.
3. The destination is resolved:
   - `user_id` — **admins only** (instructors get **403** even for their own
     collection). The user must exist (**422**) and be active; a deactivated
     user cannot become an owner (**422**). Any role may be assigned as owner;
     the new owner's own authority then follows the normal predicates (a
     student owner can edit and delete but still cannot transfer).
   - `program_id` — the program must exist (**422**) and pass
     `can_attach_program_to_collection` (**403**): admins may pick any
     program, instructors only a program they belong to.
4. Exactly one of `user_id` / `owner_program_id` is set and the other cleared,
   `version` advances, and the fresh `CollectionOut` is returned with the new
   `owner` and `permissions` re-evaluated for the caller — an instructor who
   moves their own collection onto a program they teach keeps `can_edit`;
   an admin always keeps everything.

A transfer only changes the owner columns; `visibility`, scope rows
(`collection_programs` / `collection_groups`), images and `viewport_state`
are untouched. Moving a collection onto a program does **not** add that
program to its restricted scope, and moving it off a program does not remove
it.

### Ownership & lifecycle

What happens to collections when the rows they reference go away (all enforced
by FK actions in migration `0030_collections`, not by router code):

- **User deleted** — every collection they own is deleted
  (`collections.user_id` `ON DELETE CASCADE`), along with its
  `collection_images` and scope rows. Transfer a collection first if it should
  survive its owner.
- **User deactivated** — nothing changes: the collections stay, keep their
  owner and visibility, and remain manageable by admins / instructors of the
  owning program. A deactivated user cannot sign in, and cannot be named as
  the destination of a transfer (**422**) until reactivated.
- **Image deleted** — its `collection_images` links are dropped (`CASCADE`);
  the collection stays, `image_count` shrinks and `sort_order` gaps are
  harmless (the next `PUT …/images` rewrites them).
- **Program deleted** — `DELETE /api/programs/{id}` never inspects
  collections. Collections **owned** by the program survive with
  `owner_program_id = NULL`: they become **orphaned** (both owner columns
  `NULL`, `owner: null`, admin-only until reassigned via transfer). The
  program's `collection_programs` rows are removed (`CASCADE`).
  **Scope caveat:** a `restricted` collection whose only program scope was the
  deleted program becomes _unrestricted on the program dimension_ (the group
  gate still applies), so it may become visible to more students than before.
  After deleting a program, review `GET /api/collections?orphaned=true` and
  any restricted collection that referenced it.
- **Group deleted** — its `collection_groups` rows are removed (`CASCADE`);
  the same scope caveat applies on the group dimension. Unlike categories,
  collections never block group deletion.

Admins find and repair orphans with the list filters that already exist on
`GET /api/collections` (`orphaned=true`, `owner_user_id`, `owner_program_id`)
followed by `POST …/transfer`.

## Frontend behaviour

### Collections tab, CRUD and deep links (#1414)

**Where.** `frontend/src/api.ts` (`ApiCollection*` wire shapes,
`fetchCollections` / `fetchCollection` / `createCollection` /
`updateCollection` / `deleteCollection` / `replaceCollectionImages` /
`saveCollectionViewport`, `collectionConflictCurrent`), `types.ts`
(`Collection`, `CollectionSummary`, `CollectionType`, `CollectionVisibility`,
`CollectionOwner`, `CollectionPermissions`), `collectionUtils.ts` (mapping,
labels, `canUseRestrictedVisibility`, `parseCollectionIdParam`),
`useCollectionsData.ts` (list/detail state + mutations),
`components/CollectionsPage.tsx`, `CollectionCard.tsx`,
`CollectionEditDialog.tsx`, plus `navigation.ts`, `AppShell.tsx`,
`useShareableImageState.ts`, `useNavigationHistory.ts` and `App.tsx`.

**Navigation.** A **Collections** tab is shown to every authenticated role
(students included) in both the desktop app bar and the compact/mobile
drawer. `?page=collections` opens the list. `App` only mounts
`useCollectionsData` while the tab is active, so browsing images never hits
`/api/collections`.

**List.** `GET /api/collections` rendered as a responsive card grid
(1 → 2 → 3 → 4 columns at `xs/sm/md/lg`). Each `CollectionCard` shows the
cover (`RenewingThumbnail` with a collection-scoped renewer that refreshes the
token via `GET /api/collections/{id}`; a renewed cover that loads and later
expires again is renewed once more, while a cover that never loads is renewed
only once), name, image count, owner, a type chip
and a visibility chip that reuses the category restriction palette. Filters:
type toggle (All / Synchronized / Sequence), **My collections** (`mine=true`;
clears and disables the owner facet), and — for admin, instructor and staff
only — an **Owner** select built from the owners in the loaded list
(`owner_user_id` / `owner_program_id`). Students never see the Owner select
and `toCollectionApiFilters` never emits `owner_*` for them. Admins
additionally get _No owner (orphaned)_ → `orphaned=true`;
`toCollectionApiFilters` never emits `orphaned` for other roles. Both rules
come from one helper, `normalizeCollectionFilters(filters, role)`, which the
hook applies to its filter state before it reaches the API params, the
client-side mirror (`matchesCollectionFilters`) and the filter bar — so an
owner selection that outlives a user switch (e.g. admin → student on the
same tab) is dropped rather than silently hiding the new user's own saves.
Loading spinner, a plain error `Alert`
(notification only — no Retry action), and filter-aware empty copy follow the
existing page patterns; the unfiltered empty state's "Create a collection" is
a link that opens the same create dialog as the **New collection** button.

**Create / edit (`CollectionEditDialog`).** Name (required), description,
type (radio on create; read-only chip on edit — the API rejects type changes
with 422), visibility. `restricted` is only offered to admins and instructors
(`canUseRestrictedVisibility`); students/staff see Private / Public. When
restricted, program and group chip pickers reuse the Add/EditCategoryDialog
attach logic: instructors can only select programs they belong to
(`getAttachableProgramIds`) and groups they manage; already-attached scope
stays enabled so it can be removed. At least one program or group is required
for `restricted`; `program_ids` / `group_ids` are sent as `[]` for any other
visibility. Create posts `image_ids: []` (adding images arrives with #1415).
Edit sends the collection `version` in the PATCH body; a **409** shows the
standard "modified by another user" message with a **Reload** action that
re-seeds the form from the authoritative `CollectionOut` in `detail`.

**Delete.** Confirmation dialog (existing delete-dialog pattern) →
`DELETE /api/collections/{id}`; failures stay in the dialog with the API
message. Deleting the open collection returns to the list.

**Permissions are UX gates only.** Edit/delete controls render when
`permissions.can_edit` / `can_delete` from the API are true; the backend
re-checks authority on every call.

**Detail placeholder.** Selecting a card sets `?collection={id}` and renders
the collection header (type/visibility chips, description, owner), an info
alert that the viewer is coming (#1416 sequence / #1417 synchronized), and
the ordered member list with an **Open image** link per row that navigates to
`?image={id}`. Both types share this placeholder for now. A 404 (missing or
not visible) renders the not-found alert with an _All collections_ action.

**Deep links & history.** `useShareableImageState` parses `?collection={id}`
ahead of `?image=` / `?category=`; a collection link wins if both are present.
The list emits `?page=collections`, a selected collection emits
`?collection={id}` (no `page` param). Both push history entries through
`useNavigationHistory`, and `popstate` restores the selected collection from
the URL, so back/forward moves between browse, image and collection views.
Refreshing a `?collection=` URL re-opens that collection. `?item={image_id}`
is reserved for the sequence viewer (#1416) and is not parsed yet.

_Planned_ (#1415–#1419): "Add to Collection" from the image view, sequence
and synchronized viewers (read-only annotations), search integration and
ownership management / transfer UI.

## Tests

- `backend/tests/test_collections_model.py` — table/constraint/cascade contract.
- `backend/tests/test_authz.py` — collection predicate matrix.
- `backend/tests/test_router_collections.py` — list/detail per role, dual-gate
  cases, image omission, 404-not-403, admin-only `orphaned` filter; write API:
  create per role, restricted attach authority (admin any / instructor own
  programs + managed groups / staff + student 403), edit/delete matrix
  (owner, instructor-of-owning-program, orphaned = admin only), image replace
  validations (missing id, duplicates, synchronized cap, student-invisible,
  `sort_order` rewrite), viewport whole-replace, 409 + version increment;
  transfer matrix (admin → user / program, instructor own → own program OK /
  other program 403 / user 403, instructor in owning program → own program,
  staff + student 403, non-viewer 404, unknown / deactivated target 422,
  stale version 409, version increment) and orphan handling (admin reassign
  via transfer, instructor edit / delete / transfer 403, public orphan still
  visible to students, cascaded scope rows).
- `backend/tests/test_router_programs.py` — the real `DELETE /api/programs/{id}`
  against PostgreSQL (`REORDER_FIXTURE_DATABASE_URL`, run in CI): 204,
  owned collections survive as orphans, `collection_programs` rows gone.
- `backend/tests/test_schemas.py` — `CollectionCreate` / `CollectionUpdate` /
  `CollectionImagesUpdate` / `CollectionViewportUpdate` / `CollectionTransfer`
  validators.
- `frontend/tests/api.test.ts` — collection wrapper paths, query filters,
  request bodies, 409 `collectionConflictCurrent` extraction.
- `frontend/tests/collectionUtils.test.ts` — wire → domain mapping, role
  gating for `restricted`, `?collection=` parsing.
- `frontend/tests/navigation.test.ts`, `components/AppShell.test.tsx` —
  Collections tab for every role (desktop + compact drawer).
- `frontend/tests/useShareableImageState.test.ts`,
  `useNavigationHistory.test.ts`, `App.test.tsx` — `?collection={id}`
  parse/emit precedence, history entries, deep-link restore on load and
  back/forward.
- `frontend/tests/components/CollectionsPage.test.tsx`,
  `CollectionCard.test.tsx`, `CollectionEditDialog.test.tsx` — list/filter
  states, permission-gated actions, create/edit/delete flows, restricted
  picker gating per role, 409 reload.
