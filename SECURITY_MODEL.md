# HRIV Image Library — threat model

Scope: `bcit-tlu/hriv` at `main` (backend 0.48+ / frontend 0.50+). Context only (not scanned): the deployment overlays for the `latest`/`stable` environments, which live in a separate private repo.
Status: **draft inferred from code and repo docs** (first written for a Devin security scan, 2026-11). Statements are a reading of the code unless marked _(maintainer)_; edit this file as decisions are made so later scans start from it.

## System overview and trust boundaries

HRIV is a FastAPI + React SPA for viewing, curating and annotating deep-zoom microscopy images for BCIT courses.

```
browser ──▶ HAProxy gateway (overwrites XFF) ──▶ ingress-nginx ──▶ frontend nginx (charts/frontend)
                                                     │  /api/*        ─▶ FastAPI (backend/app/main.py)
                                                     │  /api/tiles/*  ─▶ tiles nginx sidecar (auth_request /api/tiles-auth)
FastAPI ─▶ PostgreSQL (CNPG, Vault dynamic creds) · Redis (arq queue, rate limit) · PVCs (source images, tiles, exports)
arq workers (worker.py, counting/worker.py) ─▶ pyvips processing, tile rebuilds, measurement/counting
backup CronJob (backup/) ─▶ Azure Blob · restore-validation (isolated namespace)
```

Boundaries, in order of importance:

1. **Internet → edge**: anything not behind `get_current_user`/`require_role` (allowlist in `docs/unauthenticated-routes.md`).
2. **Role boundary**: admin > instructor > staff > student (`auth.py`, `authz.py`, `require_role`). OIDC maps IdP groups to roles (`routers/oidc.py` `_resolve_role`, highest wins) and programs (`Program.oidc_group`).
3. **Student visibility boundary**: dual program AND group gate up the category ancestor chain (`visibility.py`, enforced in `routers/categories.py`, `routers/images.py`, `routers/collections.py`). Frontend filtering is UX only.
4. **Tile content boundary**: stateless HMAC `tile_token` (`tile_tokens.py`), validated DB-free by nginx `auth_request`; `thumb` purpose is restricted to `thumbnail.jpeg`; dot-segment tile paths are rejected by both the sidecar and the validator so the checked path is the served path (`docs/tile-delivery-boundary.md`).
5. **Cluster-internal**: `/api/metrics`, `/api/health/{ready,storage}`, `/api/_probe` are 404'd by frontend nginx, and the backend API NetworkPolicy (`charts/backend/templates/networkpolicy.yaml`, `networkPolicy.enabled`) is **enabled in both deployment overlays** (2026-11): deny-all ingress on the API pods except the frontend proxy (`http` + `tiles` ports) and the Prometheus metrics scraper. The chart default stays `enabled: false` because the peer selectors are deployment-specific. The latest-only counting worker additionally ships its own policy (deny-all ingress; egress only to Redis, kube-dns and the OTel collector) via `countingWorker.networkPolicy`.
6. **Worker/file boundary**: user-supplied images and admin archives are parsed by pyvips, `tarfile` (`filter="data"`), `pg_restore`/`psql` subprocesses in `admin_ops.py`.

## Components

| Component              | Code it covers                                                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend**           | `frontend/` (React SPA, OpenSeadragon, Fabric.js annotations, markdown rendering of changelog/announcements)                                                                                                            |
| **Auth**               | `backend/app/auth.py`, `authz.py`, `password_tokens.py`, `rate_limit.py`, `middleware.py` (`get_client_ip`), `routers/auth.py`, `routers/oidc.py`, `routers/users.py`                                                   |
| **API**                | other `backend/app/routers/*` (categories, images, collections, groups, programs, measurements, counts, issues, telemetry, changelog, announcement, jobs, tile_order), `visibility.py`, `serializers.py`, `feedback.py` |
| **Tile delivery**      | `tile_tokens.py`, `routers/tiles.py`, `charts/backend/templates/configmap-nginx-tiles.yaml`, fallback tile serving via `routers/tiles.py` (no `StaticFiles` mount in `main.py`)                                         |
| **Workers**            | `worker.py`, `processing.py`, `upload_staging.py`, `image_validation.py`, `routers/upload.py`, `counting/`, `measurement/`, `tile_rebuild_*.py`                                                                         |
| **Admin operations**   | `routers/admin.py`, `admin_ops.py`, `routers/bulk_import.py`, `backup_access.py`, `maintenance.py`, `reconciliation.py`                                                                                                 |
| **Backup and restore** | `backup/`, `restore-validation/`, `charts/backup`, `charts/restore-validation`                                                                                                                                          |
| **Infrastructure**     | `charts/frontend` (edge nginx `files/default.conf.template`, ingress, NetworkPolicy), `charts/backend`, `docker-compose*.yml`, `docker/`, `.github/workflows/`, Dockerfiles                                             |

## Entry points and who can reach them

- Public: `POST /api/auth/login` (Redis rate limit per IP+email and per email), OIDC login/callback, `GET /api/auth/oidc/enabled`, password-setup redemption (purpose-scoped token in body), `/version`, `/runtime-config.js`, health/liveness. `POST /api/telemetry/synthetic-result` takes a static `X-Synthetic-Ingest-Token` or synthetic-account JWT.
- Signed-credential: `/api/tiles/**` (`tile_token` query string), admin task download (`download-token` cookie).
- Any authenticated user: browse tree, images, collections (student access gated by `COLLECTIONS_STUDENT_ACCESS`, a deployment-configurable switch), issue reports, telemetry events, profile/password change.
- Instructor/admin: uploads (`/api/source-images/upload`, image replace), bulk import, categories/groups/programs management, measurements review.
- Admin only: DB export/import, files export/import, chunked uploads, tile rebuilds, file restore, backup archives/snapshots, maintenance mode, user management, source-image download.
- In-cluster: `/api/metrics` (Prometheus), probes, Redis, Postgres.

## Assets and sensitivity

- Course image content (source images, DZI tiles, thumbnails) hidden from students by program/group/hidden-subtree rules — the main confidentiality asset. Exception: category card covers (`card_thumb`) may show a thumbnail of an otherwise hidden image via a thumbnail-only `thumb` token; full tiles stay hidden.
- User records: names, emails, roles, program/group memberships, password hashes, password-setup tokens.
- Credentials: `JWT_SECRET` (signs sessions, tile tokens, download tokens), OIDC client secret, SMTP relay, Vault DB creds, Azure backup credentials, synthetic ingest token.
- Integrity of the catalogue: categories, annotations/`metadata_` JSONB, measurement scale, collections.
- Availability of the production (`stable`) deployment during teaching.

## Attacker profiles (inferred)

1. **Anonymous internet user** — login brute force, unauthenticated routes, tile URL enumeration, token forgery.
2. **Authenticated student** — sees hidden categories/images/tiles/collections, IDOR on numeric IDs, privilege escalation to instructor/admin, abusing collections/issue reports/telemetry.
3. **Instructor or staff** — exceeding scoped authority (attaching programs/groups they don't own, editing others' collections, reaching admin-only operations).
4. **Malicious file** uploaded by an instructor — parser bugs in pyvips/tar, path traversal, resource exhaustion in workers.
5. Admins: assumed trusted (inferred; not confirmed).

## Existing controls

- Default-authenticated routes with a documented allowlist (`docs/unauthenticated-routes.md`); no optional-auth pattern.
- `require_password_changed` on `get_current_user`; JWT epoch for session rotation; `REQUIRE_JWT_SECRET` in charts.
- Login rate limiting (Redis, fails open) with right-anchored XFF parsing (hop count configured per deployment via `TRUSTED_PROXY_HOPS`).
- CORS: explicit origin list with credentials; wildcard rejected in `required` mode.
- Tile HMAC tokens scoped to one `source_image_id`, ~15 min TTL, `Cache-Control: private`.
- Archive extraction with `tarfile` `filter="data"` and manifest validation; upload size caps enforced by backend streaming middleware (`_upload_body_limits` in `middleware.py`) for source-image upload/replace and bulk import; frontend nginx sets `client_max_body_size 0` on upload routes. Admin import uploads (`/api/admin/tasks/db-import`, `files-import`, `PUT tasks/<id>/upload`; chunked `PATCH` uploads are capped at 512 MiB per request) have no body cap and rely on admins being trusted.
- Trivy image scanning + Dependabot (`docs/security-scanning.md`).

## Out of scope / accepted risk

- None recorded from the user yet.
- Documented residual (repo docs, not a user statement): `tile_token` travels in the query string.

## Open questions

- Which assets matter most; which attackers count; whether admins are trusted.
- Whether dev-only docker-compose exposure, synthetic-monitoring and restore-validation are in scope.
- The backend API NetworkPolicy is enabled in both overlays (2026-11); keep the overlay's `metricsScraper` pod selectors aligned with the actual Prometheus deployment or scraping silently degrades (the policy matches zero peers rather than failing open).
