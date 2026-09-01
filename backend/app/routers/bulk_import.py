"""Bulk image import endpoints (admin and instructor).

Accepts multiple image files and/or zip archives, extracts images,
and processes them in the background with concurrency limiting.
"""

import asyncio
import contextlib
import errno
import logging
import os
import shutil
import tempfile
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated

from arq.connections import ArqRedis
from arq.constants import abort_jobs_ss
from arq.jobs import JobStatus
from arq.utils import timestamp_ms
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from opentelemetry import trace
from opentelemetry.trace import StatusCode
from sqlalchemy import case, cast, select, update
from sqlalchemy.dialects.postgresql import JSONB as JSONB_type
from sqlalchemy.sql import func
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_role
from ..database import async_session, get_db, settings
from ..filenames import sanitize_upload_filename
from ..image_validation import IMAGE_EXTENSIONS, UPLOAD_CHUNK_SIZE
from ..models import BulkImportJob, Category, SourceImage, User
from ..processing import process_source_image
from ..schemas import MAX_NOTE_LENGTH, BulkImportJobOut, normalize_note_value
from ..task_constants import (
    BULK_IMPORT_COORDINATOR_LIVENESS_KEY as _BULK_IMPORT_COORDINATOR_LIVENESS_KEY,
    BULK_IMPORT_COORDINATOR_LIVENESS_WINDOW_SECONDS as _BULK_IMPORT_COORDINATOR_LIVENESS_WINDOW_SECONDS,
    SOURCE_IMAGE_PENDING_WAIT_SAFETY_CAP_SECONDS,
)
from ..tracing import record_exception_if_server_error
from ..worker import (
    EnqueueResult,
    TaskQueueUnavailableError,
    WorkerSettings,
    enqueue_bulk_import,
    enqueue_process_source_image,
    get_pool,
)
from ..queue_metrics import HEALTH_CHECK_INTERVAL_SECONDS, collect_queue_state

router = APIRouter(prefix="/admin/bulk-import", tags=["admin"])

_editor = require_role("admin", "instructor")

logger = logging.getLogger(__name__)
tracer = trace.get_tracer(__name__)

# Maximum in-flight source-image processing tasks per bulk import.
# Keep this aligned with worker.max_jobs to avoid surprising throughput shifts.
_MAX_CONCURRENCY = settings.worker_max_jobs
_ZIP_EXTRACT_CHUNK_SIZE = 1024 * 1024
_SOURCE_IMAGE_POLL_INTERVAL_SECONDS = 2
_SOURCE_IMAGE_STALE_SECONDS = int(os.environ.get("SOURCE_IMAGE_STALE_SECONDS", "900"))
_SOURCE_IMAGE_PENDING_GRACE_SECONDS = 10
_SOURCE_IMAGE_LOST_OBSERVATIONS = 2
_SOURCE_IMAGE_PENDING_WAIT_SAFETY_CAP_SECONDS = (
    SOURCE_IMAGE_PENDING_WAIT_SAFETY_CAP_SECONDS
)
_STALE_BULK_IMPORT_SECONDS = int(
    os.environ.get("BULK_IMPORT_STALE_SECONDS", str(WorkerSettings.job_timeout))
)
# Keep the pending ceiling below the coordinator's timeout so late-enqueued
# children still leave time for terminal bookkeeping before it is killed.
# The ceiling is only a backstop when queue evidence has gone stale; a child
# repeatedly confirmed queued behind a healthy worker must never hit it.
# Worker-hosted coordinators rely on the stale-progress detector because arq
# can kill the coordinator before this cap. API-hosted coordinators do not have
# that outer arq timeout, so this cap backstops a child stalled in processing.
_SOURCE_IMAGE_PROCESSING_WAIT_SAFETY_CAP_SECONDS = WorkerSettings.job_timeout + 60
_SOURCE_IMAGE_QUEUE_STATE_SAMPLE_POLLS = max(
    HEALTH_CHECK_INTERVAL_SECONDS // _SOURCE_IMAGE_POLL_INTERVAL_SECONDS,
    1,
)
_SOURCE_IMAGE_QUEUE_CONFIRMATION_MAX_AGE_SECONDS = (
    HEALTH_CHECK_INTERVAL_SECONDS * 2
)
_BULK_IMPORT_COORDINATOR_LIVENESS_REFRESH_SECONDS = HEALTH_CHECK_INTERVAL_SECONDS
_BULK_IMPORT_COORDINATOR_REREGISTRATION_MAX_SECONDS = 300
_SOURCE_IMAGE_ABORT_LATCH_RETENTION_SECONDS = WorkerSettings.job_timeout * 2
_SOURCE_IMAGE_NO_WORKER_WINDOW_SECONDS = (
    _SOURCE_IMAGE_QUEUE_STATE_SAMPLE_POLLS
    * _SOURCE_IMAGE_POLL_INTERVAL_SECONDS
    * 4
)


def _is_image_filename(filename: str) -> bool:
    """Return True if the filename has a recognised image extension."""
    return Path(filename).suffix.lower() in IMAGE_EXTENSIONS


@dataclass(frozen=True)
class _SourceImageTerminalState:
    """Serializable source-image terminal state independent of SQLAlchemy sessions."""

    status: str
    error_message: str | None
    status_message: str | None


@dataclass
class _BulkImportProgress:
    """Track when any child in a batch last advanced out of ``pending``."""

    last_child_advanced_at: float
    observed_statuses: dict[int, str] = field(default_factory=dict)
    capacity_starvation_detected: bool = False

    def observe(self, source_image_id: int, status: str) -> None:
        previous_status = self.observed_statuses.get(source_image_id)
        if status != "pending" and previous_status in {None, "pending"}:
            self.last_child_advanced_at = time.monotonic()
        self.observed_statuses[source_image_id] = status


def _source_image_terminal_state(src: SourceImage) -> _SourceImageTerminalState:
    return _SourceImageTerminalState(
        status=src.status,
        error_message=src.error_message,
        status_message=src.status_message,
    )


def _coerce_utc_aware(dt: datetime, *, source_image_id: int) -> datetime:
    """Return a timezone-aware UTC datetime, tolerating naive DB values."""
    if dt.tzinfo is not None:
        return dt

    logger.warning(
        "Bulk import source image has naive updated_at; coercing to UTC",
        extra={
            "event": "bulk_import.naive_updated_at",
            "source_image_id": source_image_id,
        },
    )
    return dt.replace(tzinfo=timezone.utc)


async def _write_source_image_abort_latch(
    source_image_id: int,
    original_filename: str,
    job_id: str,
) -> bool:
    """Write arq's durable abort latch without waiting for a job result."""
    pool = await get_pool()
    if pool is None:
        logger.warning(
            "Could not write bulk import source image abort latch",
            extra={
                "event": "bulk_import.source_job_abort_latch_failed",
                "source_image_id": source_image_id,
                "original_filename": original_filename,
                "reason": "queue_unavailable",
            },
        )
        return False
    try:
        now_ms = timestamp_ms()
        try:
            await pool.zremrangebyscore(
                abort_jobs_ss,
                "-inf",
                now_ms - (_SOURCE_IMAGE_ABORT_LATCH_RETENTION_SECONDS * 1000),
            )
        except Exception:
            logger.debug(
                "Could not prune old bulk import source image abort latches",
                extra={
                    "event": "bulk_import.source_job_abort_latch_prune_failed",
                },
                exc_info=True,
            )
        await pool.zadd(abort_jobs_ss, {job_id: now_ms})
    except Exception:
        logger.exception(
            "Could not write bulk import source image abort latch",
            extra={
                "event": "bulk_import.source_job_abort_latch_failed",
                "source_image_id": source_image_id,
                "original_filename": original_filename,
                "reason": "submission_failed",
            },
        )
        return False
    return True


async def _remove_source_image_abort_latch(
    source_image_id: int,
    original_filename: str,
    job_id: str,
) -> bool:
    """Remove a queued-job abort latch after the worker starts."""
    pool = await get_pool()
    if pool is None:
        logger.warning(
            "Could not remove bulk import source image abort latch",
            extra={
                "event": "bulk_import.source_job_abort_latch_remove_failed",
                "source_image_id": source_image_id,
                "original_filename": original_filename,
                "reason": "queue_unavailable",
            },
        )
        return False
    try:
        await pool.zrem(abort_jobs_ss, job_id)
    except Exception:
        logger.exception(
            "Could not remove bulk import source image abort latch",
            extra={
                "event": "bulk_import.source_job_abort_latch_remove_failed",
                "source_image_id": source_image_id,
                "original_filename": original_filename,
                "reason": "submission_failed",
            },
        )
        return False
    return True


async def _reread_source_image_after_abort_latch(
    db: AsyncSession,
    source_image_id: int,
    original_filename: str,
    job_id: str,
    *,
    expected_status: str,
) -> tuple[SourceImage, bool]:
    """Re-read a latched row and remove the latch if it advanced."""
    latest_src = await db.get(
        SourceImage,
        source_image_id,
        populate_existing=True,
    )
    if latest_src is None:
        await _remove_source_image_abort_latch(
            source_image_id,
            original_filename,
            job_id,
        )
        raise RuntimeError(
            f"Queued source image {source_image_id} disappeared before completion"
        )
    if latest_src.status == expected_status:
        return latest_src, False
    latch_removed = await _remove_source_image_abort_latch(
        source_image_id,
        original_filename,
        job_id,
    )
    return latest_src, latch_removed


async def _bulk_import_has_capacity_starvation(
    *,
    batch_progress: _BulkImportProgress | None,
    stale_after_seconds: int,
    last_queue_confirmed_at: float | None,
    last_queue_worker_up: bool | None,
    job_status: JobStatus | None,
    coordinator_pool: ArqRedis | None,
) -> bool:
    """Compatibility no-op for the legacy slot-starvation detector.

    Bulk-import coordinators no longer reserve worker slots for the duration of
    a batch, so no child should be failed on the basis of *coordinator capacity*.
    Stale-progress / lost-job checks remain in place, but they are no longer
    coupled to the total-worker-slots setting.
    """
    return False


async def _register_bulk_import_coordinator(
    bulk_import_job_id: int,
    worker_hosted: bool = False,
) -> ArqRedis | None:
    """Register the coordinator's heartbeat in Redis.

    Worker-slot reservations were removed from the coordinator design; only the
    liveness set remains so a stale coordinator can be reconciled on restart.
    """
    pool = await get_pool()
    if pool is None:
        return None
    try:
        now_ms = timestamp_ms()
        await pool.zremrangebyscore(
            _BULK_IMPORT_COORDINATOR_LIVENESS_KEY,
            "-inf",
            now_ms - (_BULK_IMPORT_COORDINATOR_LIVENESS_WINDOW_SECONDS * 1000),
        )
        await pool.zadd(
            _BULK_IMPORT_COORDINATOR_LIVENESS_KEY,
            {str(bulk_import_job_id): now_ms},
        )
    except Exception:
        logger.exception(
            "Bulk import coordinator registration failed",
            extra={
                "event": "bulk_import.coordinator_registration_failed",
                "job_id": bulk_import_job_id,
            },
        )
        return None
    return pool


async def _refresh_bulk_import_coordinator(
    pool: ArqRedis,
    bulk_import_job_id: int,
    worker_hosted: bool = False,
) -> None:
    """Refresh a coordinator heartbeat without tracking worker slots."""
    try:
        await pool.zadd(
            _BULK_IMPORT_COORDINATOR_LIVENESS_KEY,
            {str(bulk_import_job_id): timestamp_ms()},
        )
    except Exception:
        logger.exception(
            "Bulk import coordinator liveness refresh failed",
            extra={
                "event": "bulk_import.coordinator_liveness_refresh_failed",
                "job_id": bulk_import_job_id,
            },
        )


async def _bulk_import_coordinator_liveness_loop(
    pool_ref: list[ArqRedis | None],
    bulk_import_job_id: int,
    stop_event: asyncio.Event,
    worker_hosted: bool = False,
) -> None:
    """Refresh coordinator liveness independently of child-image status."""
    registration_retry_seconds = _BULK_IMPORT_COORDINATOR_LIVENESS_REFRESH_SECONDS
    while True:
        try:
            await asyncio.wait_for(
                stop_event.wait(),
                timeout=registration_retry_seconds,
            )
            return
        except asyncio.TimeoutError:
            pool = pool_ref[0]
            if pool is None:
                pool = await _register_bulk_import_coordinator(
                    bulk_import_job_id,
                    worker_hosted=worker_hosted,
                )
                if pool is not None:
                    pool_ref[0] = pool
                    registration_retry_seconds = (
                        _BULK_IMPORT_COORDINATOR_LIVENESS_REFRESH_SECONDS
                    )
                else:
                    registration_retry_seconds = min(
                        registration_retry_seconds * 2,
                        _BULK_IMPORT_COORDINATOR_REREGISTRATION_MAX_SECONDS,
                    )
            else:
                await _refresh_bulk_import_coordinator(
                    pool,
                    bulk_import_job_id,
                    worker_hosted=worker_hosted,
                )


async def _unregister_bulk_import_coordinator(
    pool: ArqRedis,
    bulk_import_job_id: int,
    worker_hosted: bool = False,
) -> None:
    """Remove a coordinator heartbeat from Redis."""
    try:
        await pool.zrem(
            _BULK_IMPORT_COORDINATOR_LIVENESS_KEY,
            str(bulk_import_job_id),
        )
    except Exception:
        logger.exception(
            "Bulk import coordinator cleanup failed",
            extra={
                "event": "bulk_import.coordinator_cleanup_failed",
                "job_id": bulk_import_job_id,
            },
        )


async def _wait_for_source_image_terminal_state(
    source_image_id: int,
    original_filename: str,
    stale_after_seconds: int = _SOURCE_IMAGE_STALE_SECONDS,
    enqueue_result: EnqueueResult | None = None,
    pending_grace_seconds: int = _SOURCE_IMAGE_PENDING_GRACE_SECONDS,
    lost_observations: int = _SOURCE_IMAGE_LOST_OBSERVATIONS,
    no_worker_window_seconds: float = _SOURCE_IMAGE_NO_WORKER_WINDOW_SECONDS,
    pending_wait_safety_cap_seconds: int = (
        _SOURCE_IMAGE_PENDING_WAIT_SAFETY_CAP_SECONDS
    ),
    processing_wait_safety_cap_seconds: int = (
        _SOURCE_IMAGE_PROCESSING_WAIT_SAFETY_CAP_SECONDS
    ),
    batch_progress: _BulkImportProgress | None = None,
    coordinator_pool: ArqRedis | None = None,
    bulk_import_job_id: int | None = None,
) -> _SourceImageTerminalState:
    """Wait for queued processing to reach a terminal source-image state."""
    not_found_count = 0
    no_worker_since: float | None = None
    last_queue_confirmed_at: float | None = None
    last_queue_worker_up: bool | None = None
    poll_count = 0
    processing_started_at: float | None = None
    queued_at = (
        enqueue_result.queued_at
        if enqueue_result is not None and enqueue_result.queued_at is not None
        else time.monotonic()
    )
    while True:
        poll_count += 1
        async with async_session() as db:
            src = await db.get(SourceImage, source_image_id)
            if src is None:
                raise RuntimeError(
                    f"Queued source image {source_image_id} disappeared before completion"
                )
            if batch_progress is not None:
                batch_progress.observe(source_image_id, src.status)
            if src.status in {"completed", "failed"}:
                return _source_image_terminal_state(src)

            if src.status == "processing":
                if processing_started_at is None:
                    processing_started_at = time.monotonic()
            else:
                processing_started_at = None

            cutoff = datetime.now(timezone.utc) - timedelta(seconds=stale_after_seconds)
            updated_at = _coerce_utc_aware(src.updated_at, source_image_id=source_image_id)
            job_status: JobStatus | None = None
            if src.status == "processing" and updated_at < cutoff:
                latch_written = False
                if enqueue_result is not None and enqueue_result.job is not None:
                    latch_written = await _write_source_image_abort_latch(
                        source_image_id,
                        original_filename,
                        enqueue_result.job.job_id,
                    )
                if latch_written:
                    latest_src, latch_removed = (
                        await _reread_source_image_after_abort_latch(
                            db,
                            source_image_id,
                            original_filename,
                            enqueue_result.job.job_id,
                            expected_status="processing",
                        )
                    )
                    if latest_src.status != "processing":
                        logger.info(
                            "Bulk import source image advanced before stall failure",
                            extra={
                                "event": "bulk_import.source_stalled_recovered",
                                "source_image_id": source_image_id,
                                "bulk_import_job_id": bulk_import_job_id,
                                "original_filename": original_filename,
                                "latch_removed": latch_removed,
                            },
                        )
                        src = latest_src
                        if latest_src.status in {"completed", "failed"}:
                            return _source_image_terminal_state(latest_src)
                    else:
                        src = latest_src
                if src.status == "processing":
                    src.status = "failed"
                    src.error_message = (
                        "Tile generation stalled during bulk import. "
                        f"No progress update was recorded for more than {stale_after_seconds}s."
                    )
                    src.status_message = "Failed"
                    await db.commit()
                    if (
                        enqueue_result is not None
                        and enqueue_result.job is not None
                    ):
                        await _remove_source_image_abort_latch(
                            source_image_id,
                            original_filename,
                            enqueue_result.job.job_id,
                        )
                    logger.error(
                        "Bulk import source image stalled while waiting for queued processing",
                        extra={
                            "event": "bulk_import.source_stalled",
                            "source_image_id": source_image_id,
                            "bulk_import_job_id": bulk_import_job_id,
                            "original_filename": original_filename,
                            "stale_after_seconds": stale_after_seconds,
                        },
                    )
                    return _source_image_terminal_state(src)
            if (
                src.status == "pending"
                and enqueue_result is not None
                and enqueue_result.job is not None
                and time.monotonic() - queued_at >= pending_grace_seconds
            ):
                # arq reports ``not_found`` only after the job id is gone from
                # the queue zset and its result key has expired. This detector
                # therefore covers Redis data loss; ``complete`` while the
                # row is pending covers a finished job that recorded no
                # source-image result while arq's default 3600-second
                # keep_result retention window is active. The retention
                # window is what makes this distinction possible.
                try:
                    job_status = await enqueue_result.job.status()
                except Exception as exc:
                    logger.debug(
                        "Bulk import source image job status probe failed",
                        extra={
                            "event": "bulk_import.source_job_status_probe_failed",
                            "source_image_id": source_image_id,
                            "original_filename": original_filename,
                        },
                        exc_info=True,
                    )
                    job_status = None
                if job_status == JobStatus.not_found:
                    not_found_count += 1
                elif job_status == JobStatus.complete:
                    latest_src = await db.get(
                        SourceImage,
                        source_image_id,
                        populate_existing=True,
                    )
                    if latest_src is None:
                        raise RuntimeError(
                            f"Queued source image {source_image_id} disappeared before completion"
                        )
                    if latest_src.status in {"completed", "failed"}:
                        return _source_image_terminal_state(latest_src)
                    if latest_src.status == "pending":
                        latest_src.status = "failed"
                        latest_src.error_message = (
                            "Tile generation finished during bulk import, "
                            "but did not record a terminal source-image result."
                        )
                        latest_src.status_message = "Failed"
                        await db.commit()
                        logger.error(
                            "Bulk import source image job completed without a result",
                            extra={
                                "event": "bulk_import.source_job_completed_without_result",
                                "source_image_id": source_image_id,
                                "bulk_import_job_id": bulk_import_job_id,
                                "original_filename": original_filename,
                            },
                        )
                        return _source_image_terminal_state(latest_src)
                    not_found_count = 0
                elif job_status is not None:
                    not_found_count = 0
                if job_status in {
                    JobStatus.queued,
                    JobStatus.deferred,
                    JobStatus.in_progress,
                }:
                    if (
                        poll_count % _SOURCE_IMAGE_QUEUE_STATE_SAMPLE_POLLS == 0
                    ):
                        queue_state = await collect_queue_state()
                        sampled_at = time.monotonic()
                        last_queue_worker_up = queue_state["worker_up"]
                        if queue_state["queue_up"]:
                            last_queue_confirmed_at = sampled_at
                            if (
                                job_status in {JobStatus.queued, JobStatus.deferred}
                                and queue_state["worker_up"] is False
                            ):
                                if no_worker_since is None:
                                    no_worker_since = sampled_at
                            else:
                                no_worker_since = None
                        else:
                            no_worker_since = None
                elif job_status is not None:
                    no_worker_since = None
                if not_found_count >= lost_observations:
                    latest_src = await db.get(
                        SourceImage,
                        source_image_id,
                        populate_existing=True,
                    )
                    if latest_src is None:
                        raise RuntimeError(
                            f"Queued source image {source_image_id} disappeared before completion"
                        )
                    if latest_src.status in {"completed", "failed"}:
                        return _source_image_terminal_state(latest_src)
                    if latest_src.status != "pending":
                        not_found_count = 0
                        src = latest_src
                    else:
                        latest_src.status = "failed"
                        latest_src.error_message = (
                            "Tile generation never started during bulk import. "
                            "The queued processing job was lost before it started."
                        )
                        latest_src.status_message = "Failed"
                        await db.commit()
                        logger.error(
                            "Bulk import source image processing job was lost",
                            extra={
                                "event": "bulk_import.source_job_lost",
                                "source_image_id": source_image_id,
                                "bulk_import_job_id": bulk_import_job_id,
                                "original_filename": original_filename,
                                "not_found_observations": not_found_count,
                            },
                        )
                        return _source_image_terminal_state(latest_src)
                if (
                    no_worker_since is not None
                    and time.monotonic() - no_worker_since
                    >= no_worker_window_seconds
                ):
                    latch_written = await _write_source_image_abort_latch(
                        source_image_id,
                        original_filename,
                        enqueue_result.job.job_id,
                    )
                    if latch_written:
                        latest_src, latch_removed = (
                            await _reread_source_image_after_abort_latch(
                                db,
                                source_image_id,
                                original_filename,
                                enqueue_result.job.job_id,
                                expected_status="pending",
                            )
                        )
                        if latest_src.status != "pending":
                            no_worker_since = None
                            logger.info(
                                "Bulk import source image worker recovered before no-worker failure",
                                extra={
                                    "event": "bulk_import.source_job_worker_recovered",
                                    "source_image_id": source_image_id,
                                    "bulk_import_job_id": bulk_import_job_id,
                                    "original_filename": original_filename,
                                    "latch_removed": latch_removed,
                                },
                            )
                            if latest_src.status in {"completed", "failed"}:
                                return _source_image_terminal_state(latest_src)
                        src = latest_src
                        if src.status == "pending":
                            src.status = "failed"
                            src.error_message = (
                                "Tile generation never started during bulk import "
                                "because no dedicated worker was available."
                            )
                            src.status_message = "Failed"
                            await db.commit()
                            await _remove_source_image_abort_latch(
                                source_image_id,
                                original_filename,
                                enqueue_result.job.job_id,
                            )
                            logger.error(
                                "Bulk import source image had no available worker",
                                extra={
                                    "event": "bulk_import.source_job_no_worker",
                                    "source_image_id": source_image_id,
                                    "bulk_import_job_id": bulk_import_job_id,
                                    "original_filename": original_filename,
                                    "no_worker_window_seconds": no_worker_window_seconds,
                                },
                            )
                            return _source_image_terminal_state(src)
            if (
                src.status == "pending"
                and enqueue_result is not None
                and enqueue_result.job is not None
                and time.monotonic() - queued_at >= pending_wait_safety_cap_seconds
                and (
                    last_queue_confirmed_at is None
                    or time.monotonic() - last_queue_confirmed_at
                    >= _SOURCE_IMAGE_QUEUE_CONFIRMATION_MAX_AGE_SECONDS
                )
            ):
                latch_written = await _write_source_image_abort_latch(
                    source_image_id,
                    original_filename,
                    enqueue_result.job.job_id,
                )
                if latch_written:
                    latest_src, latch_removed = (
                        await _reread_source_image_after_abort_latch(
                            db,
                            source_image_id,
                            original_filename,
                            enqueue_result.job.job_id,
                            expected_status="pending",
                        )
                    )
                    if latest_src.status != "pending":
                        logger.info(
                            "Bulk import source image advanced before pending wait failure",
                            extra={
                                "event": "bulk_import.source_job_pending_recovered",
                                "source_image_id": source_image_id,
                                "bulk_import_job_id": bulk_import_job_id,
                                "original_filename": original_filename,
                                "latch_removed": latch_removed,
                            },
                        )
                        src = latest_src
                        if latest_src.status in {"completed", "failed"}:
                            return _source_image_terminal_state(latest_src)
                    else:
                        logger.error(
                            "Bulk import source image exceeded pending wait ceiling",
                            extra={
                                "event": "bulk_import.source_job_pending_timeout",
                                "source_image_id": source_image_id,
                                "bulk_import_job_id": bulk_import_job_id,
                                "original_filename": original_filename,
                                "pending_wait_safety_cap_seconds": (
                                    pending_wait_safety_cap_seconds
                                ),
                            },
                        )
                        latest_src.status = "failed"
                        latest_src.error_message = (
                            "Tile generation never started during bulk import. "
                            "The queued processing job exceeded the wait ceiling."
                        )
                        latest_src.status_message = "Failed"
                        await db.commit()
                        await _remove_source_image_abort_latch(
                            source_image_id,
                            original_filename,
                            enqueue_result.job.job_id,
                        )
                        return _source_image_terminal_state(latest_src)
            if (
                src.status == "processing"
                and processing_started_at is not None
                and enqueue_result is not None
                and enqueue_result.job is not None
                and time.monotonic() - processing_started_at
                >= processing_wait_safety_cap_seconds
            ):
                latch_written = await _write_source_image_abort_latch(
                    source_image_id,
                    original_filename,
                    enqueue_result.job.job_id,
                )
                if latch_written:
                    latest_src, latch_removed = (
                        await _reread_source_image_after_abort_latch(
                            db,
                            source_image_id,
                            original_filename,
                            enqueue_result.job.job_id,
                            expected_status="processing",
                        )
                    )
                    if latest_src.status != "processing":
                        processing_started_at = None
                        logger.info(
                            "Bulk import source image advanced before processing wait failure",
                            extra={
                                "event": "bulk_import.source_job_processing_recovered",
                                "source_image_id": source_image_id,
                                "bulk_import_job_id": bulk_import_job_id,
                                "original_filename": original_filename,
                                "latch_removed": latch_removed,
                            },
                        )
                        src = latest_src
                        if latest_src.status in {"completed", "failed"}:
                            return _source_image_terminal_state(latest_src)
                    else:
                        latest_src.status = "failed"
                        latest_src.error_message = (
                            "Tile generation did not finish during bulk import "
                            "before the worker job timeout."
                        )
                        latest_src.status_message = "Failed"
                        await db.commit()
                        await _remove_source_image_abort_latch(
                            source_image_id,
                            original_filename,
                            enqueue_result.job.job_id,
                        )
                        logger.error(
                            "Bulk import source image wait exceeded processing safety cap",
                            extra={
                                "event": "bulk_import.source_wait_timeout",
                                "source_image_id": source_image_id,
                                "original_filename": original_filename,
                                "processing_wait_safety_cap_seconds": (
                                    processing_wait_safety_cap_seconds
                                ),
                            },
                        )
                        return _source_image_terminal_state(latest_src)

        await asyncio.sleep(_SOURCE_IMAGE_POLL_INTERVAL_SECONDS)


async def _process_bulk_import(
    job_id: int,
    file_entries: list[tuple[str, str]],
    copyright: str | None = None,
    note: str | None = None,
    active: bool = True,
    worker_hosted: bool = False,
) -> None:
    """Process a bulk import while publishing coordinator liveness."""
    coordinator_pool_ref = [
        await _register_bulk_import_coordinator(
            job_id,
            worker_hosted=worker_hosted,
        )
    ]
    try:
        await _process_bulk_import_impl(
            job_id,
            file_entries,
            copyright=copyright,
            note=note,
            active=active,
            coordinator_pool=coordinator_pool_ref[0],
            coordinator_pool_ref=coordinator_pool_ref,
            worker_hosted=worker_hosted,
        )
    finally:
        if coordinator_pool_ref[0] is not None:
            await _unregister_bulk_import_coordinator(
                coordinator_pool_ref[0],
                job_id,
                worker_hosted=worker_hosted,
            )


async def reconcile_stale_bulk_import_jobs(
    session: AsyncSession,
    stale_after_seconds: int = _STALE_BULK_IMPORT_SECONDS,
) -> int:
    """Mark abandoned bulk-import coordinators as failed on startup."""
    pool = await get_pool()
    live_ids: set[int] | None = None
    try:
        if pool is not None:
            live_since = timestamp_ms() - (
                _BULK_IMPORT_COORDINATOR_LIVENESS_WINDOW_SECONDS * 1000
            )
            live_members = await pool.zrange(
                _BULK_IMPORT_COORDINATOR_LIVENESS_KEY,
                live_since,
                "+inf",
                byscore=True,
            )
            live_ids = {int(member) for member in live_members}
    except Exception:
        logger.warning(
            "Could not read bulk-import coordinator liveness on startup",
            extra={"event": "bulk_import.reconcile_liveness_unavailable"},
            exc_info=True,
        )
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=stale_after_seconds)
    filters = [
        BulkImportJob.status.in_(("pending", "processing")),
        BulkImportJob.updated_at < cutoff,
    ]
    if live_ids is not None:
        filters.append(BulkImportJob.id.not_in(live_ids))
    stmt = (
        update(BulkImportJob)
        .where(*filters)
        .values(
            # Match the coordinator finalizer: any completed image counts as
            # partial success, so "failed" means nothing was imported.
            status=case(
                (BulkImportJob.completed_count > 0, "completed"),
                else_="failed",
            ),
            failed_count=BulkImportJob.total_count - BulkImportJob.completed_count,
            # Only note the abandonment when children are actually
            # unaccounted for; a coordinator killed after every child reached
            # a terminal state already has coherent per-file error entries.
            errors=case(
                (
                    BulkImportJob.failed_count
                    == BulkImportJob.total_count - BulkImportJob.completed_count,
                    BulkImportJob.errors,
                ),
                else_=(
                    func.coalesce(
                        BulkImportJob.errors,
                        cast([], JSONB_type),
                    )
                    + cast(
                        [
                            {
                                "error": (
                                    "Coordinator abandoned during backend startup "
                                    "reconciliation."
                                )
                            }
                        ],
                        JSONB_type,
                    )
                )
            ),
            updated_at=func.now(),
        )
        .returning(BulkImportJob.id)
    )
    result = await session.execute(stmt)
    ids = [row[0] for row in result.all()]
    await session.commit()
    if ids:
        logger.warning(
            "Reconciled %d stale bulk-import job(s) to a terminal state on startup",
            len(ids),
            extra={
                "event": "bulk_import.reconciled_stale",
                "bulk_import_job_ids": ids,
                "stale_after_seconds": stale_after_seconds,
                "liveness_evidence": (
                    "redis" if live_ids is not None else "stale_timestamp_only"
                ),
            },
        )
    return len(ids)


async def _process_bulk_import_impl(
    job_id: int,
    file_entries: list[tuple[str, str]],
    copyright: str | None = None,
    note: str | None = None,
    active: bool = True,
    coordinator_pool: ArqRedis | None = None,
    coordinator_pool_ref: list[ArqRedis | None] | None = None,
    worker_hosted: bool = False,
) -> None:
    """Background task: process all images for a bulk import job.

    ``file_entries`` is a list of (original_filename, stored_path) tuples.
    Each image is turned into a SourceImage record and processed via the
    existing VIPS pipeline, with concurrency limited by a semaphore.
    """
    semaphore = asyncio.Semaphore(_MAX_CONCURRENCY)
    note = normalize_note_value(note)
    coordinator_pool_ref = coordinator_pool_ref or [coordinator_pool]

    async def _process_one(original_filename: str, stored_path: str) -> None:
        try:
            async with async_session() as db:
                # Reload job to get current category_id
                job = await db.get(BulkImportJob, job_id)
                if job is None:
                    return

                name = Path(original_filename).stem
                src = SourceImage(
                    original_filename=original_filename,
                    stored_path=stored_path,
                    status="pending",
                    name=name,
                    category_id=job.category_id,
                    copyright=copyright or "Public Domain",
                    note=note,
                    active=active,
                )
                db.add(src)
                await db.commit()
                await db.refresh(src)

            # Process each image through the same queue-backed path used by
            # single uploads when Redis is available. That keeps heavyweight
            # tile generation off the request-serving pod while still letting
            # this bulk-import coordinator observe terminal status and update
            # per-job counters synchronously.
            async with semaphore:
                try:
                    source_image_id = src.id
                    enqueue_result = await enqueue_process_source_image(source_image_id)
                    if enqueue_result.queued:
                        if enqueue_result.job is not None:
                            terminal_state = (
                                await _wait_for_source_image_terminal_state(
                                    source_image_id,
                                    original_filename,
                                    enqueue_result=enqueue_result,
                                    batch_progress=batch_progress,
                                    coordinator_pool=coordinator_pool_ref[0],
                                    bulk_import_job_id=job_id,
                                )
                            )
                        else:
                            terminal_state = (
                                await _wait_for_source_image_terminal_state(
                                    source_image_id,
                                    original_filename,
                                    enqueue_result=enqueue_result,
                                )
                            )
                    else:
                        await process_source_image(source_image_id)
                        async with async_session() as db:
                            src_check = await db.get(SourceImage, source_image_id)
                            if src_check is None:
                                raise RuntimeError(
                                    f"Source image {source_image_id} disappeared after processing"
                                )
                            terminal_state = _source_image_terminal_state(src_check)
                except TaskQueueUnavailableError as exc:
                    detail = "Task queue unavailable; image processing was not started."
                    bookkeeping_committed = False
                    try:
                        async with async_session() as db:
                            src_check = await db.get(SourceImage, source_image_id)
                            if src_check is not None:
                                src_check.status = "failed"
                                src_check.status_message = "Failed"
                                src_check.error_message = detail
                                await db.commit()
                                bookkeeping_committed = True
                    except Exception:
                        logger.exception(
                            "Failed to mark bulk-import source image after queue rejection",
                            extra={
                                "event": "bulk_import.queue_rejection_bookkeeping_failed",
                                "job_id": job_id,
                                "source_image_id": source_image_id,
                                "original_filename": original_filename,
                            },
                        )
                    if bookkeeping_committed:
                        with contextlib.suppress(OSError):
                            os.unlink(stored_path)
                    span = trace.get_current_span()
                    span.record_exception(exc)
                    span.set_status(StatusCode.ERROR, str(exc))
                    logger.warning(
                        "Bulk import image enqueue rejected",
                        extra={
                            "event": {
                                "queue_unavailable": "worker.queue_unavailable",
                                "submission_failed": "worker.submission_failed",
                            }.get(exc.reason, "worker.queue_unavailable"),
                            "job_id": job_id,
                            "source_image_id": source_image_id,
                            "original_filename": original_filename,
                        },
                        exc_info=True,
                    )
                    error_entry = [{"filename": original_filename, "error": detail}]
                    async with async_session() as db:
                        await db.execute(
                            update(BulkImportJob)
                            .where(BulkImportJob.id == job_id)
                            .values(
                                failed_count=BulkImportJob.failed_count + 1,
                                errors=func.coalesce(BulkImportJob.errors, cast([], JSONB_type)) + cast(error_entry, JSONB_type),
                            )
                        )
                        await db.commit()
                    return
                except Exception as exc:
                    span = trace.get_current_span()
                    span.record_exception(exc)
                    span.set_status(StatusCode.ERROR, str(exc))
                    logger.exception(
                        "Bulk import: image processing failed",
                        extra={
                            "event": "bulk_import.image_failed",
                            "job_id": job_id,
                            "original_filename": original_filename,
                        },
                    )
                    error_entry = [{"filename": original_filename, "error": str(exc)}]
                    async with async_session() as db:
                        await db.execute(
                            update(BulkImportJob)
                            .where(BulkImportJob.id == job_id)
                            .values(
                                failed_count=BulkImportJob.failed_count + 1,
                                errors=func.coalesce(BulkImportJob.errors, cast([], JSONB_type)) + cast(error_entry, JSONB_type),
                            )
                        )
                        await db.commit()
                    return

                # process_source_image catches its own exceptions internally
                # and sets SourceImage.status to "failed". Check for that.
                async with async_session() as db:
                    if terminal_state.status == "failed":
                        error_entry = [{"filename": original_filename, "error": terminal_state.error_message or "Processing failed"}]
                        await db.execute(
                            update(BulkImportJob)
                            .where(BulkImportJob.id == job_id)
                            .values(
                                failed_count=BulkImportJob.failed_count + 1,
                                errors=func.coalesce(BulkImportJob.errors, cast([], JSONB_type)) + cast(error_entry, JSONB_type),
                            )
                        )
                        await db.commit()
                    else:
                        await db.execute(
                            update(BulkImportJob)
                            .where(BulkImportJob.id == job_id)
                            .values(completed_count=BulkImportJob.completed_count + 1)
                        )
                        await db.commit()
        except Exception as exc:
            # Catch errors from SourceImage creation or any other unexpected
            # failure so that gather(return_exceptions=True) doesn't silently
            # swallow them without updating job counters.
            span = trace.get_current_span()
            span.record_exception(exc)
            span.set_status(StatusCode.ERROR, str(exc))
            logger.exception(
                "Bulk import: unexpected error",
                extra={
                    "event": "bulk_import.unexpected_error",
                    "job_id": job_id,
                    "original_filename": original_filename,
                },
            )
            error_entry = [{"filename": original_filename, "error": str(exc)}]
            try:
                async with async_session() as db:
                    await db.execute(
                        update(BulkImportJob)
                        .where(BulkImportJob.id == job_id)
                        .values(
                            failed_count=BulkImportJob.failed_count + 1,
                            errors=func.coalesce(BulkImportJob.errors, cast([], JSONB_type)) + cast(error_entry, JSONB_type),
                        )
                    )
                    await db.commit()
            except Exception:
                logger.exception(
                    "Bulk import: failed to update job counters",
                    extra={
                        "event": "bulk_import.counter_update_failed",
                        "job_id": job_id,
                        "original_filename": original_filename,
                    },
                )

    # Mark job as processing
    async with async_session() as db:
        job = await db.get(BulkImportJob, job_id)
        if job is None:
            return
        if job.status in {"completed", "failed"}:
            logger.info(
                "Terminal BulkImportJob found, skipping processing",
                extra={
                    "event": "bulk_import.terminal_job_skipped",
                    "bulk_import_job_id": job_id,
                    "status": job.status,
                },
            )
            return
        job.status = "processing"
        await db.commit()

    logger.info(
        "Bulk import processing started",
        extra={
            "event": "bulk_import.processing_started",
            "job_id": job_id,
            "total_count": len(file_entries),
        },
    )

    # Process all images concurrently (bounded by semaphore)
    batch_progress = _BulkImportProgress(last_child_advanced_at=time.monotonic())
    coordinator_stop_event = asyncio.Event()
    coordinator_liveness_task = asyncio.create_task(
        _bulk_import_coordinator_liveness_loop(
            coordinator_pool_ref,
            job_id,
            coordinator_stop_event,
            worker_hosted,
        )
    )
    tasks = [
        asyncio.create_task(_process_one(fname, spath))
        for fname, spath in file_entries
    ]
    try:
        await asyncio.gather(*tasks, return_exceptions=True)
    finally:
        if coordinator_stop_event is not None:
            coordinator_stop_event.set()
        if coordinator_liveness_task is not None:
            coordinator_liveness_task.cancel()
            await asyncio.gather(
                coordinator_liveness_task,
                return_exceptions=True,
            )

    # Finalise job status
    async with async_session() as db:
        job = await db.get(BulkImportJob, job_id)
        if job is not None:
            if job.failed_count > 0 and job.completed_count == 0:
                job.status = "failed"
            elif job.failed_count > 0:
                job.status = "completed"  # partial success
            else:
                job.status = "completed"
            await db.commit()

            logger.info(
                "Bulk import job finished",
                extra={
                    "event": "bulk_import.finished",
                    "job_id": job_id,
                    "status": job.status,
                    "total_count": job.total_count,
                    "completed_count": job.completed_count,
                    "failed_count": job.failed_count,
                },
            )


@router.post("/", response_model=BulkImportJobOut, status_code=201)
async def bulk_import_images(
    files: Annotated[list[UploadFile], File()],
    background_tasks: BackgroundTasks,
    _user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
    category_id: Annotated[int | None, Form()] = None,
    copyright: Annotated[str | None, Form()] = None,
    note: Annotated[str | None, Form()] = None,
    active: Annotated[bool, Form()] = True,
) -> BulkImportJob:
    """Upload multiple image files and/or zip archives for bulk import.

    Images are assigned to the specified category, or placed at root level
    when ``category_id`` is omitted.  Metadata fields (copyright, note,
    active) are applied uniformly to every image in the batch.  Omitted
    fields fall back to sensible defaults.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    # Validate that the target category exists (if specified)
    if category_id is not None:
        category = await db.get(Category, category_id)
        if category is None:
            raise HTTPException(status_code=400, detail="Category not found")

    try:
        note = normalize_note_value(note)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Note must be {MAX_NOTE_LENGTH} characters or fewer",
        )

    # A bulk-import coordinator remains a single in-flight logical operation for
    # the duration of a batch, but it no longer reserves a worker slot while it
    # waits on child work. The liveness set still guards against stale or lost
    # coordinators without reintroducing the deadlock-prone slot accounting.
    processing_result = await db.execute(
        select(BulkImportJob.id).where(BulkImportJob.status == "processing")
    )
    processing_ids = {row[0] for row in processing_result.all()}
    registration_cutoff = datetime.now(timezone.utc) - timedelta(
        seconds=_BULK_IMPORT_COORDINATOR_LIVENESS_WINDOW_SECONDS
    )
    # A row younger than the liveness window may belong to a coordinator that
    # has not registered yet (queued behind other work, or still starting), so
    # recency stands in for liveness only for that window. Anything older falls
    # through to the registration check below and is admitted when no
    # coordinator is alive, so a crash can never block imports for long.
    recent_coordinator_result = await db.execute(
        select(func.count())
        .select_from(BulkImportJob)
        .where(
            BulkImportJob.status.in_(("pending", "processing")),
            BulkImportJob.updated_at >= registration_cutoff,
        )
    )
    if recent_coordinator_result.scalar_one() > 0:
        raise HTTPException(
            status_code=409,
            detail="A bulk import is already in progress",
        )
    pending_result = await db.execute(
        select(BulkImportJob.id).where(BulkImportJob.status == "pending")
    )
    pending_ids = {row[0] for row in pending_result.all()}
    coordinator_ids = processing_ids | pending_ids
    if coordinator_ids:
        pool = await get_pool()
        if pool is not None:
            live_since = timestamp_ms() - (
                _BULK_IMPORT_COORDINATOR_LIVENESS_WINDOW_SECONDS * 1000
            )
            try:
                live_members = await pool.zrangebyscore(
                    _BULK_IMPORT_COORDINATOR_LIVENESS_KEY,
                    live_since,
                    "+inf",
                )
            except Exception:
                logger.warning(
                    "Could not read bulk-import coordinator liveness",
                    extra={
                        "event": "bulk_import.conflict_liveness_unavailable",
                    },
                    exc_info=True,
                )
            else:
                live_ids = {int(member) for member in live_members}
                if coordinator_ids.intersection(live_ids):
                    raise HTTPException(
                        status_code=409,
                        detail="A bulk import is already in progress",
                    )

    with tracer.start_as_current_span("bulk_import.enqueue") as span:
        try:
            span.set_attribute("bulk_import.category_id", category_id if category_id is not None else "none")

            os.makedirs(settings.source_images_dir, exist_ok=True)

            file_entries: list[tuple[str, str]] = []  # (original_filename, stored_path)

            try:
                for upload in files:
                    if not upload.filename:
                        continue

                    # Handle zip files
                    if upload.filename.lower().endswith(".zip"):
                        # Stream zip to a temp file, then extract images.
                        # The try/finally wraps the entire lifecycle so the
                        # temp file is cleaned up even if streaming fails.
                        tmp_path: str | None = None
                        try:
                            with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp:
                                tmp_path = tmp.name
                                while True:
                                    chunk = await upload.read(UPLOAD_CHUNK_SIZE)
                                    if not chunk:
                                        break
                                    tmp.write(chunk)

                            with zipfile.ZipFile(tmp_path, "r") as zf:
                                for zip_entry in zf.namelist():
                                    # Skip directories and hidden/system files
                                    if zip_entry.endswith("/") or zip_entry.startswith("__MACOSX"):
                                        continue
                                    basename = os.path.basename(zip_entry)
                                    if not basename or basename.startswith("."):
                                        continue
                                    if not _is_image_filename(basename):
                                        continue

                                    ext = Path(basename).suffix or ".bin"
                                    unique_name = f"{uuid.uuid4().hex}{ext}"
                                    stored_path = os.path.join(
                                        settings.source_images_dir, unique_name
                                    )

                                    try:
                                        with (
                                            zf.open(zip_entry) as src,
                                            open(stored_path, "wb") as dst,
                                        ):
                                            shutil.copyfileobj(
                                                src,
                                                dst,
                                                length=_ZIP_EXTRACT_CHUNK_SIZE,
                                            )
                                    except Exception:
                                        with contextlib.suppress(OSError):
                                            os.unlink(stored_path)
                                        raise

                                    file_entries.append(
                                        (
                                            sanitize_upload_filename(basename),
                                            stored_path,
                                        )
                                    )
                        except zipfile.BadZipFile:
                            raise HTTPException(
                                status_code=400,
                                detail=f"File '{upload.filename}' is not a valid zip archive",
                            )
                        finally:
                            if tmp_path is not None:
                                with contextlib.suppress(OSError):
                                    os.unlink(tmp_path)
                    else:
                        # Regular image file
                        if not _is_image_filename(upload.filename):
                            continue  # silently skip non-image files

                        ext = os.path.splitext(upload.filename)[1] or ".bin"
                        unique_name = f"{uuid.uuid4().hex}{ext}"
                        stored_path = os.path.join(settings.source_images_dir, unique_name)

                        # Stream to disk in chunks (handles large TIFFs)
                        try:
                            with open(stored_path, "wb") as f:
                                while True:
                                    chunk = await upload.read(UPLOAD_CHUNK_SIZE)
                                    if not chunk:
                                        break
                                    f.write(chunk)
                        except Exception:
                            with contextlib.suppress(OSError):
                                os.unlink(stored_path)
                            raise

                        file_entries.append(
                            (sanitize_upload_filename(upload.filename), stored_path)
                        )
            except OSError as exc:
                for _, stored_path in file_entries:
                    with contextlib.suppress(OSError):
                        os.unlink(stored_path)
                if exc.errno == errno.ENOSPC:
                    logger.error(
                        "Bulk import failed: no space left on device",
                        extra={"event": "bulk_import.enospc"},
                    )
                    raise HTTPException(
                        status_code=507,
                        detail="Insufficient storage \u2014 the data volume is full",
                    )
                raise
            except Exception:
                # Clean up any files already stored before re-raising
                for _, stored_path in file_entries:
                    with contextlib.suppress(OSError):
                        os.unlink(stored_path)
                raise

            if not file_entries:
                raise HTTPException(
                    status_code=400,
                    detail="No valid image files found in the upload",
                )

            span.set_attribute("bulk_import.total_count", len(file_entries))

            # Create the bulk import job record
            job = BulkImportJob(
                status="pending",
                category_id=category_id,
                total_count=len(file_entries),
                completed_count=0,
                failed_count=0,
                errors=[],
            )
            db.add(job)
            await db.commit()
            await db.refresh(job)

            span.set_attribute("bulk_import.job_id", job.id)

            logger.info(
                "Bulk import job created",
                extra={
                    "event": "bulk_import.job_created",
                    "job_id": job.id,
                    "category_id": category_id,
                    "total_count": len(file_entries),
                },
            )

            # Prefer the arq task queue for resource isolation and job
            # persistence; fall back to in-process BackgroundTasks when Redis
            # is unavailable (e.g. local development without Redis).
            bulk_job_id = job.id
            try:
                enqueue_result = await enqueue_bulk_import(
                    bulk_job_id,
                    file_entries,
                    copyright=copyright,
                    note=note,
                    active=active,
                )
            except TaskQueueUnavailableError:
                bookkeeping_committed = False
                error_entry = [{
                    "filename": None,
                    "error": "Task queue unavailable; bulk import was not started.",
                }]
                try:
                    job.status = "failed"
                    job.failed_count = job.total_count
                    job.errors = list(job.errors or []) + error_entry
                    await db.commit()
                    bookkeeping_committed = True
                except Exception:
                    logger.exception(
                        "Failed to mark bulk import after queue rejection",
                        extra={
                            "event": "bulk_import.queue_rejection_bookkeeping_failed",
                            "job_id": bulk_job_id,
                        },
                    )
                if bookkeeping_committed:
                    for _, stored_path in file_entries:
                        with contextlib.suppress(OSError):
                            os.unlink(stored_path)
                raise
            span.set_attribute("bulk_import.enqueued", enqueue_result.queued)
            if not enqueue_result.queued:
                background_tasks.add_task(
                    _process_bulk_import,
                    bulk_job_id,
                    file_entries,
                    copyright=copyright,
                    note=note,
                    active=active,
                )

            return job
        except Exception as exc:
            record_exception_if_server_error(span, exc)
            raise


@router.get("/", response_model=list[BulkImportJobOut])
async def list_bulk_import_jobs(
    _user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
) -> list[BulkImportJob]:
    """List all bulk import jobs, most recent first."""
    stmt = select(BulkImportJob).order_by(BulkImportJob.created_at.desc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/{job_id}", response_model=BulkImportJobOut)
async def get_bulk_import_job(
    job_id: int,
    _user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
) -> BulkImportJob:
    """Get the current status of a bulk import job."""
    job = await db.get(BulkImportJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Bulk import job not found")
    return job
