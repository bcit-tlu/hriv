# Agent feature map — "where to change what"

A quick reference mapping each major feature area to its **frontend**,
**backend**, **tests**, and **docs**. Use it to locate the likely files for a
change without searching the whole repo.

Frontend hooks/components live under `frontend/src/` (e.g. `useImageActions.ts`,
`components/ImageViewer.tsx`); backend modules under `backend/app/`; tests under
`backend/tests/` and `frontend/tests/`.

| Feature | Frontend | Backend | Tests | Docs to update |
|---|---|---|---|---|
| Category visibility | `useBrowseData.ts`, `categoryUtils.ts`, `components/CategoryPickerSelect.tsx` | `visibility.py`, `routers/categories.py` | `test_visibility.py`, `test_categories.py`, `categoryUtils.test.ts`, `useBrowseData.test.ts` | [`docs/category-visibility-and-programs.md`](category-visibility-and-programs.md) |
| Groups (membership + category attach) | `components/GroupManagementModal.tsx`, group restriction section in `components/AddCategoryDialog.tsx` / `EditCategoryDialog.tsx`, `api.ts` (`fetchGroups`, `fetchUsersPaged`, bulk helpers) | `routers/groups.py`, `authz.py`, `routers/categories.py` (group attach + warnings), `routers/users.py` (instructor student/instructor listing) | `test_router_groups.py`, `test_authz.py`, `test_categories.py`, `test_visibility.py`; `GroupManagementModal.test.tsx` | [`docs/groups.md`](groups.md), [`docs/category-visibility-and-programs.md`](category-visibility-and-programs.md) |
| Image metadata / versioning | `api.ts` (`updateImage`), `useImageActions.ts`, `useCanvasAnnotations.ts`, `useOverlayPersistence.ts` | `routers/images.py`, `schemas.py` | `test_router_images.py`, `useCanvasAnnotations.test.ts`, `useOverlayPersistence.test.ts`, `useImageActions.test.ts` | [`docs/image-metadata-and-versioning.md`](image-metadata-and-versioning.md) |
| Bulk import | `components/ManagePage.tsx`, upload modals | `routers/bulk_import.py`, `processing.py`, `worker.py` | `test_router_bulk_import.py`, `test_processing.py`, `test_worker.py` | [`.agents/skills/testing-hriv/SKILL.md`](../.agents/skills/testing-hriv/SKILL.md) |
| Image upload / processing | `api.ts` (upload helpers), `useProcessingJobs.ts` | `routers/upload.py`, `processing.py`, `worker.py`, `image_validation.py` | `test_router_upload.py`, `test_processing.py`, `test_worker.py`, `pollProcessingJob.test.ts` | [`.agents/skills/testing-image-processing/SKILL.md`](../.agents/skills/testing-image-processing/SKILL.md) |
| Image replacement | `useImageActions.ts`, `components/ImageViewer.tsx` | `routers/images.py` (`replace_image`), `processing.py` (`process_replace_image`) | `test_router_images.py`, `test_processing.py` | [`docs/image-metadata-and-versioning.md`](image-metadata-and-versioning.md), [`docs/image-processing-lifecycle.md`](image-processing-lifecycle.md) |
| Admin import / export | Admin tab components | `routers/admin.py`, `admin_ops.py` | `test_router_admin.py`, `test_admin_ops.py` | [`docs/admin-import-export.md`](admin-import-export.md) |
| OIDC / auth | `AuthContext.tsx`, `api.ts` | `routers/auth.py`, `routers/oidc.py`, `auth.py` | `test_router_auth.py`, `test_router_oidc.py`, `test_auth.py`, `useAuth.test.tsx` | [`docs/OIDC_SETUP.md`](OIDC_SETUP.md) |
| Programs / RBAC | `components/ManagePage.tsx`, program management components | `routers/programs.py`, `auth.py` | `test_router_programs.py`, `test_auth.py` | [`README.md`](../README.md#role-capabilities) (role table), [`docs/TESTING.md`](TESTING.md) (endpoint table) |
| Drag-and-drop | `components/SortableTileGrid.tsx`, `components/sortableTileGridUtils.ts` | N/A (frontend only) | Component tests | [`docs/drag-and-drop.md`](drag-and-drop.md) |
| Announcements | Announcement components | `routers/announcement.py` | `test_router_announcement.py`, `useAnnouncementModal.test.ts` | — |
| Deployment / Helm | N/A | N/A | `helm-lint` CI job | [`docs/RELEASE_AND_DEPLOY_FLOW.md`](RELEASE_AND_DEPLOY_FLOW.md), chart READMEs |
| Canvas annotations | `useCanvasAnnotations.ts`, `components/ImageViewer.tsx` (Fabric.js) | `routers/images.py` (metadata merge) | `useCanvasAnnotations.test.ts`, `test_router_images.py` | — |
| Backup | N/A | `backup/` service | — | [`.agents/skills/testing-backup-service/SKILL.md`](../.agents/skills/testing-backup-service/SKILL.md) |
| Observability (OTel) | N/A | `otel_bootstrap.py`, `tracing.py` | `test_tracing.py` | [`docs/observability-conventions.md`](observability-conventions.md) |

## Notes

- **Programs are admin-managed only** (since cohorts were removed in
  [#601](https://github.com/bcit-tlu/hriv/pull/601)). Groups are the
  instructor-managed visibility dimension — see [`docs/groups.md`](groups.md).
- **Category visibility** is a dual gate (programs AND groups); the backend gate
  lives in `visibility.py`. Any change to the group gate must also run
  `test_router_images.py` (image visibility flows through the same gate).
- **Admin import / export** round-trips groups; see
  [`docs/admin-import-export.md`](admin-import-export.md).
- Hooks marked above without a path prefix live directly under `frontend/src/`.

## Domain model & invariants

For schema/relationship details before touching models or migrations, see
[`docs/domain-model.md`](domain-model.md). For the project-wide rules agents must
not break, see the **Critical Invariants** section in
[`AGENTS.md`](../AGENTS.md#critical-invariants).
