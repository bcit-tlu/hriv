# Frontend Map

## Primary Files

| Concern                           | Files                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| App composition and routing state | `frontend/src/App.tsx`                                                                                                          |
| Auth/session state                | `frontend/src/AuthContext.tsx`, `frontend/src/useAuth.ts`                                                                       |
| API client and type mapping       | `frontend/src/api.ts`, `frontend/src/types.ts`                                                                                  |
| Shell, tabs, theme                | `components/AppShell.tsx`, `ThemeContext.tsx`, `theme.ts`                                                                       |
| Browse/category data              | `useBrowseData.ts`, `treeUtils.ts`, `CategoryTile.tsx`                                                                          |
| Category editing and picking      | `AddCategoryDialog.tsx`, `EditCategoryDialog.tsx`, `CategoryPickerSelect.tsx`, `ManageCategoriesDialog.tsx`, `categoryUtils.ts` |
| Image table/manage workflows      | `ManagePage.tsx`, `EditImageModal.tsx`, `UploadImageModal.tsx`, `BulkEditImagesModal.tsx`, `MoveImageDialog.tsx`                |
| Viewer                            | `ImageViewer.tsx`, `CanvasOverlay.tsx`, `imageViewerUtils.ts`, `useShareableImageState.ts`                                      |
| Annotations and overlays          | `useCanvasAnnotations.ts`, `useOverlayPersistence.ts`                                                                           |
| Processing status                 | `useProcessingJobs.ts`, `pollProcessingJob.ts`                                                                                  |
| Drag and drop                     | `SortableTileGrid.tsx`, `sortableTileGridUtils.ts`                                                                              |
| People/admin UI                   | `PeoplePage.tsx`, `AdminPage.tsx`, `GroupManagementModal.tsx`, `ProgramManagementModal.tsx`                                     |

## Change Heuristics

- Keep API wrapper behavior in `api.ts`; avoid scattering fetch calls inside
  components.
- Keep category tree logic in `categoryUtils.ts`, `treeUtils.ts`, and shared
  hooks instead of duplicating path/restriction calculations in components.
- Preserve direct-vs-inherited restriction emphasis: direct restrictions render
  full strength; inherited restrictions render the same treatment at 0.6
  opacity.
- Use the existing Material UI idioms and component patterns before adding new
  UI abstractions.
- For viewer work, check both desktop and narrow viewport behavior because the
  viewer, modals, and breadcrumbs share limited screen space.

## API Layer And Type Mapping

`frontend/src/api.ts` is the single API layer:

- `request<T>(path, init?)` prepends `/api`, adds auth headers + `X-Session-ID`,
  and handles errors uniformly. Base URL comes from `VITE_API_URL` (empty string
  = same origin, used with the Vite dev proxy). All calls go through this helper
  **except** file uploads, which use `XMLHttpRequest` for progress.
- Two type systems: `Api*` interfaces in `api.ts` (snake_case, match backend
  schemas — `ApiImage`, `ApiCategory`, `ApiUser`) and domain interfaces in
  `types.ts` (camelCase, used in components — `ImageItem`, `Category`, `User`).
  Mapping functions convert between them (e.g. `toUser()` in `AuthContext.tsx`).
- Auth tokens: stored in `localStorage` as `hriv_token` / `hriv_user`. OIDC
  tokens arrive via URL fragment (`#oidc_token=...`) to avoid server logs, then
  are stripped from the URL. Session is validated on mount via
  `GET /api/auth/me`. Logout calls `clearUserStorage()`, which removes all
  `hriv_*` and `hriv-*` localStorage keys.
- Vite dev proxy: `/api` proxies to `http://backend:8000` (Docker service name);
  for non-Docker local dev set `VITE_API_URL`.

## Accessibility Conventions

The in-repo `REVIEW.md` accessibility section is the source of truth; prefer
native accessibility patterns over tooltip-only affordances.

- Use semantic HTML and native attributes (`aria-label`, `role`, ...) as the
  primary mechanism for conveying information.
- MUI `<Tooltip>` does not render a DOM `title`; add `aria-label` to the wrapped
  element and query with `screen.getByLabelText()`, not `getByTitle()`.
- Non-interactive icons/status indicators: wrap in
  `<span role="img" aria-label="...">` with **no** `tabIndex`. Do not add
  `tabIndex={0}` just for tooltip discoverability (it creates extra tab stops,
  especially inside MUI Select menu items — that earlier guidance was reversed).
- Interactive/clickable icons: use `<IconButton aria-label="...">`. Choose the
  wrapper by behavior (clickable → `IconButton`; not clickable → `span
role="img"`), and keep patterns consistent across components (e.g.
  `CategoryPickerSelect.tsx` and `ManageCategoriesDialog.tsx` both render
  non-interactive lock icons as `<span role="img" aria-label="…">`).

## Drag-And-Drop Contract (SortableTileGrid)

`docs/drag-and-drop.md` is the **locked** move-vs-reorder contract — read it
before touching `SortableTileGrid.tsx`. Key facts:

- Library is **`@dnd-kit/react` v2** (`useSortable`/`useDroppable`/
  `DragDropProvider` + `move()` from `@dnd-kit/helpers`), NOT v1
  `@dnd-kit/core`/`SortableContext`. Do not mix v1 examples in.
- **Move** = pointer on the **near half** of a category tile →
  `DroppableCategoryZone` (id `drop-cat-<id>`), detector `nearHalfMoveCollision`,
  `CollisionPriority.High` ("Move here" overlay). **Reorder** = optimistic
  `useSortable` reflow committed via `move()`, detector `farHalfReorderCollision`,
  `CollisionPriority.Normal`.
- Move-wins guard is a **directional far-half threshold**: both detectors share
  `isPastTileCenterAlongDrag(pointer, center, delta)` and are exact complements
  inside a tile. Direction comes from the **cumulative** drag delta
  (`position.delta` = current − start), NOT the jittery `position.direction`.
- `handleDragEnd`: move only when the target id starts with `drop-cat-`; any
  other target is a reorder committed via `move(ids, event)`; self-drop / null /
  canceled drags are no-ops (asserted by the "drag-and-drop spec contract" tests
  in `tests/components/SortableTileGrid.test.tsx`).
- Activation: mouse = `Distance(8px)` only; touch = `Delay(250, tolerance 5)`.
  Drags are suppressed when starting on `.MuiIconButton-root`.
- **Process gate**: any collision/zone/priority/threshold/activation change
  requires a HUMAN feel-test before merge — recorded/scripted drags move in
  idealized discrete steps and cannot prove feel. Pinned in `AGENTS.md`,
  `REVIEW.md`, and the `testing-hriv` skill.

## Capture-Phase Events And requestAnimationFrame

HRIV's drag-and-drop uses window-level native listeners alongside React synthetic
handlers. When a window-level **capture-phase** listener updates state that
unmounts a component, the component's synthetic handler never fires (e.g. a
`drop` capture listener calling `setFileDragActive(false)` unmounts
`FileDropZone` before its `onDrop` runs → dropped files lost).

Fix: defer the state reset by one frame so React's synthetic handler runs first:

```typescript
const handleDrop = (e: DragEvent) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
  fileDragCounter.current = 0
  requestAnimationFrame(() => setFileDragActive(false))
}
window.addEventListener('drop', handleDrop, true) // capture phase
```

Capture phase is required because child `onDrop` handlers call
`stopPropagation()`, which would prevent a bubble-phase window listener from
firing. Also keep `dragenter`/`dragleave` filters identical (both must check
`e.dataTransfer.types.includes("Files")`), or the counter drifts negative on
internal drags and the dropzone becomes permanently invisible. See
`frontend/src/App.tsx` (file-drag `useEffect`) and
`frontend/src/components/FileDropZone.tsx`.

## Docs To Read When Relevant

- `../../../../docs/ui-behaviour-spec.md`: current UI behavior.
- `../../../../docs/drag-and-drop.md`: locked move-vs-reorder contract.
- `../../../../docs/category-visibility-and-programs.md`: mirrored visibility and
  narrowing semantics.
- `../../../../docs/groups.md`: group UI behavior and roster management.
- `../../../../docs/image-metadata-and-versioning.md`: annotation and overlay
  persistence.
