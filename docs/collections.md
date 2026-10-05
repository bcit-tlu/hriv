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

## Feature flag (`COLLECTIONS_ENABLED`)

Collections are **dark-launched** so the rest of the app can keep releasing
(patch/minor bumps via release-please, `stable` re-pins) while the epic lands
one child issue at a time on `main`.

- **Backend.** `Settings.collections_enabled` (`backend/app/database.py`,
  env `COLLECTIONS_ENABLED`, default `false`). The collections router carries
  a router-wide dependency (`require_collections_enabled` in
  `routers/collections.py`) that raises the same `404 Not Found` as an
  unknown route for **every** `/api/collections*` endpoint while the flag is
  off — the API surface is indistinguishable from a build without
  collections. The check runs per request, so tests and operators can flip
  it without rebuilding the app. `CollectionsFeatureMiddleware`
  (`middleware.py`, registered in `main.py`) applies the same 404 to every
  `/api/collections*` path _before_ FastAPI parses the body, so a malformed
  write on a disabled deployment is also a 404 rather than a 422 — the two
  layers keep the surface identical to an unknown route. Admin DB export/import still includes the
  `collections` tables regardless of the flag (they exist in the schema
  either way).
- **`GET /api/features`** (`main.py`, unauthenticated, `FeaturesOut`) returns
  `{"collections": <bool>}`. It is a UX hint only — flags are not secrets and
  each one is enforced independently by the backend.
- **Frontend.** `useFeatures()` fetches `/api/features` once per mount
  (`fetchFeatures` in `api.ts`; `Features` / `DEFAULT_FEATURES` in
  `types.ts`). Until the response arrives nothing collections-related
  renders; a failed request resolves to _everything off_. When `collections`
  is `false`, `getNavigationItems` drops the Collections item
  (`requiresCollections`), `AppShell` omits the desktop tab and drawer entry,
  `useCollectionsData` never fetches, and `App.tsx` falls back from
  `?collection={id}` / `?page=collections` to browse (`effectivePage` reports
  `browse` to telemetry). When `true`, behaviour is exactly as described in
  the sections below.
- **Deployment.** Helm value `collections.enabled` (default `false`) renders
  `COLLECTIONS_ENABLED` on the backend API pod (`charts/backend`). The
  `flux-fleet` `latest` overlay
  (`apps/overlays/latest/hriv/backend/values-latest.yaml`) sets it `true`;
  `stable` inherits the chart default until the epic is promoted. Because
  chart edits only reach an environment on the next chart release
  ([RELEASE_AND_DEPLOY_FLOW.md](RELEASE_AND_DEPLOY_FLOW.md)), `latest`
  shows no collections between this flag landing and the next backend
  release. `docker-compose.yml` sets `COLLECTIONS_ENABLED=true` for local
  development.
- **Removal.** The flag, `/api/features`' `collections` key and the frontend
  gating are deleted in the epic's closing issue
  ([#1419](https://github.com/bcit-tlu/hriv/issues/1419)).

## Data model

Migration `0030_collections` (`backend/app/models.py`: `Collection`,
`CollectionImage`, `collection_programs`, `collection_groups`); migration
`0031_collection_categories` adds `collections.category_id` +
`collections.sort_order` so collections file into the Browse hierarchy.

| Table                 | Purpose                                                                                                                                                                                                                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collections`         | `name`, `description`, `type` (`synchronized` / `sequence`, CHECK), `visibility` (`private` / `public` / `restricted`, CHECK, default `private`), `user_id`, `owner_program_id`, `category_id` (nullable FK → `categories`, `SET NULL` on delete; #1527), `sort_order` (tile-order position), `viewport_state` (JSONB, default `{}`), `version` |
| `collection_images`   | Ordered membership: PK `(collection_id, image_id)`, `sort_order`; index `idx_collection_images_order (collection_id, sort_order)`                                                                                                                                                                                                               |
| `collection_programs` | Program scope for `visibility = restricted`                                                                                                                                                                                                                                                                                                     |
| `collection_groups`   | Group scope for `visibility = restricted`                                                                                                                                                                                                                                                                                                       |

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
- Deleting a **category** does _not_ delete its collections:
  `category_id` becomes `NULL` (`SET NULL`) and the collection resurfaces at
  the Browse root — the same reparenting rule as images.

### Browse placement (#1527)

`category_id` files a collection into the category tree like an image:
`NULL` = uncategorized (shown at the Browse root via `?uncategorized`),
otherwise the collection tile appears inside that category's node in
`GET /api/categories/tree` (`CategoryTree.collections`). `sort_order` is the
tile-order position inside that scope (category or root), shared with
categories and images.

Moving is curatorial, not ownership-bound: `POST /api/collections/{id}/move`
is admin/instructor-only (like moving images and categories) and is
deliberately separate from the owner-gated PATCH. The move bumps the
tile-order scope revisions of both the source and destination scopes and
the global browse revision, so in-flight reorder clients get a 409 and the
tree ETag invalidates. `visibility` still gates _who sees_ the tile;
placement only gates _where_ it sits.

Collections are included in the admin database export/import round-trip
(`collections` key with ordered `image_ids`, `program_ids`, `group_ids`); see
[admin-import-export.md](admin-import-export.md).

`viewport_state` is written as a whole-column replacement (never a partial
JSONB merge). The synchronized viewer (#1417) stores it as
`{ "<image_id>": { "zoom": number, "x": number, "y": number,
"rotation": number } }` — each member pane's absolute viewport position; the
relative offset between panes is implicit in the pair. Keys the stored JSONB
does not recognise are ignored by the frontend validator.

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

A filed collection is additionally gated by its **category's** ancestor
visibility: a student sees the collection only when the collection gate AND
the category gate both pass (a hidden/restricted category hides everything
inside it, mirroring images). This applies identically to `GET
/api/collections`, `GET /api/collections/{id}` and the category tree embed.

### Images inside a collection

Students receive only images they could open via `GET /api/images/{id}` —
`image.active` **and** the image's category (with ancestors) passes the dual
gate. Invisible images are **omitted** from `images`, `image_count` and
`cover_thumb`; the collection itself is still returned. Non-students see every
referenced image, including inactive ones. Omitted members survive a student's
`PUT …/images` (see **Image list** below), so a hidden image is never removed
by someone who cannot see it.

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
(see [unauthenticated-routes.md](unauthenticated-routes.md)). Every endpoint
below answers `404` while `COLLECTIONS_ENABLED` is off (see
[Feature flag](#feature-flag-collections_enabled)).

| Method | Endpoint                         | Min role                                                               | Notes                                                                                                                                                                                                                                                                                                                                 |
| ------ | -------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/collections`               | student                                                                | Visible collections as `CollectionSummaryOut[]`. Query: `type`, `mine`, `owner_user_id`, `owner_program_id`, `orphaned` (**admin only**, others **403**), `uncategorized` (only collections filed at the Browse root, `category_id IS NULL`). Ordered by `updated_at` desc.                                                           |
| GET    | `/api/collections/{id}`          | student                                                                | `CollectionOut` (summary + ordered `images: ImageOut[]`, `program_ids`, `group_ids`, `viewport_state`). **404** when missing _or_ not visible (no existence leak).                                                                                                                                                                    |
| POST   | `/api/collections`               | student                                                                | Create; owner = caller (`user_id`). Body `CollectionCreate`: `name`, `description?`, `type`, `visibility` (default `private`), ordered `image_ids`, `program_ids` / `group_ids` (restricted only). **201** `CollectionOut`.                                                                                                           |
| PATCH  | `/api/collections/{id}`          | student (must pass `can_edit_collection`)                              | Body `CollectionUpdate`: any of `name`, `description`, `visibility`, `program_ids`, `group_ids` + required `version`. `type` is immutable (**422** if changed). Returns fresh `CollectionOut`.                                                                                                                                        |
| DELETE | `/api/collections/{id}`          | student (must pass `can_delete_collection`)                            | **204**.                                                                                                                                                                                                                                                                                                                              |
| PUT    | `/api/collections/{id}/images`   | student (must pass `can_edit_collection`)                              | Replace the whole ordered image list (add / remove / reorder in one call). Body `CollectionImagesUpdate`: `image_ids`, `version`. `sort_order` is rewritten to `0..n-1`. Returns fresh `CollectionOut`.                                                                                                                               |
| PUT    | `/api/collections/{id}/viewport` | student (must pass `can_edit_collection`)                              | Replace `viewport_state` wholesale. Body `CollectionViewportUpdate`: `viewport_state` (JSON object), `version`. Returns fresh `CollectionOut`.                                                                                                                                                                                        |
| POST   | `/api/collections/{id}/move`     | admin / instructor (any — filing is curatorial, not ownership-bound)   | File the collection into a category. Body `CollectionMove`: `category_id` (required, `null` = Browse root) + `version`. **404** missing collection, **422** unknown category, **409** stale version. Keeps `sort_order`; bumps source+destination scope revisions and the browse revision. Returns fresh `CollectionOut`.             |
| POST   | `/api/collections/{id}/transfer` | instructor (must pass `can_transfer_collection`; to a user: **admin**) | Reassign ownership. Body `CollectionTransfer`: exactly one of `user_id` / `program_id` (**422** otherwise) + required `version`. **404** if not visible, **403** if not transferable, **422** unknown / deactivated target, **409** stale version. Returns fresh `CollectionOut` with the new `owner` and re-evaluated `permissions`. |

`CollectionSummaryOut`: `id`, `name`, `description`, `type`, `visibility`,
`owner` (`{user_id, name}` | `{program_id, name}` | `null` when orphaned),
`image_count` (visible-to-caller), `cover_thumb` (first visible image thumb),
`version`, `category_id`, `sort_order`, `created_at`, `updated_at`,
`permissions {can_edit, can_delete, can_transfer}`.

`CollectionOut` adds `member_count` (#1529). For non-students it is the
nominal member total; for students it is clamped to `len(images) + 1` when
members are hidden, so it signals _that_ restricted members exist — the
"all images restricted" message intentionally reveals that much — without
disclosing how many. It is detail-only so list rows and Browse tiles cannot
leak hidden membership; viewers use it to tell an all-restricted collection
(`member_count > 0`, no visible `images`) apart from a truly empty one
(`member_count === 0`).

Each `CategoryTree` node additionally carries `collections:
CollectionSummaryOut[]` — the collections filed into that category, subject
to the same visibility filtering as `GET /api/collections` (collection gate
AND category ancestor gate). When `COLLECTIONS_ENABLED` is off the field is
always empty and the collections query is skipped entirely, so flag-off
deployments neither leak collection data nor grow the tree query count.

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
- Members the caller **cannot view** (omitted from `GET`, and **422** if named)
  are never dropped by a `PUT`: they are carried over after the submitted list
  in their existing relative order, and still count toward the `synchronized`
  cap (the 422 detail then says how many hidden members are retained). Since
  non-students see every image, this only affects students.

**Viewport (`PUT …/viewport`).** `viewport_state` is overwritten with the
submitted object — never a partial JSONB merge. The synchronized viewer
(#1417) writes `{ "<image_id>": {zoom, x, y, rotation} }`; the backend keeps
the column opaque, so foreign keys survive a round-trip but are ignored by
the viewer's own validator.

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
Everything in this section is conditional on the deployment flag
(`useFeatures.ts`; see [Feature flag](#feature-flag-collections_enabled)).

**Navigation.** A **Collections** tab is shown to every authenticated role
(students included) in both the desktop app bar and the compact/mobile
drawer. `?page=collections` opens the list. `App` only mounts
`useCollectionsData` while the tab is active, so browsing images never hits
`/api/collections`.

**List.** `GET /api/collections` rendered as a fixed-width flex-wrap card
grid (300px tiles, `gap: 2` — the same parameters as the Browse tile grid, so
cards do not stretch with the viewport). Each `CollectionCard` shows the
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
Filter state is also keyed to the signed-in user's id: a different user on
the same tab starts from the default filters, so a previous admin's owner
selection cannot resurface for the next instructor. Saves that finish after
a filter change are placed and refreshed against the filters current at
completion, and a second **Edit** click (or **New collection**) supersedes an
earlier Edit whose record fetch is still in flight. When the account changes,
the previous user's cards and owner options are cleared as the new user's
first load starts, so a failed load never leaves another account's rows on
screen. The `owner` wire object always carries both `user_id` and
`program_id` (the unused one `null`), so the mapper picks the non-null id
rather than testing key presence.
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
visibility. Create from the Collections tab posts `image_ids: []`; create from
the image view (#1415, below) posts the selected image id(s).
Edit sends the collection `version` in the PATCH body; a **409** shows the
standard "modified by another user" message with a **Reload** action that
re-seeds the form from the authoritative `CollectionOut` in `detail`.

**Delete.** Confirmation dialog (existing delete-dialog pattern) →
`DELETE /api/collections/{id}`; failures stay in the dialog with the API
message. Deleting the open collection returns to the list.

**Permissions are UX gates only.** Edit/delete controls render when
`permissions.can_edit` / `can_delete` from the API are true; the backend
re-checks authority on every call.

**Detail view.** Selecting a card sets `?collection={id}` and renders the
collection header (type/visibility chips, description, owner).
`sequence` collections mount the sequence viewer (#1416, below) and
`synchronized` collections mount the synchronized viewer (#1417, below). A
404 (missing or not visible) renders the not-found alert with an
_All collections_ action.

**Deep links & history.** `useShareableImageState` parses `?collection={id}`
ahead of `?image=` / `?category=`; a collection link wins if both are present.
The list emits `?page=collections`, a selected collection emits
`?collection={id}` (no `page` param), a selected sequence item adds
`&item={image_id}` (#1416), and a collection opened from a Browse tile adds
`?cat=` carrying its originating scope (#1529). Both push history entries
through `useNavigationHistory`, and `popstate` restores the selected
collection (and sequence item) from the URL, so back/forward moves between
browse, image and collection views. Refreshing a `?collection=` URL re-opens
that collection;
refreshing `?collection={id}&item={image_id}` re-opens the sequence on that
image (falling back to the first image when the id is not a visible member).
`?item=` without `?collection=` is ignored.

### Browse tile integration (#1529)

**Where.** `useBrowseData.ts` (nested `resolvePathNode` collections + root
`uncategorizedCollections` loader), `components/SortableTileGrid.tsx`
(`GridTile`/`DragOverlay` collection branches), `components/CollectionCard.tsx`
(`onMove`), `components/MoveCollectionDialog.tsx`,
`useCategoryActions.ts` (move/undo handlers), `useCollectionsData.ts` (`move`).

**Tiles.** When `COLLECTIONS_ENABLED` is on, collections render in the Browse
tile grid alongside categories and images — the same shared `CollectionCard`
the Collections tab uses (C1 parity), wrapped in the standard sortable tile so
dimensions, drag activation and reflow match image/category tiles. Nested
scopes read `CategoryTree.collections`; the root scope fetches
`GET /api/collections?uncategorized=true`. With the flag off nothing is
fetched or rendered and the scope's freshness counts as satisfied for
background-refresh bookkeeping.

**Ordering & moving.** Collection tiles carry `col-{id}` draggable ids and
participate in the mixed category/image/collection tile-order contract
(#1528). Dropping a collection onto a category tile's move zone files it into
that category (the same API as `POST /api/collections/{id}/move`) — like
images and categories. Filing is curatorial: any admin/instructor sees the
**Move** affordance on Browse tiles, list cards and the detail header,
independent of `permissions.canEdit`; students and staff get no move UI. The
move dialog (`MoveCollectionDialog`) offers every category plus "Top level",
preselects the current category, and no-ops on an unchanged destination. A
successful move refreshes the category tree and the root collection list,
invalidates both scopes' tile-order revisions, and offers an undo snackbar
that re-posts the previous category with the version from the move response.

**Browse context.** Opening a collection tile keeps the originating Browse
scope: the URL becomes `?collection={id}&cat={ancestor path}`, the detail
back button reads **Back to Browse**, and closing returns to that scope
instead of the Collections list. Back/forward restores both the collection
and the scope — `useNavigationHistory` carries a `collectionFromBrowse` flag
in history state for root-scope entries (where no `?cat=` is needed). Links
without `?cat=` behave exactly as before (`?collection={id}` opens the
Collections list context).

**Counts and empty states.** Category tiles include descendant collection
counts in their detail line (`· N collections`), and the Browse empty-state
guard treats a scope with only collections as non-empty. On the detail side,
`CollectionOut.member_count` (nominal for staff; clamped to "hidden members
exist" for students) lets viewers distinguish "no members yet" from "all
members restricted" — `image_count`/`imageCount` remains visible-only so
list rows and tiles never leak hidden membership.

**Drop-add (#1530).** Dragging an image tile onto an editable collection
tile's **near half** shows an "Add to collection" overlay and, on drop,
adds the image as a member via `useCollectionsData.addImages` →
`addImagesToCollection` (dedupe + synchronized-capacity enforced; the call
is serialized through the collection mutation queue so it never sends a
stale `version`). The `drop-col-<id>` zone renders only when the
collection's `permissions.canEdit` is set — unlike filing, which is
curatorial — and accepts `img-` drags only; category/collection drags fall
through to the far-half reorder contract unchanged. Membership editing is
ownership-gated rather than curatorial, so when the grid contains an
editable collection, a non-`canEditContent` viewer (e.g. a student who owns
it) gets drag-only image tiles — draggable toward `drop-col-*` zones but
never reorder targets; move/reorder/category filing stay `canEditContent`
gated. A successful add refreshes the scope (the tile's
`imageCount`/`coverThumb` come from the summary row) and offers an undo
snackbar that removes the member via `removeImagesFromCollection` (the same
whole-replace `PUT …/images`). Undo pins the version returned by the add:
any intervening write to the collection — membership, name, placement —
answers 409, which the snackbar reports as an undo failure rather than
silently rebasing over the other change. Already-member drops surface an info snackbar; a full
synchronized collection surfaces the 4-image limit error. See
`docs/drag-and-drop.md` for the collision contract.

### "Add to Collection" from the image view (#1415)

**Where.** `App.tsx` (button + snackbars), `components/AddToCollectionDialog.tsx`,
`useAddToCollection.ts` (`useEditableCollections`, `addImagesToCollection`,
`createCollectionWithImages`, `fitsCollectionCapacity`). Reuses the #1414
API wrappers — no new endpoints.

**Button.** An **Add to Collection** action sits after **Share View** in the
image viewer action bar for every authenticated role (students included) and
only while the deployment flag is on. It shares the viewer-action rules:
desaturated when the image is inactive or hidden by category, disabled with
the "Exit canvas edit mode first" tooltip while canvas edit mode is active.

**Dialog.** Opening it loads `GET /api/collections` (unfiltered) and keeps
rows with `permissions.can_edit`, grouped as _My collections_ (owner is the
signed-in user), _Program collections_ (program-owned) and _Other
collections_ (anything else an admin may edit, e.g. orphaned). A client-side
name filter narrows the list. Rows show name, image count and a type chip.
The dialog takes `imageIds: number[]` so the multi-select flow (#1418) can
reuse it; the viewer passes the selected image.

**Capacity.** A `synchronized` row is disabled with an explanatory tooltip
only when its `image_count` has already reached `SYNCHRONIZED_MAX_IMAGES`
(4); sequence rows are never capped. Borderline rows stay clickable
because the summary count cannot see which `imageIds` are already members
— the rule is re-checked against the fresh member list before the write
and a genuinely overflowing add returns `full` (count-neutral error
snackbar; the dialog stays open).

**Add.** `addImagesToCollection` fetches `GET /api/collections/{id}` for the
current member list and `version`, drops ids already present, and issues the
whole-replace `PUT /api/collections/{id}/images` with `[...existing,
...missing]` so nobody else's members are lost. Outcomes:

| Result                               | Feedback                                                                     | Dialog |
| ------------------------------------ | ---------------------------------------------------------------------------- | ------ |
| Added                                | success snackbar `Added to "<name>".` with a **View collection** action      | closes |
| Every image already present (no-op)  | info snackbar `This image is already in "<name>".`; no PUT is sent           | closes |
| Synchronized collection already full | error snackbar; no PUT is sent                                               | stays  |
| API error (409 stale / 403 / 404 …)  | existing error snackbar via `userMessage` (409 → "modified by another user") | stays  |

**View collection** navigates with `handleOpenCollection` → `?collection={id}`
(same history entry as opening a card), so back returns to the image.

**New collection…** opens the shared `CollectionEditDialog` in create mode;
`createCollectionWithImages` posts the form with `image_ids` preset to the
selected image(s) and the success snackbar offers **View collection**. Form
errors stay inside the create dialog as on the Collections tab.

**Permissions are UX gates only.** `can_edit` filtering and the capacity
check are conveniences; the backend re-validates edit authority, image
visibility, duplicates and the synchronized cap on every write.

### Sequence collection viewer (#1416)

**Where.** `components/SequenceCollectionViewer.tsx`, mounted by
`CollectionsPage` for `type === 'sequence'` below the shared detail header.
`App`/`useShareableImageState` own the selected item (`?item={image_id}`)
and pass it down, so the position is shareable and participates in history.

**Read-only surface.** One `ImageViewer` at a time, `key={image.id}` so
switching items remounts it and no viewport state bleeds between images.
`canEditContent={false}` and no annotation mutation callbacks — canvas
annotations, locked overlays and measurement metadata from `metadataExtra`
render read-only via `canvasAnnotationsFromMetadata` /
`lockedOverlaysFromMetadata` / `measurementFromMetadata`
(`components/imageViewerUtils.ts`). **Open image** navigates to the normal
`?image={id}` view where annotations can be edited.

**Toolbar.** A MUI `ButtonGroup` above the viewer (outside the OSD control
bar): **Previous** / **Next**, an `n of N` live region, **Open image**, and —
editors only (`permissions.can_edit`) — a **Reorder** toggle.

**Navigation.** Buttons, strip thumbnails (`Go to {name}`) and ←/→ arrow
keys all change the current item. Arrows are handled on keydown-capture at
the sequence container so OpenSeadragon's own keyboard panning never sees
them; editable targets (inputs, textareas, selects, `[role="textbox"]`,
contenteditable) are skipped, and while reorder mode is on the keys belong
to dnd-kit's `KeyboardSensor` instead.

**Thumbnail strip.** `RenewingThumbnail` buttons under the viewer; the
current item is outlined (`aria-current`). `onTileSourceRenewed` and the
thumbnails' renewal callback flow through `onImageRenewed` →
`useCollectionsData.renewCollectionImage`, which swaps the refreshed
`ApiImage` into `detail` so short-lived tile/thumb tokens keep working.

**Fallback states.** Empty collection → "no visible images" info alert. If
the current image's tiles fail mid-session the viewer reports the error via
`onError`, marks the id failed (dimmed, disabled thumbnail), and skips to
the nearest still-available image (preferring the next one). When every
image has failed, an error alert replaces the viewer.

**Reorder.** The Reorder toggle swaps the strip for `useSortable`
thumbnails (`type: 'sequence-strip-item'`; pointer: 250 ms touch delay /
8 px mouse distance; a separate `DragDropProvider` — the locked
`SortableTileGrid` collision contract is untouched). On drag-end the new
order is computed with `move()`; a no-change drop or a cancel sends
nothing. `useCollectionsData.reorderImages` applies the order to `detail`
immediately, then sends the whole id list as
`PUT /api/collections/{id}/images` (`image_ids` + `version`); on error it
restores the prior order and surfaces the message via `onError`. Doing the
optimistic reorder in the hook keeps `App`'s `detail` the single source of
truth — the strip and any subsequent edits see the same member order.

### Synchronized collection viewer (#1417)

**Where.** `components/SynchronizedCollectionViewer.tsx`, mounted by
`CollectionsPage` for `type === 'synchronized'` below the shared detail
header.

**Panes.** The first two visible members render side by side, each a
read-only `ImageViewer` with the same prop set as the sequence viewer
(`canEditContent={false}`; stored annotations, locked overlays and
measurement metadata pass through from `metadataExtra`). A caption under
each pane shows the member name (plus an _inactive_ marker) and an
**Open image** action → `?image={id}`. More than two stored members produce
a "Showing 2 of _N_" note — three/four-pane layouts are future work. Fewer
than two visible (or surviving) members shows a fallback alert with the
ordered member list and per-row **Open image** links; members whose tiles
fail mid-session are skipped, so the pair slides forward.

**Linked navigation.** `ImageViewer` exposes the OSD instance through a new
`onViewerReady(viewer | null)` prop; the component attaches raw
`viewport-change` handlers and mirrors zoom, center and rotation onto the
other pane with `immediately=true` so the follower tracks during the
leader's spring animation. A `syncingRef` guard makes every programmatic
write a follower write — mirrored events never lead the sync, and viewer
changes before both `open` events complete are ignored.

**Offset.** The pair keeps a _relative offset_ — B's viewport relative to
A's, captured once both panes have opened — as a multiplicative zoom ratio,
an additive centre delta and an additive rotation delta. Saved positions
around different highlights therefore stay aligned while navigation mirrors.
Toggling the **Link views** switch off lets either side move independently;
switching it back on re-captures the current alignment (it does not snap).

**Persisted view.** **Save view** (editors only,
`permissions.can_edit`) writes both panes' current viewports as
`{ "<image_id>": {zoom, x, y, rotation} }` through
`useCollectionsData.saveViewport` → `PUT …/viewport` (whole-replace +
`version`), so the pair restores exactly after a reload or via a
`?collection={id}` share link. `saveViewport` is serialized with
`reorderImages` through the same mutation queue so the two writes can never
consume each other's version. **Reset view** (everyone) re-applies the saved
positions — or each viewer's home when nothing is saved — then re-arms the
offset. Saved entries that do not match the shape are ignored by
`viewportStateFromSaved` (`imageViewerUtils.ts`).

**Orientation.** `(orientation: portrait)` covers the pane area with a
"rotate your device" hint while the viewers stay mounted underneath, so
rotating back restores the exact view instead of re-opening the images.

### Search integration and multi-select (#1418)

**Where.** `components/SearchModal.tsx`, `useAddToCollection.ts`
(`useVisibleCollections`), `App.tsx`. No new endpoints — the modal indexes
the existing `GET /api/collections` list.

**Collections as results.** `collection` is a sixth `ResultKind` with its
own type chip and `CollectionsIcon`. Matches search `name` (primary) and
`description`; the **Collections** chip scopes to both fields, matching the
primary-field semantics of the other type chips. A row shows name, the
`Collection` kind chip, type (`Synchronized`/`Sequence`), image count, and
owner via `describeCollectionOwner`; selecting it calls
`onSelectCollection` → `handleOpenCollection` → `?collection={id}`.
Collections are **not** part of `suppressExtendedResults` — they appear for
every role because the list endpoint is already access-filtered
server-side, so a student never sees a restricted-failing collection.

**Data.** `App` calls `useVisibleCollections(collectionsEnabled &&
searchOpen)` — a lazy list fetch each time the modal opens, shared with
`useEditableCollections` (which now derives from it and filters
`permissions.canEdit`). When the feature flag is off the list stays empty
and no Collections chip appears.

**Multi-select (image results only).** A **Select** toggle next to the
result count appears when image results exist (or select mode is already
on) and `onAddImagesToCollection` is provided. Image rows become labelled
checkboxes (`Select {image name}`) inside a `<label>` row — clicking
anywhere toggles — while every other kind keeps its `CardActionArea`
navigation and is never selectable (this avoids nested-interactive
controls, see #1345). Selections survive query and filter changes: each
check records the result generation and position where the image
appeared, so the footer count covers picks hidden by the current query
and the payload emits them in "order encountered" — result order within
one query, chronological batches across queries. A sticky footer shows
"N images selected" with **Clear** and **Add to collection**, which opens
`AddToCollectionDialog` with `imageIds`, reusing the #1415 dialog,
capacity checks, and snackbar feedback. Closing the modal, cancelling
select mode, or handing off resets the selection. When the collections
feature flag is off, the modal hides collection results, the Collections
chip, and the collections wording in the placeholder.

**Image ids.** `App` keeps `addToCollectionImageIds` as state: the viewer
button sets `[selectedImage.id]`, the search footer sets the checked ids;
the dialog renders whenever `collectionsEnabled && currentUser`, so
search-driven adds work with no image open.

### Ownership management UI (#1419)

The write API's `POST /api/collections/{id}/transfer` endpoint (#1413) is
surfaced on the Collections tab — there is no separate Admin section.

**Entry points.** A **Transfer** button appears on the detail header and a
transfer icon on each `CollectionCard`, both gated on
`permissions.can_transfer` (the API re-checks regardless). On an orphaned
collection — found via the admin-only _No owner (orphaned)_ owner facet —
the card action is the reassignment flow.

**`TransferCollectionDialog`.** Admins choose _A user_ or _A program_; the
user picker is an autocomplete over `auth.users` (loaded at login, refreshed
on open) with inactive accounts filtered out, and the program select lists
every program. Instructors go straight to a program select narrowed to their
own `program_ids` — the same boundary the backend 403s across. The confirm
stays disabled until a target different from the current owner is chosen.
Rejections surface inline via `userMessage`: 403 (outside your authority),
409 (stale `version` — "modified by another user"), 422 (invalid or
inactive target). The version is resolved by `useCollectionsData.transfer`,
which serializes with reorder/viewport saves through the shared mutation
queue and fetches the freshest record first when the collection is not the
open detail (e.g. card-level reassignment). A transferred row that no longer
matches the current filters — transferred away under **My collections**, or
assigned out of **No owner (orphaned)** — leaves the list.

**Detail header.** Shows the owner as "Managed by program _X_" for
program-owned collections (user owners show their name, orphans _No
owner_), the visibility chip, and — for `restricted` — a chip per attached
program and group using the shared group-chip palette.

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
- `backend/tests/test_router_collections_db.py` — write-API persistence
  against real PostgreSQL (`TEST_DATABASE_URL`, run in CI): `sort_order`
  rewrite + link reuse on reorder, join-table scope set/clear on
  restricted↔public transitions, cross-session OCC (409 with the current
  `CollectionOut`, version incremented once), wholesale `viewport_state`
  replacement, and delete-during-write → 404.
- `backend/tests/test_schemas.py` — `CollectionCreate` / `CollectionUpdate` /
  `CollectionImagesUpdate` / `CollectionViewportUpdate` / `CollectionTransfer`
  validators.
- `frontend/tests/api.test.ts` — collection wrapper paths, query filters,
  request bodies, 409 `collectionConflictCurrent` extraction.
- `frontend/tests/collectionUtils.test.ts` — wire → domain mapping, role
  gating for `restricted`, `?collection=` parsing.
- `frontend/tests/navigation.test.ts`, `components/AppShell.test.tsx` —
  Collections tab for every role (desktop + compact drawer), and hidden for
  every role when `collectionsEnabled` is false.
- Feature flag: `backend/tests/test_database.py` (`COLLECTIONS_ENABLED`
  default / env parsing), `test_router_collections.py` (router-wide
  `require_collections_enabled` dependency, 404 when off), `test_main.py`
  (`GET /api/features`); `frontend/tests/useFeatures.test.ts`,
  `api.test.ts` (`fetchFeatures`), `App.test.tsx` (shell flag prop, deep-link
  fallback to browse when off, failed `/api/features` treated as off).
- `frontend/tests/useShareableImageState.test.ts`,
  `useNavigationHistory.test.ts`, `App.test.tsx` — `?collection={id}` and
  `?collection={id}&item={image_id}` parse/emit precedence, history entries,
  deep-link restore on load and back/forward, `?item=` alone ignored.
- Browse tile integration (#1529): `useBrowseData.test.ts` (nested-scope
  collections from the tree, root `?uncategorized` fetch, flag-off no-fetch
  and freshness), `SortableTileGrid.test.tsx` (`col-` tiles, drag dispatch to
  reorder vs `onDropCollectionOnCategory`), `useCategoryActions.test.ts`
  (collection move/undo, no-op destination, root-scope lookup),
  `MoveCollectionDialog.test.tsx`, `CollectionsPage.test.tsx` (role-gated
  Move, `Back to Browse` label, all-restricted notice),
  `useCollectionsData.test.ts` (`move` row/detail sync),
  `CategoryTile.test.tsx` (recursive collection counts), viewer tests
  (all-restricted empty state); backend `test_router_collections.py`
  (`member_count` on `CollectionOut`, absent from summaries).
- `frontend/tests/components/SequenceCollectionViewer.test.tsx`,
  `useCollectionsData.test.ts` (#1416) — position readout, `?item=` restore
  and non-member fallback, button / thumbnail / arrow-key navigation,
  editable-target and reorder-mode key guards, read-only `ImageViewer` props
  (annotations / overlays / measurement from `metadataExtra`), tile-renewal
  forwarding, mid-session failure skip + all-failed state, editor-only
  reorder toggle, `move()` reorder → `PUT` with version, optimistic order in
  `detail`, rollback on error, `renewCollectionImage` member swap.
- `frontend/tests/components/SynchronizedCollectionViewer.test.tsx`,
  `useCollectionsData.test.ts` (#1417) — two-pane render with read-only
  props, `viewport-change` mirroring with the saved offset in both
  directions, no write-back/oscillation, Link views toggle + re-arm, Save
  view payload, Reset to saved/home, portrait hint, `< 2` fallback +
  "Showing 2 of _N_", member failure slide-up, editor-only Save;
  `saveViewport` whole-replace `PUT` with `version`, queue sharing with
  `reorderImages`, cross-collection detail guard;
  `ImageViewer.test.tsx` — `onViewerReady` mount/unmount contract.
- `frontend/tests/components/CollectionsPage.test.tsx`,
  `CollectionCard.test.tsx`, `CollectionEditDialog.test.tsx` — list/filter
  states, permission-gated actions, create/edit/delete flows, restricted
  picker gating per role, 409 reload, viewer mount + callback wiring per
  collection type.
- `frontend/tests/components/AddToCollectionDialog.test.tsx`,
  `useAddToCollection.test.tsx`, `App.test.tsx` (#1415) — grouping, filter,
  synchronized cap (per image count), in-flight locking, create path;
  append-not-replace `PUT` body with current `version`, no-op / full / error
  results; viewer button per role and flag, canvas-edit disabling,
  desaturation, success / info / error snackbars and **View collection**
  navigation.
- `frontend/tests/components/SearchModal.test.tsx`,
  `useAddToCollection.test.tsx`, `App.test.tsx` (#1418) — collection results
  on name/description, Collections chip field scoping, `?collection={id}`
  navigation, collections visible under `suppressExtendedResults`, Select
  toggle gating (image results + handler only), image-only checkboxes,
  result-order payload, Clear/close reset, `useVisibleCollections` keeping
  non-editable rows, dialog plumbing with the multi-selected ids.
- `frontend/tests/components/TransferCollectionDialog.test.tsx`,
  `CollectionsPage.test.tsx`, `CollectionCard.test.tsx`,
  `useCollectionsData.test.ts`, `api.test.ts`, `App.test.tsx` (#1419) —
  admin user/program pick, instructor program narrowing, inactive-user and
  unchanged-owner gating, orphaned hint, 403/409 inline errors; `canTransfer`
  affordances on cards and the detail header, "Managed by program" hint,
  restricted scope chips, admin orphan reassignment; the `transfer` hook's
  version resolution (open detail vs fetched), mutation-queue serialization
  behind a reorder, filtered-list removal, and error propagation; and the
  `POST /transfer` request body.
