"""arq worker configuration for background image processing tasks.

Run with:  arq app.worker.WorkerSettings

Falls back to in-process BackgroundTasks when Redis is unavailable so
the application keeps working in local-dev / single-container setups.
"""

import logging
from typing import Any
from urllib.parse import urlparse

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from .database import settings

logger = logging.getLogger(__name__)

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
        await pool.enqueue_job("process_source_image_task", source_image_id)
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


# ── arq task functions ────────────────────────────────────

async def process_source_image_task(ctx: dict[str, Any], source_image_id: int) -> None:
    """arq task wrapper around the existing processing pipeline."""
    # Lazy import to avoid loading pyvips at module level (it requires
    # libvips shared library which may not be present in all environments).
    from .processing import process_source_image

    logger.info(
        "arq worker processing source image",
        extra={
            "event": "worker.task_started",
            "source_image_id": source_image_id,
        },
    )
    await process_source_image(source_image_id)


# ── arq WorkerSettings ───────────────────────────────────

class WorkerSettings:
    """Configuration class consumed by ``arq worker``."""

    functions = [process_source_image_task]
    redis_settings = _parse_redis_settings()
    max_jobs = 4  # Match the existing _MAX_CONCURRENCY
    job_timeout = 600  # 10 minutes — large TIFFs can take a while
