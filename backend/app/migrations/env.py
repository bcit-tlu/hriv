"""Alembic migration environment.

Wires the Alembic CLI up to the application's SQLAlchemy models and the
``DATABASE_URL`` environment variable that the backend itself uses, so
``alembic upgrade head`` targets the same database that the FastAPI app
runs against.
"""
from __future__ import annotations

import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# Import the app's SQLAlchemy Base and models so ``target_metadata`` reflects
# the current schema (enabling ``alembic revision --autogenerate``).
# The ``models`` import registers every table on ``Base.metadata`` as a
# side-effect.
from app import models  # noqa: F401  — imported for side effects
from app.database import Base, settings

config = context.config

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _get_database_url() -> str:
    """Resolve the database URL, preferring the app's ``DATABASE_URL`` env var
    over any ``sqlalchemy.url`` value baked into ``alembic.ini``."""
    url = settings.database_url
    if not url or url.startswith("driver://"):
        raise RuntimeError(
            "DATABASE_URL must be set (or sqlalchemy.url in alembic.ini) "
            "before running Alembic migrations."
        )
    return url


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emits SQL instead of executing)."""
    url = _get_database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Create an async Engine and run migrations through it."""
    section = config.get_section(config.config_ini_section, {}) or {}
    section["sqlalchemy.url"] = _get_database_url()

    connectable = async_engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
