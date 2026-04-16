"""Bootstrap Alembic at deployment time.

This module is intended to run at deployment time (Dockerfile CMD entrypoint,
Helm initContainer, docker-compose ``command`` override, etc.) before the
FastAPI app is started.

Because Alembic is the sole source of truth for the schema, bootstrap is a
single operation: ``alembic upgrade head``.  That handles both fresh and
already-managed databases — on a fresh DB, ``upgrade head`` creates every
table and stamps ``alembic_version``; on an already-managed DB, it applies
any pending revisions and is a no-op if already at head.

To make multi-replica deployments safe (Helm ``replicaCount > 1`` or
parallel ``docker-compose up``), the upgrade runs under a PostgreSQL
advisory lock so concurrent pods serialize on the database itself rather
than racing on the baseline ``CREATE TABLE``.
"""
from __future__ import annotations

import asyncio
import contextlib
import hashlib
import logging
import sys
from collections.abc import AsyncIterator
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.database import settings

logger = logging.getLogger(__name__)

# Deterministic signed 64-bit key used with ``pg_advisory_lock`` so that
# multiple pods racing to bootstrap (Helm ``replicaCount > 1`` or parallel
# docker-compose ``up``) serialize on the database itself.  The first pod
# to acquire the lock runs ``upgrade head``; waiters block until release,
# then observe ``alembic_version`` already at head and their own
# ``upgrade head`` is a cheap no-op.
_ADVISORY_LOCK_KEY = int.from_bytes(
    hashlib.sha256(b"hriv-alembic-bootstrap").digest()[:8],
    byteorder="big",
    signed=True,
)


def _alembic_config() -> Config:
    """Return a Config pointing at ``backend/alembic.ini``."""
    ini_path = Path(__file__).resolve().parent.parent / "alembic.ini"
    if not ini_path.exists():
        raise RuntimeError(f"alembic.ini not found at {ini_path}")
    return Config(str(ini_path))


@contextlib.asynccontextmanager
async def _advisory_lock() -> AsyncIterator[None]:
    """Serialize concurrent bootstrap runs via ``pg_advisory_lock``.

    Alembic itself doesn't acquire an advisory lock, so with ``replicaCount
    > 1`` multiple pods could race on the baseline ``CREATE TABLE`` and
    produce transient ``DuplicateTable`` errors on all-but-one pods.  The
    advisory lock makes concurrent bootstrap safe: the waiters simply block
    until the first pod finishes, then observe an already-managed DB and
    run ``upgrade head`` as a no-op.

    Implemented with the same asyncpg engine the rest of the app uses so
    we don't need a second (synchronous) Postgres driver as a dependency.
    Advisory locks are session-scoped in Postgres, not connection-type
    scoped, so the lock held here is visible to the separate sync
    connection Alembic opens for its migrations.

    Uses ``isolation_level="AUTOCOMMIT"`` so the lock-holding connection
    never sits idle-in-transaction while Alembic runs on its own
    connection in a worker thread — otherwise a Postgres-server-side
    ``idle_in_transaction_session_timeout`` (commonly configured in
    production) could terminate the session and silently release the
    advisory lock mid-migration.
    """
    engine = create_async_engine(
        settings.database_url,
        isolation_level="AUTOCOMMIT",
    )
    try:
        async with engine.connect() as conn:
            logger.info(
                "Acquiring pg_advisory_lock(%d) for Alembic bootstrap.",
                _ADVISORY_LOCK_KEY,
                extra={"event": "alembic.lock_acquire"},
            )
            await conn.execute(
                text("SELECT pg_advisory_lock(:key)"),
                {"key": _ADVISORY_LOCK_KEY},
            )
            try:
                yield
            finally:
                await conn.execute(
                    text("SELECT pg_advisory_unlock(:key)"),
                    {"key": _ADVISORY_LOCK_KEY},
                )
                logger.info(
                    "Released pg_advisory_lock(%d) after Alembic bootstrap.",
                    _ADVISORY_LOCK_KEY,
                    extra={"event": "alembic.lock_release"},
                )
    finally:
        await engine.dispose()


def _run_upgrade(cfg: Config) -> None:
    """Run ``alembic upgrade head``.  Factored out for test injection."""
    logger.info(
        "Running 'alembic upgrade head'.",
        extra={"event": "alembic.upgrade"},
    )
    command.upgrade(cfg, "head")


async def _async_bootstrap() -> None:
    """Async entrypoint holding the advisory lock across the upgrade.

    The Alembic command is dispatched via :func:`asyncio.to_thread` because
    ``app/migrations/env.py`` (``run_migrations_online``) calls
    ``asyncio.run()`` internally, and a nested ``asyncio.run()`` on the
    same thread raises ``RuntimeError: asyncio.run() cannot be called from
    a running event loop``.  Running Alembic in a worker thread gives
    ``env.py`` a clean thread with no active event loop.

    The advisory lock remains valid because ``pg_advisory_lock`` is
    *session-scoped* in Postgres — the lock held by the asyncpg session on
    this thread is respected by the separate synchronous connection
    Alembic opens on the worker thread.
    """
    cfg = _alembic_config()
    async with _advisory_lock():
        await asyncio.to_thread(_run_upgrade, cfg)


def bootstrap() -> None:
    """Run ``alembic upgrade head`` for this deployment's database.

    Runs under a :func:`_advisory_lock` so multiple replicas can safely
    race on the same database.
    """
    asyncio.run(_async_bootstrap())


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
