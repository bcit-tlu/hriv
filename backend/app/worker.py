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

import asyncio
import logging
import os
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings
from arq.worker import func
from opentelemetry import trace
from opentelemetry.context import attach, detach
from opentelemetry.propagate import extract, inject
from opentelemetry.trace import Status, StatusCode
from redis.exceptions import RedisError

from .component_versions import get_worker_version
from .database import async_session, settings
from .logging_config import setup_logging
from .models import ACTIVE_TASK_STATUSES, AdminTask
from .queue_metrics import ARQ_QUEUE_NAME, HEALTH_CHECK_KEY

logger = logging.getLogger(__name__)
tracer = trace.get_tracer(__name__)


# ── Shared helpers ────────────────────────────────────────

_redis_settings: RedisSettings | None = None


async def _finalize_interrupted_admin_task(task_id: int, task_type: str) -> None:
    """Best-effort cleanup when the worker is cancelled mid-admin-task.

    ``run_rebuild_tiles`` already persists its own interruption detail before
    re-raising ``CancelledError``. This helper covers the other admin-task
    runners, and also avoids overwriting any task that is already terminal.
    """
    from .admin_ops import _update_task

    async with async_session() as session:
        task = await session.get(AdminTask, task_id)
        if task is None or task.status not in ACTIVE_TASK_STATUSES:
            return

        if task.status == "cancelling":
            await _update_task(
                session, task,
                status="cancelled",
                log_line="Task cancelled while the worker was shutting down.",
            )
            return

        detail = f"Worker interrupted during {task_type.replace('_', ' ')}."
        await _update_task(
            session, task,
            status="failed",
            log_line=f"ERROR: {detail} Rerun the task to continue.",
            error_message=detail,
        )


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
_last_pool_failure = 0.0
_RETRY_BACKOFF_SECS = 30.0


class TaskQueueUnavailableError(RuntimeError):
    """Raised when required queue execution cannot submit a task."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


@dataclass(frozen=True)
class EnqueueResult:
    """Outcome returned by the shared task enqueue boundary."""

    outcome: str
    reason: str

    @property
    def queued(self) -> bool:
        return self.outcome == "queued"


async def get_pool() -> ArqRedis | None:
    """Return a shared arq connection pool, or ``None`` if Redis is down."""
    global _pool, _last_pool_failure
    if _pool is not None:
        return _pool
    if _last_pool_failure and time.time() - _last_pool_failure < _RETRY_BACKOFF_SECS:
        return None
    try:
        _pool = await create_pool(_parse_redis_settings())
        await _pool.ping()
        _last_pool_failure = 0.0
        return _pool
    except Exception:
        _last_pool_failure = time.time()
        _pool = None
        logger.warning(
            "Task queue unavailable; enqueue fallback/rejection will apply",
            extra={"event": "worker.queue_unavailable"},
        )
        return None


async def _enqueue(
    job_name: str,
    *args: Any,
    job_type: str,
) -> EnqueueResult:
    """Apply the single queue-vs-fallback policy for all task submissions."""
    def _fallback_or_reject(
        reason: str,
        exc: BaseException | None = None,
    ) -> EnqueueResult:
        outcome = (
            "rejected"
            if settings.task_execution_mode == "required"
            else "fallback"
        )
        _record_enqueue(job_type, outcome, reason)
        if settings.task_execution_mode == "required":
            error = TaskQueueUnavailableError(reason)
            if exc is not None:
                raise error from exc
            raise error
        return EnqueueResult("fallback", reason)

    pool = await get_pool()
    if pool is None:
        return _fallback_or_reject("queue_unavailable")
    try:
        carrier: dict[str, str] = {}
        inject(carrier)
        await pool.enqueue_job(job_name, *args, carrier)
    except RedisError as exc:
        global _pool, _last_pool_failure
        _pool = None
        _last_pool_failure = time.time()
        logger.warning(
            "Task queue submission failed",
            extra={"event": "worker.submission_failed", "job_type": job_type},
            exc_info=True,
        )
        return _fallback_or_reject("submission_failed", exc)
    except Exception as exc:
        logger.warning(
            "Task queue submission failed",
            extra={"event": "worker.submission_failed", "job_type": job_type},
            exc_info=True,
        )
        return _fallback_or_reject("submission_failed", exc)
    _record_enqueue(job_type, "queued", "submitted")
    return EnqueueResult("queued", "submitted")


def _record_enqueue(job_type: str, outcome: str, reason: str) -> None:
    from .queue_metrics import record_enqueue

    record_enqueue(job_type, outcome, reason)


async def enqueue_process_source_image(source_image_id: int) -> EnqueueResult:
    """Enqueue an image-processing job via the shared queue boundary."""
    return await _enqueue(
        "process_source_image_task", source_image_id, job_type="source_image"
    )


async def enqueue_replace_image(
    source_image_id: int, target_image_id: int,
) -> EnqueueResult:
    """Enqueue an image-replacement job via the shared queue boundary."""
    return await _enqueue(
        "replace_image_task", source_image_id, target_image_id,
        job_type="image_replacement",
    )


async def enqueue_bulk_import(
    job_id: int,
    file_entries: list[tuple[str, str]],
    copyright: str | None = None,
    note: str | None = None,
    active: bool = True,
) -> EnqueueResult:
    """Enqueue a bulk-import processing job via the shared queue boundary."""
    return await _enqueue(
        "bulk_import_task", job_id, file_entries, copyright, note, active,
        job_type="bulk_import",
    )


async def enqueue_admin_task(task_id: int, task_type: str) -> EnqueueResult:
    """Enqueue a background admin task via the shared queue boundary."""
    return await _enqueue(
        "admin_task_runner", task_id, task_type, job_type=f"admin:{task_type}"
    )


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
        ) as span:
            logger.info(
                "arq worker processing source image",
                extra={
                    "event": "worker.task_started",
                    "source_image_id": source_image_id,
                },
            )
            try:
                await process_source_image(source_image_id)
            except Exception as exc:
                span.set_status(Status(StatusCode.ERROR, str(exc)))
                span.record_exception(exc)
                raise
    finally:
        if token is not None:
            detach(token)


async def replace_image_task(
    ctx: dict[str, Any],
    source_image_id: int,
    target_image_id: int,
    trace_headers: dict[str, str] | None = None,
) -> None:
    """arq task wrapper for image replacement processing."""
    from .processing import process_replace_image

    parent_ctx = extract(trace_headers) if trace_headers else None
    token = attach(parent_ctx) if parent_ctx else None
    try:
        with tracer.start_as_current_span(
            "replace_image_task",
            attributes={
                "source_image.id": source_image_id,
                "target_image.id": target_image_id,
            },
        ) as span:
            logger.info(
                "arq worker processing image replacement",
                extra={
                    "event": "worker.replace_task_started",
                    "source_image_id": source_image_id,
                    "target_image_id": target_image_id,
                },
            )
            try:
                await process_replace_image(source_image_id, target_image_id)
            except Exception as exc:
                span.set_status(Status(StatusCode.ERROR, str(exc)))
                span.record_exception(exc)
                raise
    finally:
        if token is not None:
            detach(token)


async def bulk_import_task(
    ctx: dict[str, Any],
    job_id: int,
    file_entries: list[tuple[str, str]],
    copyright: str | None,
    note: str | None,
    active: bool,
    trace_headers: dict[str, str] | None = None,
) -> None:
    """arq task wrapper for bulk import processing."""
    from .routers.bulk_import import _process_bulk_import

    parent_ctx = extract(trace_headers) if trace_headers else None
    token = attach(parent_ctx) if parent_ctx else None
    try:
        with tracer.start_as_current_span(
            "bulk_import_task",
            attributes={"bulk_import.job_id": job_id},
        ) as span:
            logger.info(
                "arq worker processing bulk import",
                extra={
                    "event": "worker.bulk_import_started",
                    "job_id": job_id,
                    "file_count": len(file_entries),
                },
            )
            try:
                await _process_bulk_import(
                    job_id,
                    file_entries,
                    copyright=copyright,
                    note=note,
                    active=active,
                )
            except Exception as exc:
                span.set_status(Status(StatusCode.ERROR, str(exc)))
                span.record_exception(exc)
                raise
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
    from .admin_ops import (
        run_db_export,
        run_db_import,
        run_file_restore,
        run_files_export,
        run_files_import,
        run_rebuild_tiles,
    )

    runners = {
        "db_export": run_db_export,
        "db_import": run_db_import,
        "file_restore": run_file_restore,
        "files_export": run_files_export,
        "files_import": run_files_import,
        "rebuild_tiles": run_rebuild_tiles,
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
        ) as span:
            logger.info(
                "arq worker running admin task",
                extra={
                    "event": "worker.admin_task_started",
                    "task_id": task_id,
                    "task_type": task_type,
                },
            )
            try:
                await runner(task_id)
            except asyncio.CancelledError as exc:
                span.set_status(Status(StatusCode.ERROR, "admin task interrupted"))
                span.record_exception(exc)
                logger.exception(
                    "arq worker interrupted while running admin task",
                    extra={
                        "event": "worker.admin_task_interrupted",
                        "task_id": task_id,
                        "task_type": task_type,
                    },
                )
                await _finalize_interrupted_admin_task(task_id, task_type)
                raise
            except Exception as exc:
                span.set_status(Status(StatusCode.ERROR, str(exc)))
                span.record_exception(exc)
                raise
    finally:
        if token is not None:
            detach(token)


# ── arq lifecycle hooks ───────────────────────────────────


async def on_startup(ctx: dict[str, Any]) -> None:
    """Initialise structured JSON logging when the arq worker boots."""
    setup_logging()
    logger.info(
        "arq worker started",
        extra={
            "event": "worker.started",
            "service.name": os.environ.get("OTEL_SERVICE_NAME", "hriv-backend-worker"),
            "service.version": get_worker_version(),
        },
    )


# ── arq WorkerSettings ───────────────────────────────────

class WorkerSettings:
    """Configuration class consumed by ``arq worker``."""

    functions = [
        process_source_image_task,
        replace_image_task,
        bulk_import_task,
        func(admin_task_runner, timeout=86400),
    ]
    redis_settings = _parse_redis_settings()
    queue_name = ARQ_QUEUE_NAME
    health_check_key = HEALTH_CHECK_KEY
    health_check_interval = 30
    on_startup = on_startup
    max_jobs = settings.worker_max_jobs
    job_timeout = 7200  # 2 hours — default bound for short-lived worker jobs
