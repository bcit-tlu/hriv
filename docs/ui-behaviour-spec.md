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

| Surface | Student | Instructor | Admin |
|---|---|---|---|
| Home | ✓ | ✓ | ✓ |
| Images tab | — | ✓ | ✓ |
| Manage dropdown | — | ✓ | ✓ |
| Manage → Categories | — | ✓ | ✓ |
| Manage → Programs | — | — | ✓ |
| Manage → Groups | — | ✓ | ✓ |
| Manage → Announcement | — | ✓ | ✓ |
| People tab | — | — | ✓ |
| Admin tab | — | — | ✓ |

- **Given** a student is logged in, **When** the app bar renders, **Then** only
  Home is shown (no Images, Manage, People, or Admin).
- **Given** an instructor, **Then** Images + the Manage dropdown appear, but the
  **Programs** item inside Manage is hidden (admin-only) while **Groups** is shown.
- **Given** an admin, **Then** all tabs and all Manage items appear.

> **This table covers navigation/tab visibility only — not API-level access.**
> Tab gating and API authorization are independent. Notably, the **People** tab
> is admin-only (`AppShell.tsx` `canManageUsers`), but instructors *can* still
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

---

## Editor / admin behaviour

### Category add / edit / delete / move (`AddCategoryDialog.test.tsx`, `EditCategoryDialog.test.tsx`, `MoveCategoryDialog.test.tsx`, `ManageCategoriesDialog.test.tsx`)

- **Add/Edit:** dialogs collect label, parent, and program/group restriction
  chips. Parent selection uses `CategoryPickerSelect`.
- **Move:** `MoveCategoryDialog` reparents a category; a category cannot be moved
  under itself or its own descendant.
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

### Category picker & direct image counts (`CategoryPickerSelect.test.tsx`)

- `CategoryPickerSelect` flattens the tree into an indented list and shows each
  category's **direct** image count. Restricted categories render a lock icon —
  per accessibility convention (see [`REVIEW.md`](../REVIEW.md)), the lock is a
  non-interactive `<span role="img" aria-label="…">` **without** `tabIndex`
  (query via `getByLabelText`, not `getByTitle`).

### Manage page filtering & auto-refresh (`ManagePage.tsx`)

- The Images/Manage page (`ManagePage.tsx`) shows a paginated image table with a
  toggleable filter row (category, program, status, etc.). Images with no
  category (`category_id == null`) render as uncategorised (`—`) and can be
  assigned a category via the row's move action.
- **Auto-refresh:** `ManagePage` reloads (`loadImages`) whenever the
  `imagesVersion` prop changes. **Given** a bulk import job completes, **When**
  the app bumps `imagesVersion`, **Then** the table re-fetches so newly imported
  images appear without a manual reload.

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
