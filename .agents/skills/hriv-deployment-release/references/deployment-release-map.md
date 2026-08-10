# Deployment And Release Map

## Files

| Concern               | Files                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Local stack           | `docker-compose.yml`, `backend/.env`, service Dockerfiles                                                                                |
| Frontend image/chart  | `frontend/Dockerfile`, `charts/frontend/`                                                                                                |
| Backend image/chart   | `backend/Dockerfile`, `charts/backend/`                                                                                                  |
| Backup image/chart    | `backup/Dockerfile`, `charts/backup/`                                                                                                    |
| Backup implementation | `backup/backup.py`, `backup/README.md`                                                                                                   |
| Release tooling       | `.release-please-manifest.json`, `.github/workflows/`, component changelogs                                                              |
| Deploy docs           | `deploy/README.md`, `docs/RELEASE_AND_DEPLOY_FLOW.md`                                                                                    |
| Observability         | `docs/observability-conventions.md`, `docs/observability-operations.md`, `docs/observability-runbooks.md`, backend tracing/logging files |

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

## Local .env / Docker Compose Setup

Docker Compose requires `backend/.env`, which does not exist on a fresh clone
(`.env` is gitignored) — `docker compose up` fails with "env file not found".
Copy the canonical example `backend/.env.vault-example` to `backend/.env` and
replace `OIDC_CLIENT_SECRET`. Notable values:

- `DATABASE_URL=postgresql+asyncpg://hriv:hriv@db:5432/hriv`,
  `REDIS_URL=redis://redis:6379`, `SOURCE_IMAGES_DIR=/data/source_images`,
  `TILES_DIR=/data/tiles`, `JWT_SECRET=change-me-local-dev-secret`,
  `CORS_ORIGINS=http://localhost:5173`, `OIDC_ENABLED=true`.
- `OIDC_ISSUER` must be the **full** Vault provider path including port 8200 and
  `/v1/identity/oidc/provider/<name>` (the backend appends
  `/.well-known/openid-configuration`); the bare base URL fails discovery. See
  `hriv-access-control` skill `references/oidc-vault-idp.md`.
- `OIDC_TRUST_EMAIL=true`, `OIDC_SCOPES=openid email profile`,
  `OIDC_ROLE_MAPPING={...}`,
  `OIDC_REDIRECT_URI=http://localhost:8000/api/auth/oidc/callback`.

`docker-compose.yml` overrides `DATABASE_URL`/`REDIS_URL` with Docker service
names (`db`, `redis`), so the host values in `.env` only matter for non-Docker
local dev. The project was formerly "corgi" — replace any stray `corgi`
references with `hriv` (the `corgi_token`/`corgi_user` localStorage migration was
removed; the frontend uses `hriv_token`/`hriv_user`). `frontend/package-lock.json`
IS tracked (PR #310), so `npm ci` uses it for deterministic installs.

## Kubernetes Database Credentials (Vault Dynamic Secrets)

In Kubernetes, HRIV uses Vault Dynamic Secrets via the Vault Secrets Operator /
`VaultDynamicSecret` CRD — not the static `hriv` owner role used in
docker-compose.

- Backend API, backend worker, seed/migration job, and backup workload all read
  `DATABASE_URL` from the shared K8s Secret `postgres-db-credentials`, key `uri`.
  Older `hriv-backend-db-app` references are stale. The backup chart's
  `postgresSecretName` defaults to `postgres-db-credentials`; do not override it
  to a separate secret in flux overlays.
- Vault dynamic DB credentials create temporary PostgreSQL roles with limited
  privileges. "Permission denied" in production often means the Vault DB role's
  grants/default privileges do not cover a newly created table. The CNPG cluster
  template has `postInitApplicationSQL` default privileges for the initial role,
  but Alembic-created tables may need matching default-privilege grants for the
  migration owner role.
- When debugging, confirm HRIV chart `secretKeyRef.name` values and flux-fleet
  `VaultDynamicSecret.destination.name` values match exactly. All workloads that
  share the dynamic credential must be in the VSO `rolloutRestartTargets` so pods
  restart after credential rotation.
- Chart references: `charts/backend/templates/deployment.yaml`,
  `charts/backend/templates/deployment-worker.yaml`,
  `charts/backend/templates/job-seed-admin.yaml`,
  `charts/backend/templates/secrets.yaml`, `charts/backup/values.yaml`.

## Docs To Read

- `../../../../docs/RELEASE_AND_DEPLOY_FLOW.md`
- `../../../../docs/observability-conventions.md`
- `../../../../docs/observability-operations.md`
- `../../../../docs/observability-runbooks.md`
- `../../../../backup/README.md`
- `../../../../charts/backend/README.md`
