# UI behaviour specification

A behavioural spec for HRIV's frontend, so agents modifying UI components have a
contract to validate against (beyond reading code + tests). Uses **Given / When /
Then** where helpful. For tile drag-and-drop reordering specifically, see
[drag-and-drop.md](drag-and-drop.md) — this doc does not re-specify it.

Component tests referenced below live in `frontend/tests/components/`; hook/util
tests live in `frontend/tests/`. See the [agent test matrix](agent-test-matrix.md)
for which tests to run per change, and the [agent feature map](agent-feature-map.md)
for where each feature lives.

---

## Role-gated behaviour (who sees what)

Three capability flags in `AuthContext.tsx` drive all gating:

- `canEditContent = role ∈ {admin, instructor}`
- `canManageUsers = role === admin`
- `canViewPeople = role ∈ {admin, staff}`

### Tab / navigation visibility (`AppShell.tsx` — `AppShell.test.tsx`)

| Surface                                            | Student | Staff | Instructor | Admin |
| -------------------------------------------------- | ------- | ----- | ---------- | ----- |
| Home                                               | ✓       | ✓     | ✓          | ✓     |
| Collections tab (Sequence / Synchronized sub-menu) | ✓       | ✓     | ✓          | ✓     |
| Images tab                                         | —       | —     | ✓          | ✓     |
| Manage dropdown                                    | —       | ✓     | ✓          | ✓     |
| Manage → Categories                                | —       | —     | ✓          | ✓     |
| Manage → Collections                               | —       | ✓     | ✓          | ✓     |
| Manage → Programs                                  | —       | —     | —          | ✓     |
| Manage → Groups                                    | —       | —     | ✓          | ✓     |
| Manage → Announcement                              | —       | —     | ✓          | ✓     |
| People tab                                         | —       | ✓     | —          | ✓     |
| Admin tab                                          | —       | —     | —          | ✓     |

- **Given** a student is logged in, **When** the app bar renders, **Then** only
  Home and **Collections** are shown (no Images, Manage, People, or Admin).
- **Given** the Collections tab, **When** clicked, **Then** it opens a
  sub-menu (same `Tab` → `Menu` pattern as Manage) offering **Sequence** and
  **Synchronized** _without_ navigating — the tab's `value` is filtered out
  of Tabs' onChange so it is a menu trigger only (#1559); each menu item
  opens `?page=collections&type=` and a missing/invalid `type`
  defaults to Sequence. On a collections page the tab stays highlighted and
  the matching menu item renders `selected`. The compact drawer shows both
  items flattened in.
- **Given** a staff user, **Then** the Manage dropdown renders with only the
  **Collections** item (Categories/Groups/Announcement stay
  edit-content-only); **Given** a student, **Then** no Manage surface at all.
- **Given** the deployment has `COLLECTIONS_ENABLED=false` (`GET /api/features`
  → `collections: false`), **Then** the Collections tab/drawer entry and the
  Manage → Collections item are absent
  for every role and `?collection=` / `?page=collections` /
  `?page=manage-collections` open Home instead
  (see [collections.md](collections.md)).
- **Given** a student on a compact (mobile) viewport, **Then** Home and
  Collections stay inline in the app bar (two tabs never collapse behind a
  lone hamburger).
- **Given** a staff, instructor, or admin on a compact (mobile) viewport,
  **Then** every tab — Home and Collections included — collapses into the
  hamburger drawer (the #1121 layout; Manage items are flattened into it).
- **Given** a staff user, **Then** Home + **Collections** + **People** appear — the People page
  renders read-only (no add/edit/delete/bulk controls; filters, sorting, and
  pagination still work).
- **Given** an instructor, **Then** Images + the Manage dropdown appear, but the
  **Programs** item inside Manage is hidden (admin-only) while **Groups** is shown.
- **Given** an admin, **Then** all tabs and all Manage items appear.

> **This table covers navigation/tab visibility only — not API-level access.**
> Tab gating and API authorization are independent. Notably, the **People** tab
> is gated by `canViewPeople` (`AppShell.tsx`), but instructors _can_ still
> list users via the API (`GET /api/users/` is gated by
> `require_role("admin", "instructor", "staff")` in `backend/app/routers/users.py`) — the
> Manage Groups detail panel relies on this. So an instructor not seeing the People
> tab does **not** mean they cannot list users. For the authoritative
> endpoint → minimum-role mapping, see
> [`docs/TESTING.md`](TESTING.md) and the README Role Capabilities table.

> Editor-only actions (edit buttons, upload, bulk operations) are likewise gated
> by `canEditContent`; these are UX gates — actual authorization is enforced
> server-side (see [category-visibility-and-programs.md](category-visibility-and-programs.md)).

---

## Student-visible behaviour

### Browse path & breadcrumbs (`useNavigationHistory.ts` — `useNavigationHistory.test.ts`)

- The current location is a `path` array of category ids from root to the
  current node; breadcrumbs render one crumb per entry.
- **Given** a student viewing a nested category, **When** they click an ancestor
  breadcrumb, **Then** the `path` truncates to that ancestor and the grid shows
  its children. **When** they click a child tile, **Then** its id is appended to
  `path`.
- The rightmost (current) breadcrumb segment shows the category's total
  descendant sub-category and image count in the same `<N sub-categories · M
images> / Empty` format used on category tiles.
- **Given** a background refresh that renames, re-restricts, hides, or
  reparents the current category or an ancestor, **Then** the grid, inherited
  program/group chips and narrowing, hidden state, the Hide/Show Category
  control, the Add Category depth limit, and the Edit Category context
  (including its descendant-incompatibility warning) follow the leaf's live ancestry (`useBrowseData.liveCategoryPath`,
  resolved by leaf id), not the navigation-time `path` entries. If the leaf has
  left the tree (deleted or no longer visible), the scope resolves empty rather
  than falling back to root. Breadcrumb labels still render the `path` entries
  until the user navigates.

### Category visibility (dual gate)

- A student sees a category only if it passes **both** the program gate and the
  group gate up the ancestor chain (plus the hidden-subtree rule). Empty
  programs/groups on a category = unrestricted on that dimension. Full semantics:
  [category-visibility-and-programs.md](category-visibility-and-programs.md).
- Profile menu shows the student's own **program** and **group** memberships as
  read-only chips (`useUserProfile.ts` — `useUserProfile.test.ts`).

### Image viewer: image information accordion (`ImageInfoAccordion.test.tsx`, `App.test.tsx`)

- **Given** the regular image viewer page, **Then** a collapsed-by-default
  **Image information** accordion sits directly below the viewer and its heading
  contains only that title.
- **When** expanded, **Then** metadata appears in evenly spaced rows and the
  original filename, file type, and (for admins and instructors) uploader appear
  in a row after the existing file details; the viewer usage hint is the final
  row and rows with no visible fields are omitted.
- The read-only Collections row sits inside the first classification row, after
  Groups, when the image belongs to visible collections (see [collections.md](collections.md)).
- **When** the user clicks to expand the accordion, **Then** it predicts the
  mounted details height and scrolls into view above the footer dock and any
  horizontally overlapping My collections trigger with a 16px gap before
  expansion starts; reduced-motion preferences use instant scrolling, and
  persisted expansion on mount does not auto-scroll.
- On the regular image viewer and open collection detail, a closed My
  collections drawer reserves an opaque trigger row in the footer dock and
  `<main>` adds 4px of bottom padding, leaving a 16px gap above the button.
  On every other page where the shelf is visible, `<main>` reserves 68.5px of
  bottom padding at all widths.
- **When** the accordion expands, **Then** source information is fetched lazily;
  collapsing and re-expanding the same image version reuses the cached result,
  while a version change fetches fresh information without exposing stale data.
- **When** the user expands or collapses the accordion, **Then** that choice is
  persisted per authenticated user id (or `anonymous` before authentication)
  under `hrivpref:image-info-expanded:user:${currentUser?.id ?? 'anonymous'}`
  in localStorage.

### Viewer: annotations, overlays, measurement (`CanvasOverlay.test.tsx`, `useCanvasAnnotations.test.ts`, `useOverlayPersistence.test.ts`)

- Students view locked overlays and annotations read-only; edit mode and
  measurement tools are gated by `canEditContent`.
- Canvas annotation editing is draft-only until the user clicks **Save & Exit**.
  Fabric changes update the local draft but never autosave. Save collects one
  exact snapshot, persists only `metadata_extra_merge.canvas_annotations`, and
  exits edit mode only after the request succeeds; a failed save keeps the
  draft editable for retry.
- **Cancel**, the canvas pencil toggle, and navigation away from a dirty draft
  discard locally after confirmation. The confirmation offers **Keep Editing**
  and **Discard Changes**. Browser unloads also receive the native unsaved
  changes warning while a draft is dirty. Overlay lock/clear actions do not
  implicitly save a canvas draft.
- View mode renders annotations without bounding boxes. Edit mode renders subtle
  dotted, presentation-only bounding boxes for unselected annotations; selected
  Fabric objects use the solid selection border with visible handles while
  unselected annotations retain their dotted boxes. Presentation guides are not
  persisted in `metadata_extra.canvas_annotations`. The selection chrome
  (`ANNOTATION_SELECTION_STYLE` in `CanvasOverlay.tsx`: 2px black border,
  filled `#263238` corner handles with a white stroke) is applied to every
  annotation object — loaded, drawn, pasted, or toolbar-created — so selected
  objects stay legible over imagery. The dashed guides are black and wrap the
  annotation's painted bounds including its stroke. Arrow annotations inflate
  their Fabric bounding box to include the arrowhead (`ArrowLine` in
  `src/components/arrowLine.ts`), so the selection box and hit area cover the
  whole painted glyph and stay grabbable.
- The canvas annotation toolbar starts flush against the top of the viewer
  frame, horizontally centred. Its left-edge grip handle moves it anywhere
  inside the frame: drag with a pointer (grab/grabbing cursor,
  `touch-action: none`), or focus it and nudge with arrow keys (8px, 32px with
  Shift). The toolbar is clamped so it stays fully inside the viewer bounds;
  `Home` or a double-click on the handle resets to the default position. The
  position persists for the browser session (module-level cache in
  `useDraggablePosition.ts`) and resets on page reload. Starting a drag closes
  any open tool submenu.
- The whole `CanvasOverlay` (view canvas, fabric edit canvas, toolbar, status
  label) is portaled into `viewer.container`, so annotation viewing and
  editing work in OSD full-page mode — previously the overlay stayed under
  `#root`, which full-page hides (#1311). MUI submenus/dialogs portal to
  `document.body`, so they close on `full-page` transitions rather than
  ending up hidden or detached. Every top-level portaled child is tagged
  `data-hriv-canvas-ui` so the selection `MouseTracker` on `viewer.element`
  can skip gesture capture for overlay UI presses — otherwise the tracker
  captures the pointer to `viewer.element`, retargeting `pointerup`/`click`
  away from toolbar buttons and suppressing the focus that arrow-key nudging
  relies on. When the viewer container changes size during
  edit mode (window resize, full-page transitions, layout shifts) the fabric
  canvas is resized and its objects are re-projected from the viewport-space
  draft, keeping annotations glued to the image.
- The OSD bottom-left control strip and the bottom-right minimap sit flush
  with the bottom edge of the frame: `ImageViewer` applies
  `vertical-align: bottom` to bottom-dock descendants to counter the
  inline-block baseline strut that otherwise lifts them a few px.
- The canvas-edit pencil button uses the same state styling as the other OSD
  toolbar icons: translucent dark rest/hover backgrounds, a red pressed
  background, and a red `2px` outline while canvas edit mode is active.
- Touch pinch gestures use a per-gesture zoom-vs-rotate mode lock. The
  `ImageViewer` intercepts `canvas-pinch` and compares initial finger-line
  rotation against finger-separation change. The dominant motion wins:
  rotation locks `ROTATE` mode, suppresses native zoom, and applies the
  damped `PINCH_ROTATE_SENSITIVITY` delta; separation locks `ZOOM` mode,
  suppresses rotation, and leaves native zoom available. Before either motion
  crosses its activation threshold, both zoom and pan remain available but
  rotation is suppressed. A gap greater than `PINCH_GESTURE_GAP_MS` resets
  arbitration for the next gesture. Covered by `measurement.test.ts`
  (`pinchRotationDeltaDegrees`, `createPinchRotationTracker`).

### Collections pages + manage table (`CollectionsPage.test.tsx`, `CollectionCard.test.tsx`, `CollectionEditDialog.test.tsx`, `CollectionOwnersDialog.test.tsx`, `ManageCollectionsPage.test.tsx`, `App.test.tsx`)

See [collections.md](collections.md#frontend-behaviour) for the full contract.
All roles, including students, can list, open, and create collections;
edit/delete controls are gated by `permissions.can_edit` / `can_delete`
returned by the API (UX only — the backend re-checks).

- **Given** a user picks **Sequence** or **Synchronized** in the Collections
  sub-menu (`?page=collections&type=`), **When**
  `GET /api/collections?type=` resolves, **Then** a fixed-width flex-wrap card grid
  (300px tiles, matching the Browse tile grid) renders one
  `CollectionCard` per summary of that type (cover, name, image count, owners,
  visibility chip); an empty result shows the empty state (whose
  **Create a collection** link opens the create dialog when no filters are
  active) and a failed request shows a plain error `Alert` with no action.
- **Given** the user switches to a type not yet cached, **When** its list
  request is pending, **Then** the previous type's cards are never shown and
  the list uses its loading spinner.
- **Given** a type has cached rows, **When** the user returns to it, **Then**
  those rows appear immediately while that type is revalidated.
- **Given** the user re-picks the already-active type, **When** the list
  remains open, **Then** that type is revalidated once.
- **Given** the user navigates from a collection detail back to the list with
  browser Back, **When** the list is restored, **Then** its active type is
  revalidated.
- **Given** a `CollectionCard`, **Then** the type icon sits left of the
  title (the category folder-icon spot), **Move** and **Set cover image**
  actions sit in a top-right cover overlay (the CategoryTile
  scrim convention, #1554 — Set-cover mirrors that tile's image-icon
  button), **Edit** is a pencil right of the title, and no
  Delete affordance or owner reference exists on the card (#1567).
- **Given** a card whose `permissions.can_edit` is true, **When** the user
  clicks **Set cover image**, **Then** `CollectionCoverPickerModal` radios
  over the collection's visible members (loaded via `GET
/api/collections/{id}` — summaries carry none) and **Save** PATCHes the
  cover fields: the leading **None** row sets `cover_blank` (the tile
  renders the type-logo placeholder like an uncovered category), the
  **Automatic** row clears both states back to the first-member fallback,
  and a member row pins `cover_image_id`.
- **Given** the list, **When** the user toggles
  **My collections** or picks an **Owner**, **Then** the list re-fetches with
  `mine=true` / `owner_user_id=` or `owner_program_id=`; selecting
  **My collections** resets and disables the owner select.
- **Given** a student, **Then** the **Owner** select is not rendered at all
  (only **My collections** remains) and `owner_user_id` /
  `owner_program_id` are never sent; admin, instructor and staff keep it.
- **Given** an admin, **Then** the owner select also offers _No owner
  (orphaned)_ (`orphaned=true`); **Given** any other role, **Then** that option
  is absent and `orphaned` is never sent.
- **Given** the user clicks **New collection**, **When** they enter a name,
  pick a type and visibility and press **Create**, **Then**
  `POST /api/collections` is sent with `image_ids: []` and the new card
  appears in the list.
- **Given** a student or staff user in the dialog, **Then** the **Restricted**
  visibility option is not offered; **Given** an admin or instructor,
  **When** they choose **Restricted**, **Then** program and group chip pickers
  appear and **Create**/**Save** stays disabled until at least one is selected.
- **Given** an instructor in the restricted pickers, **Then** only programs
  they belong to and groups they manage are selectable (others are disabled),
  except scope already attached to the collection, which stays removable.
- **Given** a card whose `permissions.can_edit` is true, **When** the user
  clicks **Edit**, **Then** the dialog opens pre-filled with the full record
  and the type is shown as a read-only chip; **Save** sends `PATCH` with the
  current `version` in the body.
- **Given** the edit `PATCH` returns **409**, **Then** the dialog shows the
  "modified by another user" message with a **Reload** action that re-seeds
  the form from the current record in the error `detail`.
- **Given** an open edit dialog on a collection whose
  `permissions.can_delete` is true, **Then** a **Delete Collection** button
  sits at the bottom of the dialog (#1554 — the `EditImageModal` pattern);
  **When** clicked once it arms ("This action cannot be undone. Click again
  to confirm."), **When** clicked again `DELETE /api/collections/{id}` is
  sent; a failure keeps the dialog open with the API message.
- **Given** the user opens a card, **Then** the URL becomes
  `?collection={id}`; a `sequence` collection mounts the sequence viewer
  (#1416, below) and a `synchronized` collection mounts the synchronized
  viewer (#1417, below).
- **Given** a `?collection={id}` URL is loaded or restored via back/forward,
  **Then** the collections page for that collection's type opens on it;
  **Given** the API
  returns **404**, **Then** the not-found `Alert` with a back-to-list action
  is shown instead.
- **Given** a collection whose `permissions.can_transfer` is true, **Then** an
  **Owners** action appears in its card overlay, a pencil beside the detail
  header's owner name, and its manage-table row; **Given**
  it is false, **Then** none of the affordances render.
- **Given** a non-student opens **Manage → Collections**
  (`?page=manage-collections`), **Then** a table of every API-visible
  collection renders (cover, ID, name, type, scope pill, owners, image
  count, programs, groups, category breadcrumb, visibility switch,
  created, modified, actions) with stored filter facets, sortable columns,
  per-user persisted column visibility and ordering via **Choose columns** —
  the default
  set mirrors Manage Images' lean subset (cover, name, type, category,
  groups, visibility, modified) so the table sizes to content and wraps
  rather than scrolling — and
  pagination (#1554, #1567); **Given** a student deep-links the
  page, **Then** the table renders nothing (role gate) and telemetry reports
  browse.
- **Given** a curatorially hidden collection row, **Then** its cells render
  dimmed/greyscale like an inactive image row on Manage Images (#1567); the
  **Visibility** switch (shown where `canHide`) PATCHes `hidden` and the
  cover thumbnail always opens the collection view.
- **Given** a collection filed under a hidden category, **Then** the row
  renders the same dimmed/greyscale treatment (the hidden-subtree rule
  already keeps it out of student view); the **Visibility**
  switch is disabled — mirroring the image table's category-hidden rows —
  and the name carries no marker icon: `VisibilityOff` is reserved for the
  collection's own hidden flag (the image/category tile convention) —
  and in **Bulk Edit** the visibility switch disables when the whole
  selection is category-hidden or the chosen target category is hidden —
  a toggle flipped before the switch locked is dropped from the save, so
  only the refile applies (same rule as `BulkEditImagesModal`).
- **Given** a collection filed under a hidden category, **Then** its card
  (Browse tile grid and the collections-page grid alike) desaturates — the
  same desaturation a curatorially hidden card gets, but **without** the
  eye-off marker, which is reserved for the collection's own hidden flag —
  and its detail header greys the action
  controls while the hide/show control locks to the disabled **Hidden by
  Category** state the image view and edit dialog share; the sequence
  filmstrip desaturates too.
- **Given** a staff user on the manage table, **Then** every API-returned row
  shows and the row's **actions** (⋮) menu follows `permissions` — View
  always, Edit only where `canEdit` or curatorial filing applies,
  and never Owners/Delete; **Given** an admin or instructor, **Then**
  (where `canTransfer`) Owners is also offered. No row carries a Move action
  — category filing lives in the edit dialog's category picker (#1566).
- **Given** the owners dialog is open (`CollectionOwnersDialog`), **Then** a
  **Program / User** radio row picks which pane edits: the **User** pane
  shows a checkbox table (Name, Email, Program) with current owners
  pre-checked under a _CURRENT OWNERS_ caption; the **Role** popover button
  scopes the list — _Students_ (default) and _Instructors_ for instructors,
  plus _Everyone_ for admins; in the _Students_ scope an optional
  **Program** filter button narrows the search
  (`GET /api/users/?role=&program_id=`). **Change Owner(s)** PUTs the
  checked set.
- **Given** the **Program** pane, **Then** the programs render as outlined
  single-select chips — clicking one stages it as the filled, deletable
  chip whose delete icon reverts it to outlined; for instructors the chips
  list only their own programs. Assigning a program clears user owners
  server-side; **Change Owner** POSTs `/transfer`.
- **Given** the staged result would leave no user owner and no program
  owner, **Then** confirm stays disabled (orphan guard); **Given** the API
  returns **403** / **409** / **422**, **Then** the message stays inline in
  the open dialog. Each pane commits only its own endpoint.
- **Given** an admin viewing the owner facet's _No owner (orphaned)_ list,
  **When** they open a card's **Owners** action and assign an owner, **Then**
  `PUT /api/collections/{id}/owners` is sent and the card leaves the
  filtered list.
- **Given** the collection detail, **Then** below the top container the
  pills row shows the icon-bearing type pill (Synchronized / Sequence — the
  shared `CollectionTypeChip` used on tiles and in the manage table) and
  the visibility
  chip, and — when `restricted` — a chip per
  attached program and group sits right after the breadcrumb; the owner
  line ("Managed by program _X_" or "Managed by _A, B_" —
  `describeCollectionOwners`, `No owner` when orphaned, with the
  transfer-horizontal owners icon beside it
  when `canTransfer`) sits beside the pills and the description renders
  below the pills, left-aligned. **Edit** is a pencil on the final
  breadcrumb item, like Edit Category — there is no right-side Edit button
  (#1567). Hidden state shows through greyscale
  alone — no `Hidden` chip (#1567).
- **Given** a collection detail is open (#1559, #1564), **Then** the header
  mirrors the image view's top container — no `<h1>` title; the
  `MuiBreadcrumbs` of its filed location (Home icon + category ancestors +
  the collection name as the current item followed by a muted `(N images)`
  count — matching the image viewer, which renders **Home / ‹image name›**
  at the root — and there is no "All collections" back link) shares one row
  with the action buttons on the right; each breadcrumb link navigates
  Browse to that spot. **Then**
  the actions order: **Hide
  collection** / **Show collection** (`canHide` — admins and instructors
  only; PATCHes `hidden` with the OCC version), **Manage** (`canEdit` —
  opens `CollectionManageDialog` for reorder/add/remove, #1566),
  **Edit** (`canEdit`), and an owners pencil beside the owner name
  (`canTransfer`). The header no longer
  carries **Move** — filing happens in the edit dialog's category picker
  (#1566).
- **Given** a curatorially hidden collection, **Then** non-students see it
  everywhere with the desaturated card treatment and a `VisibilityOff`
  marker (card name, Manage → Collections Name cell); students see it only if they own it — for everyone else it is
  absent from lists/Browse/search and `GET` answers **404**.

#### Collections in the Browse tile grid (#1529)

(`SortableTileGrid.test.tsx`, `useBrowseData.test.ts`,
`useCategoryActions.test.ts`, `MoveCollectionDialog.test.tsx`,
`CategoryTile.test.tsx`, `App.test.tsx`)

- **Given** `COLLECTIONS_ENABLED` is on, **Then** collection tiles render in
  the Browse tile grid beside categories and images — filed collections
  inside their category's scope only; unfiled collections are not Browse tiles —
  using the shared `CollectionCard` inside the standard sortable tile.
- **Given** the flag is on or off, **Then** Browse never fetches an unfiled
  collection queue; the root grid has no collection tiles. Filed collection
  tiles render only inside their category's scope when the flag is on.
- **Given** the flag is off, **Then** no collection tile renders anywhere in
  the grid, and a scope containing only collections is not treated as pending
  work.
- **Given** `COLLECTIONS_ENABLED` and `COLLECTIONS_HOME_SHELF` are on and the
  caller has visible owned collections, **Then** Browse root and category
  scopes, the image viewer, and the Collections pages (type lists and an open
  collection detail) show a fixed bottom-left **My collections** button
  outside `SortableTileGrid`; no button renders while the owned feed is
  loading or empty (#1608). Opening it shows a bottom drawer with up to eight most recently
  updated collections, **New collection**, and a close control. The sheet
  is docked in flow directly above the sticky
  footer, so it rises out from _behind_ the footer's top border (the footer
  paints over the sheet's bottom edge, so only the sheet's top shows
  elevation) and a pinned sheet moves with the footer during rubber-band
  overscroll. The standard contained button stays mounted while the sheet
  is open and doubles as its title (`aria-labelledby`): it rests 16 px above
  the footer, attaches to the sheet's title slot once the rising header
  reaches it, rides up with the sheet, and detaches again at the same point
  on the way down. A pin control sits beside the title placeholder — it
  fills with a light-grey circle while the sheet is pinned — and the
  temporary header's action cluster ends in a close button. Tiles are
  title-only (no image count, no chips) with ~110 px-tall media. Compact
  cards are 160–180 px wide (at most 60% of a 300 px Browse tile) and scroll
  horizontally below about 1424 px. The card row's height is capped so the
  dock (header + cards + footer) never outgrows the viewport — the header
  and footer heights are measured live, so a wrapped header or a multi-line
  admin footer shrinks the card row instead of pushing the sheet's controls
  above the top edge. The temporary state has a backdrop that leaves the
  footer undimmed, locks document scrolling until the sheet closes or pins
  (the card row still scrolls), and closes on Escape, backdrop click, the
  header's close button, or a second press of the button; pinning removes
  the backdrop (and the close control), keeps Browse
  interactive, persists per user, turns the button into an outlined,
  non-clickable title, and lets the page grow by the sheet's height so the
  last Browse row stays reachable. The same sheet stays mounted across both
  modes — pinning does not reload it — and unpinning leaves the drawer open
  (the pin is not
  a close control). The drawer never renders on the Manage,
  Manage → Collections, People, Admin, or Guide pages and has no drag,
  reorder, or drop targets.
- **Given** an admin or instructor, **Then** collection tiles offer **Move**
  (`MoveCollectionDialog` or drag onto a category tile's move zone) and the
  edit dialog's category picker refiles the collection — both regardless of
  `permissions.can_edit`; **Given** a student or staff member, **Then** no
  collection move UI renders.
- **Given** a collection move (dialog or drop), **Then** an unchanged
  destination no-ops; otherwise the category tree refreshes, only non-null
  source/destination tile-order scopes invalidate, and an undo snackbar
  re-posts the previous category with the version from the move response.
  Moving to `null` unfiles the collection, removes its tile from Browse, and
  shows the snackbar **Removed “<name>” from Browse**.
- **Given** a collection opened from a Browse tile, **Then** the URL carries
  `?collection={id}&cat={path}`, and the error-state close action returns to
  the originating scope; the detail breadcrumb always shows the collection's
  _filed_ location (#1559). **Given** a
  `?collection={id}` link without `?cat=`, **Then** the detail opens in the
  Collections list context as before.
- **Given** a category containing collections, **Then** its tile detail line
  includes `N collections` summed over descendants; **Given** a Browse scope
  holding only collections, **Then** the empty-state message does not render.
- **Given** an unfiled collection, **Then** it remains available in
  collection-management views and the `uncategorized=true` API queue, but
  does not appear in Browse or the root tile-order scope. A root-level
  category such as **Featured** is the way to feature a collection near the
  top of Browse.
- **Given** a private collection is filed into a non-null category, **Then**
  the filing dialog shows a warning (not a block):
  “This collection is private. Students will not be able to see the images in
  this collection.”
  The warning also appears in Edit Collection when the current edit state is
  private and filed, and in Bulk Edit when a changed non-null destination
  includes private selections. Public collections and an unfiled destination
  show no warning.
- **Given** a collection filing picker, **Then** its null option reads
  **None. Access in Manage > Collections.** in Move, Edit, and Bulk Edit;
  the shared picker default remains **None (root level)**. The Move dialog says:
  “File “<name>” into a Browse category. Collections that aren't filed don't
  appear on Browse.”
- **Given** a private selection is filed in Bulk Edit, **Then** the warning
  reads “${privateCount} of the ${total} selected collections are private.
  Students will not be able to see the images in these collections.”
- **Given** a collection is unfiled, **Then** **Add to Collection** remains
  available for adding images; students no longer have the former root-tile
  drag-add path onto their own collections.
- **Given** a collection whose members are all restricted (`member_count > 0`
  but no visible `images`), **Then** the detail header and both viewers show
  the "All images in this collection are currently restricted." notice;
  **Given** `member_count` is `0`, **Then** the ordinary empty-collection
  copy renders instead.
- **Given** an image dragged onto an editable collection tile's near half
  (#1530), **Then** an "Add to collection" overlay appears and the drop adds
  the image as a member with a snackbar offering **Undo**; **Given** the
  image is already a member, **Then** an informational snackbar reports it;
  **Given** the add would exceed the synchronized 4-image cap, **Then** an
  error snackbar names the limit. **Given** the collection is not editable
  (`permissions.can_edit` false) or the drag source is a category or
  collection tile, **Then** no add zone is offered — the far-half reorder
  behaviour is unchanged. The add zone is ownership-gated, not curatorial:
  a non-`canEditContent` viewer who owns a collection sees it and gets
  drag-only image tiles (draggable toward the zone, never reorder targets);
  move, reorder, and category filing stay `canEditContent`-gated.

### Sequence collection viewer (`SequenceCollectionViewer.test.tsx`, `useCollectionsData.test.ts`, `useShareableImageState.test.ts`)

See [collections.md](collections.md#sequence-collection-viewer-1416) for the
full contract. Mounted by the collection detail for `sequence` collections;
always read-only (`canEditContent={false}`).

- **Given** a sequence collection is open with no `?item=`, **Then** the
  thumbnail filmstrip renders _above_ the viewer (#1564), the first member
  renders with the caption row under the viewport (member name left;
  `1 of N` position readout and **Open image** right — the synchronized
  pane pattern), the edge-overlay
  **Previous** button disabled, and the member's canvas annotations /
  locked overlays / measurement shown read-only.
- **Given** `?collection={id}&item={image_id}`, **Then** the viewer opens on
  that image; a non-member `item` id falls back to the first image and
  `?item=` without `?collection=` is ignored.
- **Given** a sequence collection opens, **Then** the viewer region
  autofocuses (#1564) to reveal the edge nav, and ← / → step the sequence
  from a document-level binding (#1567) — they keep working after a dialog
  closes, after clicking a chevron or thumbnail, or when focus sits
  anywhere else on the page. Switching
  images does not re-steal focus, but opening another collection focuses
  it again.
- **Given** the pointer enters or moves over the viewer frame, **Then** the
  lightbox-style **Previous** / **Next** chevrons fade in on the left/right
  edges; **Then** after ~2 s idle or on pointer leave they fade out again
  (keyboard focus also reveals them).
- **Given** the user clicks **Next** / **Previous**, a strip thumbnail, or
  presses ← / → while the collection page is open, **Then** the current image
  changes, the position readout and `?item=` URL update, and the viewer
  remounts (keyed by image id — no viewport bleed).
- **Given** focus is in an input / textarea / select / textbox, on a
  roving-focus widget (tablist, tree, radio group, slider), **or** a
  dialog, menu or listbox is open, **Then**
  arrow keys do not navigate.
- **Given** **Open image** is clicked, **Then** the normal `?image={id}`
  view opens where annotations can be edited.
- **Given** the current image's tiles fail mid-session, **Then** the error
  snackbar fires, that thumbnail dims/disables, and the viewer skips to the
  nearest still-available image; when all members have failed, an error
  `Alert` replaces the viewer.
- **Given** the collection has no visible images, **Then** an info `Alert`
  says "This collection has no images." Editable collections add the
  **Manage Images** instruction; collections with restricted members retain
  the restricted-member message.
- **Given** `permissions.can_edit`, **Then** a **Manage Images** button
  opens the "Manage Collection Images — {name}" dialog of filmstrip-size
  thumbnails;
  dragging reorders, the per-tile corner control removes members (tooltip
  "Remove image"), a
  **Multi-select** toggle multi-picks members for a staged
  dialog-wide **Remove N Selected Images** button, and a
  **Choose images** button opens the search picker — all staged in a local
  draft that leaves the page behind untouched until **Done** PUTs the whole
  member id list with the collection `version`; **Cancel** closes without
  saving (a dirty draft asks to discard first). Non-editors never see the
  button.
- **Given** the collection is synchronized, **When** the Manage dialog
  opens, **Then** it is narrower (`maxWidth="sm"`) and renders a position
  map mirroring the viewer — two members side by side, three or four in a
  2×2 grid with any unfilled cell shown as a dashed **Empty** slot — each
  slot numbered by pane position (#1614). **When** a member is dropped on
  another, **Then** the two swap positions and the others stay put; Done
  commits the slot order as the member id list.

### Synchronized collection viewer (`SynchronizedCollectionViewer.test.tsx`, `useCollectionsData.test.ts`, `ImageViewer.test.tsx`)

See [collections.md](collections.md#synchronized-collection-viewer-1417)
for the full contract. Mounted by the collection detail for `synchronized`
collections; both panes are read-only `ImageViewer`s
(`canEditContent={false}`) showing stored annotations, locked overlays and
measurement metadata.

- **Given** a synchronized collection with two or more visible members,
  **Then** up to four render as panes — side by side for two, a 2×2 grid for
  three or four (each pane captioned with the member name and an
  **Open image** → `?image={id}` action) — and, when more than four are
  stored, a "Showing _N_ of _M_" note appears.
- **Given** the user pans, zooms or rotates any pane, **Then** every other
  pane follows with `immediately=true`, shifted by that pane's offset from
  the armed baseline, and followers never lead the sync (no oscillation).
- **Given** the collection's `viewport_state` matches
  `{ "<image_id>": {zoom, x, y, rotation} }`, **Then** each pane opens at
  its saved position so every pane returns to where it was saved — the
  relative offset between saved entries is the alignment around different
  highlights; entries that don't match the shape are ignored.
- **Given** `permissions.can_edit`, **Then** a **Save view** button appears
  and clicking it PUTs every rendered pane's current viewport as
  `viewport_state` with the collection `version`; a failure surfaces
  `userMessage` on the snackbar. Non-editors never see **Save view**.
- **Given** the **Restore view** button (everyone), **Then** it stays
  disabled until a view has been saved (#1567); **When** clicked, **Then**
  each pane re-applies its saved position and the link baselines re-arm.
- **Given** each pane's **link** button at the top-right of its viewport
  (#1564 — a link icon when linked, link-off when unlinked), **Then**
  panes start linked; **When** a pane is
  unlinked, **Then** it pans/zooms/rotates independently — it neither leads
  nor follows the linked panes; **When** re-linked, **Then** the baselines
  re-capture the current alignment so the pane rejoins without snapping.
- **Given** `(orientation: portrait)`, **Then** a full-area hint
  ("rotate your device") covers the pane area while the viewers stay mounted
  underneath, and rotating back restores the exact view.
- **Given** fewer than two visible members (or fewer than two whose tiles
  survive), **Then** a fallback alert shows the ordered member list with
  per-row **Open image** links; members whose tiles fail mid-session are
  skipped so the surviving panes slide forward.

### "Add to Collection" from the image view (`AddToCollectionDialog.test.tsx`, `useAddToCollection.test.tsx`, `App.test.tsx`)

See [collections.md](collections.md#add-to-collection-from-the-image-view-1415)
for the full contract. Available to every authenticated role; the dialog only
lists collections the API marks `permissions.can_edit` (UX gate — the backend
re-checks).

- **Given** the collections flag is on and an image is open, **When** the
  viewer action bar renders, **Then** an **Add to Collection** button follows
  **Share View** for every role. It is absent when the flag is off, disabled
  with the "Exit canvas edit mode first" tooltip while canvas edit mode is
  active, and desaturated (`grayscale(100%)`) when the image is inactive or
  hidden by category — the same rules as **Edit Details** / **Share View**.
- **Given** the dialog opens, **When** `GET /api/collections` resolves,
  **Then** editable collections render grouped as **My collections**,
  **Program collections** and **Other collections** (empty groups omitted),
  each row showing name, image count and type chip, with a name filter above;
  a spinner, a plain error `Alert`, and an empty state ("You don't have a
  collection you can add to yet.") follow the usual patterns. The filter and
  busy state reset each time the dialog opens.
- **Given** a synchronized collection, **When** it already holds four
  images, **Then** its row is disabled and hovering it shows "Synchronized
  collections hold at most 4 images." Under-cap rows stay clickable — the
  summary count cannot see which selected ids are already members, so the
  authoritative capacity check runs in `addImagesToCollection` against the
  fetched member list; a genuinely overflowing add keeps the dialog open
  with "Adding this selection to `<name>` would exceed the 4-image limit
  for synchronized collections." Sequence rows are never capped.
- **Given** a row is picked, **When** the add is in flight, **Then** every row
  and the footer buttons are disabled and the picked row shows a spinner.
- **Given** the add succeeds, **Then** the dialog closes and a success
  snackbar `Added to "<name>".` offers **View collection**, which opens
  `?collection={id}` (back returns to the image).
- **Given** the image is already in the collection, **Then** no write is
  sent, the dialog closes, and an info snackbar reads
  `This image is already in "<name>".`
- **Given** the collection turns out to be full or the API fails (409 stale
  version, 403, 404), **Then** the message goes to the error snackbar and
  the dialog stays open so another collection can be chosen.
- **Given** **New collection…** is clicked, **Then** the shared
  `CollectionEditDialog` opens in create mode; creating posts the image id(s)
  as the initial members, closes both dialogs and shows the same success
  snackbar. Form errors stay inside the create dialog.

### Search modal (`SearchModal.test.tsx`)

- Search is client-side over the currently loaded browse data (categories,
  images, programs, users); it does not call a dedicated backend search
  endpoint.
- Image results match on image name, copyright, note, parent category,
  associated program names, and text-bearing canvas annotations stored in
  `image.metadataExtra.canvas_annotations`.
- Only text-bearing annotations are searchable: text annotations, link display
  text, and link URLs. Shape-only annotations (rect/circle/arrow) do not
  create search hits.
- Field filters expose dedicated chips for `Annotation`, `Link`, and
  `Link URL`, so users can keep only annotation-derived image matches visible.
- Type filter chips scope the searched fields, not just the result types: with
  a type chip active (and no Field chips selected), the query matches only the
  field(s) most closely associated with that type — `Categories` searches
  category names, `Images` searches image titles, `Programs` searches program
  names, `People` searches people names, `Guide` searches guide titles, and
  `Collections` searches collection names and descriptions. Selecting any
  Field chip overrides that default scope, so `Images` + `Note` still finds
  images whose notes match.
- Collections are a result kind for **every** role (unlike program/user/guide
  kinds, they are not hidden from students): the modal indexes the caller's
  `GET /api/collections` list, which the backend already access-filters, so a
  student never sees a restricted-failing collection. A collection row shows
  its type, image count, and owners, and selecting it navigates to
  `?collection={id}`.
- Multi-select covers images and categories, but only in picker mode
  (#1567): the Manage dialog's **Add** flow opens the modal with
  `initialSelectMode`, and the select layer (checkboxes, **Select all** /
  **Unselect all** at the top-left of the results list, the sticky footer)
  exists nowhere else — the normal search carries no Select affordance.
  The picker offers only the two addable kinds — **Categories** and
  **Images** type chips, pre-applied and toggleable; no other type chips or
  Field chips render (unticking both widens to all kinds), and the
  select-all/results-count header stays pinned while the result list
  scrolls.
  In picker mode, image rows gain checkboxes labelled `Select {image title}`
  and category rows `Select {category name}`; checking a category selects
  every image in its subtree (sub-categories included, hidden subtrees
  excluded) in registration order, and the box shows indeterminate when the
  subtree is only partially covered. A category whose subtree holds no
  addable images is not listed in picker mode — a disabled checkbox cannot
  explain why — while normal search still surfaces it. Row clicks toggle the check instead of
  navigating; every other kind stays navigable and is never selectable.
  Selections persist across query and filter changes — the footer count
  includes picks hidden by the current query and enumerates unique image
  objects (a checked category counts its whole subtree once). Provenance
  keeps overlap honest (#1567): an image remembers whether it was picked
  directly or pinned by a checked category, so unchecking a category only
  releases members no direct pick or other category still claims, and
  checking an already-covered nested category never shrinks the count. The
  footer lays out "N images selected" then **Cancel** (closes the picker)
  and **Add to
  collection**, which emits the ids in "order encountered" (result order
  within a query, chronological across queries) into the Manage dialog's
  staged draft. Closing the modal or handing off resets the
  selection. When the collections feature flag is off the modal hides
  collection results, the Collections chip, and the collections wording in
  the placeholder.
- Search result field labels render in a stronger secondary style so the field
  name reads as metadata rather than body text.
- Staff searches also match the user guide: each guide page is split into
  heading-delimited sections (`buildGuideIndex` in `src/guideSearch.ts`), and a
  match navigates to `?page=guide&doc=<slug>` scrolled to the section anchor.
- The `Guide` type chip limits results to guide content. Guide results and the
  chip are staff-only — students see neither, matching guide access.
- Query syntax (`parseSearchQuery` in `src/searchQuery.ts`): whitespace splits
  the query into terms and results union — a result appears when ANY term
  matches a searchable field as a case-insensitive substring. Wrapping words in
  double quotes (`"…"`, including smart `“”` quotes normalized to straight
  quotes) groups them into a single exact-phrase clause, so `"lung 2"` matches
  only fields containing the adjacent string "lung 2". A quoted phrase and bare
  terms still union together (`biopsy "lung 2"` → "biopsy" OR "lung 2"). An
  unclosed quote treats the rest of the query as the phrase, empty `""` quotes
  contribute no clause, and whitespace runs inside a phrase collapse to single
  spaces.
- The search input placeholder advertises the syntax with a
  `— "quotes" for exact phrases` suffix on both the staff and student variants.

---

## Editor / admin behaviour

### Category add / edit / delete / move (`AddCategoryDialog.test.tsx`, `EditCategoryDialog.test.tsx`, `MoveCategoryDialog.test.tsx`, `ManageCategoriesDialog.test.tsx`)

- **Add/Edit:** dialogs collect label, parent, and program/group restriction
  chips. Parent selection uses `CategoryPickerSelect`.
- **Move:** `MoveCategoryDialog` reparents a category; a category cannot be moved
  under itself or its own descendant. If moving the category would change its
  **effective** program or group restrictions (because the new ancestor path
  narrows or widens the inherited set), a `MoveRestrictionConfirmDialog` is
  shown before the API call is made. The dialog displays the before/after
  effective restriction sets (programs and/or groups, whichever changed) as
  named chips and explains that the category's own direct restrictions are
  preserved — only the inherited context changes. The editor may **Move Anyway**
  to proceed or **Cancel** to abort. This confirmation applies to the
  `MoveCategoryDialog` flow, drag-and-drop of a category tile onto another
  category (`handleDropCategoryOnCategory`), and parent-changing drags in the
  Manage Categories tree. Manage-tree drags apply the visual tree move
  optimistically, then revert it if the editor cancels the confirmation or if
  the deferred API save fails. Drag-and-drop reordering within the same parent
  never triggers the dialog because the ancestor path is unchanged.
- **Category tree surfaces:** `ManageCategoriesDialog`, `CategoryPickerSelect`,
  and flows built on the picker (including `MoveCategoryDialog`) start expanded,
  allow subtree collapse/expand, and share the same persisted collapse state for
  the current browser user. Collapsing a branch in one surface keeps it
  collapsed in the others until it is re-expanded.
- **Manage Categories dialog:** the list also renders each category label as a
  link that navigates the app to that category in Browse, and shows the category's
  total descendant sub-category and image count next to the label in the same
  `<N sub-categories · M images> / Empty` format used on category tiles. The
  dialog uses the medium desktop width so longer category titles use the
  available horizontal space before wrapping, while the category rows retain
  enough right-side space for their action icons.
- **Delete:** confirmation required; deleting a category cascades to children and
  detaches images (`category_id → NULL`). See [domain-model.md](domain-model.md).

### Program / group chip selection & narrowing (`categoryUtils.test.ts`)

The category dialogs enforce **narrowing (intersection)** semantics so a child can
never widen access an ancestor restricts:

- `narrowProgramIds(ancestors)` / `narrowGroupIds(ancestors)` compute the
  effective allowed set walking top-down.
- `splitDirectAncestorProgramIds(fullPath)` is a display helper: **direct**
  program ids come from the leaf category, while **ancestor-inherited** program
  ids come from the narrowed ancestor path above the leaf and exclude ids already
  set directly on the leaf. Full-path narrowing, including the leaf category, is
  still used for backend enforcement and move/change validation.
- **Given** a child category whose ancestor restricts to programs {A, B}, **When**
  the editor opens the program picker, **Then** inherited chips {A, B} render
  disabled and only a subset can be selected — selecting outside the inherited
  set is prevented (no widening). A symmetric, **non-blocking** advisory appears
  when a category is restricted by both a program and a group.

#### Direct vs inherited restriction emphasis

Breadcrumb/header chips render the **effective** program/group restriction for
the current category or image. They use full-path narrowing, including the leaf
category, so ancestor IDs narrowed away by the current category do not render.

For effective IDs shown in the breadcrumb/header and for other surfaces that
render **program** or **group** restrictions as chips or lock icons, the same
emphasis rule applies:

- **Direct restriction** on the current entity/path segment = normal full-strength
  primary/secondary treatment.
- **Inherited restriction** from an ancestor = the same visual treatment at
  **0.6 opacity**.

This applies to breadcrumb chips for IDs that remain in the effective set, browse
tile chips, ManagePage restriction chips, inherited-only category dialog chips,
and restriction lock icons in category pickers / category-management lists.

### Visibility cascade & indicators (`EditCategoryDialog.test.tsx`, `EditImageModal.test.tsx`, `CategoryPickerSelect.test.tsx`, `ManageCategoriesDialog.test.tsx`)

Category and image visibility status is surfaced in a consistent 3-state pattern
across all editor surfaces. Visibility toggles are **deferred** (local state
committed on Save) in the edit modals.

#### Category visibility — 3-state button (breadcrumb bar, EditCategoryDialog)

| State                 | Button                      | Behaviour                  |
| --------------------- | --------------------------- | -------------------------- |
| Visible               | Primary "Hide Category"     | Clickable — toggles status |
| Directly hidden       | Grey "Show Category"        | Clickable — toggles status |
| Inherited from parent | Disabled "Hidden by Parent" | Not clickable              |

- **Given** a category whose ancestor is hidden, **When** the breadcrumb bar
  renders, **Then** the visibility button shows "Hidden by Parent" and is
  disabled; "Add Category" and "Add Images" buttons are desaturated
  (`grayscale(100%)`).
- **Given** an editor (`canEditContent`) on a Browse category page with the
  collections feature enabled, **Then** a "New collection" button sits
  between "Add Category" and "Add Images"; clicking it opens
  `CollectionEditDialog` in create mode with the current Browse category
  pre-filed (`defaultCategoryId`).
- **EditCategoryDialog** visibility button uses local state; the actual
  `status` change is committed only when Save is pressed.

#### Image visibility — 3-state button (EditImageModal, Image Viewer header)

| State           | Button                        | Behaviour                            |
| --------------- | ----------------------------- | ------------------------------------ |
| Active          | Primary "Hide Image"          | Clickable — toggles `active` locally |
| Directly hidden | Grey "Show Image"             | Clickable — toggles `active` locally |
| Category hidden | Disabled "Hidden by Category" | Not clickable                        |

- `categoryHidden` is computed reactively inside `EditImageForm` via
  `isCategoryHiddenInTree(categories, categoryId)`, so it updates when the
  user changes the category in the form.
- The Image Viewer header buttons ("Edit Details", "Share View",
  "Add to Collection") desaturate when the image's category is hidden.

#### Tile desaturation

- **Given** a category or image tile whose parent category is hidden, **When**
  the grid renders, **Then** the tile is desaturated (`grayscale(100%)`).
- Parent visibility overrides child: if a parent is hidden, child tiles always
  appear desaturated regardless of their own status.

#### Tile titles and hover affordances (`CategoryTile.tsx`, `ImageTile.tsx`)

- Category and image tile titles wrap to a maximum of 3 lines before
  truncating, using a word-breaking clamp so long labels do not expand the
  tile horizontally.
- Category tile title rows align their action icons to the top edge of the
  title block so multi-line labels stay visually balanced.
- Category tile titles expose the full category name in a hover tooltip.
- Image tiles expose the full image name in a hover tooltip.

#### ManagePage table row desaturation

- **Given** an image row in the ManagePage table, **When** the image is
  individually hidden **or** its category is hidden, **Then** the row's
  non-interactive cells (and the thumbnail) are dimmed via a per-cell
  `data-dimmed` attribute (independent of MUI internal class names); the
  visibility Switch is disabled when hidden by category.

#### Category dropdowns (CategoryPickerSelect, ManageCategoriesDialog)

- Categories inherit visibility from ancestors. **Given** a child category
  whose ancestor is hidden, **When** the dropdown renders, **Then**:
  - `CategoryPickerSelect`: disabled `VisibilityOff` icon, dimmed text, dimmed
    delete icon. Hidden-state indicators do not use whole-element opacity
    reduction.
  - `ManageCategoriesDialog`: disabled `VisibilityOff` icon with "Hidden by
    parent category" tooltip, dimmed text, dimmed delete icon.

### Category picker & item counts (`CategoryPickerSelect.test.tsx`)

- `CategoryPickerSelect` renders the category tree as an indented,
  collapsible list and shows each category's total descendant sub-category and
  image count in the same `<N sub-categories · M images> / Empty` format used on
  category tiles. It is used by the Add Images, Edit Image details, and Edit
  Collection dialogs,
  which have the same medium desktop width as the Manage Categories dialog so
  the longer count suffixes still fit. Restricted categories render a lock icon —
  per accessibility convention (see [`REVIEW.md`](../REVIEW.md)), the lock is a
  non-interactive `<span role="img" aria-label="…">` **without** `tabIndex`
  (query via `getByLabelText`, not `getByTitle`).

### People page filtering (`PeoplePage.tsx`)

- The People page now exposes a persistent **Filter by** bar above the table
  instead of hiding filters behind a toggle button.
- People rows include a **Status** column chip (`Active` / `Inactive`) and bulk
  account-status action so admins can deactivate/reactivate selected users
  without deleting accounts.
- The filter bar shows only controls for currently visible filterable columns
  (for example, hiding the `Groups` column also removes the `Groups` filter
  controls). Hiding a filtered column clears that column's active filter state.
- Text filters accept comma-separated terms, render one chip per term, and
  match only when every term is present.
- Filter selections persist per user between logins using localStorage, in the
  same style as table column visibility and category-tree collapse preferences.

### Profile popover memberships (`AppShell.tsx`)

- The profile popover caps its width so long program/group chip lists wrap
  vertically instead of forcing the menu to grow horizontally. Program and
  group memberships remain read-only chips.

### Manage page filtering & auto-refresh (`ManagePage.tsx`)

- The Images/Manage page (`ManagePage.tsx`) shows a paginated image table with a
  persistent **Filter by** bar above the table (category, program, visibility,
  etc.) instead of a toggleable filter row. The filter bar only includes
  controls for visible filterable columns, so the column chooser and filter bar
  stay in sync. Images with no
  category (`category_id == null`) render as uncategorised (`—`) and can be
  assigned a category via the row's move action.
- The `Annotations` column is available in the column chooser but is off by
  default; it indicates whether an image has canvas edit annotations in
  `metadata_extra.canvas_annotations`.
- Text filters accept comma-separated terms, render one chip per term, and
  match only when every term is present.
- The `Category` filter is a collapsible checkbox tree. Checking a parent
  matches the whole subtree, the tree shares its expand/collapse state with
  `ManageCategoriesDialog`, and selected categories persist per user between
  logins using localStorage. Each node shows the category's total descendant
  sub-category and image count next to its label in the same `<N sub-categories ·
M images> / Empty` format used on category tiles.
- Filter selections persist per user between logins using localStorage, in the
  same style as table column visibility and category-tree collapse preferences.
- The **Choose columns** dialog reorders as well as shows/hides: each row has
  a drag handle (pointer drag, or focus the handle and use Enter/arrow keys)
  and the chosen column order persists per user between logins; filter-bar
  controls, table headers, and row cells all render in that order (#1577).
  The People and Collections tables share the same chooser and ordering.
- **Pagination controls render at both the top and bottom of the table** so
  users can change page or rows-per-page without scrolling to the end of a long
  list. Both controls are bound to the same page / rows-per-page state, so a
  change made in one is reflected in the other.
- The rows-per-page selection persists per user between logins using
  localStorage (`useRowsPerPagePreference`), in the same style as table column
  visibility and filter preferences, so navigating away to an image and back
  keeps the chosen page size. The People page table persists its rows-per-page
  the same way. Available options are 5, 10, 25, 50, 100, and 200 rows.
- **Auto-refresh:** `ManagePage` reloads (`loadImages`) whenever the
  `imagesVersion` prop changes. **Given** a bulk import job completes, **When**
  the app bumps `imagesVersion`, **Then** the table re-fetches so newly imported
  images appear without a manual reload.

### Changelog notifications (`NotificationMenu.tsx`, `ChangelogAdmin.tsx`)

- Changelog entries render in reverse chronological order (most recent first)
  in both the app bar feed and the admin changelog table, even if the API
  response arrives unsorted.
- The admin changelog table's `new` chip is time-bound: it appears only for
  entries published within the last 7 days, then disappears automatically.
- The app bar changelog feed uses the same local version-bump pattern as other
  refreshable surfaces. **Given** an admin creates, republishes, or deletes a
  changelog entry in the Admin tab, **When** that mutation succeeds, **Then**
  the app bumps a shared `changelogVersion` counter and `NotificationMenu`
  re-fetches entries in the same session without a full page reload.

### Admin tab layout (`AdminPage.tsx`)

- **Given** an admin opens the `Admin` tab, **When** the page renders,
  **Then** the `Changelog` sub-tab is selected by default so changelog
  management appears without scrolling.
- **Given** the admin switches to the `Backups` sub-tab, **Then** the page
  groups backup tools in this order: a data-transfer card grid first (export
  cards, then the destructive import cards, then Rebuild Tiles), a
  `Parallel tile rebuilds` section listing durable rebuild jobs, the
  `Restore individual file` panel, `Recent Tasks` in a collapsible accordion,
  and finally the archive-history panels (`Stored export archives` and
  `Previously uploaded import archives`) side by side.
- The `Parallel tile rebuilds` section (#1191) is separate from `Recent
Tasks`: durable `Job` rows are never merged into the serial `AdminTask`
  list. Each rebuild job shows a status chip, a determinate progress bar, and
  per-status item counts (queued/running/completed/skipped/failed/cancelled).
  The jobs list loads once on mount and re-polls every 2 s only while a
  rebuild job is `queued`, `running`, or `cancelling`; polling stops itself
  once every rebuild job is terminal and never overlaps requests.
- **Given** a rebuild job is active, **Then** a `Cancel` button requests
  idempotent supervisor cancellation; **Given** a job has failed items and is
  not `cancelling`/`cancelled`/`completed`, **Then** a `Retry N failed`
  button requeues all failures. Failed items load lazily — expanding the list
  fetches the first bounded page of 50, and a `Load more` button pages forward
  via `next_after_id` until the cursor is `null`. `Completed with errors`
  renders distinctly from clean `Completed` and `Cancelled`.
- **Given** `GET /api/jobs/rebuild-tiles` reports `enabled`, **Then** the
  Rebuild Tiles button creates a durable job via `POST
/api/jobs/rebuild-tiles`; otherwise it uses the serial
  `POST /api/admin/tasks/rebuild-tiles` task path, and the section notes that
  parallel rebuilds are disabled while still listing any in-flight durable
  jobs.
- Active task alerts remain visible above the tab strip so background export or
  import progress is not hidden while the admin is working in either sub-tab.

### Image replacement & versioning (`useImageActions.test.ts`, `ImageMetadataFields.test.tsx`)

- **Given** an existing image, **When** an editor replaces its file, **Then**
  re-processing is triggered, the canvas annotations/locked overlays are cleared,
  other metadata is preserved, and `version` is bumped.
- **Optimistic concurrency:** mutations send `If-Match: <version>`; a stale
  version yields **409 Conflict**. The UI surfaces the conflict rather than
  silently overwriting. Version tracking is what prevents stale 409s across edit
  sessions.

### File drop zone (`FileDropZone.test.tsx`)

- Window-level **capture-phase** `drag*`/`drop` listeners track an in-flight file
  drag via a `fileDragCounter`; `dragenter`/`dragleave` must apply identical
  `types.includes("Files")` filters or the counter drifts.
- The `setFileDragActive(false)` reset is deferred one frame via
  `requestAnimationFrame` so React's synthetic `onDrop` fires on `FileDropZone`
  before it unmounts (otherwise dropped files are silently lost).

### Reorder notifications (`ReorderSnackbar`, `ReorderStatusIndicator`)

- Reorder save-state feedback (`Saving order…`, `Order saved`,
  `Order changed elsewhere`, `Could not save order — Retry`) appears as a
  bottom-right `Snackbar` in `App.tsx`, not inline in the page header or dialog
  title.
- The reorder snackbar stacks above the processing/upload snackbars (e.g.
  image-processing jobs) using the same 88 px vertical spacing, so a reorder
  started while an image is processing is rendered elegantly above the existing
  progress snackbar rather than overlapping it.
- A single snackbar shows the most urgent active reorder scope across both
  Browse and Manage Categories (`useMostSevereScope`), preserving the same
  conflict-recovery actions (Refresh / Keep my order / Retry).

---

## See also

- [drag-and-drop.md](drag-and-drop.md) — tile move-vs-reorder contract (human
  feel-test required before merge).
- [category-visibility-and-programs.md](category-visibility-and-programs.md) — the
  authoritative visibility model (frontend narrowing vs backend enforcement).
- [agent-feature-map.md](agent-feature-map.md) — where each feature lives.
- [agent-test-matrix.md](agent-test-matrix.md) — which tests to run per change.
