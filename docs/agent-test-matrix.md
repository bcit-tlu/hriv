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

### Changed category visibility or program restrictions
- backend: `poetry run pytest tests/test_visibility.py tests/test_categories.py tests/test_router_images.py`
- frontend: `npm test -- categoryUtils useBrowseData CategoryPickerSelect treeUtils`
- See [category-visibility-and-programs.md](category-visibility-and-programs.md).

### Changed groups (membership, ownership, category attach, dual-gate visibility)
- backend: `poetry run pytest tests/test_router_groups.py tests/test_authz.py tests/test_visibility.py tests/test_categories.py tests/test_router_images.py`
- frontend: `npm test -- GroupManagementModal groupUtils EditCategoryDialog AddCategoryDialog`
- **Any change touching the group gate in `visibility.py` MUST also run
  `tests/test_router_images.py`** — the images router is a separate caller that
  must pass `user_group_ids` (regression fixed in #604). See [groups.md](groups.md).

### Changed image metadata / versioning (annotations, overlays, measurement)
- backend: `poetry run pytest tests/test_router_images.py tests/test_images.py tests/test_schemas.py`
- frontend: `npm test -- useCanvasAnnotations useOverlayPersistence useImageActions ImageMetadataFields measurement CanvasOverlay api.test`

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
- skill: [`.agents/skills/testing-hriv/SKILL.md`](../.agents/skills/testing-hriv/SKILL.md) (bulk import section)

### Changed drag-and-drop (SortableTileGrid)
- frontend: `npm test -- SortableTileGrid sortableTileGridUtils`
- **manual: human feel-test required** — see [drag-and-drop.md](drag-and-drop.md).

### Changed search modal
- frontend: `npm test -- SearchModal`
- See [ui-behaviour-spec.md](ui-behaviour-spec.md).

### Changed admin import/export
- backend: `poetry run pytest tests/test_admin_ops.py tests/test_router_admin.py`
- skill: [`.agents/skills/testing-hriv/SKILL.md`](../.agents/skills/testing-hriv/SKILL.md) (admin export/import section)
- See [admin-import-export.md](admin-import-export.md).

### Changed OIDC / auth
- backend: `poetry run pytest tests/test_auth.py tests/test_router_auth.py tests/test_router_oidc.py tests/test_migration_role_helpers.py`
- frontend: `npm test -- useAuth AuthContext LoginScreen`
- See [OIDC_SETUP.md](OIDC_SETUP.md).

### Changed user / program management
- backend: `poetry run pytest tests/test_router_users.py tests/test_router_programs.py`
- frontend: `npm test -- PeoplePage AddEditPersonModal ProgramManagementModal`

### Changed announcements
- backend: `poetry run pytest tests/test_router_announcement.py`
- frontend: `npm test -- useAnnouncementModal AnnouncementBanner`

### Changed changelog notifications
- backend: `poetry run pytest tests/test_router_changelog.py`
- frontend: `npm test -- NotificationMenu ChangelogAdmin api AppShell`
- If the migration changed too, also run: `poetry run pytest tests/test_database.py tests/test_migrations_bootstrap.py`

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

### Changed Helm charts
- lint: `for chart in charts/*/; do helm lint "$chart"; done`
- validate: `for chart in charts/*/; do helm template test "$chart" | kubeconform -strict -summary -schema-location default -ignore-missing-schemas; done`

### Changed release / CI workflows
- verify: review `.github/workflows/` and `release-please-config.json` /
  `.release-please-manifest.json`; confirm conventional-commit PR title (the
  `pr-title-lint.yaml` check). See [RELEASE_AND_DEPLOY_FLOW.md](RELEASE_AND_DEPLOY_FLOW.md).

### Changed backup service
- skill: [`.agents/skills/testing-backup-service/SKILL.md`](../.agents/skills/testing-backup-service/SKILL.md)

## Notes

- Vitest patterns match by path substring, so `npm test -- api.test` runs
  `api.test.ts`, and `npm test -- useImageActions` runs `useImageActions.test.ts`.
- When in doubt about which files a feature touches, consult the
  [agent feature map](agent-feature-map.md).
- This matrix lists the *most relevant* tests, not an exhaustive set — always run
  the full suite before merging.
