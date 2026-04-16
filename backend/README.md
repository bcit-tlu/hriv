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

At deployment time, prefer the bootstrap helper which auto-detects
legacy databases (created via `db/init.sql` / CNPG `postInitApplicationSQL`)
and stamps `head` on them instead of re-creating existing tables:

```sh
DATABASE_URL=postgresql+asyncpg://... poetry run python -m app.migrations_bootstrap
```

The helper is wired into `docker-compose.yml` as a `migrate` service
(the `backend` and `worker` services depend on it completing
successfully) and into the Helm chart as an `initContainer` on the
backend Deployment.

For manual ops you can invoke Alembic directly from `backend/`:

```sh
DATABASE_URL=postgresql+asyncpg://... poetry run alembic upgrade head      # apply migrations
DATABASE_URL=postgresql+asyncpg://... poetry run alembic current           # show current revision
DATABASE_URL=postgresql+asyncpg://... poetry run alembic stamp head        # mark pre-existing schema as migrated
DATABASE_URL=postgresql+asyncpg://... poetry run alembic downgrade -1      # revert the latest migration
```

### Authoring a new migration

Any schema change (new table, new column, index, default, etc.) goes
through a new Alembic revision — do **not** edit `db/init.sql` or the
Helm `configmap-initdb.yaml` by hand anymore.

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
helper once.  It detects the legacy schema — presence of the `images`
table without an `alembic_version` table — and stamps `head` so that
future migrations apply on top of the existing schema without
re-creating any tables.
