"""Bulk image import endpoints (admin and instructor).

Accepts multiple image files and/or zip archives, extracts images,
and processes them in the background with concurrency limiting.
"""

import asyncio
import logging
import os
import tempfile
import uuid
import zipfile
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import cast, select, update
from sqlalchemy.dialects.postgresql import JSONB as JSONB_type
from sqlalchemy.sql import func
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_role
from ..database import async_session, get_db, settings
from ..models import BulkImportJob, Category, SourceImage, User
from ..processing import process_source_image
from ..schemas import BulkImportJobOut

router = APIRouter(prefix="/admin/bulk-import", tags=["admin"])

_editor = require_role("admin", "instructor")

logger = logging.getLogger(__name__)

# Image extensions we accept (lowercase)
_IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".gif", ".webp", ".svs",
}

# Maximum concurrent tile-generation tasks per bulk import
_MAX_CONCURRENCY = 4

# 1 MiB chunks for streaming large uploads to disk
_UPLOAD_CHUNK_SIZE = 1024 * 1024


def _is_image_filename(filename: str) -> bool:
    """Return True if the filename has a recognised image extension."""
    return Path(filename).suffix.lower() in _IMAGE_EXTENSIONS


async def _process_bulk_import(job_id: int, file_entries: list[tuple[str, str]]) -> None:
    """Background task: process all images for a bulk import job.

    ``file_entries`` is a list of (original_filename, stored_path) tuples.
    Each image is turned into a SourceImage record and processed via the
    existing VIPS pipeline, with concurrency limited by a semaphore.
    """
    semaphore = asyncio.Semaphore(_MAX_CONCURRENCY)

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
                    copyright="Public Domain",
                )
                db.add(src)
                await db.commit()
                await db.refresh(src)

            # Process through VIPS pipeline (this acquires the semaphore).
            # Note: bulk imports use direct processing (not arq) because the
            # job-tracking logic below needs synchronous completion status.
            async with semaphore:
                try:
                    await process_source_image(src.id)
                except Exception as exc:
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
                    src_check = await db.get(SourceImage, src.id)
                    if src_check is not None and src_check.status == "failed":
                        error_entry = [{"filename": original_filename, "error": src_check.error_message or "Processing failed"}]
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
    category_id: Annotated[int, Form()],
    background_tasks: BackgroundTasks,
    _user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
) -> BulkImportJob:
    """Upload multiple image files and/or zip archives for bulk import.

    All images are assigned to the specified category with sane defaults:
    - active = True
    - name = filename stem
    - copyright = "Public Domain"
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    # Validate that the target category exists
    category = await db.get(Category, category_id)
    if category is None:
        raise HTTPException(status_code=400, detail="Category not found")

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
                            chunk = await upload.read(_UPLOAD_CHUNK_SIZE)
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

                            with zf.open(zip_entry) as src, open(stored_path, "wb") as dst:
                                dst.write(src.read())

                            file_entries.append((basename, stored_path))
                except zipfile.BadZipFile:
                    raise HTTPException(
                        status_code=400,
                        detail=f"File '{upload.filename}' is not a valid zip archive",
                    )
                finally:
                    if tmp_path is not None:
                        try:
                            os.unlink(tmp_path)
                        except OSError:
                            pass
            else:
                # Regular image file
                if not _is_image_filename(upload.filename):
                    continue  # silently skip non-image files

                ext = os.path.splitext(upload.filename)[1] or ".bin"
                unique_name = f"{uuid.uuid4().hex}{ext}"
                stored_path = os.path.join(settings.source_images_dir, unique_name)

                # Stream to disk in chunks (handles large TIFFs)
                with open(stored_path, "wb") as f:
                    while True:
                        chunk = await upload.read(_UPLOAD_CHUNK_SIZE)
                        if not chunk:
                            break
                        f.write(chunk)

                file_entries.append((upload.filename, stored_path))
    except Exception:
        # Clean up any files already stored before re-raising
        for _, stored_path in file_entries:
            try:
                os.unlink(stored_path)
            except OSError:
                pass
        raise

    if not file_entries:
        raise HTTPException(
            status_code=400,
            detail="No valid image files found in the upload",
        )

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

    logger.info(
        "Bulk import job created",
        extra={
            "event": "bulk_import.job_created",
            "job_id": job.id,
            "category_id": category_id,
            "total_count": len(file_entries),
        },
    )

    # Fire off background processing
    background_tasks.add_task(_process_bulk_import, job.id, file_entries)

    return job


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
