# Backend (FastAPI)

This backend is built with FastAPI and managed with Poetry.

## Testing Setup

The backend test runner is configured with **pytest** and includes:

- `pytest` for test execution
- `pytest-asyncio` for async test support
- `pytest-cov` for coverage reporting

Configuration is defined in `pyproject.toml` under:

- `[tool.poetry.group.dev.dependencies]`
- `[tool.pytest.ini_options]`

### Current pytest defaults

- Test discovery path: `tests`
- Python import path: project root (`.`)
- Async mode: `auto`
- Coverage target: `app`
- Coverage report: terminal with missing lines
- Coverage enforcement: not enabled by default (use `--cov-fail-under=80` to enforce)

---

## Install Dependencies

From the `backend` directory:

```sh
poetry install
```

If dev dependencies are not installed by default in your Poetry setup, use:

```sh
poetry install --with dev
```

---

## Run Tests

From `backend`:

```sh
poetry run pytest
```

This is the **local/default** command and includes coverage reporting from configured `addopts`.

Run a single test file:

```sh
poetry run pytest tests/test_auth.py
```

Run a single test function:

```sh
poetry run pytest tests/test_auth.py::test_hash_password_and_verify_password_roundtrip
```

Run with a **strict coverage gate** (recommended for CI or pre-merge checks):

```sh
poetry run pytest --cov-fail-under=80
```

---

## Coverage

The default `poetry run pytest` command reports coverage but does **not** enforce a fail-under threshold.

Use `--cov-fail-under=80` when you want to enforce minimum coverage (aligns with `AGENTS.md` guidance of >80%):

```sh
poetry run pytest --cov-fail-under=80
```

---

## Test Structure

- Put backend tests in `backend/tests/`
- Name files `test_*.py`
- Keep tests focused on units (pure functions/helpers/guards) unless integration behavior is intentional
- For new functions, add unit tests to align with `AGENTS.md` guidance

Example files already included:

- `tests/test_auth.py`
- `tests/test_database.py`

---

## Notes

- Unit tests should avoid requiring a live database where possible (use mocks/stubs).
- Async test functions are auto-detected by `pytest-asyncio` (`asyncio_mode = "auto"`); no `@pytest.mark.asyncio` decorator is needed.
- Keep tests deterministic and independent.

---

## Database migrations (Alembic)

The backend uses [Alembic](https://alembic.sqlalchemy.org/) for schema
migrations.  The config lives in `backend/alembic.ini` and the migration
scripts in `backend/app/migrations/versions/`.

### Running migrations

Alembic is the sole source of truth for the schema.  At deployment time,
prefer the bootstrap helper which runs ``alembic upgrade head`` under a
``pg_advisory_lock`` so concurrent pods (Helm ``replicaCount > 1``)
serialize on the database rather than racing on the baseline
``CREATE TABLE``:

```sh
DATABASE_URL=postgresql+asyncpg://... poetry run python -m app.migrations_bootstrap
```

The helper is wired into `docker-compose.yml` as a `migrate` service
(the `backend`, `worker` and `seed` services depend on it completing
successfully) and into the Helm chart as an `initContainer` on the
backend Deployment.

For manual ops you can invoke Alembic directly from `backend/`:

```sh
DATABASE_URL=postgresql+asyncpg://... poetry run alembic upgrade head      # apply migrations
DATABASE_URL=postgresql+asyncpg://... poetry run alembic current           # show current revision
DATABASE_URL=postgresql+asyncpg://... poetry run alembic downgrade -1      # revert the latest migration
```

### Authoring a new migration

Any schema change (new table, new column, index, default, etc.) goes
through a new Alembic revision.

1. Make the change in `backend/app/models.py`.
2. Generate a revision (requires a live DB at `DATABASE_URL` pointing at
   the current `head` state):

   ```sh
   DATABASE_URL=postgresql+asyncpg://... \
     poetry run alembic revision --autogenerate -m "add_foo_column_to_bar"
   ```

3. Review the generated file in `app/migrations/versions/`.  Autogenerate
   is a heuristic — always check it captures the change you intended
   and no spurious drops.
4. Run `poetry run alembic upgrade head` locally against a test DB to
   make sure the migration applies cleanly.
5. Commit the migration alongside the model change.

### Legacy / existing deployments

Deployments whose database was bootstrapped before Alembic existed
(i.e. produced by `db/init.sql` directly) should run the bootstrap
helper once.  It detects the legacy schema — presence of the `programs`
table without an `alembic_version` table — and stamps `head` so that
future migrations apply on top of the existing schema without
re-creating any tables.

---

## JWT_SECRET

The backend signs access tokens with `JWT_SECRET`. Setting it correctly is
**mandatory** for any deployment that runs more than one Uvicorn worker or
more than one replica — without a stable, shared secret each worker generates
its own ephemeral value at startup, and tokens signed by one worker fail
validation on another, producing random authentication errors.

| Env var                | Default | Purpose                                                                                       |
| ---------------------- | ------- | --------------------------------------------------------------------------------------------- |
| `JWT_SECRET`           | *empty* | Stable secret used to sign/verify JWTs across all workers and replicas.                       |
| `REQUIRE_JWT_SECRET`   | `false` | When `true`, the app refuses to start unless `JWT_SECRET` is set. Enable in all multi-worker/multi-replica deployments. |
| `JWT_INSTANCE_EPOCH`   | *empty* | Optional override for the per-instance epoch claim. Derived from `JWT_SECRET` when blank.     |

### Local dev

Leave `JWT_SECRET` empty and `REQUIRE_JWT_SECRET=false` (the default). The
backend generates an ephemeral random secret on startup so tokens are
invalidated whenever the container restarts — convenient for dev, but not
safe for production.

### Production (single-host, multi-worker)

The production Dockerfile runs `uvicorn --workers 2`, so `JWT_SECRET` is
already required there. Supply it via `.env`, a Compose `environment:` entry,
or your orchestrator's secret store, and set `REQUIRE_JWT_SECRET=true` to
fail fast on misconfiguration:

```sh
export JWT_SECRET="$(openssl rand -base64 48)"
export REQUIRE_JWT_SECRET=true
```

### Production (Kubernetes via Helm)

The Helm chart (`charts/backend`) auto-generates a random `JWT_SECRET` on
first install and stores it in a dedicated `Opaque` Secret
(`<release>-jwt`). The deployment wires `JWT_SECRET` from that Secret and
sets `REQUIRE_JWT_SECRET=true` unconditionally, so the pod refuses to start
if the Secret is missing or empty.

To supply your own pre-existing secret, set `jwtSecret` in `values.yaml` (or
manage the `<release>-jwt` Secret out-of-band and the chart will honour the
existing value).
