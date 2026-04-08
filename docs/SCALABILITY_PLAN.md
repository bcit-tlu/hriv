# CORGI Scalability Implementation Plan

**Target load:** ~30 concurrent students (shared account) + 2–3 instructors,
with peak doubling to ~60 students + 5–6 instructors.

This document tracks the phased implementation of scalability, security, and
observability improvements.  Each phase is self-contained and can be picked up
by a new session.  Mark phases **DONE** as they are completed so subsequent
sessions know where to start.

---

## Phase 1 — Foundation  `DONE`

> Zero-risk configuration and hardening changes.  No functional code changes;
> all additive.  Ship as a single PR.

- [x] **1.1 Explicit `JWT_SECRET`** — Read `JWT_SECRET` from environment with
  a secure random fallback.  Document that production deployments **must** set
  this via a Kubernetes Secret for multi-replica token consistency.
- [x] **1.2 CORS lock-down** — Replace `allow_origins=["*"]` with a
  configurable `CORS_ORIGINS` env var (comma-separated).  Default to `*` in dev
  for convenience; require explicit origins in production.
- [x] **1.3 Readiness probe** — Add `GET /api/health/ready` that verifies
  the database connection (`SELECT 1`).  Wire into Kubernetes liveness/readiness
  probes.
- [x] **1.4 DB connection pool tuning** — Expose `DB_POOL_SIZE` (default 10)
  and `DB_MAX_OVERFLOW` (default 20) env vars on the engine.  Enable
  `pool_pre_ping` to detect stale connections.

---

## Phase 2 — Observability  `DONE`

> Add request-level audit logging so every HTTP request is traceable.  Must be
> completed before Phase 3 so OIDC debugging has full visibility.

- [x] **2.1 Request audit middleware** — FastAPI middleware that logs every
  request with:
  - Correlation ID (generate UUID or honour inbound `X-Request-ID`)
  - Client IP (`request.client.host` + `X-Forwarded-For`)
  - Authenticated user ID (extracted from JWT when present)
  - HTTP method, path, response status, duration in ms
- [x] **2.2 Correlation ID propagation** — Use Python `contextvars` to make
  the correlation ID available to all downstream log calls within the same
  request, so processing logs and DB errors can be traced back to the
  originating HTTP request.
- [x] **2.3 Client session fingerprint header** — Frontend generates a random
  `session_id` on page load and sends it as `X-Session-ID` on every API call.
  The audit middleware logs this value, enabling correlation of all requests
  from a single browser tab — critical for distinguishing users behind the
  shared student account.

---

## Phase 3 — Identity (OIDC / OAuth)  `DONE`

> The single most impactful change.  Gives every student their own identity,
> solves forensic logging, and delegates password management to the IdP.

- [x] **3.1 Backend OIDC endpoints** — Add `/api/auth/oidc/login` (redirect to
  IdP) and `/api/auth/oidc/callback` (exchange code, upsert user, issue JWT).
  Use `authlib` or manual OIDC flow with `httpx`.
- [x] **3.2 User model migration** — Add `oidc_subject` column to `users`
  table for IdP user mapping.  `password_hash` is already nullable.
- [x] **3.3 IdP role mapping** — Map IdP groups/claims to CORGI roles
  (e.g. `bcit-tlu-instructors` → `instructor`).  Default unmapped users to
  `student`.
- [x] **3.4 Frontend OIDC login** — Add "Sign in with BCIT" button on
  `LoginScreen.tsx`.  Keep local email/password login as a fallback for admin
  bootstrap accounts.
- [x] **3.5 Documentation** — Document IdP configuration requirements (client
  ID, client secret, redirect URI, required scopes/claims).

---

## Phase 4 — Performance  `DONE`

> Isolated infrastructure and query optimisations.  No interaction with auth
> or identity; safe to tackle independently.

- [x] **4.1 Serve tiles via nginx / CDN** — Configure the Kubernetes ingress
  (or an nginx sidecar) to serve `/api/tiles` directly from the PVC, bypassing
  the Python process.  Tiles are immutable and cache-friendly.
- [x] **4.2 Optimise category tree query** — Replace the recursive
  `_load_tree()` with a flat CTE or two-query approach (all categories + all
  images), then assemble the tree in Python.  Add `Cache-Control` / `ETag`
  headers to reduce redundant fetches.

---

## Phase 5 — Refinements  `DONE`

> Low-urgency improvements with no downstream dependencies.

- [x] **5.1 Overlay optimistic concurrency** — Add a `version` column to
  `images`.  Frontend sends `If-Match: <version>` on overlay-lock PATCH;
  backend returns `409 Conflict` if the row has been modified since the client
  last read it.
- [x] **5.2 Task queue for image processing** — Replace `BackgroundTasks` with
  a dedicated task queue (Celery + Redis or arq).  Adds retry, monitoring, and
  independent scaling of workers.  Only pursue if upload volume grows
  significantly beyond current levels.
- [x] **5.3 Login rate limiting** — Add rate limiting on `/api/auth/login`
  (e.g. nginx `limit_req` or Redis-backed middleware) to prevent brute-force
  attacks, especially important while the shared student password exists.

---

## How to use this document

1. **Starting a new session?**  Scan the phase headers for the first one marked
   `TODO` — that is where work should resume.
2. **Completing a phase?**  Change its header marker from `TODO` to `DONE`,
   check off all sub-items, and commit the update in the same PR as the code
   changes.
3. **Need context?**  The full analysis is in the PR description of the Phase 1
   PR and in the attached `corgi-scalability-analysis.md` shared with the
   project owner.
