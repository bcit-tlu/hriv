"""Bootstrap Alembic against either a fresh or a pre-existing database.

This module is intended to run at deployment time (Dockerfile CMD entrypoint,
Helm initContainer, docker-compose ``command`` override, etc.) before the
FastAPI app is started.

It safely handles three cases:

1. **Fresh database** — no ``alembic_version`` table and no application
   tables.  Runs ``alembic upgrade head`` to create the full schema from
   scratch.
2. **Legacy database** — application tables already exist (e.g. because
   ``db/init.sql`` was applied via a Postgres initdb script or CNPG
   ``postInitApplicationSQL``) but ``alembic_version`` does not.  Stamps
   the baseline revision (``_LEGACY_BASELINE_REVISION``) so Alembic
   records the pre-existing schema as already migrated without
   attempting a duplicate ``CREATE TABLE``, then runs
   ``alembic upgrade head`` in the same bootstrap pass so any migrations
   beyond the baseline are applied immediately.
3. **Already-managed database** — ``alembic_version`` exists.  Runs
   ``alembic upgrade head`` to apply any pending revisions.

The detection query looks for a sentinel table (``images``) rather than
enumerating every model, so adding new models in future migrations does
not break the legacy-DB stamp path.
"""
from __future__ import annotations

import asyncio
import contextlib
import hashlib
import logging
import sys
from collections.abc import Iterator
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.database import settings

logger = logging.getLogger(__name__)

# Tables we treat as a signal that the schema was created outside of
# Alembic (i.e. ``db/init.sql``).  ``images`` is the most central table
# in the schema and predates every version of this application, so it
# is a reliable sentinel.
_LEGACY_SENTINEL_TABLE = "images"
_ALEMBIC_VERSION_TABLE = "alembic_version"

# Revision a legacy database (db/init.sql-style bootstrap) matches.  We stamp
# this specific revision rather than ``"head"`` so that adding a future
# migration (``0002_*``, ``0003_*``, ...) after someone's initial ``stamp``
# never causes a later ``upgrade`` to silently skip pending migrations.
_LEGACY_BASELINE_REVISION = "0001_initial_schema"

# Deterministic signed 64-bit key used with ``pg_advisory_lock`` so that
# multiple pods racing to bootstrap (Helm ``replicaCount > 1`` or parallel
# docker-compose ``up``) serialize on the database itself.  The first pod
# to acquire the lock runs the strategy; subsequent waiters see
# ``alembic_version`` already populated when they acquire the lock and
# their ``upgrade head`` becomes a cheap no-op.
_ADVISORY_LOCK_KEY = int.from_bytes(
    hashlib.sha256(b"hriv-alembic-bootstrap").digest()[:8],
    byteorder="big",
    signed=True,
)


def _sync_database_url() -> str:
    """Return a synchronous SQLAlchemy URL for advisory-lock / inspector use.

    ``settings.database_url`` is configured for the asyncpg driver but
    ``pg_advisory_lock`` is held for the lifetime of a *session*, and
    Alembic's own commands open synchronous connections — so we map the URL
    back to the default sync ``psycopg2`` / ``psycopg`` driver.
    """
    return settings.database_url.replace("+asyncpg", "")


def _alembic_config() -> Config:
    """Return a Config pointing at ``backend/alembic.ini``."""
    ini_path = Path(__file__).resolve().parent.parent / "alembic.ini"
    if not ini_path.exists():
        raise RuntimeError(f"alembic.ini not found at {ini_path}")
    return Config(str(ini_path))


async def _existing_tables() -> set[str]:
    """Inspect the target database and return the set of existing table names.

    Uses the same async driver (asyncpg) the application already depends on,
    so we don't need to install a second Postgres driver just for bootstrap.
    """
    engine = create_async_engine(settings.database_url)
    try:
        async with engine.connect() as conn:
            return set(
                await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names())
            )
    finally:
        await engine.dispose()


async def _decide_strategy() -> str:
    """Return ``"upgrade"`` or ``"stamp"`` based on the current DB state."""
    try:
        tables = await _existing_tables()
    except Exception:  # pragma: no cover — DB connection failure
        logger.exception(
            "Could not inspect database to decide between upgrade/stamp. "
            "Falling back to 'upgrade' which will surface the underlying error."
        )
        return "upgrade"

    has_alembic = _ALEMBIC_VERSION_TABLE in tables
    has_legacy_schema = _LEGACY_SENTINEL_TABLE in tables

    if has_alembic:
        logger.info(
            "alembic_version exists — will run 'alembic upgrade head' to apply "
            "any pending revisions.",
            extra={"event": "alembic.upgrade"},
        )
        return "upgrade"

    if has_legacy_schema:
        logger.warning(
            "Detected legacy schema (table '%s' exists without alembic_version). "
            "Will stamp baseline revision '%s' and then run 'alembic upgrade head' "
            "so pending migrations apply without re-creating existing tables.",
            _LEGACY_SENTINEL_TABLE,
            _LEGACY_BASELINE_REVISION,
            extra={"event": "alembic.stamp_baseline_legacy"},
        )
        return "stamp"

    logger.info(
        "Fresh database — will run 'alembic upgrade head' to create the full "
        "schema.",
        extra={"event": "alembic.upgrade_fresh"},
    )
    return "upgrade"


def _apply_strategy(strategy: str, cfg: Config) -> None:
    """Dispatch to the appropriate Alembic command for ``strategy``.

    For the ``stamp`` path we stamp the specific baseline revision
    (``_LEGACY_BASELINE_REVISION``) rather than ``"head"`` — so that a
    legacy DB which only has the initial-schema state isn't falsely
    marked as already-at-head when newer migrations exist — and then
    immediately run ``upgrade head`` so any migrations beyond the
    baseline are applied in the same bootstrap pass.
    """
    if strategy == "stamp":
        command.stamp(cfg, _LEGACY_BASELINE_REVISION)
        command.upgrade(cfg, "head")
    else:
        command.upgrade(cfg, "head")


@contextlib.contextmanager
def _advisory_lock() -> Iterator[None]:
    """Serialize concurrent bootstrap runs via ``pg_advisory_lock``.

    Alembic itself doesn't acquire an advisory lock, so with ``replicaCount
    > 1`` multiple pods could race on the baseline ``CREATE TABLE`` and
    produce transient ``DuplicateTable`` errors on all-but-one pods.  The
    advisory lock makes concurrent bootstrap safe: the waiters simply block
    until the first pod finishes, then observe an already-managed DB and
    run ``upgrade head`` as a no-op.
    """
    engine = create_engine(_sync_database_url(), future=True)
    try:
        with engine.connect() as conn:
            logger.info(
                "Acquiring pg_advisory_lock(%d) for Alembic bootstrap.",
                _ADVISORY_LOCK_KEY,
                extra={"event": "alembic.lock_acquire"},
            )
            conn.execute(
                text("SELECT pg_advisory_lock(:key)"),
                {"key": _ADVISORY_LOCK_KEY},
            )
            try:
                yield
            finally:
                conn.execute(
                    text("SELECT pg_advisory_unlock(:key)"),
                    {"key": _ADVISORY_LOCK_KEY},
                )
                logger.info(
                    "Released pg_advisory_lock(%d) after Alembic bootstrap.",
                    _ADVISORY_LOCK_KEY,
                    extra={"event": "alembic.lock_release"},
                )
    finally:
        engine.dispose()


def bootstrap() -> None:
    """Run the right Alembic command for this deployment's DB state.

    Wrapped in :func:`_advisory_lock` so multiple replicas can safely race
    on the same database.
    """
    cfg = _alembic_config()
    with _advisory_lock():
        strategy = asyncio.run(_decide_strategy())
        _apply_strategy(strategy, cfg)


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    try:
        bootstrap()
    except Exception:
        logger.exception("Alembic bootstrap failed")
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
