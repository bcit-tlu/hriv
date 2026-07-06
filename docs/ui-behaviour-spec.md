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

Two capability flags in `AuthContext.tsx` drive all gating:

- `canEditContent = role ∈ {admin, instructor}`
- `canManageUsers = role === admin`

### Tab / navigation visibility (`AppShell.tsx` — `AppShell.test.tsx`)

| Surface               | Student | Instructor | Admin |
| --------------------- | ------- | ---------- | ----- |
| Home                  | ✓       | ✓          | ✓     |
| Images tab            | —       | ✓          | ✓     |
| Manage dropdown       | —       | ✓          | ✓     |
| Manage → Categories   | —       | ✓          | ✓     |
| Manage → Programs     | —       | —          | ✓     |
| Manage → Groups       | —       | ✓          | ✓     |
| Manage → Announcement | —       | ✓          | ✓     |
| People tab            | —       | —          | ✓     |
| Admin tab             | —       | —          | ✓     |

- **Given** a student is logged in, **When** the app bar renders, **Then** only
  Home is shown (no Images, Manage, People, or Admin).
- **Given** an instructor, **Then** Images + the Manage dropdown appear, but the
  **Programs** item inside Manage is hidden (admin-only) while **Groups** is shown.
- **Given** an admin, **Then** all tabs and all Manage items appear.

> **This table covers navigation/tab visibility only — not API-level access.**
> Tab gating and API authorization are independent. Notably, the **People** tab
> is admin-only (`AppShell.tsx` `canManageUsers`), but instructors _can_ still
> list users via the API (`GET /api/users/` is gated by
> `require_role("admin", "instructor")` in `backend/app/routers/users.py`) — the
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
  to proceed or **Cancel** to abort. This confirmation applies to both the
  `MoveCategoryDialog` flow and drag-and-drop of a category tile onto another
  category (`handleDropCategoryOnCategory`). Drag-and-drop reordering within the
  same parent never triggers the dialog because the ancestor path is unchanged.
- **Category tree surfaces:** `ManageCategoriesDialog`, `CategoryPickerSelect`,
  and flows built on the picker (including `MoveCategoryDialog`) start expanded,
  allow subtree collapse/expand, and share the same persisted collapse state for
  the current browser user. Collapsing a branch in one surface keeps it
  collapsed in the others until it is re-expanded.
- **Manage Categories dialog:** the list also renders each category label as a
  link that navigates the app to that category in Browse.
- **Delete:** confirmation required; deleting a category cascades to children and
  detaches images (`category_id → NULL`). See [domain-model.md](domain-model.md).

### Program / group chip selection & narrowing (`categoryUtils.test.ts`)

The category dialogs enforce **narrowing (intersection)** semantics so a child can
never widen access an ancestor restricts:

- `narrowProgramIds(ancestors)` / `narrowGroupIds(ancestors)` compute the
  effective allowed set walking top-down.
- `splitDirectAncestorProgramIds(fullPath)` separates **direct** (editable on
  this category) from **ancestor-inherited** (shown disabled) program ids.
- **Given** a child category whose ancestor restricts to programs {A, B}, **When**
  the editor opens the program picker, **Then** inherited chips {A, B} render
  disabled and only a subset can be selected — selecting outside the inherited
  set is prevented (no widening). A symmetric, **non-blocking** advisory appears
  when a category is restricted by both a program and a group.

#### Direct vs inherited restriction emphasis

Anywhere the UI renders **program** or **group** restrictions as chips or lock
icons, the same emphasis rule applies:

- **Direct restriction** on the current entity/path segment = normal full-strength
  primary/secondary treatment.
- **Inherited restriction** from an ancestor = the same visual treatment at
  **0.6 opacity**.

This applies to breadcrumb chips, browse tile chips, ManagePage restriction
chips, inherited-only category dialog chips, and restriction lock icons in
category pickers / category-management lists.

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
- The Image Viewer header buttons ("Edit Details", "Share View") desaturate
  when the image's category is hidden.

#### Tile desaturation

- **Given** a category or image tile whose parent category is hidden, **When**
  the grid renders, **Then** the tile is desaturated (`grayscale(100%)`).
- Parent visibility overrides child: if a parent is hidden, child tiles always
  appear desaturated regardless of their own status.

#### ManagePage table row desaturation

- **Given** an image row in the ManagePage table, **When** the image is
  individually hidden **or** its category is hidden, **Then** the row
  (including thumbnail) is dimmed via `data-dimmed` attribute; the visibility
  Switch is disabled when hidden by category.

#### Category dropdowns (CategoryPickerSelect, ManageCategoriesDialog)

- Categories inherit visibility from ancestors. **Given** a child category
  whose ancestor is hidden, **When** the dropdown renders, **Then**:
  - `CategoryPickerSelect`: disabled `VisibilityOff` icon at 0.5 opacity,
    dimmed text, dimmed delete icon.
  - `ManageCategoriesDialog`: disabled `VisibilityOff` icon with "Hidden by
    parent category" tooltip, dimmed text, dimmed delete icon.

### Category picker & direct image counts (`CategoryPickerSelect.test.tsx`)

- `CategoryPickerSelect` renders the category tree as an indented,
  collapsible list and shows each category's **direct** image count.
  Restricted categories render a lock icon —
  per accessibility convention (see [`REVIEW.md`](../REVIEW.md)), the lock is a
  non-interactive `<span role="img" aria-label="…">` **without** `tabIndex`
  (query via `getByLabelText`, not `getByTitle`).

### People page filtering (`PeoplePage.tsx`)

- The People page now exposes a persistent **Filter by** bar above the table
  instead of hiding filters behind a toggle button.
- The filter bar shows only controls for currently visible filterable columns
  (for example, hiding the `Groups` column also removes the `Groups` filter
  controls). Hiding a filtered column clears that column's active filter state.
- Text filters accept comma-separated terms and match if any term is present.
- Filter selections persist per user between logins using localStorage, in the
  same style as table column visibility and category-tree collapse preferences.

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
- Text filters accept comma-separated terms and match if any term is present.
- Filter selections persist per user between logins using localStorage, in the
  same style as table column visibility and category-tree collapse preferences.
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
  groups backup tools in this order: export cards first, `Recent Tasks` in a
  collapsible accordion, and destructive import cards at the bottom.
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

---

## See also

- [drag-and-drop.md](drag-and-drop.md) — tile move-vs-reorder contract (human
  feel-test required before merge).
- [category-visibility-and-programs.md](category-visibility-and-programs.md) — the
  authoritative visibility model (frontend narrowing vs backend enforcement).
- [agent-feature-map.md](agent-feature-map.md) — where each feature lives.
- [agent-test-matrix.md](agent-test-matrix.md) — which tests to run per change.
