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
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from opentelemetry import trace
from opentelemetry.trace import StatusCode
from sqlalchemy import cast, select, update
from sqlalchemy.dialects.postgresql import JSONB as JSONB_type
from sqlalchemy.sql import func
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_role
from ..database import async_session, get_db, settings
from ..image_validation import IMAGE_EXTENSIONS, UPLOAD_CHUNK_SIZE
from ..models import BulkImportJob, Category, SourceImage, User
from ..processing import process_source_image
from ..schemas import MAX_NOTE_LENGTH, BulkImportJobOut, normalize_note_value
from ..tracing import record_exception_if_server_error
from ..worker import enqueue_bulk_import, enqueue_process_source_image

router = APIRouter(prefix="/admin/bulk-import", tags=["admin"])

_editor = require_role("admin", "instructor")

logger = logging.getLogger(__name__)
tracer = trace.get_tracer(__name__)

# Maximum in-flight source-image processing tasks per bulk import.
# Keep this aligned with worker.max_jobs to avoid surprising throughput shifts.
_MAX_CONCURRENCY = 4
_ZIP_EXTRACT_CHUNK_SIZE = 1024 * 1024
_SOURCE_IMAGE_POLL_INTERVAL_SECONDS = 2
_SOURCE_IMAGE_STALE_SECONDS = int(os.environ.get("SOURCE_IMAGE_STALE_SECONDS", "900"))


def _is_image_filename(filename: str) -> bool:
    """Return True if the filename has a recognised image extension."""
    return Path(filename).suffix.lower() in IMAGE_EXTENSIONS


@dataclass(frozen=True)
class _SourceImageTerminalState:
    """Serializable source-image terminal state independent of SQLAlchemy sessions."""

    status: str
    error_message: str | None
    status_message: str | None


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


async def _wait_for_source_image_terminal_state(
    source_image_id: int,
    original_filename: str,
    stale_after_seconds: int = _SOURCE_IMAGE_STALE_SECONDS,
) -> _SourceImageTerminalState:
    """Wait for queued processing to reach a terminal source-image state."""
    while True:
        async with async_session() as db:
            src = await db.get(SourceImage, source_image_id)
            if src is None:
                raise RuntimeError(
                    f"Queued source image {source_image_id} disappeared before completion"
                )
            if src.status in {"completed", "failed"}:
                return _source_image_terminal_state(src)

            cutoff = datetime.now(timezone.utc) - timedelta(seconds=stale_after_seconds)
            updated_at = _coerce_utc_aware(src.updated_at, source_image_id=source_image_id)
            if updated_at < cutoff:
                src.status = "failed"
                src.error_message = (
                    "Tile generation stalled during bulk import. "
                    f"No progress update was recorded for more than {stale_after_seconds}s."
                )
                src.status_message = "Failed"
                await db.commit()
                logger.error(
                    "Bulk import source image stalled while waiting for queued processing",
                    extra={
                        "event": "bulk_import.source_stalled",
                        "source_image_id": source_image_id,
                        "original_filename": original_filename,
                        "stale_after_seconds": stale_after_seconds,
                    },
                )
                return _source_image_terminal_state(src)

        await asyncio.sleep(_SOURCE_IMAGE_POLL_INTERVAL_SECONDS)


async def _process_bulk_import(
    job_id: int,
    file_entries: list[tuple[str, str]],
    copyright: str | None = None,
    note: str | None = None,
    active: bool = True,
) -> None:
    """Background task: process all images for a bulk import job.

    ``file_entries`` is a list of (original_filename, stored_path) tuples.
    Each image is turned into a SourceImage record and processed via the
    existing VIPS pipeline, with concurrency limited by a semaphore.
    """
    semaphore = asyncio.Semaphore(_MAX_CONCURRENCY)
    note = normalize_note_value(note)

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
                    enqueued = await enqueue_process_source_image(src.id)
                    if enqueued:
                        terminal_state = await _wait_for_source_image_terminal_state(
                            src.id, original_filename,
                        )
                    else:
                        await process_source_image(src.id)
                        async with async_session() as db:
                            src_check = await db.get(SourceImage, src.id)
                            if src_check is None:
                                raise RuntimeError(
                                    f"Source image {src.id} disappeared after processing"
                                )
                            terminal_state = _source_image_terminal_state(src_check)
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
        if job is not None:
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
    tasks = [
        asyncio.create_task(_process_one(fname, spath))
        for fname, spath in file_entries
    ]
    await asyncio.gather(*tasks, return_exceptions=True)

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

    with tracer.start_as_current_span("bulk_import.enqueue") as span:
        try:
            # Validate and normalize note before proceeding.
            try:
                note = normalize_note_value(note)
            except ValueError:
                raise HTTPException(
                    status_code=400,
                    detail=f"Note must be {MAX_NOTE_LENGTH} characters or fewer",
                )

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

                                    file_entries.append((basename, stored_path))
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

                        file_entries.append((upload.filename, stored_path))
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
            enqueued = await enqueue_bulk_import(
                job.id,
                file_entries,
                copyright=copyright,
                note=note,
                active=active,
            )
            span.set_attribute("bulk_import.enqueued", enqueued)
            if not enqueued:
                background_tasks.add_task(
                    _process_bulk_import,
                    job.id,
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
