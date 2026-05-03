"""arq worker configuration for background image processing tasks.

Run with:  opentelemetry-instrument arq app.worker.WorkerSettings

Falls back to in-process BackgroundTasks when Redis is unavailable so
the application keeps working in local-dev / single-container setups.

Trace context propagation
~~~~~~~~~~~~~~~~~~~~~~~~
When the API pod enqueues a job the current W3C trace context is
serialized into the arq job arguments.  The worker extracts it and
links the processing span to the originating HTTP request so the
full upload → enqueue → worker → tile-gen → DB-write pipeline is
visible as a single distributed trace.
"""

import logging
from typing import Any
from urllib.parse import urlparse

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings
from opentelemetry import trace
from opentelemetry.context import attach, detach
from opentelemetry.propagate import extract, inject

from .database import settings
from .logging_config import setup_logging

logger = logging.getLogger(__name__)
tracer = trace.get_tracer(__name__)


# ── Shared helpers ────────────────────────────────────────

_redis_settings: RedisSettings | None = None


def _parse_redis_settings() -> RedisSettings:
    """Convert the ``REDIS_URL`` env-var into arq ``RedisSettings``.

    Handles full Redis URLs including auth and database, e.g.
    ``redis://:password@host:6379/1``.
    """
    global _redis_settings
    if _redis_settings is not None:
        return _redis_settings
    parsed = urlparse(settings.redis_url)
    host = parsed.hostname or "localhost"
    port = parsed.port or 6379
    password = parsed.password
    # Database number is the first path segment (e.g. /1 → 1)
    database = int(parsed.path.lstrip("/")) if parsed.path.strip("/") else 0
    _redis_settings = RedisSettings(
        host=host, port=port, password=password, database=database,
    )
    return _redis_settings


# ── Enqueue helper (used by FastAPI routers) ──────────────

_pool: ArqRedis | None = None


async def get_pool() -> ArqRedis | None:
    """Return a shared arq connection pool, or ``None`` if Redis is down."""
    global _pool
    if _pool is not None:
        return _pool
    try:
        _pool = await create_pool(_parse_redis_settings())
        return _pool
    except Exception:
        logger.warning(
            "Redis unavailable — task queue disabled; falling back to BackgroundTasks",
            extra={"event": "worker.redis_unavailable"},
        )
        return None


async def enqueue_process_source_image(source_image_id: int) -> bool:
    """Enqueue an image-processing job via arq.

    Returns ``True`` if the job was enqueued, ``False`` if Redis is
    unavailable (caller should fall back to ``BackgroundTasks``).
    """
    pool = await get_pool()
    if pool is None:
        return False
    try:
        carrier: dict[str, str] = {}
        inject(carrier)
        await pool.enqueue_job(
            "process_source_image_task", source_image_id, carrier,
        )
        return True
    except Exception:
        logger.warning(
            "Failed to enqueue job — falling back to BackgroundTasks",
            extra={
                "event": "worker.enqueue_failed",
                "source_image_id": source_image_id,
            },
        )
        return False


async def enqueue_admin_task(task_id: int, task_type: str) -> bool:
    """Enqueue a background admin task via arq.

    Returns ``True`` if the job was enqueued, ``False`` if Redis is
    unavailable (caller should fall back to ``BackgroundTasks``).
    """
    pool = await get_pool()
    if pool is None:
        return False
    try:
        carrier: dict[str, str] = {}
        inject(carrier)
        await pool.enqueue_job(
            "admin_task_runner", task_id, task_type, carrier,
        )
        return True
    except Exception:
        logger.warning(
            "Failed to enqueue admin task — falling back to BackgroundTasks",
            extra={
                "event": "worker.enqueue_admin_failed",
                "task_id": task_id,
                "task_type": task_type,
            },
        )
        return False


# ── arq task functions ────────────────────────────────────

async def process_source_image_task(
    ctx: dict[str, Any],
    source_image_id: int,
    trace_headers: dict[str, str] | None = None,
) -> None:
    """arq task wrapper around the existing processing pipeline."""
    from .processing import process_source_image

    parent_ctx = extract(trace_headers) if trace_headers else None
    token = attach(parent_ctx) if parent_ctx else None
    try:
        with tracer.start_as_current_span(
            "process_source_image_task",
            attributes={"source_image.id": source_image_id},
        ):
            logger.info(
                "arq worker processing source image",
                extra={
                    "event": "worker.task_started",
                    "source_image_id": source_image_id,
                },
            )
            await process_source_image(source_image_id)
    finally:
        if token is not None:
            detach(token)


async def admin_task_runner(
    ctx: dict[str, Any],
    task_id: int,
    task_type: str,
    trace_headers: dict[str, str] | None = None,
) -> None:
    """arq task wrapper for background admin import/export operations."""
    from .admin_ops import run_db_export, run_db_import, run_files_export, run_files_import

    runners = {
        "db_export": run_db_export,
        "db_import": run_db_import,
        "files_export": run_files_export,
        "files_import": run_files_import,
    }
    runner = runners.get(task_type)
    if runner is None:
        logger.error(
            "Unknown admin task type: %s",
            task_type,
            extra={"event": "worker.unknown_admin_task", "task_id": task_id},
        )
        return

    parent_ctx = extract(trace_headers) if trace_headers else None
    token = attach(parent_ctx) if parent_ctx else None
    try:
        with tracer.start_as_current_span(
            "admin_task_runner",
            attributes={"admin_task.id": task_id, "admin_task.type": task_type},
        ):
            logger.info(
                "arq worker running admin task",
                extra={
                    "event": "worker.admin_task_started",
                    "task_id": task_id,
                    "task_type": task_type,
                },
            )
            await runner(task_id)
    finally:
        if token is not None:
            detach(token)


# ── arq lifecycle hooks ───────────────────────────────────


async def on_startup(ctx: dict[str, Any]) -> None:
    """Initialise structured JSON logging when the arq worker boots."""
    setup_logging()
    logger.info("arq worker started", extra={"event": "worker.started"})


# ── arq WorkerSettings ───────────────────────────────────

class WorkerSettings:
    """Configuration class consumed by ``arq worker``."""

    functions = [process_source_image_task, admin_task_runner]
    redis_settings = _parse_redis_settings()
    on_startup = on_startup
    max_jobs = 4  # Match the existing _MAX_CONCURRENCY
    job_timeout = 7200  # 2 hours — large filesystem archives need headroom
