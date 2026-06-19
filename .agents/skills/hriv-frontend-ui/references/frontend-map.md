# Frontend Map

## Primary Files

| Concern | Files |
|---|---|
| App composition and routing state | `frontend/src/App.tsx` |
| Auth/session state | `frontend/src/AuthContext.tsx`, `frontend/src/useAuth.ts` |
| API client and type mapping | `frontend/src/api.ts`, `frontend/src/types.ts` |
| Shell, tabs, theme | `components/AppShell.tsx`, `ThemeContext.tsx`, `theme.ts` |
| Browse/category data | `useBrowseData.ts`, `treeUtils.ts`, `CategoryTile.tsx` |
| Category editing and picking | `AddCategoryDialog.tsx`, `EditCategoryDialog.tsx`, `CategoryPickerSelect.tsx`, `ManageCategoriesDialog.tsx`, `categoryUtils.ts` |
| Image table/manage workflows | `ManagePage.tsx`, `EditImageModal.tsx`, `UploadImageModal.tsx`, `BulkEditImagesModal.tsx`, `MoveImageDialog.tsx` |
| Viewer | `ImageViewer.tsx`, `CanvasOverlay.tsx`, `imageViewerUtils.ts`, `useShareableImageState.ts` |
| Annotations and overlays | `useCanvasAnnotations.ts`, `useOverlayPersistence.ts` |
| Processing status | `useProcessingJobs.ts`, `pollProcessingJob.ts` |
| Drag and drop | `SortableTileGrid.tsx`, `sortableTileGridUtils.ts` |
| People/admin UI | `PeoplePage.tsx`, `AdminPage.tsx`, `GroupManagementModal.tsx`, `ProgramManagementModal.tsx` |

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

## Docs To Read When Relevant

- `../../../../docs/ui-behaviour-spec.md`: current UI behavior.
- `../../../../docs/drag-and-drop.md`: locked move-vs-reorder contract.
- `../../../../docs/category-visibility-and-programs.md`: mirrored visibility and
  narrowing semantics.
- `../../../../docs/groups.md`: group UI behavior and roster management.
- `../../../../docs/image-metadata-and-versioning.md`: annotation and overlay
  persistence.
