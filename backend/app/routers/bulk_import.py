"""Bulk image import endpoints (admin and instructor).

Accepts multiple image files and/or zip archives, extracts images,
and processes them in the background with concurrency limiting.
"""

import asyncio
import contextlib
import errno
import logging
import math
import os
import shutil
import struct
import threading
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, BinaryIO

from arq.connections import ArqRedis
from arq.constants import abort_jobs_ss
from arq.jobs import JobStatus
from arq.utils import timestamp_ms
from asyncpg.exceptions import PostgresError as AsyncpgPostgresError
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from opentelemetry import trace
from opentelemetry.trace import StatusCode
from sqlalchemy import case, cast, exists, select, update
from sqlalchemy.dialects.postgresql import JSONB as JSONB_type
from sqlalchemy.exc import IntegrityError
from sqlalchemy.sql import func
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_role
from ..bulk_import_jobs import (
    bulk_import_source_arq_job_id as _bulk_import_source_arq_job_id,
    coordinator_claims as _coordinator_claims,
    create_bulk_import_job as _create_bulk_import_job,
    finalize_bulk_import_abandoned as _finalize_bulk_import_abandoned,
    finalize_bulk_import_item as _finalize_bulk_import_item,
    finalize_bulk_import_supervisor as _finalize_bulk_import_supervisor,
    heartbeat_bulk_import_coordinator as _heartbeat_bulk_import_coordinator,
    increment_coordinator_claims as _increment_coordinator_claims,
    list_active_bulk_import_supervisors as _list_active_bulk_import_supervisors,
    load_bulk_import_supervisor as _load_bulk_import_supervisor,
    reclaim_expired_bulk_import_items as _reclaim_expired_bulk_import_items,
    requeue_orphaned_bulk_import_items as _requeue_orphaned_bulk_import_items,
    release_bulk_import_coordinator as _release_bulk_import_coordinator,
    try_claim_bulk_import_coordinator as _try_claim_bulk_import_coordinator,
)
from ..database import async_session, get_db, settings
from ..filenames import sanitize_upload_filename
from ..image_validation import IMAGE_EXTENSIONS, UPLOAD_CHUNK_SIZE
from ..job_state import claim_job_items as _claim_job_items
from ..job_state import heartbeat_job_item as _heartbeat_job_item
from ..models import BulkImportJob, Category, Job, JobItem, SourceImage, User
from ..processing import process_source_image
from ..schemas import MAX_NOTE_LENGTH, BulkImportJobOut, normalize_note_value
from ..task_constants import (
    BULK_IMPORT_COORDINATOR_LIVENESS_KEY as _BULK_IMPORT_COORDINATOR_LIVENESS_KEY,
    BULK_IMPORT_COORDINATOR_LIVENESS_WINDOW_SECONDS as _BULK_IMPORT_COORDINATOR_LIVENESS_WINDOW_SECONDS,
    BULK_IMPORT_MAX_REQUEST_BYTES as _MAX_REQUEST_BYTES,
    BULK_IMPORT_MAX_UPLOAD_BYTES as _MAX_UPLOAD_BYTES,
    SOURCE_IMAGE_PENDING_WAIT_SAFETY_CAP_SECONDS,
)
from ..tracing import record_exception_if_server_error
from ..worker import (
    EnqueueResult,
    TaskQueueUnavailableError,
    WorkerSettings,
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
# Decompression-bomb guards for uploaded zip archives. Each image entry is
# capped individually (declared size, compression ratio and bytes actually
# decompressed), the archive is capped cumulatively and by entry count, and the
# data volume must keep a minimum amount of free space while extracting
# (checked every _ZIP_FREE_SPACE_CHECK_INTERVAL_BYTES written).
_ZIP_MAX_ENTRY_BYTES = int(
    os.environ.get("BULK_IMPORT_MAX_ENTRY_BYTES", str(2 * 1024 * 1024 * 1024))
)
_ZIP_MAX_TOTAL_BYTES = int(
    os.environ.get("BULK_IMPORT_MAX_TOTAL_BYTES", str(20 * 1024 * 1024 * 1024))
)
_ZIP_MAX_ENTRIES = int(os.environ.get("BULK_IMPORT_MAX_ENTRIES", "2000"))
_ZIP_MAX_COMPRESSION_RATIO = float(
    os.environ.get("BULK_IMPORT_MAX_COMPRESSION_RATIO", "100")
)
_ZIP_MIN_FREE_BYTES = int(
    os.environ.get("BULK_IMPORT_MIN_FREE_BYTES", str(1024 * 1024 * 1024))
)
_ZIP_FREE_SPACE_CHECK_INTERVAL_BYTES = 512 * 1024 * 1024
_ZIP_NAME_DISPLAY_LIMIT = 40
# Ceiling on one archive's central-directory entry count (#1432). Checked
# from the EOCD record before ZipFile() allocates the ZipInfo list, and
# again on the parsed total after open: ``BULK_IMPORT_MAX_ENTRIES`` only
# counts eligible image entries, so without this an archive of millions of
# tiny non-image files costs API memory/time proportional to its size.
_ZIP_MAX_ARCHIVE_ENTRIES = int(
    os.environ.get("BULK_IMPORT_MAX_ARCHIVE_ENTRIES", "10000")
)


def _validate_zip_limits() -> None:
    for name, value in (
        ("BULK_IMPORT_MAX_ENTRY_BYTES", _ZIP_MAX_ENTRY_BYTES),
        ("BULK_IMPORT_MAX_TOTAL_BYTES", _ZIP_MAX_TOTAL_BYTES),
        ("BULK_IMPORT_MAX_ENTRIES", _ZIP_MAX_ENTRIES),
        ("BULK_IMPORT_MIN_FREE_BYTES", _ZIP_MIN_FREE_BYTES),
        ("BULK_IMPORT_MAX_UPLOAD_BYTES", _MAX_UPLOAD_BYTES),
        ("BULK_IMPORT_MAX_REQUEST_BYTES", _MAX_REQUEST_BYTES),
        ("BULK_IMPORT_MAX_ARCHIVE_ENTRIES", _ZIP_MAX_ARCHIVE_ENTRIES),
    ):
        if value <= 0:
            raise ValueError(f"{name} must be a positive integer, got {value}")
    if _MAX_REQUEST_BYTES < _MAX_UPLOAD_BYTES:
        raise ValueError(
            "BULK_IMPORT_MAX_REQUEST_BYTES must be >= "
            f"BULK_IMPORT_MAX_UPLOAD_BYTES ({_MAX_UPLOAD_BYTES}), got "
            f"{_MAX_REQUEST_BYTES} — a single max-size part would no "
            "longer fit in one request"
        )
    if not math.isfinite(_ZIP_MAX_COMPRESSION_RATIO) or _ZIP_MAX_COMPRESSION_RATIO < 1:
        raise ValueError(
            "BULK_IMPORT_MAX_COMPRESSION_RATIO must be a finite number >= 1, "
            f"got {_ZIP_MAX_COMPRESSION_RATIO}"
        )


_validate_zip_limits()
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


class _ZipExtractLimitExceeded(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _format_gib(num_bytes: int) -> str:
    return f"{num_bytes / (1024 ** 3):g} GiB"


def _display_name(name: str) -> str:
    """Shorten attacker-controlled names so the error detail stays readable."""
    name = os.path.basename(name.replace("\\", "/")) or name
    if len(name) <= _ZIP_NAME_DISPLAY_LIMIT:
        return name
    return name[: _ZIP_NAME_DISPLAY_LIMIT - 1] + "\u2026"


def _ensure_zip_extract_free_space(target_dir: str) -> None:
    free_bytes = shutil.disk_usage(target_dir).free
    if free_bytes < _ZIP_MIN_FREE_BYTES:
        raise _ZipExtractLimitExceeded(
            507,
            "Insufficient storage \u2014 the data volume has less than "
            f"{_format_gib(_ZIP_MIN_FREE_BYTES)} free, so the zip archive "
            "cannot be extracted",
        )


class _ZipExtractBudget:
    """Enforces per-entry, cumulative, entry-count and free-space limits across
    every zip archive extracted for one bulk-import request."""

    def __init__(self) -> None:
        self.archive_name = ""
        self.entries = 0
        self.total_bytes = 0
        self._last_free_space_check = 0

    def begin_archive(self, archive_name: str) -> None:
        self.archive_name = _display_name(archive_name)

    def _entry_too_large(self, zip_entry: str) -> _ZipExtractLimitExceeded:
        return _ZipExtractLimitExceeded(
            413,
            f"Zip entry '{_display_name(zip_entry)}' in '{self.archive_name}' "
            f"is larger than the per-file limit of {_format_gib(_ZIP_MAX_ENTRY_BYTES)}",
        )

    def _archive_too_large(self) -> _ZipExtractLimitExceeded:
        return _ZipExtractLimitExceeded(
            413,
            f"Zip archive '{self.archive_name}' would take this upload beyond "
            f"the total limit of {_format_gib(_ZIP_MAX_TOTAL_BYTES)}",
        )

    def next_entry(self) -> None:
        self.entries += 1
        if self.entries > _ZIP_MAX_ENTRIES:
            raise _ZipExtractLimitExceeded(
                413,
                f"Zip archive '{self.archive_name}' takes this upload beyond "
                f"{_ZIP_MAX_ENTRIES} image files",
            )

    def check_central_directory(self, total_entries: int) -> None:
        """Reject an archive whose raw entry count is oversized (#1432).

        ``next_entry`` only counts eligible image entries, but ``ZipFile``
        parses the entire central directory first — a flood of non-image
        entries costs memory/time even though none are extracted.
        """
        if total_entries > _ZIP_MAX_ARCHIVE_ENTRIES:
            raise _ZipExtractLimitExceeded(
                413,
                f"Zip archive '{self.archive_name}' contains {total_entries} "
                f"entries, over the {_ZIP_MAX_ARCHIVE_ENTRIES} per-archive "
                "limit",
            )

    def prescreen(self, info: zipfile.ZipInfo) -> None:
        """Reject an entry from its central-directory metadata alone."""
        if info.file_size > _ZIP_MAX_ENTRY_BYTES:
            raise self._entry_too_large(info.filename)
        if self.total_bytes + info.file_size > _ZIP_MAX_TOTAL_BYTES:
            raise self._archive_too_large()
        if info.file_size > max(info.compress_size, 1) * _ZIP_MAX_COMPRESSION_RATIO:
            raise _ZipExtractLimitExceeded(
                413,
                f"Zip entry '{_display_name(info.filename)}' in "
                f"'{self.archive_name}' has a compression ratio above "
                f"{_ZIP_MAX_COMPRESSION_RATIO:g}:1 and was rejected as a "
                "possible decompression bomb",
            )

    def extract_entry(
        self,
        zf: zipfile.ZipFile,
        zip_entry: str,
        stored_path: str,
        target_dir: str,
    ) -> None:
        """Write ``zip_entry`` to ``stored_path`` with a bounded read loop.

        The declared sizes are pre-screened, then the limits are re-checked on
        the bytes actually decompressed (headers are attacker-controlled).
        Aborts before the next write as soon as a limit is crossed, leaving
        cleanup of ``stored_path`` to the caller.
        """
        self.prescreen(zf.getinfo(zip_entry))
        _ensure_zip_extract_free_space(target_dir)

        entry_bytes = 0
        with zf.open(zip_entry) as src, open(stored_path, "wb") as dst:
            while True:
                chunk = src.read(_ZIP_EXTRACT_CHUNK_SIZE)
                if not chunk:
                    break
                entry_bytes += len(chunk)
                self.total_bytes += len(chunk)
                if entry_bytes > _ZIP_MAX_ENTRY_BYTES:
                    raise self._entry_too_large(zip_entry)
                if self.total_bytes > _ZIP_MAX_TOTAL_BYTES:
                    raise self._archive_too_large()
                dst.write(chunk)
                if (
                    self.total_bytes - self._last_free_space_check
                    >= _ZIP_FREE_SPACE_CHECK_INTERVAL_BYTES
                ):
                    self._last_free_space_check = self.total_bytes
                    _ensure_zip_extract_free_space(target_dir)


# End-of-central-directory record layout (APPNOTE §4.3.16). Parsing just
# the EOCD gives the archive's declared total entry count without building
# one ZipInfo per record — the pre-parse bound on ``ZipFile``'s memory use
# (#1432). Fields that overflow 16/32 bits are saturated and the real values
# live in the ZIP64 EOCD located via the locator record just before it.
_EOCD_SIGNATURE = b"PK\x05\x06"
_EOCD_MIN_BYTES = 22
_EOCD_SEARCH_BYTES = _EOCD_MIN_BYTES + 0xFFFF  # + max comment length
_EOCD_STRUCT = struct.Struct("<4s4H2LH")
_ZIP64_LOCATOR_SIGNATURE = b"PK\x06\x07"
_ZIP64_LOCATOR_STRUCT = struct.Struct("<4sLQL")
_ZIP64_EOCD_SIGNATURE = b"PK\x06\x06"
_ZIP64_EOCD_STRUCT = struct.Struct("<4sQ2H2L4Q")
_UINT16_MAX = 0xFFFF
_UINT32_MAX = 0xFFFFFFFF


def _zip_declared_entry_count(archive: BinaryIO) -> int | None:
    """Return an archive's declared total entry count, or ``None``.

    ``ZipFile`` allocates the full ``ZipInfo`` list while parsing the
    central directory on open, so the per-archive entry ceiling must be
    checked from this cheap EOCD read first. ``None`` means the record
    could not be read (truncated/garbled/zip64-inconsistent); the caller
    then defers to ``ZipFile``'s own ``BadZipFile`` handling and the
    post-open re-check of the parsed count. All reads are absolute seeks,
    so ``archive`` may be positioned anywhere; the incoming position is
    restored on exit. ``None`` is also returned for non-seekable streams
    (a ``ZipFile``-compatible file object is always seekable, so this
    only matters for misuse).
    """
    pos = 0
    try:
        pos = archive.tell()
        archive.seek(0, os.SEEK_END)
        size = archive.tell()
        if size < _EOCD_MIN_BYTES:
            return None
        archive.seek(max(0, size - _EOCD_SEARCH_BYTES))
        tail = archive.read()

        idx = tail.rfind(_EOCD_SIGNATURE)
        if idx < 0 or idx + _EOCD_MIN_BYTES > len(tail):
            return None
        (
            _sig,
            _disk,
            _cd_disk,
            disk_entries,
            total_entries,
            cd_size,
            cd_offset,
            _comment_len,
        ) = _EOCD_STRUCT.unpack(tail[idx : idx + _EOCD_MIN_BYTES])
        if (
            total_entries != _UINT16_MAX
            and disk_entries != _UINT16_MAX
            and cd_size != _UINT32_MAX
            and cd_offset != _UINT32_MAX
        ):
            return total_entries

        # ZIP64: the locator record sits immediately before the EOCD.
        eocd_offset = size - len(tail) + idx
        locator_offset = eocd_offset - _ZIP64_LOCATOR_STRUCT.size
        if locator_offset < 0:
            return None
        archive.seek(locator_offset)
        locator = archive.read(_ZIP64_LOCATOR_STRUCT.size)
        if (
            len(locator) != _ZIP64_LOCATOR_STRUCT.size
            or locator[:4] != _ZIP64_LOCATOR_SIGNATURE
        ):
            # Claims ZIP64 but has no locator — let ZipFile raise.
            return None
        (_lsig, _ldisk, zip64_offset, _ldisks) = _ZIP64_LOCATOR_STRUCT.unpack(
            locator
        )
        if zip64_offset + _ZIP64_EOCD_STRUCT.size > size:
            return None
        archive.seek(zip64_offset)
        z64 = archive.read(_ZIP64_EOCD_STRUCT.size)
    except (OSError, ValueError):
        return None
    finally:
        with contextlib.suppress(OSError, ValueError):
            archive.seek(pos)
    if len(z64) != _ZIP64_EOCD_STRUCT.size or z64[:4] != _ZIP64_EOCD_SIGNATURE:
        return None
    fields = _ZIP64_EOCD_STRUCT.unpack(z64)
    return fields[7]  # total entries across all disks (u64)


def _extract_zip_image_entries(
    archive: BinaryIO,
    budget: _ZipExtractBudget,
    file_entries: list[tuple[str, str]],
    target_dir: str,
    done: threading.Event,
) -> None:
    """Extract eligible image entries from the open zip archive ``archive``.

    Runs entirely on a worker thread (``asyncio.to_thread`` at the call
    site): parsing the central directory and decompressing entries are
    synchronous CPU/IO work that would otherwise stall the API worker's
    event loop for the whole archive.

    Each staged entry is appended to ``file_entries`` as an
    ``(original_filename, stored_path)`` pair as soon as it lands, so a
    caller cancelled mid-extraction can still find and remove them — a
    cancelled asyncio wrapper cannot carry the paths back. ``done`` is
    set on every exit so the caller can confirm the thread has finished
    before sweeping ``file_entries``.
    """
    try:
        declared_entries = _zip_declared_entry_count(archive)
        if declared_entries is not None:
            # Reject oversized central directories before ZipFile()
            # allocates one ZipInfo per record.
            budget.check_central_directory(declared_entries)
        with zipfile.ZipFile(archive, "r") as zf:
            # The declared count can understate a malformed archive, so
            # the parsed total is re-checked after open as well.
            budget.check_central_directory(len(zf.infolist()))
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
                stored_path = os.path.join(target_dir, unique_name)

                budget.next_entry()
                try:
                    budget.extract_entry(zf, zip_entry, stored_path, target_dir)
                except Exception:
                    with contextlib.suppress(OSError):
                        os.unlink(stored_path)
                    raise

                file_entries.append(
                    (sanitize_upload_filename(basename), stored_path)
                )
    finally:
        done.set()


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


def _coerce_utc_aware(dt: datetime, *, event: str, **log_fields: object) -> datetime:
    """Return a timezone-aware UTC datetime, tolerating naive DB values."""
    if dt.tzinfo is not None:
        return dt

    logger.warning(
        "Bulk import naive datetime coerced to UTC",
        extra={"event": event, **log_fields},
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


async def _register_bulk_import_coordinator(
    bulk_import_job_id: int,
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
                )


async def _unregister_bulk_import_coordinator(
    pool: ArqRedis,
    bulk_import_job_id: int,
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
            updated_at = _coerce_utc_aware(
                src.updated_at,
                event="bulk_import.naive_updated_at",
                source_image_id=source_image_id,
            )
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


async def _process_bulk_import(bulk_import_job_id: int) -> None:
    """API-hosted durable coordinator for one bulk import (#1173).

    Registers Redis liveness (still used by source-image reconciliation and
    the POST conflict guard), runs the durable pump, and always unregisters.
    The coordinator itself holds no arq worker slot; child image processing
    is dispatched through the queue exactly as before.
    """
    coordinator_pool_ref = [
        await _register_bulk_import_coordinator(bulk_import_job_id)
    ]
    coordinator_stop_event = asyncio.Event()
    coordinator_liveness_task = asyncio.create_task(
        _bulk_import_coordinator_liveness_loop(
            coordinator_pool_ref,
            bulk_import_job_id,
            coordinator_stop_event,
        )
    )
    try:
        await _process_bulk_import_impl(bulk_import_job_id)
    finally:
        coordinator_stop_event.set()
        coordinator_liveness_task.cancel()
        await asyncio.gather(
            coordinator_liveness_task,
            return_exceptions=True,
        )
        if coordinator_pool_ref[0] is not None:
            await _unregister_bulk_import_coordinator(
                coordinator_pool_ref[0],
                bulk_import_job_id,
            )


async def _get_or_create_bulk_source_image(
    db: AsyncSession,
    *,
    bulk_import_job_id: int,
    original_filename: str,
    stored_path: str,
    category_id: int | None,
    copyright: str | None,
    note: str | None,
    active: bool,
    requested_by: int | None,
) -> SourceImage:
    """Idempotent ``SourceImage`` creation keyed by (bulk job, staged path).

    The partial unique index ``uq_source_images_bulk_import_entry`` makes
    this safe under overlapping coordinators after a lease takeover: the
    loser of the insert race re-reads the winner's row instead of
    duplicating it. The caller owns the transaction boundary.
    """
    stmt = select(SourceImage).where(
        SourceImage.bulk_import_job_id == bulk_import_job_id,
        SourceImage.stored_path == stored_path,
    )
    src = (await db.execute(stmt)).scalar_one_or_none()
    if src is not None:
        return src
    src = SourceImage(
        original_filename=original_filename,
        stored_path=stored_path,
        status="pending",
        name=Path(original_filename).stem,
        category_id=category_id,
        copyright=copyright or "Public Domain",
        note=note,
        active=active,
        uploaded_by=requested_by,
        bulk_import_job_id=bulk_import_job_id,
    )
    db.add(src)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        src = (await db.execute(stmt)).scalar_one_or_none()
        if src is None:
            raise
    return src


async def _track_bulk_import_item(
    *,
    bulk_import_job_id: int,
    supervisor_job_id: int,
    item_id: int,
    claim_token: str,
    original_filename: str,
    stored_path: str,
    category_id: int | None,
    copyright: str | None,
    note: str | None,
    active: bool,
    requested_by: int | None,
    batch_progress: _BulkImportProgress,
) -> None:
    """Drive one claimed ``JobItem`` to a terminal state.

    Per-file lifecycle: get-or-create the ``SourceImage`` (idempotent across
    coordinator restarts via ``uq_source_images_bulk_import_entry``), ensure
    exactly one processing submission through the deterministic arq job ID,
    wait for the terminal source state with the existing detector, then
    finalize the item — token-guarded so a superseded coordinator cannot
    double-count the file.
    """
    terminal_status: str | None = None
    error_message: str | None = None
    source_image_id: int | None = None
    try:
        async with async_session() as db:
            src = await _get_or_create_bulk_source_image(
                db,
                bulk_import_job_id=bulk_import_job_id,
                original_filename=original_filename,
                stored_path=stored_path,
                category_id=category_id,
                copyright=copyright,
                note=note,
                active=active,
                requested_by=requested_by,
            )
            await db.commit()
            source_image_id = src.id
            if src.status in {"completed", "failed"}:
                # A previous coordinator already drove this file to a
                # terminal state; fold the outcome into the durable ledger
                # without re-dispatching.
                terminal_status = src.status
                error_message = src.error_message or src.status_message

        if terminal_status is None:
            assert source_image_id is not None
            enqueue_result = await enqueue_process_source_image(
                source_image_id,
                arq_job_id=_bulk_import_source_arq_job_id(source_image_id),
            )
            if enqueue_result.queued:
                terminal_state = await _wait_for_source_image_terminal_state(
                    source_image_id,
                    original_filename,
                    enqueue_result=enqueue_result,
                    batch_progress=batch_progress,
                    bulk_import_job_id=bulk_import_job_id,
                )
            else:
                # Queue unavailable in fallback mode: run the pipeline
                # in-process, same degraded path as the legacy coordinator.
                await process_source_image(source_image_id)
                async with async_session() as db:
                    src_check = await db.get(SourceImage, source_image_id)
                    if src_check is None:
                        raise RuntimeError(
                            f"Source image {source_image_id} disappeared "
                            "after processing"
                        )
                    terminal_state = _source_image_terminal_state(src_check)
            terminal_status = terminal_state.status
            if terminal_status == "failed":
                error_message = (
                    terminal_state.error_message
                    or terminal_state.status_message
                    or "Processing failed"
                )

        won = await _finalize_bulk_import_item(
            job_id=supervisor_job_id,
            item_id=item_id,
            claim_token=claim_token,
            bulk_import_job_id=bulk_import_job_id,
            filename=original_filename,
            terminal_status=(
                "completed" if terminal_status == "completed" else "failed"
            ),
            error_message=error_message,
        )
        if not won:
            logger.info(
                "Bulk-import item finalize lost its claim",
                extra={
                    "event": "bulk_import.item_finalize_claim_lost",
                    "job_id": supervisor_job_id,
                    "item_id": item_id,
                    "bulk_import_job_id": bulk_import_job_id,
                    "original_filename": original_filename,
                },
            )
    except TaskQueueUnavailableError as exc:
        # Required-mode queue rejection: mark the source image failed,
        # drop the staged file, and finalize the item — the same
        # bookkeeping the legacy coordinator performed.
        detail = "Task queue unavailable; image processing was not started."
        bookkeeping_committed = False
        if source_image_id is not None:
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
                        "job_id": bulk_import_job_id,
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
                "job_id": bulk_import_job_id,
                "source_image_id": source_image_id,
                "original_filename": original_filename,
            },
            exc_info=True,
        )
        try:
            await _finalize_bulk_import_item(
                job_id=supervisor_job_id,
                item_id=item_id,
                claim_token=claim_token,
                bulk_import_job_id=bulk_import_job_id,
                filename=original_filename,
                terminal_status="failed",
                error_message=detail,
            )
        except Exception:
            logger.exception(
                "Bulk import: failed to finalize item after queue rejection",
                extra={
                    "event": "bulk_import.item_finalize_failed",
                    "job_id": supervisor_job_id,
                    "item_id": item_id,
                    "bulk_import_job_id": bulk_import_job_id,
                    "original_filename": original_filename,
                },
            )
    except Exception as exc:
        span = trace.get_current_span()
        span.record_exception(exc)
        span.set_status(StatusCode.ERROR, str(exc))
        logger.exception(
            "Bulk import: unexpected item error",
            extra={
                "event": "bulk_import.unexpected_error",
                "job_id": supervisor_job_id,
                "item_id": item_id,
                "bulk_import_job_id": bulk_import_job_id,
                "original_filename": original_filename,
            },
        )
        try:
            await _finalize_bulk_import_item(
                job_id=supervisor_job_id,
                item_id=item_id,
                claim_token=claim_token,
                bulk_import_job_id=bulk_import_job_id,
                filename=original_filename,
                terminal_status="failed",
                error_message=str(exc),
            )
        except Exception:
            logger.exception(
                "Bulk import: failed to finalize item after unexpected error",
                extra={
                    "event": "bulk_import.item_finalize_failed",
                    "job_id": supervisor_job_id,
                    "item_id": item_id,
                    "bulk_import_job_id": bulk_import_job_id,
                    "original_filename": original_filename,
                },
            )



async def _cleanup_orphaned_bulk_import_files(
    session: AsyncSession,
    job_ids: list[int],
) -> None:
    """Delete staged files for abandoned jobs that were never processed.

    A bulk-import coordinator now runs as an API ``BackgroundTasks`` job with
    no durable restart path (see the coordinator-hosting change in
    ``bulk_import_images``), so an API restart mid-import can strand staged
    files on disk that will never become a ``SourceImage``. This uses the
    persisted ``file_manifest`` to find those orphans and remove them; files
    that already made it into ``source_images`` are left alone regardless of
    the image's own processing outcome.
    """
    if not job_ids:
        return
    manifest_stmt = select(BulkImportJob.file_manifest).where(
        BulkImportJob.id.in_(job_ids)
    )
    manifest_result = await session.execute(manifest_stmt)
    stored_paths: set[str] = set()
    for (manifest,) in manifest_result.all():
        for entry in manifest or []:
            if len(entry) == 2:
                stored_paths.add(entry[1])
    if not stored_paths:
        return
    known_stmt = select(SourceImage.stored_path).where(
        SourceImage.stored_path.in_(stored_paths)
    )
    known_result = await session.execute(known_stmt)
    known_paths = {row[0] for row in known_result.all()}
    orphaned_paths = stored_paths - known_paths
    removed = 0
    for stored_path in orphaned_paths:
        try:
            os.unlink(stored_path)
            removed += 1
        except FileNotFoundError:
            continue
        except OSError:
            logger.warning(
                "Failed to remove orphaned bulk-import staged file",
                extra={
                    "event": "bulk_import.orphaned_file_cleanup_failed",
                    "stored_path": stored_path,
                },
                exc_info=True,
            )
    if removed:
        logger.warning(
            "Removed %d orphaned bulk-import staged file(s) on startup",
            removed,
            extra={
                "event": "bulk_import.orphaned_files_removed",
                "bulk_import_job_ids": job_ids,
                "removed_count": removed,
            },
        )


def _is_single_active_job_violation(exc: IntegrityError) -> bool:
    """Check whether ``exc`` is the ``idx_bulk_import_jobs_single_active``
    partial unique index violation, as opposed to some unrelated integrity
    failure (e.g. a foreign-key violation) surfacing at the same commit.

    ``exc.orig`` is the DBAPI-level exception, an
    ``AsyncAdapt_asyncpg_dbapi.Error`` instance that does not itself carry
    ``constraint_name``. With the asyncpg driver, SQLAlchemy's dialect
    re-raises that translated wrapper via ``raise translated_error from
    native_error`` (see ``sqlalchemy.dialects.postgresql.asyncpg.
    AsyncAdapt_asyncpg_connection._handle_exception``), so the native
    ``asyncpg.exceptions.PostgresError`` -- a real, statically-declared
    ``constraint_name`` attribute -- is reachable only via
    ``exc.orig.__cause__``. Both ``exc.orig`` and its ``__cause__`` are
    checked by explicit ``isinstance`` narrowing against the known asyncpg
    exception type, since ``BaseException.__cause__`` is a normal attribute
    on every exception (defaulting to ``None``) rather than a driver-specific
    dynamic one.
    """
    orig = exc.orig
    if isinstance(orig, AsyncpgPostgresError):
        if orig.constraint_name == "idx_bulk_import_jobs_single_active":
            return True
    cause = orig.__cause__ if orig is not None else None
    if isinstance(cause, AsyncpgPostgresError):
        if cause.constraint_name == "idx_bulk_import_jobs_single_active":
            return True
    return False


async def _finalize_abandoned_bulk_import_jobs(
    session: AsyncSession,
    job_ids: set[int] | list[int],
    *,
    abandonment_note: str,
) -> list[int]:
    """Atomically finalize the given ``bulk_import_jobs`` rows to a terminal
    state, restricted to rows still in ``pending``/``processing``.

    This does not commit; the caller controls the transaction boundary so the
    finalization can be bundled atomically with other work (e.g. inserting a
    replacement job). A concurrent finalizer racing for the same rows simply
    affects fewer rows here, since the ``WHERE`` clause is re-evaluated after
    the row lock is acquired — no error, no double-finalization.

    Rows with a durable ``job_id`` link (#1173) also have their ``Job``
    supervisor and non-terminal ``JobItem``s terminated in the same
    transaction, so a superseded import cannot keep a coordinator claimable
    or leave item state dangling.
    """
    if not job_ids:
        return []
    # A durable import whose supervisor lease is still live belongs to a
    # running coordinator — never finalize it out from under that
    # coordinator, no matter how stale the domain row looks (#1173).
    live_coordinator_lease = exists(
        select(Job.id)
        .where(
            Job.id == BulkImportJob.job_id,
            Job.status.in_(("queued", "running")),
            Job.coordinator_lease_expires_at.is_not(None),
            Job.coordinator_lease_expires_at > func.now(),
        )
        .correlate(BulkImportJob)
    )
    stmt = (
        update(BulkImportJob)
        .where(
            BulkImportJob.id.in_(job_ids),
            BulkImportJob.status.in_(("pending", "processing")),
            ~live_coordinator_lease,
        )
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
                    + cast([{"error": abandonment_note}], JSONB_type)
                )
            ),
            updated_at=func.now(),
        )
        .returning(BulkImportJob.id, BulkImportJob.job_id)
    )
    result = await session.execute(stmt)
    rows = result.all()
    finalized_ids = [row[0] for row in rows]
    durable_job_ids = [row[1] for row in rows if row[1] is not None]
    if durable_job_ids:
        now = func.now()
        await session.execute(
            update(JobItem)
            .where(
                JobItem.job_id.in_(durable_job_ids),
                JobItem.status.in_(("queued", "running")),
            )
            .values(
                status="cancelled",
                claim_token=None,
                heartbeat_at=None,
                lease_expires_at=None,
                retry_not_before=None,
                arq_job_id=None,
                started_at=None,
                completed_at=now,
                updated_at=now,
            )
        )
        await session.execute(
            update(Job)
            .where(
                Job.id.in_(durable_job_ids),
                Job.status.in_(("queued", "running", "cancelling")),
            )
            .values(
                status="cancelled",
                progress=100,
                error_message=abandonment_note,
                completed_at=now,
                coordinator_token=None,
                coordinator_heartbeat_at=None,
                coordinator_lease_expires_at=None,
                updated_at=now,
            )
        )
    return finalized_ids


async def reconcile_stale_bulk_import_jobs(
    session: AsyncSession,
    stale_after_seconds: int = _STALE_BULK_IMPORT_SECONDS,
) -> int:
    """Mark abandoned bulk-import coordinators as failed on startup.

    Also cleans up any staged files that were never picked up for processing
    (per the persisted ``file_manifest``) so an interrupted import doesn't
    leak files on disk indefinitely. See ``_cleanup_orphaned_bulk_import_files``.

    Rows linked to a durable ``Job`` supervisor (``job_id`` set, #1173) are
    excluded: their resume path is the API-side coordinator sweep plus the
    supervisor lease/claim-cap machinery, not finalize-on-stale.
    """
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
        # Durable imports (#1173) are resumed by the API coordinator sweep,
        # not finalized here — only legacy rows without a Job link are
        # abandoned-and-finalized by this path.
        BulkImportJob.job_id.is_(None),
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
        await _cleanup_orphaned_bulk_import_files(session, ids)
    return len(ids)


async def _process_bulk_import_impl(bulk_import_job_id: int) -> None:
    """Durable coordinator: claim the supervisor lease and pump ``JobItem``s.

    Resumable across API restarts, crashes, rolling deploys, and OOM kills
    (#1173): every durable transition lives in PostgreSQL, so any replica's
    sweep can re-claim an expired coordinator lease and continue from the
    last finalized item. At most ``_MAX_CONCURRENCY`` items are in flight;
    the rest stay ``queued`` in ``job_items`` until a slot frees.
    """
    token = uuid.uuid4().hex
    async with async_session() as db:
        ctx = await _load_bulk_import_supervisor(db, bulk_import_job_id)
        if ctx is None:
            logger.info(
                "Bulk import has no durable supervisor; nothing to coordinate",
                extra={
                    "event": "bulk_import.no_durable_supervisor",
                    "bulk_import_job_id": bulk_import_job_id,
                },
            )
            return
        bulk_job, supervisor = ctx
        bulk_status = bulk_job.status
        supervisor_status = supervisor.status
        claims = _coordinator_claims(supervisor.metadata_)
        meta = dict(supervisor.metadata_ or {})
        supervisor_id = supervisor.id
        bulk_id = bulk_job.id
        category_id = bulk_job.category_id
        requested_by = bulk_job.requested_by

    if bulk_status not in {"pending", "processing"}:
        logger.info(
            "Terminal BulkImportJob found, skipping processing",
            extra={
                "event": "bulk_import.terminal_job_skipped",
                "bulk_import_job_id": bulk_id,
                "status": bulk_status,
            },
        )
        return

    terminal_supervisor_statuses = {
        "completed",
        "completed_with_errors",
        "failed",
        "cancelled",
    }
    if supervisor_status in terminal_supervisor_statuses:
        # The domain row is still active but the supervisor already
        # finished — close out the import record (defensive; the normal
        # finalize paths write both rows in one transaction).
        await _finalize_bulk_import_supervisor(
            job_id=supervisor_id,
            bulk_import_job_id=bulk_id,
        )
        return

    def _meta_int(key: str, default: int) -> int:
        value = meta.get(key)
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            return default
        return value

    lease_seconds = _meta_int(
        "coordinator_lease_seconds",
        settings.bulk_import_coordinator_lease_seconds,
    )
    heartbeat_seconds = _meta_int(
        "coordinator_heartbeat_seconds",
        settings.bulk_import_coordinator_heartbeat_seconds,
    )
    item_lease_seconds = _meta_int(
        "item_lease_seconds",
        settings.bulk_import_item_lease_seconds,
    )
    max_item_attempts = _meta_int(
        "max_item_attempts",
        settings.bulk_import_max_item_attempts,
    )
    max_claims = _meta_int(
        "max_coordinator_claims",
        settings.bulk_import_max_coordinator_claims,
    )

    # ── Coordinator claim: CAS on the supervisor lease ──
    async with async_session() as db:
        won = await _try_claim_bulk_import_coordinator(
            db,
            supervisor_id,
            token=token,
            lease_seconds=lease_seconds,
        )
        if not won:
            logger.info(
                "Bulk-import coordinator claim lost to a peer",
                extra={
                    "event": "bulk_import.coordinator_claim_lost",
                    "bulk_import_job_id": bulk_id,
                    "job_id": supervisor_id,
                },
            )
            return
        if claims >= max_claims:
            # Only the lease winner may abandon: a delayed duplicate task
            # that lost the CAS must never cancel a live coordinator's
            # items (#1173 review).
            await db.rollback()
            await _finalize_bulk_import_abandoned(
                bulk_import_job_id=bulk_id,
                job_id=supervisor_id,
                abandonment_note=(
                    "Bulk-import coordinator repeatedly failed to complete "
                    f"the import; abandoned after {max_claims} coordinator "
                    "claims."
                ),
            )
            async with async_session() as cleanup_db:
                await _cleanup_orphaned_bulk_import_files(
                    cleanup_db, [bulk_id]
                )
                await cleanup_db.commit()
            return
        await _increment_coordinator_claims(db, supervisor_id)
        requeued = await _requeue_orphaned_bulk_import_items(db, supervisor_id)
        bulk_row = await db.get(BulkImportJob, bulk_id, populate_existing=True)
        if bulk_row is not None and bulk_row.status == "pending":
            bulk_row.status = "processing"
            bulk_row.updated_at = datetime.now(timezone.utc)
        await db.commit()

    logger.info(
        "Bulk-import coordinator claimed",
        extra={
            "event": "bulk_import.coordinator_claimed",
            "bulk_import_job_id": bulk_id,
            "job_id": supervisor_id,
            "requeued_orphaned_items": requeued,
            "coordinator_claims": claims + 1,
        },
    )

    copyright = meta.get("copyright")
    note = meta.get("note")
    active = bool(meta.get("active", True))
    batch_progress = _BulkImportProgress(
        last_child_advanced_at=time.monotonic()
    )
    in_flight: dict[int, tuple[asyncio.Task[None], str]] = {}

    try:
        while True:
            lost_item_ids: list[int] = []
            claimed_items: list[JobItem] = []
            bulk_done = False
            supervisor_done = False
            # The coordinator heartbeat commits in its own transaction so
            # the ``jobs`` row lock is never held while item ``job_items``
            # locks are taken below — ``finalize_bulk_import_item`` locks in
            # the opposite order (items → bulk → jobs FOR UPDATE), and
            # mixing the orders deadlocks (#1173).
            async with async_session() as db:
                owned = await _heartbeat_bulk_import_coordinator(
                    db,
                    supervisor_id,
                    token,
                    lease_seconds,
                )
                await db.commit()
            if owned:
                async with async_session() as db:
                    for item_id, (_task, item_token) in in_flight.items():
                        item_owned = await _heartbeat_job_item(
                            db,
                            item_id,
                            item_token,
                            item_lease_seconds,
                        )
                        if not item_owned:
                            lost_item_ids.append(item_id)
                    await _reclaim_expired_bulk_import_items(
                        db,
                        supervisor_id,
                        bulk_id,
                        max_attempts=max_item_attempts,
                    )
                    free_slots = _MAX_CONCURRENCY - len(in_flight)
                    if free_slots > 0:
                        claimed_items = await _claim_job_items(
                            db,
                            supervisor_id,
                            free_slots,
                            item_lease_seconds,
                        )
                    bulk_row = await db.get(
                        BulkImportJob, bulk_id, populate_existing=True
                    )
                    bulk_done = (
                        bulk_row is None
                        or bulk_row.status not in {"pending", "processing"}
                    )
                    sup_row = await db.get(
                        Job, supervisor_id, populate_existing=True
                    )
                    supervisor_done = (
                        sup_row is None
                        or sup_row.status in terminal_supervisor_statuses
                    )
                    await db.commit()

            for item_id in lost_item_ids:
                entry = in_flight.pop(item_id, None)
                if entry is not None:
                    entry[0].cancel()
            if not owned or bulk_done or supervisor_done:
                break

            for item_id, (task, _item_token) in list(in_flight.items()):
                if task.done():
                    with contextlib.suppress(Exception):
                        task.result()
                    del in_flight[item_id]

            for item in claimed_items:
                item_meta = item.metadata_ or {}
                task = asyncio.create_task(
                    _track_bulk_import_item(
                        bulk_import_job_id=bulk_id,
                        supervisor_job_id=supervisor_id,
                        item_id=item.id,
                        claim_token=item.claim_token,
                        original_filename=str(
                            item_meta.get("original_filename") or "unknown"
                        ),
                        stored_path=str(item_meta.get("stored_path") or ""),
                        category_id=category_id,
                        copyright=copyright,
                        note=note,
                        active=active,
                        requested_by=requested_by,
                        batch_progress=batch_progress,
                    )
                )
                in_flight[item.id] = (task, item.claim_token)

            if not in_flight:
                # No running items and the claim pass found nothing
                # queued — every item is terminal, so the import is done.
                break

            await asyncio.wait(
                [task for task, _item_token in in_flight.values()],
                timeout=heartbeat_seconds,
                return_when=asyncio.FIRST_COMPLETED,
            )
    finally:
        for task, _item_token in in_flight.values():
            task.cancel()
        if in_flight:
            await asyncio.gather(
                *[task for task, _item_token in in_flight.values()],
                return_exceptions=True,
            )
        try:
            async with async_session() as db:
                await _release_bulk_import_coordinator(
                    db, supervisor_id, token
                )
                await db.commit()
        except Exception:
            logger.warning(
                "Failed to release bulk-import coordinator lease",
                extra={
                    "event": "bulk_import.coordinator_release_failed",
                    "bulk_import_job_id": bulk_id,
                    "job_id": supervisor_id,
                },
                exc_info=True,
            )

    await _finalize_bulk_import_supervisor(
        job_id=supervisor_id,
        bulk_import_job_id=bulk_id,
    )
    logger.info(
        "Bulk-import coordinator finished",
        extra={
            "event": "bulk_import.coordinator_finished",
            "bulk_import_job_id": bulk_id,
            "job_id": supervisor_id,
        },
    )


async def sweep_bulk_import_coordinators() -> dict[str, int]:
    """One coordinator-sweep pass across active durable imports (#1173).

    Every API replica runs this on a timer; the supervisor CAS claim keeps
    it single-flight, so replicas only ever *nudge* — ``_process_bulk_import``
    itself decides whether it wins the lease. Imports whose supervisor is
    already terminal but whose domain row is still active are closed out
    defensively (the normal paths write both rows atomically).
    """
    async with async_session() as db:
        rows = await _list_active_bulk_import_supervisors(db)

    terminal_supervisor_statuses = {
        "completed",
        "completed_with_errors",
        "failed",
        "cancelled",
    }
    stranded_ids = [
        int(row["bulk_import_job_id"])
        for row in rows
        if str(row["supervisor_status"]) in terminal_supervisor_statuses
    ]
    closed = 0
    if stranded_ids:
        async with async_session() as db:
            finalized = await _finalize_abandoned_bulk_import_jobs(
                db,
                stranded_ids,
                abandonment_note=(
                    "Durable supervisor already reached a terminal state; "
                    "closing the stranded import record."
                ),
            )
            if finalized:
                await _cleanup_orphaned_bulk_import_files(db, finalized)
            await db.commit()
        closed = len(finalized)

    spawned = 0
    for row in rows:
        if str(row["supervisor_status"]) in terminal_supervisor_statuses:
            continue
        if not row["lease_free"]:
            continue
        asyncio.create_task(
            _process_bulk_import(int(row["bulk_import_job_id"]))
        )
        spawned += 1
    if spawned or closed:
        logger.info(
            "Bulk-import coordinator sweep pass complete",
            extra={
                "event": "bulk_import.sweep_pass",
                "spawned": spawned,
                "closed": closed,
                "active": len(rows),
            },
        )
    return {"spawned": spawned, "closed": closed}


async def bulk_import_coordinator_sweep_loop() -> None:
    """Periodically resume durable bulk imports on this API replica.

    Started from the FastAPI lifespan so every replica self-heals imports
    orphaned by a sibling's restart, crash, rolling deploy, or OOM kill —
    the durable counterpart to the one-shot startup reconciliation.
    ``sweep_bulk_import_coordinators`` only *nudges* lease-free imports and
    the supervisor CAS claim inside ``_process_bulk_import`` keeps execution
    single-flight, so replicas can never double-coordinate.
    """
    interval = settings.bulk_import_coordinator_sweep_seconds
    while True:
        try:
            await sweep_bulk_import_coordinators()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception(
                "Bulk-import coordinator sweep failed",
                extra={"event": "bulk_import.sweep_failed"},
            )
        await asyncio.sleep(interval)


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
        select(BulkImportJob.id, BulkImportJob.updated_at).where(
            BulkImportJob.status == "processing"
        )
    )
    processing_rows = {row[0]: row[1] for row in processing_result.all()}
    pending_result = await db.execute(
        select(BulkImportJob.id, BulkImportJob.updated_at).where(
            BulkImportJob.status == "pending"
        )
    )
    pending_rows = {row[0]: row[1] for row in pending_result.all()}
    coordinator_rows = {**processing_rows, **pending_rows}
    coordinator_ids = set(coordinator_rows)
    # A row younger than the liveness window may belong to a coordinator that
    # has not registered yet (queued behind other work, or still starting), so
    # recency stands in for liveness only for that window. Anything older falls
    # through to the registration check below and is admitted when no
    # coordinator is alive, so a crash can never block imports for long.
    #
    # This check is derived from coordinator_rows -- the rows just fetched
    # above -- rather than a separate, earlier COUNT query. A separate,
    # earlier read would leave a window between it and the pending_rows read
    # where a concurrent request's job could commit: that fresh row would
    # sail past an already-completed recency COUNT, land in coordinator_rows
    # here, and (with Redis liveness not yet registered for a job that young)
    # get discarded as "abandoned" by the finalizer below -- discarding the
    # concurrent winner's own in-flight import. Gating on the same rows we
    # already fetched for coordinator_rows closes that window: any row fresh
    # enough to matter is necessarily visible to this check.
    registration_cutoff = datetime.now(timezone.utc) - timedelta(
        seconds=_BULK_IMPORT_COORDINATOR_LIVENESS_WINDOW_SECONDS
    )
    has_recent_coordinator = any(
        _coerce_utc_aware(
            updated,
            event="bulk_import.naive_job_updated_at",
            bulk_import_job_id=job_id,
        )
        >= registration_cutoff
        for job_id, updated in coordinator_rows.items()
    )
    if has_recent_coordinator:
        raise HTTPException(
            status_code=409,
            detail="A bulk import is already in progress",
        )
    # True only when Redis was reachable and positively reported that none of
    # coordinator_ids are alive. False when liveness is unreadable or disabled
    # and the guard falls open on trust alone -- that case still finalizes the
    # row's status below (existing behavior, so a crashed coordinator doesn't
    # block imports forever), but it is NOT proof the coordinator has actually
    # stopped, so its staged files must not be deleted: a coordinator that is
    # still running could still be about to turn one of those manifest
    # entries into a SourceImage.
    liveness_confirmed_dead = False
    if coordinator_ids:
        pool = await get_pool()
        redis_liveness_available = False
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
                redis_liveness_available = True
                live_ids = {int(member) for member in live_members}
                if coordinator_ids.intersection(live_ids):
                    raise HTTPException(
                        status_code=409,
                        detail="A bulk import is already in progress",
                    )
                liveness_confirmed_dead = True

        if not redis_liveness_available:
            # Redis is disabled, unreachable, or errored: we have no
            # positive signal either way. The 90-second registration window
            # above only proves a coordinator *hasn't written to its row*
            # recently -- it does NOT prove the coordinator has stopped, since
            # a legitimately running coordinator can go well past 90 seconds
            # between per-child bookkeeping updates (e.g. one slow image, or
            # a worker backlog). Rather than guess, fall back to the same
            # conservative, Redis-independent staleness threshold that
            # reconcile_stale_bulk_import_jobs already uses to declare a row
            # abandoned on its own: anything still within that window is
            # treated as blocking (fail closed) instead of being finalized
            # out from under a coordinator that may still be alive.
            stale_cutoff = datetime.now(timezone.utc) - timedelta(
                seconds=_STALE_BULK_IMPORT_SECONDS
            )
            not_confirmed_stale = {
                job_id
                for job_id, updated in coordinator_rows.items()
                if _coerce_utc_aware(
                    updated,
                    event="bulk_import.naive_job_updated_at",
                    bulk_import_job_id=job_id,
                )
                >= stale_cutoff
            }
            if not_confirmed_stale:
                raise HTTPException(
                    status_code=409,
                    detail="A bulk import is already in progress",
                )

    if coordinator_ids:
        # We reach here only when every id in coordinator_ids was judged
        # non-blocking above (confirmed dead via Redis, or liveness was
        # unreadable/disabled and every remaining row cleared the
        # conservative Redis-independent staleness threshold). Finalize them
        # now, atomically with the job row we're about to insert below, so
        # the partial unique index on bulk_import_jobs doesn't reject the new
        # job just because an abandoned row is still "pending"/"processing".
        # Without this, an abandoned coordinator would block every new
        # import until reconcile_stale_bulk_import_jobs runs at startup.
        finalized_abandoned_ids = await _finalize_abandoned_bulk_import_jobs(
            db,
            coordinator_ids,
            abandonment_note=(
                "Superseded by a new bulk import after its coordinator was "
                "found to be inactive."
            ),
        )
    else:
        finalized_abandoned_ids = []

    with tracer.start_as_current_span("bulk_import.enqueue") as span:
        try:
            span.set_attribute("bulk_import.category_id", category_id if category_id is not None else "none")

            os.makedirs(settings.source_images_dir, exist_ok=True)

            file_entries: list[tuple[str, str]] = []  # (original_filename, stored_path)
            budget = _ZipExtractBudget()

            try:
                for upload in files:
                    if not upload.filename:
                        continue

                    # Handle zip files
                    if upload.filename.lower().endswith(".zip"):
                        # The multipart parser already spooled the part to
                        # a seekable file — hand it straight to zipfile so
                        # no second archive copy is written anywhere
                        # (#1365). In deployment the spool itself lives on
                        # the source-images PVC (TMPDIR points at
                        # <source_images_dir>/.staging), so nothing touches
                        # the pod's 1 GiB ephemeral-storage budget.
                        if (
                            isinstance(upload.size, int)
                            and upload.size > _MAX_UPLOAD_BYTES
                        ):
                            raise HTTPException(
                                status_code=413,
                                detail=(
                                    f"File '{_display_name(upload.filename)}' "
                                    "exceeds the per-upload limit of "
                                    f"{_format_gib(_MAX_UPLOAD_BYTES)}"
                                ),
                            )
                        await upload.seek(0)
                        try:
                            budget.begin_archive(upload.filename)
                            # Central-directory parsing and bounded
                            # extraction run on a worker thread: both are
                            # synchronous CPU/IO that would otherwise stall
                            # this uvicorn worker's event loop for the
                            # duration of a large archive. The thread cannot
                            # be interrupted once started, so a cancelled
                            # request waits on extract_done for it to finish;
                            # the paths it appended to file_entries are then
                            # removed by the CancelledError sweep below
                            # instead of being orphaned mid-write.
                            extract_done = threading.Event()
                            try:
                                await asyncio.to_thread(
                                    _extract_zip_image_entries,
                                    upload.file,
                                    budget,
                                    file_entries,
                                    settings.source_images_dir,
                                    extract_done,
                                )
                            except asyncio.CancelledError:
                                while not extract_done.is_set():
                                    with contextlib.suppress(
                                        asyncio.CancelledError
                                    ):
                                        await asyncio.to_thread(
                                            extract_done.wait
                                        )
                                raise
                        except zipfile.BadZipFile:
                            raise HTTPException(
                                status_code=400,
                                detail=f"File '{upload.filename}' is not a valid zip archive",
                            )
                        except _ZipExtractLimitExceeded as exc:
                            logger.warning(
                                "Bulk import rejected zip archive: %s",
                                exc.detail,
                                extra={"event": "bulk_import.zip_limit_exceeded"},
                            )
                            raise HTTPException(
                                status_code=exc.status_code, detail=exc.detail
                            )
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
                                spooled_bytes = 0
                                while True:
                                    chunk = await upload.read(UPLOAD_CHUNK_SIZE)
                                    if not chunk:
                                        break
                                    spooled_bytes += len(chunk)
                                    if spooled_bytes > _MAX_UPLOAD_BYTES:
                                        raise HTTPException(
                                            status_code=413,
                                            detail=(
                                                f"File '{_display_name(upload.filename)}' "
                                                "exceeds the per-upload limit of "
                                                f"{_format_gib(_MAX_UPLOAD_BYTES)}"
                                            ),
                                        )
                                    f.write(chunk)
                        except Exception:
                            with contextlib.suppress(OSError):
                                os.unlink(stored_path)
                            raise

                        file_entries.append(
                            (sanitize_upload_filename(upload.filename), stored_path)
                        )
            except asyncio.CancelledError:
                # CancelledError is BaseException and bypasses the generic
                # cleanup below; remove everything staged so far.
                for _, stored_path in file_entries:
                    with contextlib.suppress(OSError):
                        os.unlink(stored_path)
                raise
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
                requested_by=_user.id,
                # Persisted before the coordinator starts so that if the API
                # process is restarted mid-import, startup reconciliation can
                # identify and remove staged files that were never picked up
                # for processing (see reconcile_stale_bulk_import_jobs).
                file_manifest=[list(entry) for entry in file_entries],
            )
            db.add(job)
            try:
                # Flush assigns ``job.id`` so the durable supervisor +
                # per-file JobItem snapshot can link back to this row —
                # all inside the same transaction (#1173). The partial
                # unique index fires at this INSERT, so the IntegrityError
                # handling below covers flush as well as commit.
                await db.flush()
                await _create_bulk_import_job(
                    db,
                    bulk_import_job=job,
                    file_entries=file_entries,
                    copyright=copyright,
                    note=note,
                    active=active,
                    parallelism=_MAX_CONCURRENCY,
                )
                await db.commit()
            except IntegrityError as exc:
                # The pre-check above (SELECT for active jobs) is a
                # check-then-act race: another request can create its job
                # row between our check and this insert. The partial unique
                # index on bulk_import_jobs is the actual guarantee here.
                # Only translate *that specific* constraint violation into
                # the pre-check's 409 — an unrelated integrity failure (e.g.
                # the target category being deleted concurrently, tripping
                # the category_id foreign key) must not masquerade as an
                # active-import conflict.
                await db.rollback()
                # Either way this job never made it into the database, so
                # its staged files would otherwise leak on disk forever.
                for _, stored_path in file_entries:
                    with contextlib.suppress(OSError):
                        os.unlink(stored_path)
                if not _is_single_active_job_violation(exc):
                    raise
                raise HTTPException(
                    status_code=409,
                    detail="A bulk import is already in progress",
                )
            await db.refresh(job)

            # Only remove abandoned coordinators' staged files once the new
            # job row (finalized in the same transaction) has actually
            # committed -- if the commit above had failed instead, those
            # rows would still need their manifests for a later reconcile
            # pass, and deleting the files first would orphan that pass.
            # Only do this when Redis positively confirmed the old
            # coordinator(s) are dead: if the liveness check instead fell
            # open (Redis disabled/unreachable), we have no proof the old
            # coordinator has stopped, and it could still be about to turn
            # one of those manifest entries into a SourceImage -- deleting
            # its files out from under it would corrupt a running import.
            # This is best-effort tidiness, not correctness-critical, so a
            # failure here must not prevent the newly committed job from
            # being scheduled below.
            if finalized_abandoned_ids and liveness_confirmed_dead:
                try:
                    await _cleanup_orphaned_bulk_import_files(
                        db, finalized_abandoned_ids
                    )
                except Exception:
                    logger.warning(
                        "Failed to clean up orphaned files for finalized "
                        "abandoned bulk-import job(s)",
                        extra={
                            "event": "bulk_import.abandoned_cleanup_failed",
                            "bulk_import_job_ids": finalized_abandoned_ids,
                        },
                        exc_info=True,
                    )

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

            # Run the durable coordinator in the API process so it does not
            # occupy an arq worker slot while waiting for child image jobs.
            # All per-file state lives in ``job_items``; if this process
            # dies before or during coordination, the API-side sweep
            # re-claims the supervisor lease and resumes (#1173).
            bulk_job_id = job.id
            span.set_attribute("bulk_import.coordinator_hosted", "api")
            background_tasks.add_task(
                _process_bulk_import,
                bulk_job_id,
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
