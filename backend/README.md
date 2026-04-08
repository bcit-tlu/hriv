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
