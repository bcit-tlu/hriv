# Backend Map

## Primary Files

| Concern                                  | Files                                                            |
| ---------------------------------------- | ---------------------------------------------------------------- |
| App setup, router registration, lifespan | `backend/app/main.py`                                            |
| DB session and engine                    | `backend/app/database.py`                                        |
| SQLAlchemy models                        | `backend/app/models.py`                                          |
| Pydantic request/response models         | `backend/app/schemas.py`                                         |
| Serializing ORM objects                  | `backend/app/serializers.py`                                     |
| Auth dependencies, JWT, roles            | `backend/app/auth.py`, `backend/app/authz.py`                    |
| Request audit logging                    | `backend/app/middleware.py`, `backend/app/logging_config.py`     |
| Rate limiting                            | `backend/app/rate_limit.py`                                      |
| Alembic bootstrap                        | `backend/app/migrations_bootstrap.py`, `backend/app/migrations/` |
| Background worker                        | `backend/app/worker.py`                                          |
| Image processing                         | `backend/app/processing.py`, `backend/app/image_validation.py`   |
| Student visibility                       | `backend/app/visibility.py`                                      |
| API routers                              | `backend/app/routers/*.py`                                       |

## Router Boundaries

- `auth.py`: login, `/me`, token payloads, OIDC-adjacent user info.
- `oidc.py`: OIDC flow endpoints and callback handling.
- `categories.py`: category CRUD, tree loading, visibility filtering,
  category restriction warnings, ETag tree responses.
- `images.py`: image CRUD, metadata updates, optimistic concurrency, image
  visibility, source-image links.
- `upload.py`: source-image upload and processing enqueue.
- `groups.py`: group CRUD, roster management, co-owner management.
- `users.py`: people/admin user listing and updates.
- `programs.py`: program CRUD and OIDC group-backed programs.
- `admin.py`: export/import/admin task endpoints.
- `announcement.py`, `changelog.py`, `issues.py`: smaller admin-facing features.

## Schema Change Checklist

1. Update `backend/app/models.py`.
2. Update `backend/app/schemas.py` and serializers if response/request shapes
   change.
3. Generate an Alembic revision with `DATABASE_URL=... poetry run alembic
revision --autogenerate -m "<message>"`.
4. Review the migration by hand. Alembic autogenerate is a heuristic.
5. Update docs in the same PR when behavior, roles, config, or API changes.
6. Add backend tests for the migration or changed behavior.

## Audit Logging And Request Correlation

Every HTTP request passes through `AuditMiddleware` (`backend/app/middleware.py`),
which emits structured single-line JSON (NDJSON) to stdout:

- **`X-Request-ID`**: correlation ID (inbound header honored, else generated UUID;
  max 128 chars, alphanumeric + hyphens). Stored in a `ContextVar`
  (`request_id_ctx`) so downstream code and logs can include it.
- **`X-Session-ID`**: per-tab fingerprint (`crypto.randomUUID()` in `api.ts`).
  Critical for distinguishing users behind the shared student account.
- **User identity**: decoded from the JWT (expiry check skipped so identity is
  captured even for expired tokens).
- **Timing**: request duration in ms. **Client IP**: `request.client.host` +
  `X-Forwarded-For`.

The frontend sends both headers on every API call via `authHeaders()` in
`api.ts`. Logging config (`backend/app/logging_config.py`): `JSONFormatter`
emits ISO-8601 UTC timestamps, injects `request_id` from middleware context, and
quiets third-party loggers (uvicorn, sqlalchemy) to WARNING.

## Backend Test Conventions

- Tests live in `backend/tests/`: one `test_router_*.py` per router, plus
  `test_*.py` for core modules (`test_auth.py`, `test_middleware.py`, ...).
- `pytest-asyncio` runs in **auto mode** (`asyncio_mode = "auto"` in
  `pyproject.toml`) — no `@pytest.mark.asyncio` decorator needed.
- Mock ORM models with `SimpleNamespace` (not real SQLAlchemy objects); mock DB
  sessions with `AsyncMock` (`db.execute`, `db.get` return mocks). Call router
  functions **directly** (e.g. `await list_images(_make_user("admin"), db=db)`),
  not via TestClient/HTTP.
- Coverage gate is **>80%** (`addopts` runs `--cov-fail-under=80`).
- When a component or endpoint gains props/fields/callbacks, update test mocks
  and assertion expectations in the **same PR** (e.g. if `onAdd(name)` becomes
  `onAdd(name, oidcGroup)`, assert the full argument list). Devin Review flags
  missing coverage.

## Redis Graceful Degradation

Redis is **optional**; all Redis-dependent features degrade gracefully:

- **Image queue** (`worker.py`): `enqueue_process_source_image()` tries
  arq/Redis first; if unavailable it returns `False` and the upload router falls
  back to FastAPI `BackgroundTasks` (synchronous processing).
- **Login rate limiting** (`rate_limit.py`): `check_login_rate_limit()` returns
  `None` (allow) when Redis is down, with a 30s backoff after a connection
  failure so it does not hammer a dead Redis.
- **arq pool** (`worker.py`): `get_pool()` returns `None` when Redis is
  unavailable; callers must check for `None` before enqueuing.

New Redis-backed features should follow the pattern:

```python
pool = await get_pool()
if pool is None:
    return fallback_result  # in-process execution / skip rate check
# normal Redis-backed behavior
```

## Category Tree Loading (two queries + ETag)

`/api/categories/tree` (`_load_tree()` in `routers/categories.py`) is **O(2)
queries** regardless of tree depth:

1. Fetch ALL categories in one query.
2. Fetch ALL images in one query.
3. Index images by `category_id` and categories by `parent_id` in Python dicts.
4. Assemble the tree recursively in memory (no further DB calls). For students,
   hidden categories and inactive images are filtered out during assembly.

ETag caching: the endpoint computes an MD5 of the serialized JSON, returns
`304 Not Modified` on a matching `If-None-Match`, and sets
`Cache-Control: private, no-cache`. When changing the `Category`/`Image` models,
keep the flat-query + in-memory-assembly approach working.

## Migration And Import/Export Compatibility Safety

HRIV is deployed to Kubernetes `latest` and `stable` overlays (`stable` via
flux-fleet). Treat production/stable data as potentially real unless a
maintainer confirms otherwise for the task. (This supersedes any older "not yet
in production" guidance.)

- Prefer forward-compatible Alembic migrations that preserve or migrate existing
  data.
- Do not drop tables/columns, rewrite identifiers, or remove import support for
  older export shapes without an explicit product decision.
- If a destructive migration or import-format break seems warranted, flag the
  risk and ask for approval before implementing it.
- Local/dev test data can still be reset freely per repo setup/test instructions.

## Documentation To Read When Relevant

- `../../../../backend/README.md`: backend setup and migrations.
- `../../../../docs/domain-model.md`: model relationships and schema reference.
- `../../../../docs/TESTING.md`: endpoint role table and test cases.
- `../../../../docs/agent-test-matrix.md`: targeted test selection.
- `../../../../docs/observability-conventions.md`: logging/tracing conventions.
