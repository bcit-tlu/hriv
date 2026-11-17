# Inuksuks and Boards

Inuksuks bookmark an image's exact viewport coordinates, zoom, and rotation.
Boards curate shared Inuksuks into ordered studies. Migration
`0046_inuksuks_and_boards` introduces the additive schema; thumbnails and
read access follow in #1767/#1768, with creation and UI in subsequent issues
of epic #1765.
See the [domain model](domain-model.md) for fields and deletion rules.

## Feature flag (`INUKSUKS_ENABLED`)

- Backend `Settings.inuksuks_enabled` reads `INUKSUKS_ENABLED`, default
  `false`. `GET /api/features` exposes `inuksuks: bool`.
- Pure ASGI `InuksuksFeatureMiddleware` returns `404 {"detail":"Not Found"}`
  for `/api/boards`, `/api/inuksuks`, and their slash-delimited descendants
  while disabled, before authentication or body parsing. Maintenance takes
  precedence (503). Other paths and non-HTTP scopes pass through.
- `require_inuksuks_enabled` in `app/inuksuks.py` is the secondary
  router-level dependency for subsequent routers. Enabling the flag alone
  exposes the read and write endpoints below.
- Helm `inuksuks.enabled: false` renders `INUKSUKS_ENABLED` on the API
  Deployment. Enable it explicitly in deployment overlays for incremental
  testing; leave it off elsewhere until the epic ships.
- Docker Compose defaults `INUKSUKS_ENABLED=true` for local development;
  override it with `INUKSUKS_ENABLED=false` to exercise the dark-launch gate.

## Verification

`backend/tests/test_inuksuks.py` covers metadata and pre-parser feature gating;
`backend/tests/test_inuksuks_db.py` uses `TEST_DATABASE_URL` against migrated
PostgreSQL for cascades and user-deletion cleanup.

## Settled access model

Every Inuksuk belongs to at least one Board. Boards follow Collections
visibility: admins, instructors, and staff see all; students see their own,
public, and restricted Boards that pass both program and group gates.
An Inuksuk requires a visible image; students additionally must own the
Inuksuk or see at least one of its Boards. Non-students can view all
Inuksuks. The read API enforces these rules; the thumbnail generator itself
does not perform authorization or create endpoints.

## Viewport thumbnails

`app.inuksuk_thumbs.generate_inuksuk_thumbnail(image, inuksuk_id, x, y, zoom,
rotation)` is synchronous CPU-bound pyvips work, suitable for
`asyncio.to_thread`. It reads a local `/api/tiles/<source_id>/image.dzi`
pyramid, reuses the counting stitcher's level planner and tile compositing,
and writes `TILES_DIR/<source_id>/inuksuks/<inuksuk_id>.jpg`: 320×240 JPEG,
quality 82. Its return value is the relative API URL
`/api/tiles/<source_id>/inuksuks/<inuksuk_id>.jpg` for `Inuksuk.thumb`.
Missing or external pyramids return `None`; callers fall back to `Image.thumb`.
Malformed manifests and missing intersecting tiles raise rather than silently
substituting unrelated content.

Both viewport axes use image width: the centre is `(x*W, y*W)` and the
4:3 window has full-resolution width `W/zoom`. The coarsest DZI level
still providing at least 320 crop pixels is selected (full resolution if
necessary). Out-of-bounds space is padded, never shifted inward, with
`#212121`, matching the viewer container's MUI `grey.900` background.
For clockwise OSD rotations the pre-crop is a square expanded by √2 of
the window's longer side; this also avoids clipping the 4:3 rectangle
at arbitrary angles. Invalid/nonfinite geometry and excessive decode
sizes raise `ValueError`. The shared 25-million-pixel guard applies.
Writes use a unique temporary JPEG and atomic replacement.

Use `append_inuksuk_thumb_token(url)` when serializing these URLs after
image and Board visibility checks. It derives the Inuksuk id from the URL
and mints `purpose="thumb"` with an integer `iid` claim, using
`issue_inuksuk_thumb_token(source_image_id, inuksuk_id)`. This token
authorizes only `inuksuks/<iid>.jpg` within that source image: not another
Inuksuk, `thumbnail.jpeg`, or DZI tiles. Plain `append_thumb_token`
tokens remain limited to `thumbnail.jpeg`, so hidden card-cover tokens
cannot reveal zoomed regions. The nginx verdict cache includes the exact
normalized URI for Inuksuk paths, preventing cached authorization from
crossing Inuksuk ids; the `tiles` class remains shared.

`remove_inuksuk_thumbnail` is the helper for future Inuksuk-delete routers.
Single/bulk image deletion removes the `inuksuks/` directory after commit.
Successful image replacement deletes the old image's Inuksuk records and
removes the old thumbnails only after commit; failed replacement preserves
both. Neither cleanup helper removes source tiles or whole-image thumbnails.

The API container already mounts `tiles-data` at `/data/tiles` when chart
persistence is enabled, with `TILES_DIR` supplied from chart values. No
mount change is needed for future API-side generation; generation is not
wired to create and geometry-update endpoints in #1769.

`backend/tests/test_inuksuk_thumbs.py` covers geometry, synthetic clockwise
rotation, padding, missing/corrupt tiles, and file lifecycle.

## Read API (#1768)

All four reads require an authenticated user and `INUKSUKS_ENABLED=true`.
The Board/Inuksuk routers use both the middleware and router dependency;
the image drawer route explicitly applies `require_inuksuks_enabled`
because it lives outside those middleware path prefixes. Flag-off returns
404 even before authentication.

| Endpoint                        | Response                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /api/boards`               | Visible Board summaries with owners, scope ids, permissions, visible `inuksuk_count` and cover thumbnail |
| `GET /api/boards/{id}`          | Board summary plus visible `inuksuks` in per-Board `sort_order`                                          |
| `GET /api/inuksuks`             | Visible Inuksuks, with owners, permissions, source tag and only their visible `board_ids`                |
| `GET /api/images/{id}/inuksuks` | Drawer items tagged `mine`, `instructor`, or `public`, once each                                         |

Admins, instructors and staff see all Boards, including private Boards.
Students see Boards they own/co-own, public Boards, and restricted Boards
passing **both** the program and group gates; empty restrictions on a
dimension mean unrestricted. An invisible or nonexistent Board detail
(or explicit `board_id` filter) is 404, never 403.

Inuksuks require an **active image for students only**, matching image reads.
Students also pass the image category's inherited program/group/hidden-subtree gates,
even when they own the Inuksuk or it is on a public Board. With that image
gate satisfied, students need ownership of the Inuksuk or a visible Board
containing it; non-students need no further gate. This owner exception
permits an owner to retain access even if all its Boards are private to
someone else. `board_ids` never discloses those private Boards.
The drawer returns 404 for an invisible or nonexistent image.

Source tags have strict precedence:

1. `mine`: the caller is an Inuksuk owner.
2. `instructor`: a **visible** containing Board has an instructor/admin
   owner or an `owner_program`.
3. `public`: another user's Inuksuk is on a public Board.

Other visible Inuksuks have `source: null` in the Organize list and remain
reachable through Boards, but are omitted from the drawer. For example,
staff can see a student's private/restricted Board without its Inuksuks
appearing in the drawer. Drawer order is source precedence, then
Inuksuk `sort_order`, then id.

### Filtering, ordering and conditional requests

Board list search `q` is a case-insensitive literal substring of name,
description or owner label. `visibility` may be repeated. Board sorts:
`id`, `name`, `description`, `visibility`, `owner`, `inuksuk_count`,
`sort_order`, `created_at`, `updated_at`.

Inuksuk list filters: `board_id`, `image_id`, `favourite`,
and `scope=mine|instructor|public` (using the same precedence as drawer tags).
Board membership filters only match visible Boards. `q` searches
title/description. Inuksuk sorts: `id`, `title`, `description`,
`image_id`, `favourite`, `sort_order`, `created_at`, `updated_at`.

Both lists accept `order=asc|desc` (or Collections-compatible `direction`).
The default is `sort=updated_at` descending; text and explicit
`sort_order` sorts default ascending, magnitude/recency sorts descending.
Ties use id in the same direction. Filtering precedes pagination.
`page` requires `page_size` (1–200); `page_size` alone means page 1.
`limit` (1–100) cannot be combined with page parameters. Bad filters,
sorts or paging combinations return 422. Lists expose pre-slice
`X-Total-Count`; results are arrays, including empty arrays.

Reads carry weak content-derived ETags, `Cache-Control: private, no-cache`,
and support comma-separated/weak/strong `If-None-Match` comparison and
`*` for 304. Unlike Collections' revision shortcut, these are computed
after loading and filtering, so image/owner/scope changes cannot leave a
stale authorization result even before #1769 introduces write endpoints.
The fingerprint includes viewer memberships, query, filtered content,
total count and a token-TTL epoch. Token strings are excluded from the
content hash; the epoch forces renewal before cached thumbnail tokens
expire. Board membership, images and owners/scopes are eager-loaded in
batches, not queried per item.

### Capability predicates for upcoming writes

Board predicates reuse Collections' rules: admins manage all; instructors
edit/change scope/delete/transfer when owners/co-owners or members of the
owning program. Students/staff edit their own/co-owned Boards, but may
change scope/delete only as sole user-owner with no program owner, and
cannot transfer. Inuksuk edit/delete is granted to admins or any user-owner
(including co-owners); merely viewing an instructor/public Board does not
grant edit authority over someone else's Inuksuks. Permissions in read
responses are UX hints, not a substitute for checking future mutations.

Every thumbnail projection, including Board covers, uses only
`append_inuksuk_thumb_token` for a saved crop and `append_thumb_token`
for the image-thumbnail fallback, after image visibility checks.
No read projection issues a full tile token.

Verification: `test_board_authz.py` covers the role × visibility × dual-gate
and capability matrices; `test_board_reads.py` exercises PostgreSQL reads,
hidden/inactive image exclusion, drawer precedence, filtering/paging,
ETags, flag-off paths and token scoping.

## Write API (#1769)

All writes share the feature gate and authenticated-user dependency of the
read routers. Visibility is checked before authority: invisible ids return
404, visible resources the caller cannot edit return 403. Read projections
and permission fields are reused in write responses.

| Endpoint                                        | Body / result                                                                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/boards`                              | `name`, optional `description`, `visibility`, `program_ids`, `group_ids`; 201 Board detail                                        |
| `PATCH /api/boards/{id}`                        | Same editable fields plus concurrency token; Board detail                                                                         |
| `DELETE /api/boards/{id}`                       | Concurrency header; 204, deletes orphaned Inuksuks and derived files                                                              |
| `PUT /api/boards/order`                         | `items: [{board_id, version}]`; ordered Board details                                                                             |
| `PUT /api/boards/{id}/owners`                   | `user_ids` and token; Board detail                                                                                                |
| `POST /api/boards/{id}/transfer`                | Required nullable `program_id` and token; Board detail                                                                            |
| `POST /api/inuksuks`                            | `image_id`, `title`, `x`, `y`, `zoom`, nonempty `board_assignments`; optional `description`, `rotation`, `favourite`; 201 Inuksuk |
| `PATCH /api/inuksuks/{id}`                      | Mutable create fields except `image_id`, plus token; Inuksuk                                                                      |
| `DELETE /api/inuksuks/{id}`                     | Concurrency header; 204 and thumbnail cleanup                                                                                     |
| `PUT /api/inuksuks/order`                       | `items: [{inuksuk_id, version}]`; ordered Inuksuks                                                                                |
| `PUT /api/inuksuks/{id}/owners`                 | Nonempty active-user `user_ids` and token; Inuksuk                                                                                |
| `PUT /api/boards/{id}/inuksuks/order`           | `items: [{inuksuk_id}]`, parent token; Board detail                                                                               |
| `DELETE /api/boards/{id}/inuksuks/{inuksuk_id}` | Parent concurrency header; Board detail                                                                                           |

Every Inuksuk must have at least one Board link. Missing/empty
`board_assignments` on create is 422. Assignments contain `board_id` and
optional `sort_order`; new links
append by default. Duplicate Board assignments are 422. Every submitted
Board must be visible and editable.
Create checks image visibility using the same context as the drawer.
Coordinates/rotation must be finite; zoom must be positive.

An Inuksuk editor's assignment PATCH replaces **only editable-Board links**.
Uneditable-Board links retain their order unchanged, even if
omitted. An empty replacement is accepted only if such retained links keep
the Inuksuk on at least one Board; otherwise it is 422. Explicitly submitting
an uneditable Board is 403 (404 if invisible). Board editors can reorder or
remove someone else's Inuksuk from their own Board without gaining edit
authority over the Inuksuk itself. Board removal returns 422 for the last
link. Deleting a Board instead deletes any newly orphaned Inuksuks and cleans
their files after commit; shared Inuksuks and their thumbnails survive.

Board member reorder submits every **visible** member once. Invisible
members are preserved and appended, like hidden image retention in
Collections. Global Board/Inuksuk order endpoints update only the listed
editable rows, assigning zero-based order in submitted sequence. Empty
reorder lists are valid no-ops.

### Write concurrency, ownership and lifecycle

PATCH, owners, transfer and Board-member mutations require
an integer `version` in the body or `If-Match: "<version>"`. DELETE uses the
header. Missing both returns **428**, malformed/conflicting header/body tokens
return 400, and atomic CAS mismatch returns **409** with the current read
projection in `detail`. Success returns the new integer version as the ETag.
Multi-row global reorder uses each item's `version`.
Board-member reorder checks the version before validating the
submitted membership list: a stale list returns 409 with the current Board,
while an invalid list at the current version returns 422 without mutation.
Collections currently requires body `version`; these endpoints retain that
format while also implementing the explicit If-Match/428 contract.

Board content, scope, deletion and transfer predicates remain the read API's
capabilities. Creating/changing restricted scope requires admin/instructor;
new program attachments require membership for instructors, and new group
attachments require instructor co-ownership of the group. Existing scope
may be retained/narrowed like Collections. Leaving restricted clears scope.
Board owners PUT uses Collections' transfer authority and active-user
validation; an empty owner set requires an owning program. Program transfer
clears user owners; clearing program ownership requires user owners to remain.
Inuksuk owners PUT requires Inuksuk edit authority and cannot remove all
owners. Students may own at most 10 Boards and 200 Inuksuks, including
co-ownership and owner additions; excess ownership is 422. Other roles have
no cap.

Writes lock Boards in id order before affected Inuksuks, recheck visibility
and edit authority, and use atomic version updates. A new parent linked
during graph-lock acquisition is 409 and must be retried. Student quota
checks lock target owners before resource locks. Membership changes advance
the affected aggregate versions. Mutations bump browse revision and are
covered by the existing HTTP audit middleware plus mutation logs.

Create and geometry PATCH take a shared Image row lock before Board and
Inuksuk locks; image replacement takes an exclusive Image row lock before
deleting the old Inuksuks. The geometry read and write therefore serialize
with replacement rather than inserting bookmarks into its deletion window.

The shared membership revision helper invalidates every affected Board on
assignment changes, Inuksuk deletion, user cleanup and image replacement or
deletion (before links cascade away). Old Board versions then return 409,
including when membership changes through an image endpoint rather than a
Board endpoint. Orphan deletion has no surviving membership to invalidate.

After create commits (id known), or a committed geometry change, thumbnail
generation runs through `asyncio.to_thread`. It rechecks the Inuksuk version
under a row lock so a stale generator cannot overwrite a newer edit or
resurrect a deleted record. Geometry changes clear the old reference; the
old crop is removed/replaced. Missing pyramids or generation failures are
logged and leave `thumb=null`, so reads use the plain image-thumb fallback
without failing the successful write. Inuksuk/Board orphan deletion removes
files only after commit, with cleanup failures logged.

Single/bulk user deletion applies the same invariant: deleted sole-owned Boards
also delete newly orphaned Inuksuks owned by surviving users. Co-owned and
program-owned Boards survive; solely departing-user-owned Inuksuks are deleted
even on surviving Boards. Their thumbnail cleanup is deferred until commit.

`test_board_writes.py` exercises PostgreSQL CRUD, role gates, CAS/428,
assignments/reorder, ownership/caps, real thumbnail generation,
fallback and deletion, commit-failure file preservation and replacement.
`test_inuksuk_thumbs.py` also checks replacement rollback cleanup boundaries.

## ImageViewer frontend (#1772)

The SPA reads `features.inuksuks` from `GET /api/features`, defaulting to
false for missing flags or failed requests. When off, the viewer mounts no
Inuksuk controls, markers or dialogs and makes no Inuksuk requests. This
applies to regular, sequence and synchronized viewers. Boards-page navigation
and the source-group drawer remain separate follow-ups (#1771 and #1773).

The bottom-left **Add Inuksuk** compass arms single-click placement. It
disarms selection and presentation tools, exits canvas editing through its
existing dirty-draft/discard flow, and captures OSD viewport x/y, zoom and
rotation without converting to image pixels. Placement stays armed after saving;
toggle the compass or press Escape without a draft to disarm it. Normal drag,
scroll and pinch navigation remain available. Only OSD quick clicks/taps place.
A preview marker and non-modal **Add Inuksuk** panel appear immediately at the
top-right. Title is selected for typing; choose a required Board (the last used
editable Board is remembered and visible before opening the menu), or create one inline.
Description is under collapsed **More options**; Favourite is a tooltip-labelled
outlined/filled star toggle at the title row's right with `aria-pressed`.
Save keeps placement armed; Cancel or
Escape removes the draft first. Only one unsaved placement is open at a time.
If a new point would sit beneath the panel, the viewer pans it clear of the panel.

`InuksukMarkersLayer` portals into `viewer.container` under
`data-hriv-canvas-ui`, independently of Fabric. White circular discs with vibrant
blue compass glyphs are 27 CSS pixels and titles use 13-pixel text; neither scales nor rotates with the image.
Saved and draft markers share `frontend/public/inuksuk-marker.svg`, with a subtle
contrast ring and shadow. Title-label styling is unchanged.
The layer reprojects anchors on animation, animation-finish, open, resize,
rotate and flip. Each marker accepts independent `markerVisible` and
`labelVisible` props, both true by default: labels may remain visible when
markers are hidden. The drawer's shared visibility preferences drive the
viewer layer directly, without separate viewer-level overrides. Clicking a marker smoothly restores its
saved pan/zoom/rotation, highlights it and opens a non-modal information card.
The card shows title, optional description, visible Board names and favourite
state. It has no close X: outside pointer presses deselect and dismiss it; Escape
also closes it. Other marker presses select that marker instead. Only authorized
editors see the pencil, which turns the card itself into the OCC-protected edit
form (title, description, Boards, favourite star, Save changes/Cancel and permitted
confirmed Delete). Drawer row Edit selects/pans to the Inuksuk, focuses its row and
opens that same in-place editor, not a central dialog. Cancel restores view mode.
Outside presses keep the editor open, whether changed or not; other markers/rows
do not replace an open editor. Use Save/Cancel or explicit Escape (cancel and close)
first. Clicks within the portalled Boards menu never discard the edit. This applies
to single-image, Sequence and Synchronized viewers; BoardsPage keeps its modal editor.

Flip remains a presentation setting, not a saved coordinate transform.
Placement unmirrors screen x before converting to viewport coordinates;
markers mirror the projected screen x around the canvas width. This follows
the count-outlines layer's handling of OSD's flip-unaware pixel conversions,
so saved points keep referring to the same image feature with flip on or off.

The image endpoint is the sole viewer marker source, retaining the backend's
`mine > instructor > public` tags and thumbnail fallbacks. The viewer reloads
it after successful create/edit/delete and discards responses for old images.
Read failures are shown in the viewer rather than silently implying no saved
views. The typed API client also covers all Board, membership,
ownership, transfer and global-order writes for #1771; deletes use If-Match,
other mutations send body versions.

`InuksukFormDialog` requires a nonblank title and at least one editable Board.
The multi-picker only lists `permissions.can_edit` Boards. Selected Boards retain their existing membership when editing. Other Boards' links are preserved by the backend assignment
contract. The searchable checkbox menu sorts names case-insensitively, with stable
ID ties. There are no selected chips: its closed field shows names as text (first
two, then `+N`). **+ New Board…** is always pinned first, without typing; an unmatched
query offers **+ Create Board "text"**. Choosing it creates and selects a private,
name-only Board; an empty query prompts inline for a name. The former separate
create link is removed. The last successfully used Board is remembered under the user-scoped
`hrivpref:inuksuk:lastBoard:<userId>` localStorage key, validated against the
editable list on the next create; blocked storage is optional, not an error.

Title, description, favourite and Board assignments are editable according
to API permissions; other viewers get read-only details. Delete requires
confirmation. Edits/deletes send the opened version. A 409 preserves local
fields and offers **Reload current**, replacing them with the authoritative
projection and new version before retry. The form stays inside the OSD
container for full-page mode. Backend caps and permission failures surface
inline without closing it. Crops and source-thumb fallbacks remain server
responsibilities; the frontend never mints tile tokens.

If existing Board assignments cannot be loaded, saving an edit is blocked
even after an inline Board is created. Close and reopen the dialog to retry;
an incomplete assignment list must never replace the existing links.

Frontend verification: `inuksukApi.test.ts`, `useImageInuksuks.test.ts`,
`useFeatures.test.ts`, `ImageViewer.test.tsx`,
`InuksukMarkersLayer.test.tsx` and `InuksukFormDialog.test.tsx`.
Both new components have attached Storybook docs and deterministic stories;
the marker stories exercise the real viewer with fixture API responses.

### Inuksuks drawer (#1773)

The feature-gated CompassCalibration trigger lives in an OSD **TOP_LEFT** control,
participates in auto-fade, and keeps keyboard-focused controls visible. Its white
glyph and dark translucent background match adjacent OSD controls, without a badge. The
left-anchored panel and its dialogs are portaled into the viewer, including in
OSD full-page mode. It reuses `useImageInuksuks`; opening the drawer does not
issue another image request.

**My Inuksuks**, **Instructor Inuksuks**, and **Public Inuksuks** follow the API's
source tags and precedence. Empty source groups are hidden rather than showing
unusable controls. My and Instructor start expanded; Public starts
collapsed. Row selection smoothly restores saved pan, zoom and rotation and
highlights the marker without opening the form. The separate edit action uses
API `permissions.can_edit` and opens the existing OCC-protected form.

Marker and label menu actions are independent at both row and group levels;
both default to shown. Group actions set the default for the entire source and
clear all row overrides for that dimension, including cached rows on other
images. A subsequent row action overrides that default. Mixed states remain
accessible in group menus; toggling a mixed group shows all. Changing markers never
changes labels, or vice versa. Shared preferences are the viewer's single source
of visibility state, so drawer controls always reflect the rendered markers and
labels. Collection embeds use the same preferences rather than external overrides.
Rows show titles only. Their **⋮** menus start with Show/Hide marker, followed by
Show/Hide label and permitted Edit/Delete actions; group menus offer Show/Hide
markers and labels. Hidden-marker row titles use `text.disabled` (contrast-safe
`text.secondary` in light mode, since the row is still navigable) and an accessible
“marker hidden” suffix. The drawer stops above
the bottom toolbar so tools remain usable. Unsaved placements also appear under
My Inuksuks with an **Unsaved** status while the draft is open.
Row hover backgrounds extend across the drawer, including the independent
options control, without nesting interactive elements.

The Pin/Unpin control mirrors `MyCollectionsDrawer.tsx`: a selected filled pin,
no close button while pinned, and unpinning leaves the panel open. Both drawers
use `usePinnedDrawerState` (via `useMyCollectionsDrawerState` for collections).
Inuksuks persist `hrivpref:inuksuks-drawer:pinned:user:<id>`, matching collections'
`hrivpref:my-collections-drawer:pinned:user:<id>` pattern; anonymous previews use
`anonymous`. Pinned drawers stay open across image/sequence navigation and new
viewer pages. Unpinned drawers close immediately on any outside press/click,
including OSD canvas presses, without consuming the event: placement still works.
Menu content is inside for click-away purposes; its viewer portal container stays
stable through exit. Unlike collections' backdrop, this non-blocking listener
allows the underlying image interaction to continue.

Preferences use `hriv.inuksukVisibility.<userId>`. Parsing validates the shape
and defaults corrupt values safely; at most 500 recently changed row overrides
are retained. A source change invalidates an old source-specific row override.
Mounted synchronized panes share changes immediately, and browser tabs observe
storage events. Storage failures fall back to memory; anonymous previews use
memory only. Switching users selects a different preference key immediately.

Each embedded viewer has unique drawer/control IDs. Sequence edge-navigation
arrows hide while the drawer is open, avoiding controls over its rows; filmstrip
and caption navigation remain available. Synchronized panes keep independent
open/selected state while sharing user visibility preferences, and reserve the
rightmost 48px for existing controls. Errors appear below the top-left trigger
and inside the drawer. Escape/Close restores focus to the trigger in unpinned mode;
pinned panels ignore Escape and outside presses.

Tests: `useInuksukVisibilityPrefs.test.ts`, `ImageInuksuksDrawer.test.tsx`,
`ImageViewer.test.tsx`, and collection-viewer tests. Attached drawer stories
cover expanded/collapsed groups, label-only visibility, sequence and synchronized
embeds with deterministic API fixtures.

### Boards page (#1771)

`GET /api/inuksuks/{id}` provides a fresh, visibility-filtered `InuksukOut`
for membership edits and thumbnail renewal. It uses the list's image and
ownership/visible-Board gates, returning 404 for missing or invisible items.
Only visible Board IDs are projected; thumbnails carry thumbnail-only tokens.
The response uses viewer-bound, token-epoch ETags and supports conditional 304s.

The feature-gated **Boards & Inuksuks** AppBar utility opens `?page=boards`.
It does not add a primary tab: students retain two mobile navigation tabs, and
Boards uses `Tabs value={false}`. Selecting a Board writes
`?page=boards&board={id}`; Back/Forward restores the selection.
The same flag gates direct links and all page requests.
Frontend telemetry preserves `boards` in both page and from-page dimensions.

The overview has one short, horizontally scrolling row of outlined, rounded Board chips,
starting with **New Board**. Owned Boards share that row, with a flush-left square
Board cover (or a renewing member thumbnail, then the themed placeholder) and a
single-line name. The **My Boards** heading shares Collections' unpadded flex header.
An outlined **Public & shared Boards** button sits at its right, above the Board row.
Admins, instructors and staff also have an outlined **All Boards** button beside it;
students never see All Boards.
Only the page heading changes; the Boards & Inuksuks navigation label remains unchanged.
Below it, **My Inuksuks** contains Collections-style Cards/Table controls and then
the filter bar. There is no Graph view. Only personally owned Inuksuks appear; both lists are
fetched in pages of 200 without the former recent-60 cap.
The overview's outlined Select button is right-aligned on the Filter by row in both views.
Each card shows the
image's parent category below its title (`category_name`, null if unfiled).
The heading uses the same h5/h1 typography as Collections. Inuksuk cards are 234px
wide (20% wider than the previous 195px), with proportionally scaled 96px covers,
including inside Board dialogs. They reuse Collections' scope-pill component.
The compass replaces the collection icon; category replaces the image count, with
Uncategorized as the fallback. Top-right actions are Favourite (Star/StarBorder,
in Collections' Set cover position) and Move/Save. The title-row pencil opens the
existing edit dialog, including Delete and, for Board editors, Remove from this Board.
Card clicks still open the exact saved view. There is no per-card overflow or drag glyph.
Table uses the same filters, permissions and actions, with Title, Category, Scope,
Boards (navigable), Favourite and Actions columns. Scope shows each distinct visible
Board visibility when a view belongs to Boards with different scopes. View choice
is local to the page mount and starts on Cards.
**Public & shared Boards** opens a separate dialog listing server-authorized
Boards outside the chip row that are public, restricted by program/group, or shared
with the current user through co-ownership or program ownership/membership. Other
users' private Boards are excluded for every role. **All Boards** lists every Board
returned by the backend for admins, instructors and staff, including others' private Boards
and editable owned Boards already in the chip row. Both dialogs render clickable
tiles with title, the shared scope pill and the Collections-style **Managed by** owner
line (program names, co-owner names, or No owner), using the existing API owner data.
Selecting a tile closes the list and opens the existing
Board dialog; overview filters do not narrow this discovery list. Program-owned
Boards retain the existing program-membership ownership rules. Backend visibility
remains authoritative; this overview separation is not an authorization boundary.
The frontend neither expands nor changes backend Board visibility. Discovery is UX
scoping, not a privacy/security boundary; All Boards adds no new API permissions.
The field uses the existing image visibility gate and eagerly loaded category.
Collections' filter components provide title/description search, Private /
Restricted / Public scope, owner/Mine, and Favourite filters on both surfaces.
An Inuksuk matches any visible Board membership of the selected scopes. A Board
matches Favourite if it holds a favourite Inuksuk. Active filters have removable
chips and a Clear filters action. Select sits at the right of the collage toolbar.
Opening a Board shows all authorized members, independent of overview filters,
in a large dialog, full-screen on mobile. Its fixed heading keeps the title,
editable-only pencil, count and Select visible while members scroll. The exact
Collections scope pill sits beside the Managed by owner line; its transfer icon
opens owner management for users with `can_transfer`. An outlined Create Sequence
Collection button sits immediately left of Close, disabled for an empty Board.
There is no Board overflow menu. Delete Board is at the bottom of Edit Board, like
Delete Collection, and requires a second confirmation before deleting orphaned
Inuksuks. Delete uses the form's Board version and explicit 409 reload flow.
The URL retains `?board=`; Back closes the dialog, and Back from a saved-view
image returns to that Board dialog.

Board metadata defaults to private. Restricted scope reuses Collections'
attach rules: admins may attach any Program/Group, instructors only their own
Programs and managed Groups, while existing attachments can be removed.
`can_change_scope` gates the scope fields; metadata-only writes omit them.
Owners/transfer reuse the Collections picker via a Board adapter, and require
`can_transfer`. Both dialogs carry Board OCC versions and require explicit
reload on 409; reload replaces the staged draft with current server values.

The selected Board displays a flat, ordered collage of saved views.
The My Inuksuks overview instead sorts every fetched page together by case-insensitive
title, with numeric Inuksuk ID breaking ties. Favourite and membership changes do not
change that order; renames move only to their new alphabetical position.
Filled favourite stars are white on both cards and table rows. A contrasting
background keeps the white star legible, including read-only favourite indicators.
Dragging a member card reorders members within the Board, without a separate handle icon;
Board reorder applies only to editable owned Boards. Read-only program-owned
Boards remain available in Public & shared Boards rather than the chip row, for every role.
The chip row contains only editable owned Boards, without instructor/admin exemptions.
Non-editable Boards are omitted from reorder writes.
Board positions
are stored globally, not per user; only the complete editable-owned subset is
submitted on reorder. Board surface dragging is disabled while filters are active so a
filtered subset can never replace that complete order.
Editable Board chips drag by their surfaces with no grip icon; clicking still opens them.
These are isolated from Browse's
near/far-half collision rules; see [drag-and-drop.md](drag-and-drop.md#boards-page-1771).
Dragging an editable overview Inuksuk card onto another editable Board chip
highlights the target and **saves a copy of the link**, with a success snackbar.
Read-only Boards cannot accept saves. Rejected drops stay unhighlighted and explain
duplicate membership or missing edit permission in the page snackbar, without sending a mutation.
Drop notices reuse the app's bottom-centre Snackbar and filled Alert: green success
for a saved link, info for duplicate membership and warning for other refusals.
**Move/Save to…** also offers an explicit atomic move that removes the source link
in the same PATCH. Other editable Board links retain their positions; non-editable
links remain server-preserved. If any membership or
destination read fails, saving is blocked rather than sending a partial list.
Board editors can remove other owners' Inuksuks from their Board, but only
Inuksuk editors may save to another Board or edit/favourite the Inuksuk.

Board deletion confirms that otherwise orphaned Inuksuks will be deleted.
Removing one link instead surfaces the backend's last-Board 422 without deleting
the Inuksuk. Mutations refresh projections silently, keeping loaded cards and
Board covers mounted; refresh errors retain the last loaded data and show an error.
Creating a Board adds the returned Board locally before opening it. Opening or
closing a Board dialog fetches only its detail, not the overview; opening an
Inuksuk editor loads its Board picker without reloading the page.
Opening a card fetches the authorized image record and reuses the existing
`?image=&x=&y=&zoom=&rotation=` viewer/share mechanism, with an epoch guard
against late navigation. Browser Back returns to the Board entry.

Tests: `boardUtils.test.ts`, `useBoardsData.test.ts`, `BoardsPage.test.tsx`,
`BoardEditDialog.test.tsx`, `BoardOwnersDialog.test.tsx`, URL/history/App/AppShell
tests, and attached deterministic component stories, including keyboard reorder.

## Collection snapshots (#1770)

The gated Collection API can seed independent member slots from visible
Inuksuks or a Board. Each slot snapshots the title and viewport;
subsequent edits never write back to the source. Duplicate source images are
valid slots with independent identity. See [Collections](collections.md#collection-slots-1770-backend)
for payloads, compatibility and authorization.

Seeded JPEGs are copied atomically into `collection_slots/<slot-id>.jpg` beneath
the source tile root. Missing source JPEGs regenerate from the viewport using
the shared renderer with a separate destination namespace; unavailable tile
data leaves the thumb null for image-thumb fallback. The `slot_thumb` JWT
purpose binds `sid` plus the exact relative `path`; it cannot authorize tiles,
whole-image thumbs, Inuksuk thumbs or other slots. nginx isolates slot JPEG
auth verdicts by exact URI rather than its shared tile class. Cleanup follows
successful database commits. Image replacement invalidates slot geometry and
snapshots because the old coordinates no longer describe the new source.

## Collections from saved views (#1774)

Boards now offer a Select toolbar: any selected Inuksuks can seed a Sequence,
and 2–4 can seed a Synchronized Collection. Both reuse the existing collection
form and Add to Collection destination dialog. Board headers create
ordered Sequences directly through **Create Collection**, while the collection Manage dialog can stage a
Board into its draft.
The Board dialog title uses Collections-style h6 typography, with its Inuksuk count
in smaller secondary body2 text; the action still creates a Sequence Collection.
Selected views follow the displayed Board member order. Click order does not change
the resulting Collection sequence.

A Collection slot is an independent snapshot. Its crop, label and starting
coordinates survive independently of the original saved view; changing the
Collection view does not edit the Inuksuk. Multiple slots on one slide are
separate Sequence steps or side-by-side Synchronized panes. These controls and
slot writes require the Inuksuks feature flag.

## Search and recovery close-out (#1775)

Search now includes visible Boards and Inuksuks by title and description, using
the existing backend `q` endpoints and Board/Inuksuk visibility rules. Board results
deep-link to Boards; Inuksuk results reuse saved-view image navigation. In the
Manage Collection picker, choosing a Board or Inuksuk stages its views instead.

Admin DB archives include all saved-view tables and association records, independent
of `INUKSUKS_ENABLED`. Filesystem archives retain exact Inuksuk and Collection slot
JPEGs while continuing to omit derived DZI tiles. Same-source rebuilds preserve
these snapshots. See [Admin import/export](admin-import-export.md) for restore order
and [the user guide](../frontend/guide/inuksuks-and-boards.md) for the workflow.

The dark-launch flag remains in place: backend/Helm default false, existing local
compose default true. This close-out does not remove the flag or alter its defaults.

## Permanent viewer side panel

With `features.inuksuks`, the image page and Sequence viewer use a single right-side
panel instead of the earlier Details overlay and left Inuksuks drawer described
above. Its sidebar toggle opens/closes it; the header selects Inuksuks, Shared View or Details.
MUI rounded-square action states replace the prototype's navigation-rail pills.
There is no pin or click-away in this panel. At sm and above it reserves 256px by
resizing OSD's actual container, so the minimap, toolbar and sequence arrows stay
inside the image area. At xs it overlays the entire frame and closes via its toggle.

Open state and selected tab persist at `hrivpref:viewer-panel:user:<id>`; new users
start closed on Inuksuks. Anonymous viewers and unavailable storage use memory.
Placement and information cards stay over the image, offset from the closed toggle.
Starting placement with Details open selects Inuksuks; Escape still cancels drafts,
disarms placement and dismisses menus, but does not close this permanent panel.
Entering canvas annotation editing also leaves an already-open panel in place.
The existing visibility preferences, grouped menus and stable portal container remain.
All image-viewer consumers (single image, Sequence and Synchronized panes) display
only the endpoint's My and Instructor groups, for both lists and image markers.
Instructor grouping retains the existing instructor/admin or program-owned Board
classification. Other users' public/shared views are discovered through
Boards & Inuksuks → Public & shared Boards instead. This is frontend UX scoping;
the backend continues to serve authorized public Boards and their contents.

The link icon between Inuksuks and Details selects **Shared View**. **Copy current
view** reuses the image page's clipboard, fallback and feedback logic, replacing
the standalone Share View button only when this panel is enabled. Sequence's panel
copies an image link with the current zoom, centre, rotation and selection rectangles,
opening that specific view independently of the collection slot. Flag-off controls
and Synchronized per-pane sharing behavior are unchanged.

Flag-off viewers retain the original Details trigger/drawer unchanged. Synchronized
panes retain their independent Details and legacy Inuksuks drawers (including their
pin model); the My Collections drawer also retains its shared pin hook. The side
panel is attached inside OSD's root element so it survives full-page reparenting.
If browser storage is blocked, the per-user fallback survives viewer remounts in
the current session, including Sequence steps; it cannot survive a page reload.

## Viewer polish

After a successful creation, the new Inuksuk replaces the previous selection,
including its marker and information card. The viewer opens the Inuksuks tab (or
legacy drawer), expands the row's group, scrolls it into view and gives it keyboard
focus. Selection does not revert to the previous row; failed saves keep the draft.
The information card shows a read-only, named star immediately before Close,
without a visible Favourite/Not a favourite sentence. Edit still changes favourite.
Viewer panel rows, group labels, details and help now use caption typography,
matching the 12px page footer at the default scale. Titles and form inputs use
14px theme variants; small inputs and reduced spacing compact both Inuksuk forms.
Legacy flag-off Details retains its original sizing.
