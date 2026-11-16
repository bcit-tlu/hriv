# Agent test matrix — "I changed X → run Y"

A decision tree for which tests to run after a change, so you can run a targeted
subset instead of the full suite. Find your change area below and run the listed
commands.

**How to run:**

- Backend: from `backend/`, `poetry run pytest <paths>` (the `--cov-fail-under=80`
  gate in `pyproject.toml` still applies to the full run before merge).
- Frontend: from `frontend/`, `npm test -- <pattern>` — Vitest matches `<pattern>`
  as a substring of the test file path (tests live in `frontend/tests/`).

All test file names below are verified against `backend/tests/` and
`frontend/tests/`. Run the **full** suite (`poetry run pytest` / `npm test`)
before opening a PR; the targeted subsets are for fast inner-loop iteration.

## Matrix

### Changed Inuksuk/Board schema or feature gating

- Backend: `poetry run pytest tests/test_inuksuks.py tests/test_inuksuks_db.py tests/test_main.py tests/test_router_users.py tests/test_migrations_bootstrap.py`.
- `tests/test_inuksuks_db.py` requires `TEST_DATABASE_URL` pointing to a
  migrated PostgreSQL database. Verify fresh bootstrap, upgrade/downgrade,
  and autogenerate drift when changing the schema.
- `INUKSUKS_ENABLED` (default false) / Helm `inuksuks.enabled`:
  `helm lint charts/backend` and `bash scripts/test-helm-chart-regressions.sh`.
- See [Inuksuks and Boards](inuksuks-and-boards.md).

### Changed category visibility or program restrictions

- backend: `poetry run pytest tests/test_visibility.py tests/test_categories.py tests/test_router_images.py`
- frontend: `npm test -- categoryUtils useBrowseData CategoryPickerSelect treeUtils`
- Category card cover / thumbnail tokens (#1609): add
  `poetry run pytest tests/test_tiles.py` (backend) and
  `npm test -- CategoryTile CardImagePickerModal` (frontend).
- See [category-visibility-and-programs.md](category-visibility-and-programs.md).

### Changed groups (membership, ownership, category attach, dual-gate visibility)

- backend: `poetry run pytest tests/test_router_groups.py tests/test_authz.py tests/test_visibility.py tests/test_categories.py tests/test_router_images.py`
- frontend: `npm test -- GroupManagementModal groupUtils EditCategoryDialog AddCategoryDialog`
- **Any change touching the group gate in `visibility.py` MUST also run
  `tests/test_router_images.py`** — the images router is a separate caller that
  must pass `user_group_ids` (regression fixed in #604). See [groups.md](groups.md).

### Changed collections (model, authorization, read/write API, ownership transfer, Collections pages / manage table)

- backend: `poetry run pytest tests/test_collections_model.py tests/test_router_collections.py tests/test_schemas.py tests/test_authz.py tests/test_visibility.py`
- Feature flags (`COLLECTIONS_ENABLED`, `COLLECTIONS_STUDENT_ACCESS`,
  `GET /api/features`, `useFeatures`): add
  `tests/test_database.py tests/test_main.py` (backend) and
  `npm test -- useFeatures` (frontend); chart: `bash scripts/test-helm-chart-regressions.sh`.
- Student-access gating also runs `tests/test_categories.py` and
  `tests/test_router_images.py` (backend) and `npm test -- App.test.tsx`
  (frontend): assert student-owner 404s, no tree-embedded collections or
  collection query, hidden navigation/deep-link fallback, and unchanged
  non-student behavior with student access off.
- Ownership transfer / program-deletion orphaning (#1413, #1531) also runs
  `tests/test_router_programs.py` (the real `DELETE /api/programs/{id}` →
  orphan test needs `REORDER_FIXTURE_DATABASE_URL`, otherwise it skips) and
  `tests/test_router_users.py` (user deletion: sole-owned collections die,
  co-owned survive).
- `tests/test_router_collections_db.py` is the PostgreSQL-backed write-API
  persistence suite — it runs when `TEST_DATABASE_URL` is set (CI sets it;
  locally `docker compose up -d db migrate` then `export
TEST_DATABASE_URL=postgresql+asyncpg://hriv:hriv@localhost:5432/hriv`),
  otherwise it skips.
- frontend: `npm test -- CollectionsPage CollectionsTable CollectionCard CollectionEditDialog CollectionManageDialog collectionUtils useCollectionsData api.test navigation AppShell useShareableImageState useNavigationHistory App.test`
- Per-type pages / card overlay / manage table / dialog delete (#1554):
  `npm test -- CollectionsPage CollectionsTable CollectionCard CollectionEditDialog navigation AppShell App.test`
- Unified Collections page — view toggle, Table view, Graph view, view
  preference, `?type=` filter seed (#1629; graph endpoints #1628/#1633):
  `npm test -- CollectionsPage CollectionsTable collectionsGraphModel useCollectionsViewPreference useCollectionsData navigation AppShell App.test`
- Collection Graph View dialog — detail-header button, perspective stack,
  order toggle, image/collection clicks (#1630; `CollectionGraphDialog.tsx`,
  `buildCollectionModel.ts`, `fetchCollectionGraph` in `api.ts`):
  `npm test -- CollectionGraphDialog collectionGraphModel CollectionsGraph CollectionsPage`
- "Add to Collection" from the image view (#1415: `AddToCollectionDialog.tsx`,
  `useAddToCollection.ts`, the viewer action bar in `App.tsx`):
  `npm test -- AddToCollectionDialog useAddToCollection App.test`
- Sequence collection viewer (#1416: `SequenceCollectionViewer.tsx`,
  `?item=` in `useShareableImageState.ts`, `reorderImages` /
  `renewCollectionImage` in `useCollectionsData.ts`, detail mount in
  `CollectionsPage.tsx`; #1566 member manager: `CollectionManageDialog.tsx`):
  `npm test -- SequenceCollectionViewer CollectionManageDialog useCollectionsData useShareableImageState CollectionsPage App.test`
- Synchronized collection viewer (#1417: `SynchronizedCollectionViewer.tsx`,
  `onViewerReady` in `ImageViewer.tsx`, `viewportStateFromSaved` in
  `imageViewerUtils.ts`, `saveViewport` in `useCollectionsData.ts`, detail
  mount in `CollectionsPage.tsx`):
  `npm test -- SynchronizedCollectionViewer useCollectionsData ImageViewer CollectionsPage App.test`
- Ownership/admin management UI (#1419, #1531: `CollectionOwnersDialog.tsx`,
  `transfer` + `saveOwners` in `useCollectionsData.ts`, `transferCollection` +
  `replaceCollectionOwners` in `api.ts`, detail header + card affordances in
  `CollectionsPage.tsx` / `CollectionCard.tsx`):
  `npm test -- CollectionOwnersDialog CollectionsPage CollectionCard useCollectionsData api.test App.test`
- Browse integration (#1529, #1583): filed collections in
  `SortableTileGrid.tsx` and nested `currentCollections` from the category
  tree only; there is no root `uncategorizedCollections` Browse loader.
  Verify the root grid has no collection tiles, and test the separate
  flag-controlled My collections drawer and its `{ mine: true, limit: 8 }`
  request. Nested filed collections still render.
  Also cover `None. Access in Collections.` picker labels,
  unfile snackbar, private-filing warnings, and Manage Categories ordering:
  `npm test -- SortableTileGrid useBrowseData useCategoryActions ManageCategoriesDialog manageCategoriesDialogUtils MoveCollectionDialog BulkEditCollectionsDialog CollectionEditDialog CategoryPickerSelectDialogs CollectionsPage CollectionCard MyCollectionsDrawer useMyCollectionsDrawerState useMyCollectionsShelf useFeatures CategoryTile collectionUtils useCollectionsData useShareableImageState useNavigationHistory App.test`
  Backend placement/tile-order cases:
  `poetry run pytest tests/test_tile_order.py tests/test_router_collections.py tests/test_router_collections_db.py tests/test_categories.py`.
  #1530 image→collection drop-add still uses the `drop-col-` zone and
  `onDropImageOnCollection` in `SortableTileGrid.tsx`; **Add to Collection**
  remains available to add images to unfiled collections.
- Storybook (stories + a11y): `npm run test:storybook -- Collection`
- Collection visibility reuses the category dual gate — if you touched
  `visibility.py` also run the "Changed groups" set above. See
  [collections.md](collections.md).

### Changed Boards page (#1771)

- Frontend: `npm test -- boardUtils useBoardsData BoardsPage BoardEditDialog BoardOwnersDialog CollectionOwnersDialog inuksukApi useShareableImageState useNavigationHistory App.test AppShell`
- Browser stories: `npm run test:storybook -- --run src/components/BoardsPage.stories.tsx src/components/BoardEditDialog.stories.tsx src/components/BoardOwnersDialog.stories.tsx`
- Cover owned/shared lists, restricted attach authority, OCC reload, Sections,
  full membership order, failed membership-read safety, last-Board removal,
  orphan-deletion warning, thumbnail renewal and exact saved-view/back navigation.
- The new DnD provider is separate from Browse. Verify handle-based Board
  and member reorder and cross-Board save; retain
  Browse's [feel-test contract](drag-and-drop.md).

### Changed image metadata / versioning (annotations, overlays, measurement)

- backend: `poetry run pytest tests/test_router_images.py tests/test_images.py tests/test_schemas.py`
- frontend: `npm test -- useCanvasAnnotations useOverlayPersistence useImageActions ImageMetadataFields measurement CanvasOverlay ImageViewer useDraggablePosition api.test`

### Changed image upload or processing pipeline

- backend: `poetry run pytest tests/test_processing.py tests/test_router_upload.py tests/test_worker.py`
- frontend: `npm test -- useProcessingJobs pollProcessingJob UploadImageModal FileDropZone`
- skill: [`.agents/skills/testing-image-processing/SKILL.md`](../.agents/skills/testing-image-processing/SKILL.md)

### Changed image replacement

- backend: `poetry run pytest tests/test_router_images.py tests/test_processing.py`
- frontend: `npm test -- useImageActions`

### Changed bulk import

- backend: `poetry run pytest tests/test_router_bulk_import.py tests/test_processing.py tests/test_worker.py`
- frontend: `npm test -- ConfirmImportDialog UploadImageModal`
- skill: [`.agents/skills/testing-hriv/SKILL.md`](../.agents/skills/testing-hriv/SKILL.md) → `references/upload-processing.md` (bulk import section)

### Changed drag-and-drop (SortableTileGrid)

- frontend: `npm test -- SortableTileGrid sortableTileGridUtils`
- **manual: human feel-test required** — see [drag-and-drop.md](drag-and-drop.md).

### Changed search modal

- frontend: `npm test -- SearchModal useAddToCollection`
- See [ui-behaviour-spec.md](ui-behaviour-spec.md).

### Changed admin import/export

- backend: `poetry run pytest tests/test_admin_ops.py tests/test_router_admin.py tests/test_processing.py`
- note: include `tests/test_processing.py` when touching the rebuild-tiles task — `select_rebuild_targets` / `rebuild_source_image_tiles` live in `processing.py`.
- skill: [`.agents/skills/testing-hriv/SKILL.md`](../.agents/skills/testing-hriv/SKILL.md) → `references/admin-export-import.md` (admin export/import section)
- See [admin-import-export.md](admin-import-export.md).

### Changed durable jobs / parallel tile rebuilds

- backend: `poetry run pytest tests/test_router_jobs.py tests/test_tile_rebuild_jobs.py tests/test_tile_rebuild_jobs_postgres.py tests/test_job_state.py tests/test_tile_rebuild_metrics.py`
- note: `test_tile_rebuild_jobs_postgres.py` is gated on `REORDER_FIXTURE_DATABASE_URL` (real PostgreSQL); it runs in CI. Include `tests/test_worker.py` when touching pump/cron wiring and `tests/test_metrics.py` when touching `/api/metrics` composition. `tests/test_rebuild_fixture.py` covers the `rebuild_fixture` scale seeder; its pyvips-dependent cases skip when libvips is absent.
- frontend: `npm test -- AdminPage api` when touching the jobs panel or `api.ts` wrappers.
- See [jobs.md](jobs.md).

### Changed OIDC / auth

- backend: `poetry run pytest tests/test_auth.py tests/test_router_auth.py tests/test_router_oidc.py tests/test_migration_role_helpers.py`
- frontend: `npm test -- useAuth AuthContext LoginScreen`
- See [OIDC_SETUP.md](OIDC_SETUP.md).

### Changed user / program management

- backend: `poetry run pytest tests/test_router_users.py tests/test_router_programs.py`
- frontend: `npm test -- PeoplePage AddEditPersonModal ProgramManagementModal`

### Changed announcements

- backend: `poetry run pytest tests/test_router_announcements.py tests/test_announcements_helpers.py`
- frontend: `npm test -- announcement Announcement NoticesShelf LoginScreen AdminPage App`

### Changed maintenance mode / middleware / rate limiting

- backend: `poetry run pytest tests/test_maintenance.py tests/test_maintenance_middleware.py tests/test_middleware.py tests/test_rate_limit.py`
- frontend: `npm test -- MaintenanceBanner`

### Changed migrations / bootstrap

- backend: `poetry run pytest tests/test_migrations_bootstrap.py tests/test_migration_role_helpers.py tests/test_database.py`
- Apply locally: `DATABASE_URL=... poetry run python -m app.migrations_bootstrap`.
- See `backend/README.md` (Database migrations).

### Changed observability / tracing (OTel)

- backend: `poetry run pytest tests/test_otel_bootstrap.py tests/test_tracing.py`
- If changing span attribute conventions or error recording in routers, also run
  the relevant router test (e.g. `tests/test_router_bulk_import.py` for bulk
  import spans, `tests/test_router_images.py` for image spans).
- See [observability-conventions.md](observability-conventions.md).

### Changed startup reconciliation / worker cron jobs

- backend: `poetry run pytest tests/test_main.py tests/test_worker.py tests/test_reconciliation.py`
- note: the shared sweep (`app/reconciliation.py`) is invoked once at API
  startup in `TASK_EXECUTION_MODE=local`, or periodically via arq
  `WorkerSettings.cron_jobs` in `required` mode — verify both paths when
  touching either.
- See [image-processing-lifecycle.md](image-processing-lifecycle.md) (Stale
  SourceImage reconciliation).

### Changed Helm charts

- lint: `for chart in charts/*/; do helm lint "$chart"; done`
- validate: `for chart in charts/*/; do helm template test "$chart" | kubeconform -strict -summary -schema-location default -ignore-missing-schemas; done`
- regression: `bash scripts/test-helm-chart-regressions.sh`
- tiles sidecar runtime: `bash scripts/test-tiles-nginx-runtime.sh` (requires docker; runs the rendered nginx config against a stub validator — covers auth_request subrequest scope and verdict caching)

### Changed release / CI workflows

- verify: review `.github/workflows/` and `release-please-config.json` /
  `.release-please-manifest.json`; confirm conventional-commit PR title (the
  `pr-title-lint.yaml` check). See [RELEASE_AND_DEPLOY_FLOW.md](RELEASE_AND_DEPLOY_FLOW.md).

### Changed backup service

- skill: [`.agents/skills/testing-backup-service/SKILL.md`](../.agents/skills/testing-backup-service/SKILL.md)

### Changed restore-validation controller or chart

- prerequisite: ensure `helm` is on `PATH` **before** running the Python suite (`nix-shell -p kubernetes-helm` if needed). `tests/test_cli_chart.py` intentionally uses the real Helm executable; a reported `helm unavailable` skip is not acceptable chart coverage.
- chart: `helm lint charts/restore-validation` and `bash scripts/test-helm-chart-regressions.sh`; the regression also lints schema-valid representative values and parses rendered profile/policy/templates with production parsers where available.
- Python (with Helm still on `PATH`): `cd restore-validation && poetry install --with dev && poetry run python -m unittest discover tests`; verify the summary contains no `helm unavailable` skip.
- compile: `cd restore-validation && poetry run python -m compileall -q hriv_restore_validation tests`
- Treat `docs/restore-validation.md` as the normative isolation and least-privilege contract. Keep invocation render-blocked until #1253 adds fixed reviewed egress/admission resources; test required digest pins, exact `recoveryTarget.targetLSN` and derived decimal `recoveryTarget.targetTLI`, fixed `app`/`app` source profile, token-free child templates, and restricted namespace-scoped RBAC.
- skill: [`.agents/skills/testing-backup-service/SKILL.md`](../.agents/skills/testing-backup-service/SKILL.md) (restore-validation section)

### Changed object counting (epic #1661 — stitch, count-job API, counting worker)

- backend: `poetry run pytest tests/test_counting_stitch.py tests/test_router_counts.py tests/test_counting_worker.py tests/test_main.py tests/test_middleware.py`
- pipeline/outliners/grouping/level rule (#1665):
  `poetry run pytest tests/test_counting_pipeline.py tests/test_counting_stitch.py`
- frontend: `npm test -- useSelectionCounts countPalette CountObjectsButton
CountProgressSnackbar CountReportDialog CountOutlinesLayer useFeatures
ImageViewer` (from `frontend/`).
- See [object-counting.md](object-counting.md).
- **Counting metrics/tracing** (`app/counting/metrics.py`, spans in `pipeline.py`,
  counting gauges in `queue_metrics.py`) → `tests/test_counting_metrics.py` +
  `tests/test_queue_metrics.py` + `tests/test_counting_pipeline.py`.

## Notes

### Inuksuk viewer (#1772)

- Feature/API/hooks: `npm test -- inuksukApi useImageInuksuks useFeatures`.
- Placement, modes, markers and form: `npm test -- ImageViewer Inuksuk`.
- App/collection viewer propagation: `npm test -- App.test CollectionsPage SequenceCollectionViewer SynchronizedCollectionViewer`.
- Full frontend: `npm test`, `npm run build`, `npm run lint`,
  `npm run format:check`, `npm run build-storybook`.
- Visually verify constant CSS sizing while zooming/rotating, independent
  marker/label visibility and create/edit in the viewer. See
  [Inuksuks and Boards](inuksuks-and-boards.md#imageviewer-frontend-1772).

### Inuksuks drawer (#1773)

- Preferences, groups, independent eyes/switches, remount/storage events:
  `npm test -- useInuksukVisibilityPrefs ImageInuksuksDrawer`.
- OSD control portal, gating, navigation, single-fetch integration and embeds:
  `npm test -- ImageViewer SequenceCollectionViewer SynchronizedCollectionViewer`.
- Browser stories: `npm run test:storybook -- --run src/components/ImageInuksuksDrawer.stories.tsx`.
- Visually check open groups, label-only and collapsed Public, plus collection
  pane placement and full-page behavior. Run the full frontend/build/lint/format
  and Storybook checks listed above.

- Vitest patterns match by path substring, so `npm test -- api.test` runs
  `api.test.ts`, and `npm test -- useImageActions` runs `useImageActions.test.ts`.
- When in doubt about which files a feature touches, consult the
  [agent feature map](agent-feature-map.md).
- This matrix lists the _most relevant_ tests, not an exhaustive set — always run
  the full suite before merging.

## Board-seeded Collection slots (#1774)

For slot identity, staging, source payloads, renewal or viewport/URL changes run
from `frontend/`:

```sh
npm test -- collectionMembers collectionUtils useAddToCollection useCollectionsData useShareableImageState CollectionSlotViewers CollectionManageDialog SequenceCollectionViewer SynchronizedCollectionViewer BoardsPage CollectionsPage AddToCollectionDialog CollectionCoverPickerModal App.test
npm run test:storybook -- --run src/components/BoardsPage.stories.tsx src/components/SequenceCollectionViewer.stories.tsx src/components/SynchronizedCollectionViewer.stories.tsx src/components/CollectionManageDialog.stories.tsx
```

Then run the full frontend suite, build, lint and format checks. Visually verify
the Board selection toolbar, labeled same-image Sequence filmstrip and
same-image Synchronized comparison. The feature-off stories and data-hook tests
protect legacy payload compatibility; the slot stories use deterministic
saved-coordinate snapshots.

## Saved-view search and archive changes (#1775)

- Run frontend SearchModal, SearchModalSavedViews, CollectionManageDialog,
  collectionMembers and guideSearch tests. Cover feature-off requests/chips,
  title/description search, Board/saved-view navigation, Board and individual-view
  draft staging, empty results and request failures. Preview the SearchModal
  SavedViews story and capture its Board/Inuksuk results.
- Run backend admin_ops, router_admin, collection_slots, snapshot_files and
  processing tests. Exercise all saved-view table links and timestamps with the
  flag off/on, old archives, selective JPEG restore and swap rollback, and retention
  of restored snapshots across same-source tile rebuilds.
- Finish with full backend/frontend suites, frontend build/lint/format and Helm
  lint/regressions. Backup/restore-validation suites are required if their code or
  recovery contracts change; adding admin archive records alone does not alter them.
