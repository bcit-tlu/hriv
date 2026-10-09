# Collections

Collections let any authenticated user group **existing** images into a
reusable viewing resource without duplicating image or category records. Two
types exist:

- **`sequence`** — an ordered set of images stepped through one at a time.
- **`synchronized`** — up to four stored images whose viewports are linked
  (rendered side by side for two, in a 2×2 grid for three or four); the
  relative viewport positions can be saved with the collection.

Epic: [#1409](https://github.com/bcit-tlu/hriv/issues/1409). This page is
extended as each child issue lands; sections marked _planned_ are not yet
implemented.

## Feature flags (`COLLECTIONS_ENABLED`, `COLLECTIONS_HOME_SHELF`)

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
  `{"collections": <bool>, "collections_home_shelf": <bool>}`. The drawer
  value is effective only when both settings are enabled. It is a UX hint
  only — flags are not secrets and each one is enforced independently by the
  backend.
- **Frontend.** `useFeatures()` fetches `/api/features` once per mount
  (`fetchFeatures` in `api.ts`; `Features` / `DEFAULT_FEATURES` in
  `types.ts`). Until the response arrives nothing collections-related
  renders; a failed request resolves to _everything off_. When `collections`
  is `false`, `getNavigationItems` drops the Collections item
  (`requiresCollections`), `AppShell` omits the desktop tab and drawer entry,
  `useCollectionsData` never fetches, and `App.tsx` falls back from
  `?collection={id}` / `?page=collections` / `?page=manage-collections` to
  browse (`effectivePage` reports
  `browse` to telemetry). When `true`, behaviour is exactly as described in
  the sections below.
- **Deployment.** Helm value `collections.enabled` (default `false`) renders
  `COLLECTIONS_ENABLED` and `collections.homeShelf` (default `false`) renders
  `COLLECTIONS_HOME_SHELF` on the backend API pod (`charts/backend`). The
  `flux-fleet` `latest` overlay
  (`apps/overlays/latest/hriv/backend/values-latest.yaml`) sets it `true`;
  `stable` inherits the chart default until the epic is promoted. Because
  chart edits only reach an environment on the next chart release
  ([RELEASE_AND_DEPLOY_FLOW.md](RELEASE_AND_DEPLOY_FLOW.md)), `latest`
  shows no collections between this flag landing and the next backend
  release. `docker-compose.yml` sets `COLLECTIONS_ENABLED=true` for local
  development; `COLLECTIONS_HOME_SHELF` defaults to `true` there.
- **Removal.** The flag, `/api/features`' `collections` key and the frontend
  gating are deleted in the epic's closing issue
  ([#1419](https://github.com/bcit-tlu/hriv/issues/1419)).

## Data model

Migration `0030_collections` (`backend/app/models.py`: `Collection`,
`CollectionImage`, `collection_programs`, `collection_groups`); migration
`0031_collection_categories` adds `collections.category_id` +
`collections.sort_order` so collections file into the Browse hierarchy;
migration `0032_collection_owners` adds `collection_owners` so several users
can co-manage one collection (#1531).

| Table                 | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collections`         | `name`, `description`, `type` (`synchronized` / `sequence`, CHECK), `visibility` (`private` / `public` / `restricted`, CHECK, default `private`), `user_id` (**creator audit only** — nullable FK → `users`, `SET NULL` on delete; not ownership), `owner_program_id`, `category_id` (nullable FK → `categories`, `SET NULL` on delete; #1527), `sort_order` (tile-order position), `viewport_state` (JSONB, default `{}`), `version` |
| `collection_owners`   | User co-owners: PK `(collection_id, user_id)`, both FKs `CASCADE` on delete; index `idx_collection_owners_user (user_id)`                                                                                                                                                                                                                                                                                                             |
| `collection_images`   | Ordered membership: PK `(collection_id, image_id)`, `sort_order`; index `idx_collection_images_order (collection_id, sort_order)`                                                                                                                                                                                                                                                                                                     |
| `collection_programs` | Program scope for `visibility = restricted`                                                                                                                                                                                                                                                                                                                                                                                           |
| `collection_groups`   | Group scope for `visibility = restricted`                                                                                                                                                                                                                                                                                                                                                                                             |

### Ownership (#1531)

A collection's owners are **any number of users** (`collection_owners` rows)
**and/or** one program (`owner_program_id`, FK `SET NULL`). The two sets are
independent in the schema: `PUT …/owners` edits the user set whether or not
a program owns the collection, while assigning a program owner via
`POST …/transfer` clears the user-owner rows (a newly assigned program owner
is sole).
`collections.user_id` is **creator audit** — it records who created the row,
survives ownership changes, and goes `NULL` when that user is deleted; it no
longer participates in authorization.

- Deleting a **user** removes their `collection_owners` rows (`CASCADE`) and
  deletes every collection for which they were the **sole** owner (no other
  user owners, no program owner). Co-owned and program-owned collections
  survive — the remaining owners keep managing them.
- Deleting an **image** silently removes it from every collection
  (`collection_images.image_id` `CASCADE`).
- Deleting a **program** does _not_ delete its collections: `owner_program_id`
  becomes `NULL`. If the collection also has no user owners it is
  **orphaned** — it keeps its declared visibility but is manageable only by
  admins until reassigned.
- Deleting a **group** removes its `collection_groups` rows; unlike categories,
  a group attached to a collection does not block group deletion.
- Deleting a **category** does _not_ delete its collections:
  `category_id` becomes `NULL` (`SET NULL`) and the collection becomes
  unfiled, outside Browse. Images still reparent to the Browse root.

### Browse placement (#1527, #1583)

`category_id` files a collection into a category. A collection appears as a
Browse tile only when it is filed into a category; `NULL` means unfiled and
not on Browse. Filed collections appear in their category node in
`GET /api/categories/tree` (`CategoryTree.collections`) and share that
category's tile order with images and sub-categories. The Browse root
tile-order scope contains categories and images only.

Separately, when `COLLECTIONS_HOME_SHELF` and `COLLECTIONS_ENABLED` are on,
Browse root and category scopes show a collapsed **My collections** button at
the bottom-left for any role with a visible owned collection. Opening it shows
a bottom drawer with up to eight of the caller's most recently updated visible
owned collections, **New collection**, a pin control beside the title, and a
close button. The **My collections** button
stays mounted in both states and doubles as the sheet's title: it rests just
above the footer, attaches to the sheet's title slot as the rising header
reaches it, and detaches again on the way down. While pinned it becomes an
outlined, non-clickable title and the pin fills with a light-grey circle.
Tiles are title-only (`density="minimal"`) with ~110 px-tall media to
keep the drawer minimally invasive. The temporary state uses a backdrop and
closes on Escape, backdrop click, the header's close button, or a second
press of the title button; the per-user pin preference removes the backdrop
and the close control. The sheet
is rendered through `AppShell`'s `footerDockSlot`, directly above `FooterBar`
inside the sticky footer dock, so it is ordinary in-flow content: opening
animates its height from 0 to its measured natural height, the sheet emerges
from behind the footer (which paints over its bottom edge), the page grows by
the sheet's height while pinned, and overscroll moves footer and sheet
together. One sheet
stays mounted across both modes, so pinning never reloads tiles and unpinning
never collapses the drawer — the pin is not a close control. The temporary
sheet also locks document scrolling (restoring it on close or pin), matching
the modal behaviour the drawer replaced. The card row is capped against the
measured header and footer heights, so a wrapped header or multi-line admin
footer shrinks the row on short viewports rather than hiding the sheet's
controls above the viewport. Compact cards are
160–180 px wide and scroll horizontally below about
1424 px. The drawer is hidden on image-viewer and collection pages, while the
feed is loading, and when no owned collection is visible. It is not a Browse
tile: it has no drag, reorder, or drop targets.

`GET /api/collections` accepts an optional `limit` from 1 to 100. It is
applied after visibility filtering so inaccessible collections do not consume
result slots; the existing updated-time descending order is retained.

Unfiled collections remain available in the Collections and collection
management views. `GET /api/collections?uncategorized=true` keeps its
existing filter name and returns the unfiled queue; it does not mean that
those collections are Browse-root tiles.

Filing is curatorial, not ownership-bound: `POST /api/collections/{id}/move`
is admin/instructor-only and is deliberately separate from the owner-gated
PATCH. A `category_id: null` move or bulk update unfiles the collection.
Move and bulk-update writes invalidate only non-null category tile-order
scopes, plus the global browse revision when placement changes, so in-flight
reorder clients get a 409 and the tree ETag invalidates. `visibility` still
gates _who sees_ a filed tile; placement only gates _where_ it sits.

To feature a collection at the top of Browse, curators can file it into a
root-level category such as **Featured**. Choosing **None. Access in Manage > Collections.** unfiles
it. Filing a private collection shows a warning that its Browse tile is
visible only to its owners and to staff, instructors and admins — not to
other students.

Unfiled collections no longer provide a root Browse tile to drag an image
onto. The **Add to Collection** dialog remains available for adding images
to collections; this change removes the root-tile drag-add path for students
adding to their own collections.

#### Deployment note

After deploying the A1 promotion model, every existing collection whose
`category_id` is `NULL` becomes unfiled and disappears from Browse. Curators
should file any collections intended for Browse — including home-page
features — into a category before or after deployment.

Collections are included in the admin database export/import round-trip
(`collections` key with ordered `image_ids`, `program_ids`, `group_ids`, and
`owner_ids` — the user-owner id list; legacy dumps carrying only `user_id`
import that creator as the sole owner). See
[admin-import-export.md](admin-import-export.md).

`viewport_state` is written as a whole-column replacement (never a partial
JSONB merge). The synchronized viewer (#1417, #1561) stores it as
`{ "<image_id>": { "zoom": number, "x": number, "y": number,
"rotation": number } }` — each member pane's absolute viewport position; the
relative offsets between panes are implicit across the saved entries. Keys
the stored JSONB does not recognise are ignored by the frontend validator.

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

**Hidden collections (#1559).** `collections.hidden` (default `false`,
migration `0033_collection_hidden`) is the curatorial hide flag, analogous
to `Image.active` / `Category.status='hidden'` but with one deliberate
difference: because collections can be student-owned, a hidden collection
drops out of every student's list/tree/detail **except its owners** —
hiding never locks an owner out of their own work. Non-students (admin,
instructor, staff) see hidden collections everywhere. The rule lives in the
central `_ViewerContext.can_view` gate, so list, detail, Browse-tree embed
and write-endpoint 404/403 checks all agree; a hidden collection is **404**
(not 403) for a non-owner student on any endpoint, so its existence never
leaks.

### Images inside a collection

Students receive only images they could open via `GET /api/images/{id}` —
`image.active` **and** the image's category (with ancestors) passes the dual
gate. Invisible images are **omitted** from `images`, `image_count` and
`cover_thumb`; the collection itself is still returned. Non-students see every
referenced image, including inactive ones. Omitted members survive a student's
`PUT …/images` (see **Image list** below), so a hidden image is never removed
by someone who cannot see it.

### Who can manage a collection (#1531)

"Owner" below means holding a `collection_owners` row; "program instructor"
means an instructor who belongs to the collection's `owner_program_id`.
**Staff hold full student parity on owned collections** — they share the
student columns below (viewing remains unrestricted for them, like
instructors).

| Predicate                     | admin | instructor (owner / program) | student/staff — sole owner | student/staff — co-owner | non-owner |
| ----------------------------- | ----- | ---------------------------- | -------------------------- | ------------------------ | --------- |
| `can_edit_collection`         | yes   | yes                          | yes                        | yes                      | no        |
| `can_change_collection_scope` | yes   | yes                          | yes                        | no                       | no        |
| `can_delete_collection`       | yes   | yes                          | yes                        | no                       | no        |
| `can_transfer_collection`     | yes   | yes                          | no                         | no                       | no        |
| `can_hide_collection` (#1559) | yes   | yes¹                         | no                         | no                       | no        |

¹ `can_hide_collection` is curatorial-global for admins/instructors — like
filing (move), it is not ownership-bound, so an instructor may hide/show any
collection. Students and staff can never hide or unhide, including their own
collections — a student owner of a hidden collection keeps view access but
gets **403** on a `hidden` PATCH.

Scope changes (visibility + restricted `program_ids`/`group_ids`) and
deletion deliberately require the stricter predicate: a co-owner may edit
content but cannot widen visibility on a shared collection or delete it out
from under the other owners. Orphaned collections (no `collection_owners`
rows and `owner_program_id` `NULL`) satisfy none of the owner/program
branches, so only admins may edit, delete or reassign them.

Attaching `restricted` scope follows the category rules:
`can_attach_program_to_collection` (admins any program; instructors only
programs they belong to) and `can_attach_group_to_collection` (admins any
group; instructors only groups they manage). Students and staff cannot use
`restricted` visibility.

PATCH is **field-level authorized**: `name`/`description` only require
`can_edit_collection`, while `visibility`/`program_ids`/`group_ids` require
`can_change_collection_scope` — a co-owner may rename a shared collection but
gets **403** if the body touches scope. A PATCH that **only** sets `hidden`
is the third carve-out (#1559): it requires `can_hide_collection` (any
admin/instructor) rather than `can_edit_collection`, so a curator can hide a
collection they cannot edit. Bundling `hidden` with any content/scope field
falls back to the normal edit/scope gates — the carve-out is exact and never
weakens the stronger checks.

## API surface

Base path `/api/collections` (router `backend/app/routers/collections.py`).
All endpoints require a JWT bearer token — there is no unauthenticated variant
(see [unauthenticated-routes.md](unauthenticated-routes.md)). Every endpoint
below answers `404` while `COLLECTIONS_ENABLED` is off (see
[Feature flag](#feature-flag-collections_enabled)).

| Method | Endpoint                         | Min role                                                             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | -------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/collections`               | student                                                              | Visible collections as `CollectionSummaryOut[]`. Query: `type`, `mine`, `owner_user_id`, `owner_program_id`, `orphaned` (**admin only**, others **403**), `uncategorized=true` (unfiled queue, not on Browse). Ordered by `updated_at` desc.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| GET    | `/api/collections/{id}`          | student                                                              | `CollectionOut` (summary + ordered `images: ImageOut[]`, `program_ids`, `group_ids`, `viewport_state`). **404** when missing _or_ not visible (no existence leak).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| POST   | `/api/collections`               | student                                                              | Create; owner = caller (`user_id`). Body `CollectionCreate`: `name`, `description?`, `type`, `visibility` (default `private`), `category_id?`, ordered `image_ids`, `program_ids` / `group_ids` (restricted only). Admins and instructors must provide a valid category; staff and students create unfiled collections and cannot file on create. Filed creates bump the category tile-order scope and Browse revisions. **201** `CollectionOut`.                                                                                                                                                                                                                                                                                                                                                                     |
| PATCH  | `/api/collections/{id}`          | student (must pass `can_edit_collection`)                            | Body `CollectionUpdate`: any of `name`, `description`, `visibility`, `program_ids`, `group_ids`, `hidden`, `cover_image_id`, `cover_blank` + required `version`. `type` is immutable (**422** if changed). `cover_image_id` pins the tile cover to a member the caller can view (**422** for a non-member or invisible member; `null` restores the first-member fallback). `cover_blank=true` is the explicit "no cover" pick — the tile renders the type-logo placeholder; the two cover states are mutually exclusive (a `cover_image_id` write clears the flag; `cover_blank=true` clears the pin). A `hidden`-only body instead requires `can_hide_collection` (any admin/instructor — curatorial, not ownership-bound); mixing `hidden` with other fields keeps the normal gates. Returns fresh `CollectionOut`. |
| DELETE | `/api/collections/{id}`          | student (must pass `can_delete_collection`)                          | **204**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| PATCH  | `/api/collections/bulk`          | admin / instructor (any — curatorial, not ownership-bound)           | Bulk-update curatorial fields (#1578). Body `CollectionBulkUpdate`: `collection_ids` + optional `category_id` (refile; `null` = unfiled) and `hidden` (hide/show for students). Scope fields are not bulk-editable. **404** when any id is missing, **422** unknown category, **409** when a row moved or vanished between the read and the row lock (retry). Atomic; bumps only non-null source/destination scope revisions for moved rows and the browse revision; `version` advances only on rows that actually change. Returns `CollectionSummaryOut[]` in request order.                                                                                                                                                                                                                                         |
| DELETE | `/api/collections/bulk`          | student (must pass `can_delete_collection` on **every** id)          | Bulk-delete (#1578). Body `CollectionBulkDelete`: `collection_ids`. **404** when any id is missing or not viewable (same no-probe rule as the single DELETE), **403** when any row fails `can_delete_collection`, **409** when a row moved or vanished between the read and the row lock. Atomic — one failure deletes nothing; **204** on success.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| PUT    | `/api/collections/{id}/images`   | student (must pass `can_edit_collection`)                            | Replace the whole ordered image list (add / remove / reorder in one call). Body `CollectionImagesUpdate`: `image_ids`, `version`. `sort_order` is rewritten to `0..n-1`. A dropped pinned member clears `cover_image_id` back to the fallback; a retained member the caller cannot see keeps the pin. Returns fresh `CollectionOut`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| PUT    | `/api/collections/{id}/viewport` | student (must pass `can_edit_collection`)                            | Replace `viewport_state` wholesale. Body `CollectionViewportUpdate`: `viewport_state` (JSON object), `version`. Returns fresh `CollectionOut`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| POST   | `/api/collections/{id}/move`     | admin / instructor (any — filing is curatorial, not ownership-bound) | File the collection into a category or unfile it from Browse. Body `CollectionMove`: `category_id` (required, `null` = unfile) + `version`. **404** missing collection, **422** unknown category, **409** stale version. Keeps `sort_order`; bumps only non-null source/destination scope revisions and the browse revision. Returns fresh `CollectionOut`.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| PUT    | `/api/collections/{id}/owners`   | instructor (must pass `can_transfer_collection`)                     | Replace the **user-owner set** wholesale (`CollectionOwnersUpdate`: `user_ids` + `version`). Targets must be active users (**422**); removing every user owner while no program owns the collection is **422** (orphan guard). **404** if not visible, **403** if not transferable, **409** stale version. Returns fresh `CollectionOut`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| POST   | `/api/collections/{id}/transfer` | instructor (must pass `can_transfer_collection`)                     | Reassign **program** ownership (#1531). Body `CollectionTransfer`: `program_id` (required, `null` = back to the user owners) + `version`. Setting a program clears the `collection_owners` rows — a program owner is sole. **404** if not visible, **403** if not transferable or the program is outside the instructor's memberships, **422** unknown program / clearing a program owner with no user owners to fall back on, **409** stale version. Returns fresh `CollectionOut`.                                                                                                                                                                                                                                                                                                                                  |

`CollectionSummaryOut`: `id`, `name`, `description`, `type`, `visibility`,
`hidden` (#1559 — serialized to every caller; students only ever receive it
as `true` on collections they own), `owners` (`[{user_id, program_id,
name}]` — user entries carry `user_id`,
the program entry carries `program_id`, the unused id is `null`; `[]` when
orphaned), `image_count` (visible-to-caller), `cover_thumb`
(pinned `cover_image_id` thumb when it resolves to a member visible to the
caller, else the first visible image thumb; `null` while `cover_blank` is
set), `cover_image_id` (the honored
pin, or `null` when the stored pin is unset or invisible to the caller),
`cover_blank` (the explicit "no cover" pick — the tile renders the
type-logo placeholder),
`version`, `category_id`, `sort_order`,
`created_at`, `updated_at`,
`permissions {can_edit, can_delete, can_change_scope, can_transfer,
can_hide}`.
(`collections.user_id` is creator-audit only and is not serialized.)

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

**Bulk writes (#1578).** `PATCH/DELETE /api/collections/bulk` apply one
operation to a `collection_ids` set atomically — any missing id is **404**
before any write. Bulk PATCH is curatorial (admin/instructor): it carries
the same fields as a hide-only PATCH plus `POST …/move` (`hidden`,
`category_id`) and no `version` token, mirroring `PATCH /images/bulk` —
rows that actually change get `version + 1`, a no-op advances nothing.
Scope fields (`visibility`/`program_ids`/`group_ids`) are deliberately not
bulk-editable: scope authority is per-collection (sole owner vs co-owner)
and `restricted` needs per-collection attach lists. Bulk DELETE re-checks
the per-collection gates on every row — viewability (**404**) then
`can_delete_collection` (**403**) — so staff/students keep the
single-delete contract at scale; unlike bulk image delete it is not
role-gated.

Both bulk endpoints keep the `scope → row → browse` lock order: scope
revisions are bumped from an unlocked snapshot, then the target rows are
re-read under `FOR UPDATE` with `populate_existing`. A row whose filing
category (or existence) changed between the two reads gets a **409** —
the caller retries with fresh state — rather than silently skipping the
real source scope's tile-order invalidation, and the locked read makes
the `version + 1` increment safe without a caller token. The bulk PATCH
response `refresh`es changed rows after commit so `updated_at` carries
the SQL-generated time, matching the single-row endpoints.

**Creating.** Every role may `POST`; the caller becomes the first user
owner (a `collection_owners` row) and is recorded as creator
(`collections.user_id` audit). Staff get the same create →
sole-owner lifecycle as students. Program ownership is only reachable via
`POST …/transfer` (#1531).

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
  (4) images (**422**) for every role. Students may create sequence
  collections with at most `STUDENT_SEQUENCE_MAX_IMAGES` (20) images and may
  not add a new image to a sequence once the resulting list would exceed that
  limit (**422**).
- On a student `PUT …/images`, the submitted ids plus retained unseen members
  count toward the sequence limit. A replacement that would exceed
  `STUDENT_SEQUENCE_MAX_IMAGES` (20) is rejected only when it adds a new
  member, so students can still remove or reorder an already-over-cap
  collection. Existing over-cap data is not modified retroactively.
- Student sequence-cap errors return **422** with detail
  `Students may add at most 20 images to a sequence collection`.
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

**Student collection count (#1583).** A student may own up to
`STUDENT_MAX_COLLECTIONS_PER_TYPE` (10) collections of each type. Only
`POST /api/collections` enforces this cap: the 11th create of one type returns
**422** with detail `Students may own at most 10 {type} collections`, while
the other type remains available until its own limit is reached. The count is
based on user-owner rows (`Collection.owners`): co-owned collections count,
program-only-owned collections do not, and `collections.user_id` is creator
audit data only. The cap applies to the caller's role, not the collection
owner's role; admins, instructors and staff are never capped. It is not
retroactive and is not enforced by owner-replacement or transfer endpoints.
On a Collections type page, **New collection** stays available until both
types are capped; in the create form, a capped type is disabled and the other
type is selected when the page's default type is capped.

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

### Owner management (#1531)

User co-ownership and program ownership are managed by two endpoints, both
gated on `can_transfer_collection` and carrying the `version` token (same
optimistic-concurrency rule as PATCH — **409** with the current
`CollectionOut` on a stale `version`; success increments it).

Authority is checked in this order, and every rule is enforced server-side:

1. The caller must be able to **view** the collection, else **404** (no
   existence leak — same as every other write).
2. The caller must pass `can_transfer_collection`, else **403**: admins for
   any collection; instructors only for a collection they co-own or one
   owned by a program they belong to. Staff and students can never manage
   owners — not even on collections they own. Orphaned collections satisfy
   neither instructor branch, so only admins can reassign them.

`PUT /api/collections/{id}/owners` replaces the **user-owner set**
wholesale:

- `user_ids` may contain any **active** user in any role — co-ownership is
  deliberately not role-restricted (an instructor may add a student
  co-owner; that student then edits content per `can_edit_collection` but
  cannot change scope, delete, or manage owners). Unknown or inactive ids
  are **422**. Note the instructor-facing picker is directory-scoped:
  `GET /api/users/` never exposes staff/admin or `Admin`-program accounts to
  instructors, so they can only select students and fellow instructors —
  an admin must add staff or admin co-owners.
- The submitted set replaces the rows wholesale — adds and removals happen
  atomically. `collections.user_id` (creator audit) is untouched.
- The result must not orphan the collection: when `owner_program_id` is
  `NULL`, an empty `user_ids` is **422**. When a program owns the
  collection the endpoint is still available (admins can pre-stage user
  owners for a later program-clearing transfer).

`POST /api/collections/{id}/transfer` reassigns the **program** owner:

- `program_id` must exist (**422**) and pass
  `can_attach_program_to_collection` (**403**): admins any program,
  instructors only a program they belong to.
- Setting a program makes it the **sole** owner — the `collection_owners`
  rows are deleted in the same write (user owners are re-added via
  `PUT /owners` after clearing the program).
- `program_id: null` clears the program owner. The collection must have at
  least one user-owner row to fall back on — clearing the last program owner
  of a collection with no user owners is **422** (add a user owner first).
- `collections.user_id` (creator audit) is untouched either way.

Neither endpoint changes `visibility`, scope rows (`collection_programs` /
`collection_groups`), images, or `viewport_state`. Moving a collection onto
a program does **not** add that program to its restricted scope, and
clearing it does not remove it.

### Ownership & lifecycle

What happens to collections when the rows they reference go away:

- **User deleted** — their `collection_owners` rows are removed
  (`ON DELETE CASCADE`) and `collections.user_id` (creator audit) is set to
  `NULL` (`SET NULL`). Then the router deletes every collection for which
  they were the **sole** owner — no remaining user owners and no program
  owner — along with its `collection_images` and scope rows (filed
  collections also bump their scope's tile-order revision). **Co-owned and
  program-owned collections survive**: the remaining owners keep managing
  them. Add a co-owner or assign a program first if a collection should
  outlive its owner.
- **User deactivated** — nothing changes: the collections stay, keep their
  owners and visibility, and remain manageable by admins, the co-owners, and
  instructors of the owning program. A deactivated user cannot sign in, and
  cannot be added as an owner (`PUT /owners` **422**) until reactivated.
- **Image deleted** — its `collection_images` links are dropped (`CASCADE`);
  the collection stays, `image_count` shrinks and `sort_order` gaps are
  harmless (the next `PUT …/images` rewrites them).
- **Program deleted** — `DELETE /api/programs/{id}` never inspects
  collections. Collections **owned** by the program survive with
  `owner_program_id = NULL`: those that also have no `collection_owners`
  rows become **orphaned** (admin-only until reassigned via the Owners
  dialog). The program's `collection_programs` rows are removed (`CASCADE`).
  **Scope caveat:** a `restricted` collection whose only program scope was
  the deleted program becomes _unrestricted on the program dimension_ (the
  group gate still applies), so it may become visible to more students than
  before. After deleting a program, review `GET /api/collections?orphaned=true`
  and any restricted collection that referenced it.
- **Group deleted** — its `collection_groups` rows are removed (`CASCADE`);
  the same scope caveat applies on the group dimension. Unlike categories,
  collections never block group deletion.

Admins find and repair orphans with the list filters that already exist on
`GET /api/collections` (`orphaned=true`, `owner_user_id`, `owner_program_id`)
followed by `PUT …/owners` or `POST …/transfer`.

## Frontend behaviour

### Collections pages, CRUD and deep links (#1414, per-type split #1554)

**Where.** `frontend/src/api.ts` (`ApiCollection*` wire shapes,
`fetchCollections` / `fetchCollection` / `createCollection` /
`updateCollection` / `deleteCollection` / `replaceCollectionImages` /
`saveCollectionViewport`, `collectionConflictCurrent`), `types.ts`
(`Collection`, `CollectionSummary`, `CollectionType`, `CollectionVisibility`,
`CollectionOwner`, `CollectionPermissions`, `CollectionPageType`),
`collectionUtils.ts` (mapping,
labels, `canUseRestrictedVisibility`, `parseCollectionIdParam`),
`useCollectionsData.ts` (list/detail state + mutations),
`components/CollectionsPage.tsx`, `CollectionCard.tsx`,
`CollectionEditDialog.tsx`, `components/ManageCollectionsPage.tsx`,
plus `navigation.ts`, `AppShell.tsx`,
`useShareableImageState.ts`, `useNavigationHistory.ts` and `App.tsx`.
Everything in this section is conditional on the deployment flag
(`useFeatures.ts`; see [Feature flag](#feature-flag-collections_enabled)).

**Navigation.** The **Collections** tab is shown to every authenticated role
(students included) in both the desktop app bar and the compact/mobile
drawer. In the app bar it is a menu trigger only (#1559) — clicking it opens
the sub-menu without navigating, the same `Tab` → `Menu` pattern as
**Manage**, with **Sequence** and **Synchronized** entries; the tab carries
`value="collections"` so Tabs' onChange ignores it (it is not a real page
tab) while the tab still highlights on collections pages. Each menu item
opens the same `CollectionsPage` locked to one type via
`?page=collections&type=`;
a missing or invalid `type` defaults to `sequence`. A `collectionPageType`
state in `App` keeps the list filter, the URL param and the detail view in
sync — opening a collection whose type differs from the current page type
updates the page, so detail back-navigation always returns to the matching
typed list. `App` only mounts
`useCollectionsData` while a collections page is active, so browsing images
never hits `/api/collections`. Non-students additionally get
**Manage → Collections** (`?page=manage-collections`) — see
[Manage Collections table](#manage-collections-table-1554) below.

**List.** `GET /api/collections?type=` rendered as a fixed-width flex-wrap
card grid (300px tiles, `gap: 2` — the same parameters as the Browse tile
grid, so cards do not stretch with the viewport). Each `CollectionCard`
shows the
cover (`RenewingThumbnail` with a collection-scoped renewer that refreshes the
token via `GET /api/collections/{id}`; a renewed cover that loads and later
expires again is renewed once more, while a cover that never loads is renewed
only once), name, image count, and a visibility chip that
reuses the category restriction palette. Tiles render no owner reference at
all (#1567) — neither program nor user names appear on the card — and the
collection type shows as a bare icon left of the title, the same spot the
category tile's folder glyph occupies (`titleAccess` names it for screen
readers). **Move** stays in the
top-right `absolute` overlay using the
white-on-`rgba(0,0,0,0.25)` scrim convention of `CategoryTile` (#1554) —
owners/transfer lives on the detail header and the manage table. A curatorially
hidden card renders the same desaturated treatment as a hidden
category/image tile plus a `VisibilityOff` affordance by the name (#1559);
a card filed under a hidden category desaturates the same way but shows
**no** marker — the eye-off glyph is reserved for the collection's own
hidden flag — because the hidden-subtree rule
already removes it from student view (`categoryHidden` mirrors
`ImageTile`'s prop; the Browse grid and the collections list both pass it).
**Edit** is a pencil inline at the title row's right — the
CategoryTile/ImageTile convention (#1567) — and Delete is
gone from the card entirely (edit dialog only). A **Set cover image**
image-icon button joins Move in the top-right overlay (the `CategoryTile`
"Set card image" convention), gated on `permissions.canEdit` like the
pencil; it opens `CollectionCoverPickerModal`, which radios over the
collection's visible members and PATCHes the cover fields: the leading
**None** row sets `cover_blank` (the tile renders the type-logo placeholder
like an uncovered category), the **Automatic** row clears both states back
to the first-member fallback, and a member row pins `cover_image_id`.
Everywhere the type renders
as a pill (detail header, edit dialog, manage table) it is the shared
`CollectionTypeChip`: red (primary) outline and text on a white fill with
the type's icon (#1567). Filters — type is the page,
not a facet (#1554): a **My collections** chip (`mine=true`;
clears and disables the owner facet) and — for admin, instructor and staff
only — an **Owner** select built from the owners in the loaded list, both
in the header row left of **New collection**
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
screen. Each `owners` wire entry always carries both `user_id` and
`program_id` (the unused one `null`), so the mapper picks the non-null id
rather than testing key presence; an empty array means the collection is
orphaned.
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
visibility. Create from a Collections page posts `image_ids: []`; create from
the image view (#1415, below) posts the selected image id(s); create from
the Browse toolbar's **New collection** button (between **Add Category**
and **Add Images**, `canEditContent` + the collections flag — the same
gate as its neighbours) seeds the current Browse category via
`defaultCategoryId` and posts it as `category_id`. Every role —
staff included — gets the **New collection** button and the unfiltered
empty-state create link (#1531).
Edit sends the collection `version` in the PATCH body; a **409** shows the
standard "modified by another user" message with a **Reload** action that
re-seeds the form from the authoritative `CollectionOut` in `detail`.
On an existing collection the dialog also honours
`permissions.can_change_scope` (#1531): when it is false (e.g. a student or
staff co-owner, or any editor on a program-owned collection they don't direct)
the visibility radio and the program/group pickers render read-only while
name and description stay editable; the backend field-level split enforces
the same boundary regardless.

On edits the dialog is the wider variant (same width as the Edit Image and
Manage Categories dialogs) so two additions fit (#1566): a **Category**
picker (`CategoryPickerSelect`, admins/instructors only — filing stays
curatorial) that turns a changed filing into a move call after the PATCH,
and a **Hide Collection** / **Show Collection** link in the title row
(`canHide`), which toggles local hidden state that the PATCH commits —
"Hidden by Category" disables it when the filing category is hidden, the
same contract as Edit Image.

**Delete.** Lives inside `CollectionEditDialog` only (#1554 — the
`EditImageModal` convention; there is no card or detail-header delete):
a **Delete Collection** button at the bottom of the dialog content arms on
first click ("This action cannot be undone. Click again to confirm."), the
second click calls `DELETE /api/collections/{id}`, and failures stay in the
dialog's error area with the API message. Deleting the open collection
returns to the list.

**Owners (`CollectionOwnersDialog`, #1531).** A pencil beside the detail
header's owner name (gated on
`permissions.canTransfer`) manages the
user-owner set and the program owner — see "Ownership management UI" below.

**Permissions are UX gates only.** Edit/delete controls render when
`permissions.can_edit` / `can_delete` from the API are true; the backend
re-checks authority on every call.

**Detail view.** Selecting a card sets `?collection={id}` and renders the
collection header, which mirrors the image view's top container (#1564) —
there is no `<h1>`; the collection name is the breadcrumb's trailing item.
The top row holds a `MuiBreadcrumbs` matching the collection's filed
location on the left and the action buttons on the right: the category
ancestor chain resolved from `detail.categoryId` (each link navigates
Browse to that category, or the root for **Home**), with the collection
name trailing as the current item followed by a muted `(N images)` count —
the same convention as the category breadcrumb (#1559). Restricted
program/group chips sit right after the breadcrumb, where the image view
renders them. The actions are **Hide collection** / **Show collection**
(`canHide` — curatorial; PATCHes `hidden` via `useCollectionsData.setHidden`
with the OCC version and 409 merge; the same text-button + eye-icon spot the
image viewer's Hide/Show Image control occupies) — replaced by a disabled
**Hidden by Category** button when the filed category (or an ancestor) is
hidden, the same locked state the image view and edit dialog render — **Manage Images**
(`canEdit` — opens `CollectionManageDialog`, the mini-Browse member
manager: drag to
reorder, the corner remove control (tooltip "Remove image"),
**Multi-select** + the bottom **Remove N Selected Images** to bulk-remove,
**Choose images** to
add via the search flow — all staged locally until **Done** commits the
staged list once or **Cancel** discards it; #1566/#1567). **Edit** is a pencil on the final
breadcrumb item — the Edit Category breadcrumb-pencil pattern — gated on
`canEdit` or filing rights (`canFile`), and the owners affordance is the
transfer-horizontal (`SwapHoriz`) icon beside the
"Managed by …" line (`canTransfer`). Filing moved into the edit dialog's
**Category** picker —
the header carries no **Move** button (#1566). Below the top row, the **type
pill** — the shared `CollectionTypeChip` with the type's icon
(Synchronized / Sequence, #1567) — and the **visibility chip**
(Public/Private — restricted renders no pill when program/group scope
chips carry the restriction; an unscoped restricted collection still
gets the pill so it is never label-less; #1567) sit to the
left of the owner line; the description renders below the pills,
left-aligned (#1567). Hidden state shows through greyscale alone — no
`Hidden` chip — and the same desaturation (chips, pills, action buttons,
sequence filmstrip) applies when the collection sits under a hidden
category. No Delete (#1554).
`sequence` collections mount the sequence viewer (#1416, below) and
`synchronized` collections mount the synchronized viewer (#1417, below). A
404 (missing or not visible) renders the not-found alert with a
back-to-list action.

**Deep links & history.** `useShareableImageState` parses `?collection={id}`
ahead of `?image=` / `?category=`; a collection link wins if both are present.
The list emits `?page=collections&type=sequence|synchronized` (#1554 — bare
`?page=collections` links were updated to carry `type`, and the param
defaults to `sequence`), a selected collection emits
`?collection={id}` (no `page` param), a selected sequence item adds
`&item={image_id}` (#1416), and a collection opened from a Browse tile adds
`?cat=` carrying its originating scope (#1529). `popstate` parses `type` as
well, so back/forward restores the typed list. Both push history entries
through `useNavigationHistory`, and `popstate` restores the selected
collection (and sequence item) from the URL, so back/forward moves between
browse, image and collection views. Refreshing a `?collection=` URL re-opens
that collection;
refreshing `?collection={id}&item={image_id}` re-opens the sequence on that
image (falling back to the first image when the id is not a visible member).
`?item=` without `?collection=` is ignored.

### Manage Collections table (#1554)

**Where.** `components/ManageCollectionsPage.tsx`, mounted by `App` for
`page === 'manage-collections'`; the **Manage → Collections** sub-menu item
gates on `canEditContent || canViewPeople` (admins, instructors, staff —
students never see Manage). Everything below the nav item shares the flag
gate too.

**Table.** `GET /api/collections` with no API filters — the server already
scopes the list per role, and every facet is client-side, mirroring
`ManagePage`'s idiom: stored filter facets in a `FilterBar` (Name text,
Type, Visibility, Owner incl. _No owner (orphaned)_, Category tree panel —
persisted under the `manage-collections` table-preferences key), sortable
columns (`TableSortLabel`), client-side `TablePagination` with the shared
rows-per-page preference, and a Category column rendering
`CategoryBreadcrumb` (extracted from `ManagePage`; segments link into
Browse, hidden-subtree rows get the eye icon). Columns (#1567): Cover
(`RenewingThumbnail`), ID, Name (with a `VisibilityOff` marker on
curatorially hidden rows, #1559), Type (the shared `CollectionTypeChip`
pill), Scope
(`CollectionVisibilityChip` — a Public/Private pill; restricted shows no
pill when scope chips render, but an unscoped restricted collection keeps
the Restricted label, #1567), Owners
(`describeCollectionOwners`), image count, Programs and Groups (own scope
solid plus the filed category's scope at inherited opacity), Category,
**Visibility** (a per-row show/hide `Switch` gated on `permissions.canHide`,
same as Manage Images' Visibility column), Created, Modified, Actions.
The default-visible set mirrors ManagePage's lean six — Cover, Name, Type,
Category, Groups, Visibility, Modified — so the table sizes to content and
wraps instead of overflowing into horizontal scroll; the rest are opt-in.
Column visibility is user-persisted through **Choose columns**
(`ColumnVisibilityDialog` + `useTableColumnPreferences` under the
`manage-collections` columns key, same mechanism as `manage-images`).
Rows hidden via the switch render greyscale/dimmed — `data-dimmed` cells,
grayscale thumbnail, inactive-color chips — matching `ManagePage`'s
inactive-image convention. The same treatment (plus a disabled
Visibility switch) applies to collections filed under a hidden category —
the hidden-subtree rule already removes them from student view; the table
styling only surfaces that inherited state to staff, and the row carries
no marker icon — `VisibilityOff` is reserved for the collection's own
hidden flag. In **Bulk Edit** the
visibility switch likewise disables when the whole selection is
category-hidden or the chosen target category is hidden — the same
`allCategoryHidden`/`nextCategoryHidden` rule `BulkEditImagesModal` uses,
and a visibility toggle pending when the switch locks is dropped from the
save so only the refile applies.

**Actions.** Row click opens the edit dialog for `permissions.canEdit`
rows — fetching the full record first, since summaries omit the restricted
scope — and calls `onOpenCollection` (the collection detail view) for
read-only rows; the cover thumbnail always navigates to the collection
view (#1567, matching Manage Images). A single kebab **actions** button
opens a contextual menu (#1567): **View** (always), **Edit**
(`canEdit` or curatorial filing), **Manage owners** (`canTransfer`,
`CollectionOwnersDialog`). Rows carry no **Move** action —
category filing moved into the edit dialog's **Category** picker (#1566),
with the Browse card's Move overlay and tile drag as the other curatorial
paths. Staff therefore get Edit only where the API
grants it and never see Owners/Delete affordances they cannot use;
Delete stays inside the edit dialog, same convention as `EditImageModal`.
Owners/transfer saves fetch a fresh record for `version` before PUT/POST,
and the page refetches after every mutation or whenever the `categories`
prop changes — the signal that a Move (or its snackbar undo) landed.

**Bulk edit (#1578).** A selection checkbox column leads each row —
enabled for curators (admin/instructor) on every row, and for
staff/students only on rows whose `permissions.canDelete` allows the
single delete. The header checkbox selects/deselects the current page;
a **Bulk Edit (N selected)** button appears once anything is selected and
opens `BulkEditCollectionsDialog` (mirroring `BulkEditImagesModal`): a
**Category** picker (files all selected into a category or the Browse
root) and a **Visible to students** switch, both curator-gated on the
frontend and enshrined server-side by the admin/instructor dependency on
`PATCH /collections/bulk`; plus a two-step **Delete selected** arm that
requires `canDelete` on every selected row. Saving calls
`PATCH /api/collections/bulk`, the delete calls `DELETE …/bulk`; both
refetch the table, clear the selection, and a refile also fires
`onCategoriesChanged` so the Browse tree re-renders.

### Browse tile integration (#1529)

**Where.** `useBrowseData.ts` (filed collections from nested
`resolvePathNode` nodes), `components/SortableTileGrid.tsx`
(`GridTile`/`DragOverlay` collection branches), `components/CollectionCard.tsx`
(`onMove`), `components/MoveCollectionDialog.tsx`,
`useCategoryActions.ts` (move/undo handlers), `useCollectionsData.ts` (`move`).

**Tiles.** When `COLLECTIONS_ENABLED` is on, filed collections render in
category scopes alongside sub-categories and images — the same shared
`CollectionCard` the Collections tab uses (C1 parity), wrapped in the
standard sortable tile so dimensions, drag activation and reflow match
image/category tiles. Collections come from `CategoryTree.collections`;
unfiled collections (`category_id IS NULL`) are not fetched into Browse
state and never render as tiles. The root scope contains categories and
images only. With the flag off no collection tile is rendered and the
scope's freshness counts as satisfied for background-refresh bookkeeping.

**Ordering & moving.** Collection tiles carry `col-{id}` draggable ids and
participate in the mixed category/image/collection tile-order contract
(#1528). Dropping a collection onto a category tile's move zone files it into
that category (the same API as `POST /api/collections/{id}/move`) — like
images and categories. Filing is curatorial: any admin/instructor sees the
**Move** affordance on Browse tiles and list cards, plus the **Category**
picker inside the edit dialog (#1566) — the detail header's separate Move
button and the manage-table row action are gone —
independent of `permissions.canEdit`; students and staff get no move UI. The
move dialog (`MoveCollectionDialog`) offers every category plus **Not on
Browse**, preselects the current category, and no-ops on an unchanged
destination. A successful move refreshes the category tree, invalidates
only non-null source/destination tile-order scopes, and offers an undo
snackbar that re-posts the previous category with the version from the move
response. Unfiling says “Removed … from Browse.”

Filing a private collection into a category shows this warning: “This
collection is private. Students will not be able to see the images in this
collection.” The
bulk dialog warns when a changed non-null destination includes private
collections. The **Add to Collection** dialog remains available; unfiled
collections no longer have root Browse tiles for drag-add.

**Browse context.** Opening a collection tile keeps the originating Browse
scope: the URL becomes `?collection={id}&cat={ancestor path}` and closing
the detail (the error-state action) returns to that scope instead of the
Collections list. The detail breadcrumb navigates to the collection's
_filed_ category location regardless of where it was opened from (#1559).
Back/forward restores both the collection
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
errors stay inside the create dialog as on the collections pages.

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

**Caption.** A caption row under the viewport — the same pattern the
synchronized panes use (#1564) — holds the member name (left) and, at the
right, the `n of N` live region plus the **Open image** action. Member
management moved into the detail header's **Manage Images** dialog
(#1566/#1567).

**Navigation.** Lightbox-style **Previous** / **Next** chevron buttons
overlay the viewport's left and right edges (#1561); like the OSD toolbar's
`autoHideControls`, they fade in on pointer activity over the viewer frame
and fade back out after ~2 s idle or on pointer leave (keyboard focus also
reveals them). The buttons stay mounted — only opacity and pointer-events
toggle — so screen readers and tab focus still reach them. Strip
thumbnails (`Go to {name}`) and ←/→ arrow keys change the current item
too. Arrows are handled by a document-level keydown-capture listener
(#1567) — focus placement is irrelevant, so a dialog returning focus to a
header trigger or a chevron/thumbnail click can no longer strand ←/→.
OpenSeadragon's own keyboard panning never sees them (capture still wins),
editable targets (inputs, textareas, selects, `[role="textbox"]`,
contenteditable) are skipped, roving-focus widgets keep their keys while
focused (tablists like the AppShell nav, trees, radio groups, sliders),
and the listener yields whenever a dialog, menu, or listbox is open. The
container itself is focusable
(`tabIndex={-1}`) and autofocuses when a collection opens (#1564) so the
edge-nav cue reveals immediately — switching images never steals focus
back, but opening a different collection focuses it again.

**Thumbnail strip.** `RenewingThumbnail` buttons _above_ the viewer
(#1564); the
current item is marked `aria-current` and framed by a 3 px primary ring —
an `outline` pulled inside the thumbnail box with a negative
`outline-offset` (an outward outline was clipped asymmetrically by the
strip's `overflow-x` scroll port, which cropped the highlight before
#1561). `onTileSourceRenewed` and the
thumbnails' renewal callback flow through `onImageRenewed` →
`useCollectionsData.renewCollectionImage`, which swaps the refreshed
`ApiImage` into `detail` so short-lived tile/thumb tokens keep working.

**Fallback states.** A truly empty editable collection says "This collection
has no images. Use 'Manage Images' to add some."; a read-only collection says
"This collection has no images." Restricted-member messaging remains distinct. If
the current image's tiles fail mid-session the viewer reports the error via
`onError`, marks the id failed (dimmed, disabled thumbnail), and skips to
the nearest still-available image (preferring the next one). When every
image has failed, an error alert replaces the viewer.

**Manage dialog.** The header's **Manage Images** button (replaces the #1559
Reorder toggle, #1566) opens `CollectionManageDialog` — a mini-Browse grid
of filmstrip-size `useSortable` thumbnails (a separate `DragDropProvider`;
the locked `SortableTileGrid` collision contract is untouched). The dialog
is a local draft editor (#1567): opening seeds the draft from the detail's
member list, and every operation — `move()` reorder on drag-end, the corner
remove control, a selection-mode bulk removal,
and picks returned by the
add-images search flow (`onAddImages` → App opens `SearchModal`, whose
selected `ImageItem`s land back in the draft via a staged-add channel) —
mutates only the draft, so the detail page and filmstrip behind the dialog
never move mid-edit. Dragging renders a `DragOverlay` replica while the
source tile dims in place. Tiles keep `tabIndex`/`role="button"` on the
activator face explicitly (not left to the dnd-kit a11y plugin's deferred
injection) so keyboard reorder — Space/Enter to pick up, arrows to move —
always reaches the `KeyboardSensor` (#1567). The header's **Multi-select**
toggle (`aria-pressed`) switches the grid into selection mode: sortables are
disabled so clicks no longer arm drags, each tile face becomes a labelled
`role="checkbox"` (click or Space/Enter toggles) with a stock MUI `Checkbox`
(decorative — the face holds the semantics) replacing the ✕ badge, and a
dialog-spanning error-styled **Remove N Selected Images** button pinned
above the actions stages the whole set at once; toggling Multi-select off
clears the set and restores the drag/remove affordances, and a fresh open
always starts out of selection mode. **Done** (contained) diffs the draft
against the seeded order
and fires `onSaveMembers(imageIds)` once when it differs — a single
`PUT /api/collections/{id}/images` whole-replace (`image_ids` + `version`)
in `useCollectionsData.reorderImages`, which keeps `App`'s `detail` the
single source of truth and surfaces errors via `onError`; a failed commit
keeps the dialog open with the draft intact. Closing a dirty draft
(Esc/backdrop/close) asks to discard first; a clean close needs no
confirmation. Staged additions dedupe by image id and enforce the
four-image synchronized cap, reporting already/full outcomes through
`onError`.

### Synchronized collection viewer (#1417)

**Where.** `components/SynchronizedCollectionViewer.tsx`, mounted by
`CollectionsPage` for `type === 'synchronized'` below the shared detail
header.

**Panes.** Up to `SYNCHRONIZED_COLLECTION_MAX_IMAGES` (4) visible members
render as panes — a side-by-side row for two, a 2×2 grid for three or four
(#1561) — each a read-only `ImageViewer` with the same prop set as the
sequence viewer (`canEditContent={false}`; stored annotations, locked
overlays and measurement metadata pass through from `metadataExtra`). A
caption under each pane shows the member name (plus an _inactive_ marker)
and an **Open image** action → `?image={id}`. A member count above the pane
cap produces a "Showing _N_ of _M_" note. Fewer than two visible (or
surviving) members shows a fallback alert with the ordered member list and
per-row **Open image** links; members whose tiles fail mid-session are
skipped, so the panes slide forward.

**Linked navigation.** `ImageViewer` exposes the OSD instance through a new
`onViewerReady(viewer | null)` prop; the component attaches raw
`viewport-change` handlers and mirrors zoom, center and rotation onto every
other pane with `immediately=true` so the followers track during the
leader's spring animation. A `syncingRef` guard makes every programmatic
write a follower write — mirrored events never lead the sync, and viewer
changes before a pane's `open` event completes are ignored. Any pane can
lead; the leader's displacement is applied to all followers.

**Baselines.** The panes keep an armed _baseline_ — every opened pane's
viewport snapshotted when the pane joins, when a pane re-pins, or
on reset (#1561). A leader's move applies its displacement from its own
baseline — a multiplicative zoom ratio and additive centre/rotation deltas —
onto each pinned follower's baseline, so saved positions around different
highlights stay aligned while navigation mirrors. For two panes this is
the pairwise offset the viewer originally captured. **Link toggles**
(#1564, #1567) — a per-pane button at the top-right of each viewport
rendering a link icon (linked) or link-off icon (unlinked) — replace the
old global **Link views** switch: panes start linked, unlinking
detaches one pane's navigation entirely (it neither leads nor follows),
and re-linking re-captures the baselines at the current positions (it does
not snap the pane back to where it left).

**Persisted view.** **Save view** (editors only,
`permissions.can_edit`) writes every pane's current viewport as
`{ "<image_id>": {zoom, x, y, rotation} }` through
`useCollectionsData.saveViewport` → `PUT …/viewport` (whole-replace +
`version`), so the layout restores exactly after a reload or via a
`?collection={id}` share link. `saveViewport` is serialized with
`reorderImages` through the same mutation queue so the two writes can never
consume each other's version. The save stays put — a tile-source refresh
from the response re-opens the pyramid but preserves the live viewport
(`ImageViewer` snapshots it before `open`, same as the token-renewal
path). **Restore view** (everyone) re-applies the saved
positions and re-arms the baselines; it is disabled until a viewport has
been saved for at least one rendered pane (#1567). Saved entries that do
not match the shape are ignored by
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

**Multi-select (image and category results) — picker mode only.** The
select layer exists only when the modal opens as a collection-image picker
(`initialSelectMode` — currently the Manage dialog's **Choose images** flow,
`requestCollectionImageSearch`); the normal search never shows a Select
toggle, checkboxes, or the footer. The picker also narrows the chip row to
just the two addable kinds — **Categories** and **Images**, pre-applied —
with no other type chips and no Field chips; unticking both widens the
search to every kind again. Matches scope to name fields while a chip is
on. Image
rows become labelled checkboxes
(`Select {image name}`) inside a `<label>` row — clicking anywhere toggles —
and category results check the same way: a checked category stages every
image in its subtree (sub-categories included) in registration order — the
category's own images by `sortOrder`, then each child's subtree in tree
order, honoring the `excludeHidden` rule — and shows indeterminate when
only part of the subtree is covered. A category result whose subtree
holds no addable images is not listed in picker mode at all — a greyed-out
checkbox cannot say why the category is unavailable, so the row is
filtered from `displayResults` (and from **Select all**'s coverage);
normal search keeps showing it. Every other kind keeps its
`CardActionArea` navigation and is never selectable (this avoids
nested-interactive controls, see #1345). A **Select all** /
**Unselect all** control at the top-left of the results list bulk-toggles
every selectable row currently displayed; that header row (with the result
count) stays pinned while the result list scrolls beneath it. Selections
survive query and
filter changes: each pick records the result generation and position
where the image appeared, so the footer count covers picks hidden by the
current query and the payload emits them in "order encountered" — result
order within one query, chronological batches across queries.
Per-image provenance (`direct` vs the set of checking categories' `pins`)
keeps the count honest under overlap: unchecking a category removes only
members no other claim holds, so a hand-picked or other-subtree member
survives, and checking an already-covered nested category never shrinks
the count. The sticky footer shows "N images selected" with **Cancel**
(closes the picker) and **Add to collection**, which hands the ids to
`handleSearchAddToCollection` — staging them into the Manage dialog's
draft when that flow launched the modal. Closing the modal or handing off
resets the selection. When the
collections feature flag is off, the modal hides collection results, the
Collections chip, and the collections wording in the placeholder.

**Image ids.** `App` keeps `addToCollectionImageIds` as state for the
viewer's **Add to Collection** button (`[selectedImage.id]`); the search
picker's footer feeds `handleSearchAddToCollection`, which stages into the
Manage dialog's draft when that flow launched the modal (and otherwise
opens `AddToCollectionDialog`). The dialog renders whenever
`collectionsEnabled && currentUser`, so adds work with no image open.

### Ownership management UI (#1419)

The write API's owner endpoints — `PUT /api/collections/{id}/owners` and
`POST /api/collections/{id}/transfer` (#1531) — are surfaced on the
collections pages and the Manage → Collections table (#1554) — there is no
separate Admin section.

**Entry points.** An **Owners** button appears on the detail header and on
manage-table rows, all gated on
`permissions.can_transfer` (the API re-checks regardless). On an orphaned
collection — found via the admin-only _No owner (orphaned)_ owner facet —
the action is the reassignment flow.

**`CollectionOwnersDialog`.** A **User / Program** radio row at the top picks
which ownership surface the pane below edits. Both panes share a fixed
height (the User pane's height at the default 25-row page); taller filter
content scrolls inside the pane's table, so switching radios never resizes
the dialog:

- The **User pane** mirrors the `GroupManagementModal` member table: a
  checkbox table (Name, Email, Program columns) over a debounced, paged
  `fetchUsersPaged` list. The role scope lives in a **Role** popover button
  beside the **Search** and **Program** filter buttons — Students /
  Instructors for everyone, plus an admin-only **Everyone** option (no
  `role` param). The **Program** filter narrows the Students scope only,
  matching group co-instructor selection. Instructors automatically get
  the mini user projection: students and instructors only, with admins,
  staff and `Admin`-program users excluded by the endpoint. The checked
  set _is_ the replacement owner set — current owners start checked under
  a **CURRENT OWNERS** caption with an **Owner** chip — and
  **Change Owner(s)** sends the `PUT /owners`.
- The **Program pane** lists the programs as single-select chips: outlined
  by default; clicking one stages it as the filled, deletable chip (its
  delete icon reverts to outlined). **Change Owner** sends the
  `POST /transfer`. Admins see every program; instructors only their own
  `program_ids` — the same boundary the backend 403s across.
- Assigning a program clears the `collection_owners` rows server-side —
  the pane hints at it while a chip is active. Clearing the program chip
  (revert to user ownership) is only confirmable when user owners survive
  — the backend's orphan guard would 422 otherwise; likewise an empty
  user selection is only confirmable while a program owner exists.
- Each pane commits only its own endpoint — one save, one call — and the
  confirm stays disabled until the staged value differs from the current
  owners.
- Rejections surface inline via `userMessage`: 403 (outside your
  authority), 409 (stale `version` — "modified by another user"), 422
  (invalid/inactive target or orphaning).

Versions are resolved by `useCollectionsData.saveOwners` / `.transfer`,
which serialize with reorder/viewport saves through the shared mutation
queue and fetch the freshest record first when the collection is not the
open detail (e.g. card-level reassignment). A saved row that no longer
matches the current filters — reassigned away under **My collections**, or
adopted out of **No owner (orphaned)** — leaves the list.

**Detail header.** The owner line reads "Managed by …" for both management
styles (#1567) — "Managed by program _X_" for program-owned collections and
"Managed by _A, B_" for user-owned ones (names joined via
`describeCollectionOwners`) — with _No owner_ left bare for orphans. The
`canTransfer` owners affordance beside it is the transfer-horizontal
(`SwapHoriz`) icon, not a pencil. The line sits beside the visibility
chip and — for `restricted` — a chip per attached program and group using
the shared group-chip palette.

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
  stale version 409, version increment), staff student-parity (owner edit /
  sole-owner scope + delete / co-owner and owner-management 403s) and
  orphan handling (admin reassign
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
  Collections sub-menu (Sequence / Synchronized) for every role (desktop +
  compact drawer), Manage → Collections for non-students, and hidden for
  every role when `collectionsEnabled` is false.
- Per-type pages + manage table (#1554): `CollectionsPage.test.tsx`
  (locked `collectionPageType`, header filters, edit-dialog delete flow),
  `CollectionCard.test.tsx` (title-row type icon, Move/Owners overlay,
  non-propagating actions, no delete affordance),
  `CollectionEditDialog.test.tsx` (delete arm/confirm/failure, category
  picker save + hide link, #1566),
  `ManageCollectionsPage.test.tsx` (unfiltered fetch, facets/sort, row
  actions on `permissions`, no row Move, breadcrumb navigation,
  categories-change refetch), `App.test.tsx` (`collectionPageType` state,
  `?type=` emit/parse, detail→type sync, `manage-collections` gate).
- Feature flag: `backend/tests/test_database.py` (`COLLECTIONS_ENABLED`
  default / env parsing), `test_router_collections.py` (router-wide
  `require_collections_enabled` dependency, 404 when off), `test_main.py`
  (`GET /api/features`); `frontend/tests/useFeatures.test.ts`,
  `api.test.ts` (`fetchFeatures`), `App.test.tsx` (shell flag prop, deep-link
  fallback to browse when off, failed `/api/features` treated as off).
- `frontend/tests/useShareableImageState.test.ts`,
  `useNavigationHistory.test.ts`, `App.test.tsx` — `?collection={id}` and
  `?collection={id}&item={image_id}` parse/emit precedence, `?type=` on
  collections-page URLs (default `sequence`), history entries,
  deep-link restore on load and back/forward, `?item=` alone ignored.
- Header + hidden-state rework (#1559, #1564): `AppShell.test.tsx` (Collections
  tab opens the menu without `onTabChange`; menu items navigate; active
  type MenuItem selected), `CollectionsPage.test.tsx` (`Home`/category
  breadcrumb navigation, name + `(N images)` count as the breadcrumb's
  trailing item, actions share the breadcrumb row, type/visibility pills
  above the description, Manage Images button wiring for editable detail,
  Hidden
  chip + Hide/Show link on
  `canHide`, `onToggleHidden` call + error surface),
  `CollectionManageDialog.test.tsx` (member grid, drag reorder, no-target
  drop no-op, add/remove callbacks, selection-mode bulk removal),
  `CollectionCard.test.tsx` (type icon left of the title, actions overlay,
  hidden indicator), `useCollectionsData.test.ts`
  (`setHidden` PATCH + 409 merge), `App.test.tsx` (`onNavigateCategory` /
  `onToggleHidden` wiring); backend `test_router_collections.py` (hidden
  list/detail visibility per role and owner, hidden-only PATCH authority,
  mixed-body 403, `can_hide` serialization), `test_router_collections_db.py`
  (hidden column round-trip, migration `0033`).
- Browse tile integration (#1529, #1583): `useBrowseData.test.ts` (nested
  filed collections from the tree, no root unfiled fetch/tiles for any role,
  flag-off no-fetch and freshness), `SortableTileGrid.test.tsx` (`col-` tiles, drag dispatch to
  reorder vs `onDropCollectionOnCategory`), `useCategoryActions.test.ts`
  (collection move/undo, no-op destination, no unfiled root lookup),
  `MoveCollectionDialog.test.tsx`, `CollectionsPage.test.tsx` (edit-dialog
  category change → move wiring, browse-context close, all-restricted
  notice),
  `useCollectionsData.test.ts` (`move` row/detail sync),
  `CategoryTile.test.tsx` (recursive collection counts), viewer tests
  (all-restricted empty state); backend `test_router_collections.py`
  (`member_count` on `CollectionOut`, absent from summaries).
- `frontend/tests/components/SequenceCollectionViewer.test.tsx`,
  `CollectionManageDialog.test.tsx`,
  `useCollectionsData.test.ts` (#1416, #1566) — position readout, `?item=` restore
  and non-member fallback, button / thumbnail / arrow-key navigation,
  editable-target key guard, read-only `ImageViewer` props
  (annotations / overlays / measurement from `metadataExtra`), tile-renewal
  forwarding, mid-session failure skip + all-failed state, hidden-prop
  filmstrip desaturation; the Manage dialog covers `move()` reorder →
  `PUT` with version, optimistic order in
  `detail`, rollback on error, corner-control removal, `renewCollectionImage`
  member swap.
- `frontend/tests/components/SynchronizedCollectionViewer.test.tsx`,
  `useCollectionsData.test.ts` (#1417, #1561, #1564) — two-pane render with
  read-only props, `viewport-change` mirroring with the saved offset in both
  directions, no write-back/oscillation, leader→followers mirroring and
  per-pane offsets for three/four panes, per-pane link toggles (default
  linked, unlinked leader/follower detachment, re-link re-arms at current
  positions), Save view payload for all panes, Restore gated on a saved
  view, portrait
  hint, `< 2`
  fallback + "Showing _N_ of _M_" over the four-pane cap, member failure
  slide-up, editor-only Save;
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
  `useAddToCollection.test.tsx`, `App.test.tsx` (#1418, #1567) — collection results
  on name/description, Collections chip field scoping, `?collection={id}`
  navigation, collections visible under `suppressExtendedResults`, picker-only
  select layer (`initialSelectMode` + handler required — normal search never
  shows it), image and category-subtree checkboxes, pin/direct provenance
  under overlap, Select-all coverage, result-order payload, Clear/close reset,
  footer Cancel/Add layout, `useVisibleCollections` keeping
  non-editable rows, dialog plumbing with the multi-selected ids.
- `frontend/tests/components/CollectionOwnersDialog.test.tsx`,
  `CollectionsPage.test.tsx`, `CollectionCard.test.tsx`,
  `useCollectionsData.test.ts`, `api.test.ts`, `App.test.tsx` (#1419, #1531) —
  user-owner autocomplete + chip removal, program select narrowing for
  instructors, program-select disabling the user picker, orphan-guard and
  403/409/422 inline errors; `canTransfer` affordances on cards and the
  detail header, plural "Managed by …" / `No owner` descriptions,
  restricted scope chips, admin orphan reassignment; the `saveOwners` /
  `transfer` hooks' version resolution (open detail vs fetched),
  mutation-queue serialization behind a reorder, filtered-list removal, and
  error propagation; and the `PUT /owners` + `POST /transfer` request bodies.
