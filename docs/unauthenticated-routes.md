# Unauthenticated Routes and Enforcement Layers

Standing rule and route-by-route audit for every HTTP path reachable without
authentication, resolving [#1079](https://github.com/bcit-tlu/hriv/issues/1079).
Until this page, each unauthenticated route was decided locally in the PR that
added it; this page is now the single answer to _"who may reach this route, and
which layer enforces that?"_

Audited at backend 0.48.0 / frontend 0.50.0 (2026-08-31).

## The standing rule

1. **Authenticated by default.** Every route requires application
   authorization (`Depends(get_current_user)` or `require_role`, see
   `backend/app/auth.py`) unless it appears in the allowlist below. There is
   deliberately no optional-auth pattern in the codebase (an endpoint either
   401s or ignores identity); do not introduce one — resolving a user "just to
   add detail" creates DB sessions on probe paths and 401 asymmetry for
   expired tokens (see the `/api/health/queue` history in #1077).
2. **Adding an unauthenticated route requires updating this page** in the same
   PR, classifying it as one of the three enforcement layers below. A route
   not listed here that skips auth is a bug.
3. **Content-bearing resources are never public.** Anything that serves user
   or course content (images, tiles, thumbnails, exports, metadata) must be
   enforced at the application layer or by an application-issued credential —
   never by obscurity of the URL. Numeric IDs in URLs are enumerable.
4. **"Cluster-internal" must be enforced, not just documented.** A route
   intended for in-cluster consumers (metrics scrapers, probes) must be
   blocked at the public edge (frontend nginx and/or ingress) _and_ the
   backend Service must not be otherwise exposed. Documentation alone is not
   an enforcement layer.
5. **Signed-credential routes** (no bearer header) are permitted when a
   browser navigation or high-volume delivery path cannot carry an
   `Authorization` header. Credentials must be short-lived, purpose-scoped,
   and resource-bound (e.g. the admin task-download token; the tile token
   designed in #1069). Validation must not require a DB query on hot paths.

### Enforcement layers

| Layer                    | Meaning                                                       | Where it lives                                                        |
| ------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| **app-authz**            | FastAPI dependency enforces identity/role                     | `backend/app/auth.py`, per-endpoint                                   |
| **app-credential**       | Application-issued signed, short-lived, resource-scoped token | issuing endpoint + validator                                          |
| **edge-restricted**      | Blocked or filtered before reaching the app                   | `charts/frontend/files/default.conf.template`, ingress, NetworkPolicy |
| **intentionally public** | Anyone may call it; response must be safe for the world       | this page                                                             |

## Route-by-route classification

### FastAPI — intentionally public

| Route                                          | Purpose                                                                                      | Notes                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/login`                         | Local login                                                                                  | By design (`routers/auth.py`)                                                                                                                                                                                                                                                                           |
| `GET /api/auth/oidc/enabled`                   | Login-screen feature probe                                                                   | Boolean only (`routers/oidc.py`)                                                                                                                                                                                                                                                                        |
| `GET /api/auth/oidc/login`                     | OIDC redirect                                                                                | By design                                                                                                                                                                                                                                                                                               |
| `GET /api/auth/oidc/callback`                  | OIDC callback                                                                                | OAuth state validated via session middleware                                                                                                                                                                                                                                                            |
| `GET /api/status`                              | Maintenance-overlay polling (`MaintenanceBanner` via `fetchStatus`) and synthetic monitoring | Leaks version string; accepted                                                                                                                                                                                                                                                                          |
| `GET /api/announcement/`                       | Login-screen announcement banner                                                             | Public **by design** — `LoginScreen.tsx` renders it pre-auth. Write path (`PUT`) is admin/instructor.                                                                                                                                                                                                   |
| `GET /api/health`                              | Liveness probe                                                                               | Static response                                                                                                                                                                                                                                                                                         |
| `GET /api/health/queue`                        | Queue probe                                                                                  | Returns only `ok`/`degraded`; detail lives on `/api/metrics` (see #1077)                                                                                                                                                                                                                                |
| `GET /docs`, `GET /redoc`, `GET /openapi.json` | FastAPI auto-generated API docs/schema (defaults not disabled in `main.py`)                  | Unreachable through the frontend nginx (unprefixed paths fall into the SPA location), but exposed on any direct backend access (dev compose `:8000`, in-cluster Service). Schema reveals route surface only, no data; acceptable once the backend Service is edge/NetworkPolicy-restricted (see below). |

### FastAPI — app-credential

| Route                                     | Credential                                                                                               | Notes                                                                                                                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/admin/tasks/{task_id}/download` | Short-lived JWT in query string, `purpose=task-download`, task-bound (`routers/admin.py`)                | Query-string tokens can leak via logs/referrers; hardening tracked in a follow-up issue (see below).                                                                                 |
| `GET /api/tiles/{source_image_id}/{path}` | Short-lived JWT in query string, `purpose=tile`, scoped to `source_image_id`                             | FastAPI fallback route added by PR [#1159](https://github.com/bcit-tlu/hriv/pull/1159); responses use `Cache-Control: private, max-age=2592000`.                                     |
| `GET /api/tiles-auth`                     | Same tile token, supplied by query string, `X-Tile-Token`, or `X-Original-URI` from nginx `auth_request` | DB-free validator added by PR [#1159](https://github.com/bcit-tlu/hriv/pull/1159); sidecar enforcement/cache wiring added by PR [#1163](https://github.com/bcit-tlu/hriv/pull/1163). |

### FastAPI — cluster-internal (edge-restricted)

| Route                     | Current enforcement                                                                                                       | Status                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/metrics`        | Frontend nginx returns 404 (`default.conf.template`); scraped in-cluster via ServiceMonitor against the ClusterIP Service | ⚠ **Partial.** The app itself is unauthenticated and there is no NetworkPolicy restricting the backend Service, so any in-cluster or port-forwarded client (and dev compose on `:8000`) reads queue depth, worker heartbeat age, and execution mode. Enforcement fix: opt-in backend NetworkPolicy in PR [#1160](https://github.com/bcit-tlu/hriv/pull/1160) (enable per deployment overlay). |
| `GET /api/health/ready`   | Frontend nginx returns 404 (`default.conf.template`); kubelet probes the backend pod directly                             | The readiness handler remains unauthenticated for kubelet access, but public frontend-ingress requests are blocked before they reach the DB and storage checks.                                                                                                                                                                                                                               |
| `GET /api/health/storage` | Frontend nginx returns 404 (`default.conf.template`); kubelet probes the backend pod directly                             | The storage liveness handler remains unauthenticated for kubelet access, but public frontend-ingress requests are blocked before they reach the storage check.                                                                                                                                                                                                                                |

### FastAPI — mismatches (violate rule 3)

No known mismatches. Tile delivery moved to **app-credential** in PR
[#1159](https://github.com/bcit-tlu/hriv/pull/1159) (backend fallback route and
validator) plus PR [#1163](https://github.com/bcit-tlu/hriv/pull/1163) (nginx
sidecar enforcement and private cache headers).

All other FastAPI routes (admin, bulk-import, categories, changelog, groups,
images, issues, programs, telemetry, tile-order, upload, users) are
**app-authz**; `docs/TESTING.md` carries the endpoint → minimum-role table.

### Frontend nginx (production image / chart)

`charts/frontend/files/default.conf.template` (also baked into the image by
`frontend/Dockerfile`):

| Location                            | Behaviour                                                                                                                                                                                                                | Classification                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `/assets/`, `/` (SPA), `= /version` | Static app shell. The SPA root also serves everything in `frontend/public/` verbatim (`THIRD-PARTY-LICENSES.txt`, logos, splash images) — treat that directory as world-readable and never place non-public files in it. | Intentionally public                                      |
| `/api/`                             | Proxy to backend                                                                                                                                                                                                         | Auth enforced by the app (layer: app-authz)               |
| upload regex location               | Proxy to backend with larger body cap                                                                                                                                                                                    | app-authz                                                 |
| `/api/tiles/`                       | Proxy to the tiles sidecar when enabled, otherwise backend fallback; query string is preserved so the image-scoped `tile_token` reaches the validator; upstream sends `Cache-Control: private, max-age=2592000`          | app-credential (#1159/#1163)                              |
| `= /api/metrics`                    | `return 404`                                                                                                                                                                                                             | Edge restriction for the cluster-internal route above     |
| `= /api/health/ready`               | `return 404`                                                                                                                                                                                                             | Edge restriction; kubelet probes the backend pod directly |
| `= /api/health/storage`             | `return 404`                                                                                                                                                                                                             | Edge restriction; kubelet probes the backend pod directly |

### Kubernetes / ingress

- `charts/frontend/templates/ingress.yaml` annotations are values-driven; the
  chart itself imposes no path allowlist. The frontend nginx configuration
  explicitly blocks `/api/health/ready` and `/api/health/storage` before the
  generic API proxy. Kubelet probes continue to call those paths directly on
  the backend pod.
- PR [#1160](https://github.com/bcit-tlu/hriv/pull/1160) adds an opt-in
  NetworkPolicy to `charts/backend` restricting ingress to the frontend proxy
  and the metrics-scraper — required for rule 4 to hold for `/api/metrics`.
  The policy is disabled by default and must be enabled in the deployment
  overlay; when disabled, no NetworkPolicy restricts direct access to the
  backend Service (the frontend chart ships one for itself only).

### Development-only exposure (docker-compose)

Not a production surface, listed for completeness: Postgres `:5432`, Redis
`:6379`, and the backend `:8000` (which bypasses the frontend nginx, so
`/api/metrics` is directly reachable and `/api/tiles/**` uses the FastAPI
tile-token fallback route) are bound to the host in `docker-compose.yml`. The
Vite dev server (`:5173`) is dev-only; the production image serves via nginx.

### Cross-cutting note — CORS

`backend/app/main.py` falls back to `allow_origins=["*"]` **with**
`allow_credentials=True` when `CORS_ORIGINS` is unset, and
`charts/backend/values.yaml` defaults `corsOrigins: ''`. Deployments must set
it; hardening the default is tracked in a follow-up issue (see below).

## Gaps and owners

| Gap                                                                    | Owner                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `/api/metrics` cluster-internal not enforced beyond frontend nginx 404 | PR [#1160](https://github.com/bcit-tlu/hriv/pull/1160) (chart NetworkPolicy; enable in overlays) |
| Admin task-download token in query string                              | #1153                                                                                            |
| CORS wildcard + credentials default                                    | #1154                                                                                            |

## Related

- [`docs/category-visibility-and-programs.md`](category-visibility-and-programs.md) — the visibility model tile delivery must honour
- [`docs/TESTING.md`](TESTING.md) — endpoint → minimum-role table
- [`docs/observability-conventions.md`](observability-conventions.md) — metrics/scrape conventions
- #1069 — authorized tile-delivery boundary design (ADR)
- #1064 — tile/thumbnail authorization enforcement
