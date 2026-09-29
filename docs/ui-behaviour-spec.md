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

| Surface               | Student | Staff | Instructor | Admin |
| --------------------- | ------- | ----- | ---------- | ----- |
| Home                  | ✓       | ✓     | ✓          | ✓     |
| Collections tab       | ✓       | ✓     | ✓          | ✓     |
| Images tab            | —       | —     | ✓          | ✓     |
| Manage dropdown       | —       | —     | ✓          | ✓     |
| Manage → Categories   | —       | —     | ✓          | ✓     |
| Manage → Programs     | —       | —     | —          | ✓     |
| Manage → Groups       | —       | —     | ✓          | ✓     |
| Manage → Announcement | —       | —     | ✓          | ✓     |
| People tab            | —       | ✓     | —          | ✓     |
| Admin tab             | —       | —     | —          | ✓     |

- **Given** a student is logged in, **When** the app bar renders, **Then** only
  Home and **Collections** are shown (no Images, Manage, People, or Admin).
- **Given** the deployment has `COLLECTIONS_ENABLED=false` (`GET /api/features`
  → `collections: false`), **Then** the Collections tab/drawer entry is absent
  for every role and `?collection=` / `?page=collections` open Home instead
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

### Category visibility (dual gate)

- A student sees a category only if it passes **both** the program gate and the
  group gate up the ancestor chain (plus the hidden-subtree rule). Empty
  programs/groups on a category = unrestricted on that dimension. Full semantics:
  [category-visibility-and-programs.md](category-visibility-and-programs.md).
- Profile menu shows the student's own **program** and **group** memberships as
  read-only chips (`useUserProfile.ts` — `useUserProfile.test.ts`).

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
  annotation's painted bounds including its stroke.
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

### Collections tab (`CollectionsPage.test.tsx`, `CollectionCard.test.tsx`, `CollectionEditDialog.test.tsx`, `App.test.tsx`)

See [collections.md](collections.md#frontend-behaviour) for the full contract.
All roles, including students, can list, open, and create collections;
edit/delete controls are gated by `permissions.can_edit` / `can_delete`
returned by the API (UX only — the backend re-checks).

- **Given** a user opens the Collections tab (`?page=collections`), **When**
  `GET /api/collections` resolves, **Then** a responsive card grid renders one
  `CollectionCard` per summary (cover, name, image count, owner, type chip,
  visibility chip); an empty result shows the empty state (whose
  **Create a collection** link opens the create dialog when no filters are
  active) and a failed request shows a plain error `Alert` with no action.
- **Given** the list, **When** the user picks a type toggle,
  **My collections**, or an **Owner**, **Then** the list re-fetches with
  `type=` / `mine=true` / `owner_user_id=` or `owner_program_id=`; selecting
  **My collections** resets and disables the owner select.
- **Given** a student, **Then** the **Owner** select is not rendered at all
  (only the type toggle and **My collections** remain) and `owner_user_id` /
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
- **Given** a card whose `permissions.can_delete` is true, **When** the user
  clicks **Delete** and confirms, **Then** `DELETE /api/collections/{id}` is
  sent and the card disappears; a failure keeps the dialog open with the API
  message.
- **Given** the user opens a card, **Then** the URL becomes
  `?collection={id}` and the detail placeholder lists the ordered member
  images with an **Open image** link (`?image={id}`) each; the viewer itself
  arrives in #1416/#1417.
- **Given** a `?collection={id}` URL is loaded or restored via back/forward,
  **Then** the Collections tab opens on that collection; **Given** the API
  returns **404**, **Then** the not-found `Alert` with **All collections** is
  shown instead.

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
- **Given** a synchronized collection, **When** its image count plus the
  images being added would exceed four, **Then** its row is disabled and
  hovering it shows "Synchronized collections hold at most 4 images."
  Sequence rows are never capped.
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
  field most closely associated with that type — `Categories` searches category
  names, `Images` searches image titles, `Programs` searches program names,
  `People` searches people names, and `Guide` searches guide titles. Selecting
  any Field chip overrides that default scope, so `Images` + `Note` still
  finds images whose notes match.
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
  category tiles. It is used by the Add Images and Edit Image details dialogs,
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
