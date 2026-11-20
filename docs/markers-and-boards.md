# Markers and Boards

Markers bookmark an image's exact viewport coordinates, zoom, and rotation.
Boards curate shared Markers into ordered studies. Migration
`0046_inuksuks_and_boards` introduces the additive schema; `0049_inuksuks_to_markers`
renames the tables, columns, indexes and persisted thumbnail paths to Marker.
Thumbnails and read access follow in #1767/#1768, with creation and UI in
subsequent issues of epic #1765.
See the [domain model](domain-model.md) for fields and deletion rules.

## Feature flag (`MARKERS_ENABLED`)

- Backend `Settings.markers_enabled` reads `MARKERS_ENABLED`, default
  `false`. `GET /api/features` exposes `markers: bool`.
- Pure ASGI `MarkersFeatureMiddleware` returns `404 {"detail":"Not Found"}`
  for `/api/boards`, `/api/markers`, and their slash-delimited descendants
  while disabled, before authentication or body parsing. Maintenance takes
  precedence (503). Other paths and non-HTTP scopes pass through.
- `require_markers_enabled` in `app/markers.py` is the secondary
  router-level dependency for subsequent routers. Enabling the flag alone
  exposes the read and write endpoints below.
- Helm `markers.enabled: false` renders `MARKERS_ENABLED` on the API
  Deployment. Enable it explicitly in deployment overlays for incremental
  testing; leave it off elsewhere until the epic ships.
- Docker Compose defaults `MARKERS_ENABLED=true` for local development;
  override it with `MARKERS_ENABLED=false` to exercise the dark-launch gate.

## Verification

`backend/tests/test_markers.py` covers metadata and pre-parser feature gating;
`backend/tests/test_markers_db.py` uses `TEST_DATABASE_URL` against migrated
PostgreSQL for cascades and user-deletion cleanup.

## Settled access model

Every Marker belongs to at least one Board. Boards follow Collections
visibility: admins, instructors, and staff see all; students see their own,
public, and restricted Boards that pass both program and group gates.
A Marker requires a visible image; students additionally must own the
Marker or see at least one of its Boards. Non-students can view all
Markers. The read API enforces these rules; the thumbnail generator itself
does not perform authorization or create endpoints.

## Viewport thumbnails

`app.marker_thumbs.generate_marker_thumbnail(image, marker_id, x, y, zoom,
rotation)` is synchronous CPU-bound pyvips work, suitable for
`asyncio.to_thread`. It reads a local `/api/tiles/<source_id>/image.dzi`
pyramid, reuses the counting stitcher's level planner and tile compositing,
and writes `TILES_DIR/<source_id>/markers/<marker_id>.jpg`: 320×240 JPEG,
quality 82. Its return value is the relative API URL
`/api/tiles/<source_id>/markers/<marker_id>.jpg` for `Marker.thumb`.
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

Use `append_marker_thumb_token(url)` when serializing these URLs after
image and Board visibility checks. It derives the Marker id from the URL
and mints `purpose="thumb"` with an integer `iid` claim, using
`issue_marker_thumb_token(source_image_id, marker_id)`. This token
authorizes only `markers/<iid>.jpg` within that source image: not another
Marker, `thumbnail.jpeg`, or DZI tiles. Plain `append_thumb_token`
tokens remain limited to `thumbnail.jpeg`, so hidden card-cover tokens
cannot reveal zoomed regions. The nginx verdict cache includes the exact
normalized URI for Marker paths, preventing cached authorization from
crossing Marker ids; the `tiles` class remains shared.

`remove_marker_thumbnail` is the helper for future Marker-delete routers.
Single/bulk image deletion removes the `markers/` directory after commit.
Successful image replacement deletes the old image's Marker records and
removes the old thumbnails only after commit; failed replacement preserves
both. Neither cleanup helper removes source tiles or whole-image thumbnails.

The API container already mounts `tiles-data` at `/data/tiles` when chart
persistence is enabled, with `TILES_DIR` supplied from chart values. No
mount change is needed for future API-side generation; generation is not
wired to create and geometry-update endpoints in #1769.

`backend/tests/test_marker_thumbs.py` covers geometry, synthetic clockwise
rotation, padding, missing/corrupt tiles, and file lifecycle.

## Read API (#1768)

All four reads require an authenticated user and `MARKERS_ENABLED=true`.
The Board/Marker routers use both the middleware and router dependency;
the image drawer route explicitly applies `require_markers_enabled`
because it lives outside those middleware path prefixes. Flag-off returns
404 even before authentication.

| Endpoint                       | Response                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `GET /api/boards`              | Visible Board summaries with owners, scope ids, permissions, visible `marker_count` and cover thumbnail |
| `GET /api/boards/{id}`         | Board summary plus visible `markers` in per-Board `sort_order`                                          |
| `GET /api/markers`             | Visible Markers, with owners, permissions, source tag and only their visible `board_ids`                |
| `GET /api/images/{id}/markers` | Drawer items tagged `mine`, `instructor`, or `public`, once each                                        |

Admins, instructors and staff see all Boards, including private Boards.
Students see Boards they own/co-own, public Boards, and restricted Boards
passing **both** the program and group gates; empty restrictions on a
dimension mean unrestricted. An invisible or nonexistent Board detail
(or explicit `board_id` filter) is 404, never 403.

Markers require an **active image for students only**, matching image reads.
Students also pass the image category's inherited program/group/hidden-subtree gates,
even when they own the Marker or it is on a public Board. With that image
gate satisfied, students need ownership of the Marker or a visible Board
containing it; non-students need no further gate. This owner exception
permits an owner to retain access even if all its Boards are private to
someone else. `board_ids` never discloses those private Boards.
The drawer returns 404 for an invisible or nonexistent image.

Source tags have strict precedence:

1. `mine`: the caller is a Marker owner.
2. `instructor`: a **visible** containing Board has an instructor/admin
   owner or an `owner_program`.
3. `public`: another user's Marker is on a public Board.

Other visible Markers have `source: null` in the Organize list and remain
reachable through Boards, but are omitted from the drawer. For example,
staff can see a student's private/restricted Board without its Markers
appearing in the drawer. Drawer order is source precedence, then
Marker `sort_order`, then id.

### Filtering, ordering and conditional requests

Board list search `q` is a case-insensitive literal substring of name,
description or owner label. `visibility` may be repeated. Board sorts:
`id`, `name`, `description`, `visibility`, `owner`, `marker_count`,
`sort_order`, `created_at`, `updated_at`.

Marker list filters: `board_id`, `image_id`, `favourite`,
and `scope=mine|instructor|public` (using the same precedence as drawer tags).
Board membership filters only match visible Boards. `q` searches
title/description. Marker sorts: `id`, `title`, `description`,
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
cannot transfer. Marker edit/delete is granted to admins or any user-owner
(including co-owners); merely viewing an instructor/public Board does not
grant edit authority over someone else's Markers. Permissions in read
responses are UX hints, not a substitute for checking future mutations.

Every thumbnail projection, including Board covers, uses only
`append_marker_thumb_token` for a saved crop and `append_thumb_token`
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

| Endpoint                                      | Body / result                                                                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/boards`                            | `name`, optional `description`, `visibility`, `program_ids`, `group_ids`; 201 Board detail                                       |
| `PATCH /api/boards/{id}`                      | Same editable fields plus concurrency token; Board detail                                                                        |
| `DELETE /api/boards/{id}`                     | Concurrency header; 204, deletes orphaned Markers and derived files                                                              |
| `PUT /api/boards/order`                       | `items: [{board_id, version}]`; ordered Board details                                                                            |
| `PUT /api/boards/{id}/owners`                 | `user_ids` and token; Board detail                                                                                               |
| `POST /api/boards/{id}/transfer`              | Required nullable `program_id` and token; Board detail                                                                           |
| `POST /api/markers`                           | `image_id`, `title`, `x`, `y`, `zoom`, nonempty `board_assignments`; optional `description`, `rotation`, `favourite`; 201 Marker |
| `PATCH /api/markers/{id}`                     | Mutable create fields except `image_id`, plus token; Marker                                                                      |
| `DELETE /api/markers/{id}`                    | Concurrency header; 204 and thumbnail cleanup                                                                                    |
| `PUT /api/markers/order`                      | `items: [{marker_id, version}]`; ordered Markers                                                                                 |
| `PUT /api/markers/{id}/owners`                | Nonempty active-user `user_ids` and token; Marker                                                                                |
| `PUT /api/boards/{id}/markers/order`          | `items: [{marker_id}]`, parent token; Board detail                                                                               |
| `DELETE /api/boards/{id}/markers/{marker_id}` | Parent concurrency header; Board detail                                                                                          |

`PATCH /api/boards/{id}` also accepts the tile cover fields, mirroring the
Collections picker: `cover_marker_id` pins a member marker's thumbnail on
the tile (422 when the marker is not a visible member of the Board; `null`
clears the pin and restores the first-member fallback) and `cover_blank`
renders the Board-icon placeholder. The two are mutually exclusive —
writing either clears the other — and deleting the pinned marker clears the
pin (`SET NULL`).

Every Marker must have at least one Board link. Missing/empty
`board_assignments` on create is 422. Assignments contain `board_id` and
optional `sort_order`; new links
append by default. Duplicate Board assignments are 422. Every submitted
Board must be visible and editable.
Create checks image visibility using the same context as the drawer.
Coordinates/rotation must be finite; zoom must be positive.

A Marker editor's assignment PATCH replaces **only editable-Board links**.
Uneditable-Board links retain their order unchanged, even if
omitted. An empty replacement is accepted only if such retained links keep
the Marker on at least one Board; otherwise it is 422. Explicitly submitting
an uneditable Board is 403 (404 if invisible). Board editors can reorder or
remove someone else's Marker from their own Board without gaining edit
authority over the Marker itself. Board removal returns 422 for the last
link. Deleting a Board instead deletes any newly orphaned Markers and cleans
their files after commit; shared Markers and their thumbnails survive.

Board member reorder submits every **visible** member once. Invisible
members are preserved and appended, like hidden image retention in
Collections. Global Board/Marker order endpoints update only the listed
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
Marker owners PUT requires Marker edit authority and cannot remove all
owners. Students may own at most 10 Boards and 200 Markers, including
co-ownership and owner additions; excess ownership is 422. Other roles have
no cap.

Writes lock Boards in id order before affected Markers, recheck visibility
and edit authority, and use atomic version updates. A new parent linked
during graph-lock acquisition is 409 and must be retried. Student quota
checks lock target owners before resource locks. Membership changes advance
the affected aggregate versions. Mutations bump browse revision and are
covered by the existing HTTP audit middleware plus mutation logs.

Create and geometry PATCH take a shared Image row lock before Board and
Marker locks; image replacement takes an exclusive Image row lock before
deleting the old Markers. The geometry read and write therefore serialize
with replacement rather than inserting bookmarks into its deletion window.

The shared membership revision helper invalidates every affected Board on
assignment changes, Marker deletion, user cleanup and image replacement or
deletion (before links cascade away). Old Board versions then return 409,
including when membership changes through an image endpoint rather than a
Board endpoint. Orphan deletion has no surviving membership to invalidate.

After create commits (id known), or a committed geometry change, thumbnail
generation runs through `asyncio.to_thread`. It rechecks the Marker version
under a row lock so a stale generator cannot overwrite a newer edit or
resurrect a deleted record. Geometry changes clear the old reference; the
old crop is removed/replaced. Missing pyramids or generation failures are
logged and leave `thumb=null`, so reads use the plain image-thumb fallback
without failing the successful write. Marker/Board orphan deletion removes
files only after commit, with cleanup failures logged.

Single/bulk user deletion applies the same invariant: deleted sole-owned Boards
also delete newly orphaned Markers owned by surviving users. Co-owned and
program-owned Boards survive; solely departing-user-owned Markers are deleted
even on surviving Boards. Their thumbnail cleanup is deferred until commit.

`test_board_writes.py` exercises PostgreSQL CRUD, role gates, CAS/428,
assignments/reorder, ownership/caps, real thumbnail generation,
fallback and deletion, commit-failure file preservation and replacement.
`test_marker_thumbs.py` also checks replacement rollback cleanup boundaries.

## ImageViewer frontend (#1772)

The SPA reads `features.markers` from `GET /api/features`, defaulting to
false for missing flags or failed requests. When off, the viewer mounts no
Marker controls, markers or dialogs and makes no Marker requests. This
applies to regular, sequence and synchronized viewers. Boards-page navigation
and the source-group drawer remain separate follow-ups (#1771 and #1773).

The bottom-left **Add Marker** pin arms single-click placement. It
disarms selection and presentation tools, exits canvas editing through its
existing dirty-draft/discard flow, and captures OSD viewport x/y, zoom and
rotation without converting to image pixels. Placement stays armed after saving;
toggle the pin or press Escape without a draft to disarm it. Normal drag,
scroll and pinch navigation remain available. Only OSD quick clicks/taps place.
A preview marker and non-modal **Add Marker** panel appear immediately at the
top-right. Title is selected for typing; choose a required Board (the last used
editable Board is remembered and visible before opening the menu), or create one inline.
Description is under collapsed **More options**; Favourite is a tooltip-labelled
outlined/filled star toggle at the title row's right with `aria-pressed`.
Save keeps placement armed; the viewport re-orients onto the returned Marker so
a brand-new saved view is centred. Cancel or
Escape removes the draft first. Only one unsaved placement is open at a time.
If a new point would sit beneath the panel, the viewer pans it clear of the panel.

`MarkersLayer` portals into `viewer.container` under
`data-hriv-canvas-ui`, independently of Fabric. White circular discs with vibrant
blue pin glyphs are 27 CSS pixels and titles use 13-pixel text; neither scales nor rotates with the image.
Saved and draft markers share the same glyph — MUI's `Room` pin icon on a
white disc with a subtle ring and shadow. Title-label styling is unchanged.
The layer reprojects anchors on animation, animation-finish, open, resize,
rotate and flip. Each marker accepts `markerVisible` and
`labelVisible` props, both true by default. A hidden marker always hides its
label: labels render only while `markerVisible` is on, so label visibility
never outlives marker visibility, though an on-marker label may still be
toggled off independently. The drawer's shared visibility preferences drive the
viewer layer directly, without separate viewer-level overrides. Clicking a marker smoothly restores its
saved pan/zoom/rotation, highlights it and opens a non-modal information card.
The card shows title, optional description, visible Board names and favourite
state, with the Marker icon left of the title and pencil immediately to its right.
Authorized users can toggle the view-mode star through the versioned API; conflicts
require Reload current. It has no close X: outside pointer presses deselect and dismiss it; Escape
also closes it. Other marker presses select that marker instead. Only authorized
editors see the pencil, which turns the card itself into the OCC-protected edit
form (title, Boards, favourite star, Save/Cancel and permitted Delete). Description
starts collapsed under More options, including existing text, without auto-expansion.
Delete opens a secondary confirmation dialog; cancelling it retains the editor draft.
Drawer row Edit selects/pans to the Marker, focuses its row and
opens that same in-place editor, not a central dialog. Cancel restores view mode.
Outside presses keep the editor open, whether changed or not; other markers/rows
do not replace an open editor. Use Save/Cancel or explicit Escape (cancel and close)
first. Clicks within the portalled **Save to** Board picker never discard the edit. This applies
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

`MarkerFormDialog` requires a nonblank title and at least one editable Board.
The multi-picker only lists `permissions.can_edit` Boards. Selected Boards retain their existing membership when editing. Other Boards' links are preserved by the backend assignment
contract. Where the Marker is saved is part of the save action, not a field of
the Marker. New Markers save first, change after: **Save** uses the default
Board (most recently used editable Board) and the viewer shows a
**Saved to {Board} · Change** snackbar (`onSaved`) whose Change opens that
Marker's inline editor. With no default, the button reads **Choose a Board** and
opens the **Save to** picker popover: each editable Board as a
row with cover, name, Marker count and a checkmark when chosen (`aria-pressed`),
ordered selected, most recently used, then by name (case-insensitive, stable ID
ties), with **Search Boards** above more than 8 rows, and Create Board / Done in
its footer. Toggling does not reorder rows. Editing replaces Save with **Save**/**Save changes** and shows a **Saved to** list of Board rows with a
remove × plus **Save to another Board**, which opens the same picker; with no
Board left, a dashed **Choose a Board** row replaces both. Create Board
slides a **New Board** pane in from the right over the form — the same fields
as the Boards & Markers page's Add Board dialog (name, description, visibility
and restricted Program/Group chips, lazily loaded) — and a top-left back arrow
or Escape returns to the Marker form with the draft intact. Creating selects
the new Board and restores the form; empty names and incomplete restricted
scopes disable creation; failures surface inside the pane.
Successful saves record their Boards in the user-scoped
`hrivpref:marker:recentBoards:<userId>` localStorage list (newest first, at most
50 IDs). It drives picker order, and its first editable Board is preselected on the
next create. When the list is absent, the legacy `hrivpref:marker:lastBoard:<userId>`
key seeds it. Storage is per browser and optional; blocked storage is not an error.
Drawer and viewer-panel lists omit the redundant Markers total heading; group
headings carry no counts.

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

Frontend verification: `markerApi.test.ts`, `useImageMarkers.test.ts`,
`useFeatures.test.ts`, `ImageViewer.test.tsx`,
`MarkersLayer.test.tsx` and `MarkerFormDialog.test.tsx`.
Both new components have attached Storybook docs and deterministic stories;
the marker stories exercise the real viewer with fixture API responses.

### Markers drawer (#1773)

The feature-gated Room trigger lives in an OSD **TOP_LEFT** control,
participates in auto-fade, and keeps keyboard-focused controls visible. Its white
glyph and dark translucent background match adjacent OSD controls, without a badge. The
left-anchored panel and its dialogs are portaled into the viewer, including in
OSD full-page mode. It reuses `useImageMarkers`; opening the drawer does not
issue another image request.

Rows are grouped by associated Board rather than source tag: the hook pages
through the visible-Board summaries, and each Marker is listed under every
Board named in its `board_ids`, so a Marker on multiple Boards appears in each
group. Headings are `body2` titles rendered as a link button labelled
`Open Board: {name}`; activating one opens the shared `BoardDialog` in place
over the viewer — the same title, scope and owner chrome, marker grid, Edit
pencil and owners affordances as the Boards & Markers dialog — without leaving
the current image. Marker tiles inside it navigate to their saved views, and
an “Open in Boards & Markers” action reaches the full management surface
(reorder, move/save, remove, selection, Collections). Headings are not
collapsible and carry no member count. Groups are tiered by Board ownership: the viewer's own Boards first,
then instructor- or program-owned Boards; every other visible Board (a
classmate's public or shared Board) sits inside a collapsed **Public & Shared**
section that expands on click, or automatically when one of its rows is
focused. Markers whose Boards are absent from the fetched summaries — or that
belong to no Board — fall into a trailing **Other** group. Empty groups are
hidden rather than showing unusable controls, and the drawer shows a short
loading note while Board summaries are pending. Row selection smoothly
restores saved pan, zoom and rotation and highlights the marker without
opening the form; selecting a canvas-hidden row also writes a `markerVisible`
override so the marker draws — a row click, a canvas click, an edit/delete
intent, or an external `?marker=` navigation never lands on an invisible
marker. The separate edit action uses API `permissions.can_edit`
and opens the existing OCC-protected form.

Marker and label actions are stored independently at both row and group
levels. `mine` and `instructor` source markers default to shown, while
`public`-source markers start canvas-hidden (their labels stay enabled but
cannot render while the marker is hidden) until the viewer opts in — matching
the collapsed Public & Shared section they group under. Source-level defaults
still apply to rows
without overrides, but the group icons write the choice as a row override on
every member of that Board in one batched update, leaving other Boards and
other images' rows untouched. A subsequent row action overrides it per Marker.
Mixed states remain
accessible; toggling a mixed group shows all. Label visibility follows marker
visibility in the rendered layer — a hidden marker hides its label — while a
shown marker's label toggles independently. Shared preferences are the
viewer's single source
of visibility state, so drawer controls always reflect the rendered markers and
labels. Collection embeds use the same preferences rather than external overrides.
Rows show titles only. Their **⋮** menus start with Show/Hide marker, followed by
Show/Hide label (disabled while the marker is hidden) and permitted
Edit/Delete actions; Edit re-centres the Marker and opens the in-card editor,
while Delete opens the shared confirmation dialog without the information card.
Group headings replace the ellipsis with inline eye and label icon buttons
(mixed states via `aria-pressed="mixed"`); the label icon disables whenever
every marker in the group is hidden. Hidden-marker row titles use `text.disabled` (contrast-safe
`text.secondary` in light mode, since the row is still navigable) and an accessible
“marker hidden” suffix. The drawer stops above
the bottom toolbar so tools remain usable. Unsaved placements also appear in a
leading **Unsaved** group while the draft is open.
Row hover backgrounds extend across the drawer, including the independent
options control, without nesting interactive elements.

The Pin/Unpin control mirrors `MyCollectionsDrawer.tsx`: a selected filled pin,
no close button while pinned, and unpinning leaves the panel open. Both drawers
use `usePinnedDrawerState` (via `useMyCollectionsDrawerState` for collections).
Markers persist `hrivpref:markers-drawer:pinned:user:<id>`, matching collections'
`hrivpref:my-collections-drawer:pinned:user:<id>` pattern; anonymous previews use
`anonymous`. Pinned drawers stay open across image/sequence navigation and new
viewer pages. Unpinned drawers close immediately on any outside press/click,
including OSD canvas presses, without consuming the event: placement still works.
Menu content is inside for click-away purposes; its viewer portal container stays
stable through exit. Unlike collections' backdrop, this non-blocking listener
allows the underlying image interaction to continue.

Preferences use `hriv.markerVisibility.<userId>`. Parsing validates the shape
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

Tests: `useImageMarkers.test.ts`, `useMarkerVisibilityPrefs.test.ts`,
`ImageMarkersDrawer.test.tsx`,
`ImageViewer.test.tsx`, and collection-viewer tests. Attached drawer stories
cover Board grouping, label-only visibility, sequence and synchronized
embeds with deterministic API fixtures.

### Boards page (#1771)

`GET /api/markers/{id}` provides a fresh, visibility-filtered `MarkerOut`
for membership edits and thumbnail renewal. It uses the list's image and
ownership/visible-Board gates, returning 404 for missing or invisible items.
Only visible Board IDs are projected; thumbnails carry thumbnail-only tokens.
The response uses viewer-bound, token-epoch ETags and supports conditional 304s.

The feature-gated **Boards & Markers** AppBar utility opens `?page=boards`.
It does not add a primary tab: students retain two mobile navigation tabs, and
Boards uses `Tabs value={false}`. Selecting a Board writes
`?page=boards&board={id}`; Back/Forward restores the selection.
The same flag gates direct links and all page requests.
Frontend telemetry preserves `boards` in both page and from-page dimensions.

The overview has one short, horizontally scrolling row of outlined, rounded Board chips,
starting with **New Board**. Owned Boards share that row, with a flush-left square
Board cover (or a renewing member thumbnail, then the themed placeholder), a
single-line name and the shared scope pill below it, on a taller tile. The
**My Boards** heading shares Collections' unpadded flex header.
Admins, instructors and staff have an outlined **All Boards** button at its
right, above the Board row; students never see All Boards.
Only the page heading changes; the Boards & Markers navigation label remains unchanged.
Below it, **My Markers** contains Collections-style Cards/Table controls and then
the filter bar. There is no Graph view. Only personally owned Markers appear; both lists are
fetched in pages of 200 without the former recent-60 cap.
The overview's Multi-select button is right-aligned on the Filter by row in both views
(contained while active; pressing it again ends selection), and the resulting
selection actions render on the same row so engaging Multi-select never pushes
controls downward.
Each card shows the
image's parent category below its title (`category_name`, null if unfiled).
The heading uses the same h5/h1 typography as Collections. Marker cards are 234px
wide (20% wider than the previous 195px), with proportionally scaled 96px covers,
including inside Board dialogs. Marker cards no longer carry scope pills — the
shared scope-pill component lives on the Board tiles instead, leaving Marker
tiles correspondingly shorter.
The pin replaces the collection icon; category replaces the image count, with
Uncategorized as the fallback. Top-right actions are Favourite (Star/StarBorder,
in Collections' Set cover position) and Move/Save. The title-row pencil opens the
existing edit dialog, including Delete and, for Board editors, Remove from this Board.
Card clicks still open the exact saved view. There is no per-card overflow or drag glyph.
Table uses the same filters, permissions and actions, with Title, Category,
Boards (navigable), Favourite and Actions columns. View choice
is local to the page mount and starts on Cards.
**All Boards** opens a large dialog listing every Board
returned by the backend for admins, instructors and staff, including others' private Boards
and editable owned Boards already in the chip row. A horizontal row of filter
chips sits directly beneath the dialog title: **Public & Shared** narrows to
server-authorized Boards outside the chip row that are public, restricted by
program/group, or shared with the current user through co-ownership or program
ownership/membership (other users' private Boards stay excluded for every role),
and **Instructor Boards** narrows to program-owned Boards or Boards owned by
admin/instructor users. Chips toggle independently and combine; with none
active the complete list shows, and a filter that excludes everything reports
“No matching Boards.” while an empty list reports “No Boards available.”. The dialog renders clickable
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
A Marker matches any visible Board membership of the selected scopes. A Board
matches Favourite if it holds a favourite Marker. Active filters have removable
chips and a Clear filters action. Select sits at the right of the collage toolbar.
Opening a Board shows all authorized members, independent of overview filters,
in a large dialog, full-screen on mobile. Its fixed heading keeps the title,
editable-only pencil, count and Select visible while members scroll. The exact
Collections scope pill sits beside the Managed by owner line; its transfer icon
opens owner management for users with `can_transfer`. An outlined Create Sequence
Collection button sits immediately left of Close, disabled for an empty Board.
There is no Board overflow menu. Delete Board is at the bottom of Edit Board, like
Delete Collection, and requires a second confirmation before deleting orphaned
Markers. Delete uses the form's Board version and explicit 409 reload flow.
The URL retains `?board=`; Back closes the dialog, and Back from a saved-view
image returns to that Board dialog.

Board metadata defaults to private. Scope selection uses the same “Visible to”
radio group as Edit Collection — Private, Restricted and Public — rather than a
dropdown. Restricted scope reuses Collections'
attach rules: admins may attach any Program/Group, instructors only their own
Programs and managed Groups, while existing attachments can be removed.
`can_change_scope` gates the scope fields; metadata-only writes omit them.
Owners/transfer reuse the Collections picker via a Board adapter, and require
`can_transfer`. Both dialogs carry Board OCC versions and require explicit
reload on 409; reload replaces the staged draft with current server values.

The selected Board displays a flat, ordered collage of saved views.
The My Markers overview keeps the saved Marker order across every fetched page
(`sort_order`, with numeric Marker ID breaking ties); dragging reorders it and the
Order saved snackbar's Undo restores the prior order. Favourite, membership and
title changes do not change that order.
The Board dialog title reads "<name> Board (<n> markers)". Saving a Marker to a
Board (drop or Move/Save to…) shows a success snackbar whose Undo restores the
Marker's previous editable Board assignments, pinned to the version the save
returned so a later edit makes Undo conflict instead of being overwritten.
The New Board form opens with a one-line description of what Boards are for.
The Marker edit form lists Description before Boards. An active favourite star
sits on a Marker-blue disc. Saving a favourite does not disable or restyle the
other tile actions; they ignore clicks until the save finishes. The viewer's
Marker info card behaves the same: its Edit button keeps its look while the star
saves.
The Board Owners dialog names the Board as "<name> Board" in its subtitle.
While placement is armed, the viewer's Add Marker toolbar button shows a blue
pin on a white disc over the red active background.
Marker and Board forms (Edit/Add Marker dialog, canvas popover, inline editor,
New Board pane and dialog) focus Title or Name on open. Enter in a single-line
field saves when Save is enabled; Ctrl/⌘+Enter saves from any field, including
Description. The Move/Save to Board dialog saves on Ctrl/⌘+Enter, because plain
Enter opens its Destination menu.
Filled favourite stars are white on both cards and table rows. A contrasting
background keeps the white star legible, including read-only favourite indicators.
Dragging a member card reorders members within the Board, without a separate handle icon;
Board reorder applies only to editable owned Boards. Read-only program-owned
Boards remain discoverable through the All Boards dialog's Public & Shared
filter rather than the chip row, for every role.
The chip row contains only editable owned Boards, without instructor/admin exemptions.
Non-editable Boards are omitted from reorder writes.
Board positions
are stored globally, not per user; only the complete editable-owned subset is
submitted on reorder. Board surface dragging is disabled while filters are active so a
filtered subset can never replace that complete order.
Editable Board chips drag by their surfaces with no grip icon; clicking still opens them.
These are isolated from Browse's
near/far-half collision rules; see [drag-and-drop.md](drag-and-drop.md#boards-page-1771).
Dragging an editable overview Marker card onto another editable Board chip
highlights the target and **saves a copy of the link**, with a success snackbar.
Read-only Boards cannot accept saves. Rejected drops stay unhighlighted and explain
duplicate membership or missing edit permission in the page snackbar, without sending a mutation.
Drop notices reuse the app's bottom-centre Snackbar and filled Alert: green success
for a saved link, info for duplicate membership and warning for other refusals.
**Move/Save to…** also offers an explicit atomic move that removes the source link
in the same PATCH. Other editable Board links retain their positions; non-editable
links remain server-preserved. If any membership or
destination read fails, saving is blocked rather than sending a partial list.
Board editors can remove other owners' Markers from their Board, but only
Marker editors may save to another Board or edit/favourite the Marker.

Board deletion confirms that otherwise orphaned Markers will be deleted.
Removing one link instead surfaces the backend's last-Board 422 without deleting
the Marker. Mutations refresh projections silently, keeping loaded cards and
Board covers mounted; refresh errors retain the last loaded data and show an error.
Creating a Board adds the returned Board locally before opening it. Opening or
closing a Board dialog fetches only its detail, not the overview; opening an
Marker editor loads its Board picker without reloading the page.
Opening a card fetches the authorized image record and reuses the existing
`?image=&x=&y=&zoom=&rotation=` viewer/share mechanism plus a `?marker={id}`
parameter naming the target Marker, with an epoch guard
against late navigation. While a marker-focused image is open the URL keeps
`?marker=`; the viewer consumes it once loaded — recentring, selecting,
focusing, revealing the Marker if it was canvas-hidden and opening its info
card so the description is visible — so a marker link
restores on refresh and Browser Back. Leaving that image consumes the focus:
returning through Browse or Collections opens it with no Marker card. Browser Back returns to the Board entry.

Tests: `boardUtils.test.ts`, `useBoardsData.test.ts`, `BoardsPage.test.tsx`,
`BoardDialog.test.tsx`, `BoardEditDialog.test.tsx`, `BoardOwnersDialog.test.tsx`,
URL/history/App/AppShell
tests, and attached deterministic component stories, including keyboard reorder.

## Collection snapshots (#1770)

The gated Collection API can seed independent member slots from visible
Markers or a Board. Each slot snapshots the title and viewport;
subsequent edits never write back to the source. Duplicate source images are
valid slots with independent identity. See [Collections](collections.md#collection-slots-1770-backend)
for payloads, compatibility and authorization.

Seeded JPEGs are copied atomically into `collection_slots/<slot-id>.jpg` beneath
the source tile root. Missing source JPEGs regenerate from the viewport using
the shared renderer with a separate destination namespace; unavailable tile
data leaves the thumb null for image-thumb fallback. The `slot_thumb` JWT
purpose binds `sid` plus the exact relative `path`; it cannot authorize tiles,
whole-image thumbs, Marker thumbs or other slots. nginx isolates slot JPEG
auth verdicts by exact URI rather than its shared tile class. Cleanup follows
successful database commits. Image replacement invalidates slot geometry and
snapshots because the old coordinates no longer describe the new source.

## Collections from saved views (#1774)

Boards now offer a Select toolbar: any selected Markers can seed a Sequence,
and 2–4 can seed a Synchronized Collection. Both reuse the existing collection
form and Add to Collection destination dialog. Board headers create
ordered Sequences directly through **Create Collection**, while the collection Manage dialog can stage a
Board into its draft.
The Board dialog title uses Collections-style h6 typography, with its Marker count
in smaller secondary body2 text; the action still creates a Sequence Collection.
Selected views follow the displayed Board member order. Click order does not change
the resulting Collection sequence.

A Collection slot is an independent snapshot. Its crop, label and starting
coordinates survive independently of the original saved view; changing the
Collection view does not edit the Marker. Multiple slots on one slide are
separate Sequence steps or side-by-side Synchronized panes. These controls and
slot writes require the Markers feature flag.

## Search and recovery close-out (#1775)

Search now includes visible Boards and Markers by title and description, using
the existing backend `q` endpoints and Board/Marker visibility rules. Board results
deep-link to Boards; Marker results reuse saved-view image navigation. In the
Manage Collection picker, choosing a Board or Marker stages its views instead.

Admin DB archives include all saved-view tables and association records, independent
of `MARKERS_ENABLED`. Filesystem archives retain exact Marker and Collection slot
JPEGs while continuing to omit derived DZI tiles. Same-source rebuilds preserve
these snapshots. See [Admin import/export](admin-import-export.md) for restore order
and [the user guide](../frontend/guide/markers-and-boards.md) for the workflow.

The dark-launch flag remains in place: backend/Helm default false, existing local
compose default true. This close-out does not remove the flag or alter its defaults.

## Permanent viewer side panel

With `features.markers`, the image page and Sequence viewer use a single right-side
panel instead of the earlier Details overlay and left Markers drawer described
above. Its sidebar toggle opens/closes it; the header selects Markers, Share View or Details.
MUI rounded-square action states replace the prototype's navigation-rail pills.
There is no pin or click-away in this panel. At sm and above it reserves 256px by
resizing OSD's actual container, so the minimap, toolbar and sequence arrows stay
inside the image area. At xs it overlays the entire frame and closes via its toggle.

Open state and selected tab persist at `hrivpref:viewer-panel:user:<id>`; new users
start closed on Markers. Anonymous viewers and unavailable storage use memory.
Placement and information cards stay over the image, offset from the closed toggle.
Starting placement with Details open selects Markers; Escape still cancels drafts,
disarms placement and dismisses menus, but does not close this permanent panel.
Entering canvas annotation editing also leaves an already-open panel in place.
The existing visibility preferences, grouped menus and stable portal container remain.
All image-viewer consumers (single image, Sequence and Synchronized panes) display
only the endpoint's My and Instructor groups, for both lists and image markers.
Instructor grouping retains the existing instructor/admin or program-owned Board
classification. Other users' public/shared views are discovered through
Boards & Markers → All Boards → Public & Shared instead. This is frontend UX
scoping;
the backend continues to serve authorized public Boards and their contents.

The link icon between Markers and Details selects **Share View**. Its centred
outlined **Share View** button reuses the image page's clipboard, fallback and feedback logic, replacing
the standalone Share View button only when this panel is enabled. Sequence's panel
copies an image link with the current zoom, centre, rotation and selection rectangles,
opening that specific view independently of the collection slot. Flag-off controls
and Synchronized per-pane sharing behavior are unchanged.

Flag-off viewers retain the original Details trigger/drawer unchanged. Synchronized
panes retain their independent Details and legacy Markers drawers (including their
pin model); the My Collections drawer also retains its shared pin hook. The side
panel is attached inside OSD's root element so it survives full-page reparenting.
If browser storage is blocked, the per-user fallback survives viewer remounts in
the current session, including Sequence steps; it cannot survive a page reload.

## Viewer polish

After a successful creation, the new Marker replaces the previous selection,
including its marker and information card. The viewer opens the Markers tab (or
legacy drawer), expands the row's group, scrolls it into view and gives it keyboard
focus. Selection does not revert to the previous row; failed saves keep the draft.
The information card shows a read-only, named star immediately before Close,
without a visible Favourite/Not a favourite sentence. Edit still changes favourite.
Viewer panel rows, group labels, details and help now use caption typography,
matching the 12px page footer at the default scale. Titles and form inputs use
14px theme variants; small inputs and reduced spacing compact both Marker forms.
Legacy flag-off Details retains its original sizing.
