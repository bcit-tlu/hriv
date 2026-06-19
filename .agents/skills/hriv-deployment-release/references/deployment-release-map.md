# Deployment And Release Map

## Files

| Concern | Files |
|---|---|
| Local stack | `docker-compose.yml`, `backend/.env`, service Dockerfiles |
| Frontend image/chart | `frontend/Dockerfile`, `charts/frontend/` |
| Backend image/chart | `backend/Dockerfile`, `charts/backend/` |
| Backup image/chart | `backup/Dockerfile`, `charts/backup/` |
| Backup implementation | `backup/backup.py`, `backup/README.md` |
| Release tooling | `.release-please-manifest.json`, `.github/workflows/`, component changelogs |
| Deploy docs | `deploy/README.md`, `docs/RELEASE_AND_DEPLOY_FLOW.md` |
| Observability | `docs/observability-conventions.md`, backend tracing/logging files |

## Release Components

- Frontend: Release Please type `node`; image
  `ghcr.io/bcit-tlu/hriv/hriv-frontend`.
- Backend: Release Please type `python`; image
  `ghcr.io/bcit-tlu/hriv/hriv-backend`.
- Backup: Release Please type `python`; image
  `ghcr.io/bcit-tlu/hriv/hriv-backup`.
- Charts publish to `oci://ghcr.io/bcit-tlu/hriv/charts`.

## Helm Validation

Use the commands from `AGENTS.md`. If `helm` or `kubeconform` is missing, run
through `nix-shell -p <executable>` per project setup instructions.

## Backup Notes

The backup service snapshots PostgreSQL and filesystem data, stores local or S3
archives, and supports restore. Keep the PostgreSQL client major version aligned
with the server image.

## Docs To Read

- `../../../docs/RELEASE_AND_DEPLOY_FLOW.md`
- `../../../docs/observability-conventions.md`
- `../../../backup/README.md`
- `../../../charts/backend/README.md`
