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
import time
from collections.abc import AsyncIterator
from pathlib import Path
from urllib.parse import urlparse

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from app.database import settings

logger = logging.getLogger(__name__)

_BOOTSTRAP_MAX_ATTEMPTS = 10
_BOOTSTRAP_RETRY_DELAY_SECONDS = 3.0

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
async def _advisory_lock() -> AsyncIterator[AsyncConnection]:
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
                yield conn
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


#: The revision that mirrors the legacy ``db/init.sql`` schema exactly.
#: Legacy databases are stamped at this specific revision — not ``head`` — so
#: that any migrations added *after* the baseline are still applied by the
#: subsequent ``upgrade head`` call.
_BASELINE_REVISION = "0001_initial_schema"


def _run_stamp(cfg: Config) -> None:
    """Stamp the database at the baseline revision without running migrations."""
    logger.info(
        "Stamping database at baseline revision %s.",
        _BASELINE_REVISION,
        extra={"event": "alembic.stamp"},
    )
    command.stamp(cfg, _BASELINE_REVISION)


async def _should_stamp_legacy(conn: AsyncConnection) -> bool:
    """Detect a pre-Alembic database that already has application tables.

    Returns ``True`` when the ``programs`` table exists (schema was created
    by the legacy ``db/init.sql`` bootstrap) **and** either:

    * ``alembic_version`` does not exist at all, **or**
    * ``alembic_version`` exists but contains no rows (left over from a
      previous failed migration attempt — Alembic may create the table
      before the migration transaction, so a rollback leaves it behind
      empty).

    In both cases the caller should *stamp* the baseline revision instead
    of *upgrading*, so the initial migration isn't re-applied on top of
    existing tables.  A subsequent ``upgrade head`` then applies any
    migrations added after the baseline.
    """
    # Quick check: do the application tables exist at all?
    programs_table = (
        await conn.execute(text("SELECT to_regclass('public.programs')"))
    ).scalar_one_or_none()
    if programs_table is None:
        # Fresh database — let upgrade create everything from scratch.
        return False

    # Application tables exist.  Is Alembic already tracking this DB?
    version_table = (
        await conn.execute(text("SELECT to_regclass('public.alembic_version')"))
    ).scalar_one_or_none()
    if version_table is None:
        # No version table at all — classic legacy DB.
        return True

    # The version table exists — but a previous failed migration may have
    # left it empty (Alembic creates the table before the migration
    # transaction, so a DDL failure rolls back the version INSERT but not
    # the table itself).  An empty table with existing app tables means we
    # still need to stamp.
    row_count = (
        await conn.execute(text("SELECT count(*) FROM alembic_version"))
    ).scalar_one()
    return row_count == 0


class SchemaPrivilegeError(RuntimeError):
    """Raised when the bootstrap user lacks CREATE on the target schema."""


async def _check_schema_privilege(conn: AsyncConnection) -> None:
    """Verify the current role has CREATE on ``public`` before migrating.

    PostgreSQL 15+ revokes the default CREATE privilege on the ``public``
    schema for non-owner roles.  When Vault dynamic credentials are used,
    the ephemeral role may inherit table-level grants but still lack
    schema-level CREATE — causing a cryptic ``InsufficientPrivilegeError``
    deep inside Alembic's ``_ensure_version_table``.  This pre-flight
    check surfaces the problem with an actionable remediation hint.
    """
    has_create = (
        await conn.execute(
            text("SELECT has_schema_privilege(current_user, 'public', 'CREATE')")
        )
    ).scalar_one()
    if not has_create:
        current_user = (await conn.execute(text("SELECT current_user"))).scalar_one()
        raise SchemaPrivilegeError(
            f"Role '{current_user}' lacks CREATE privilege on schema "
            f"'public'.  On PostgreSQL 15+ the default CREATE grant on "
            f"'public' was revoked.  Fix: a superuser or the database "
            f"owner must run:\n\n"
            f'    GRANT CREATE ON SCHEMA public TO "{current_user}";\n\n'
            f"If credentials are provisioned by Vault, add a "
            f"'GRANT ALL ON SCHEMA public TO \"<app_role>\"' statement "
            f"to the dynamic role's creation_statements "
            f"(see vault/modules/postgresql/main.tf)."
        )


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
    async with _advisory_lock() as conn:
        await _check_schema_privilege(conn)
        if await _should_stamp_legacy(conn):
            logger.info(
                "Detected legacy database schema (alembic_version missing or empty); "
                "stamping baseline revision %s then upgrading.",
                _BASELINE_REVISION,
                extra={"event": "alembic.legacy_stamp"},
            )
            await asyncio.to_thread(_run_stamp, cfg)
        # Always run upgrade head — on a freshly-stamped legacy DB this
        # applies any migrations added after the baseline; on all other
        # databases it's the normal path (fresh or already-managed).
        await asyncio.to_thread(_run_upgrade, cfg)


def bootstrap() -> None:
    """Run ``alembic upgrade head`` for this deployment's database.

    Runs under a :func:`_advisory_lock` so multiple replicas can safely
    race on the same database.
    """
    for attempt in range(1, _BOOTSTRAP_MAX_ATTEMPTS + 1):
        try:
            asyncio.run(_async_bootstrap())
            return
        except Exception as exc:
            if not _is_transient_bootstrap_connectivity_error(exc):
                raise
            if attempt >= _BOOTSTRAP_MAX_ATTEMPTS:
                raise
            logger.warning(
                "Transient database bootstrap failure (%d/%d): %s. Retrying in %.1fs.",
                attempt,
                _BOOTSTRAP_MAX_ATTEMPTS,
                exc,
                _BOOTSTRAP_RETRY_DELAY_SECONDS,
                extra={"event": "alembic.retry"},
            )
            time.sleep(_BOOTSTRAP_RETRY_DELAY_SECONDS)


def _is_transient_bootstrap_connectivity_error(exc: Exception) -> bool:
    """Return True when bootstrap should retry a transient DB outage.

    CNPG rollouts and primary handovers can briefly surface startup or
    shutdown errors through asyncpg while the rw Service points at a node
    that is not yet ready. Retrying the bootstrap initContainer is safe:
    the advisory lock and Alembic semantics already make repeated runs
    idempotent once the database becomes available again.
    """
    transient_markers = (
        "cannotconnectnowerror",
        "connectionrefusederror",
        "toomanyconnectionserror",
        "serverclosedconnectionerror",
        "connectiondoesnotexisterror",
    )
    transient_messages = (
        "the database system is shutting down",
        "the database system is starting up",
        "the database system is not yet accepting connections",
        "connection refused",
        "could not connect to the primary server",
    )

    to_visit: list[BaseException] = [exc]
    seen: set[int] = set()
    while to_visit:
        current = to_visit.pop()
        if id(current) in seen:
            continue
        seen.add(id(current))
        msg = str(current).lower()
        type_name = type(current).__name__.lower()
        if any(marker in type_name for marker in transient_markers) or any(
            marker in msg for marker in transient_messages
        ):
            return True
        if current.__cause__ is not None:
            to_visit.append(current.__cause__)
        if current.__context__ is not None:
            to_visit.append(current.__context__)
    return False


def _redacted_url(url: str) -> str:
    """Return *host/user/db* from a database URL with the password masked."""
    try:
        parsed = urlparse(url.replace("+asyncpg", "", 1))
        return f"{parsed.username}@{parsed.hostname}:{parsed.port or 5432}/{parsed.path.lstrip('/')}"
    except Exception:
        return "<unparseable>"


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    logger.info(
        "Alembic bootstrap targeting %s",
        _redacted_url(settings.database_url),
    )
    try:
        bootstrap()
        logger.info("Alembic bootstrap completed successfully.")
    except Exception as exc:
        # Surface actionable hints for the two most common deployment
        # errors so operators don't have to trace through asyncpg internals.
        msg = str(exc)
        if isinstance(exc, SchemaPrivilegeError):
            logger.error(
                "%s",
                exc,
            )
        elif "InvalidPasswordError" in type(exc).__name__ or (
            "password authentication failed" in msg
        ):
            logger.error(
                "Database authentication failed.  The password in "
                "DATABASE_URL does not match the PostgreSQL role's "
                "password.  If credentials are sourced from Vault, verify "
                "that the KV secret (e.g. apps/hriv/<env>/postgres-db-credentials) contains "
                "the password the CNPG cluster was originally bootstrapped "
                "with.  To reset: ALTER USER <owner> PASSWORD '<pw>' via "
                "the superuser, or update the Vault KV secret to match."
            )
        elif (
            "could not translate host name" in msg or "Name or service not known" in msg
        ):
            logger.error(
                "Database host unreachable — is the CNPG cluster running "
                "and does the Service '%s-db-rw' exist?",
                "hriv-backend",
            )
        elif _is_transient_bootstrap_connectivity_error(exc):
            logger.error(
                "Database remained temporarily unavailable after %d bootstrap "
                "attempts. Verify that the CNPG primary behind the rw Service "
                "is ready and accepting connections, then restart the init "
                "container or pod.",
                _BOOTSTRAP_MAX_ATTEMPTS,
            )
        else:
            logger.exception("Alembic bootstrap failed")
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
