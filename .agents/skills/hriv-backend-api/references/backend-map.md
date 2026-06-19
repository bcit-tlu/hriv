# Backend Map

## Primary Files

| Concern | Files |
|---|---|
| App setup, router registration, lifespan | `backend/app/main.py` |
| DB session and engine | `backend/app/database.py` |
| SQLAlchemy models | `backend/app/models.py` |
| Pydantic request/response models | `backend/app/schemas.py` |
| Serializing ORM objects | `backend/app/serializers.py` |
| Auth dependencies, JWT, roles | `backend/app/auth.py`, `backend/app/authz.py` |
| Request audit logging | `backend/app/middleware.py`, `backend/app/logging_config.py` |
| Rate limiting | `backend/app/rate_limit.py` |
| Alembic bootstrap | `backend/app/migrations_bootstrap.py`, `backend/app/migrations/` |
| Background worker | `backend/app/worker.py` |
| Image processing | `backend/app/processing.py`, `backend/app/image_validation.py` |
| Student visibility | `backend/app/visibility.py` |
| API routers | `backend/app/routers/*.py` |

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

## Documentation To Read When Relevant

- `../../../backend/README.md`: backend setup and migrations.
- `../../../docs/domain-model.md`: model relationships and schema reference.
- `../../../docs/TESTING.md`: endpoint role table and test cases.
- `../../../docs/agent-test-matrix.md`: targeted test selection.
- `../../../docs/observability-conventions.md`: logging/tracing conventions.
