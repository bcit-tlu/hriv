"""Source image upload and processing status endpoints."""

import contextlib
import errno
import logging
import os
import uuid
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from opentelemetry import trace
from sqlalchemy import select, update as sql_update
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_role
from ..database import async_session, get_db, settings
from ..filenames import sanitize_upload_filename, storage_extension
from ..image_validation import UPLOAD_CHUNK_SIZE, is_valid_image
from ..models import SourceImage, User
from ..processing import process_source_image
from ..schemas import MAX_NOTE_LENGTH, SourceImageOut, normalize_note_value
from ..tracing import record_exception_if_server_error
from ..worker import TaskQueueUnavailableError, enqueue_process_source_image

logger = logging.getLogger(__name__)
tracer = trace.get_tracer(__name__)

router = APIRouter(prefix="/source-images", tags=["source-images"])


@router.post("/upload", response_model=SourceImageOut, status_code=201)
async def upload_source_image(
    file: Annotated[UploadFile, File()],
    background_tasks: BackgroundTasks,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    name: Annotated[str | None, Form()] = None,
    category_id: Annotated[int | None, Form()] = None,
    copyright: Annotated[str | None, Form()] = None,
    note: Annotated[str | None, Form()] = None,
    active: Annotated[bool, Form()] = True,
    db: AsyncSession = Depends(get_db),
) -> SourceImage:
    """Upload a source image and trigger background tile generation."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    if not is_valid_image(file.filename, file.content_type):
        raise HTTPException(status_code=400, detail="File must be an image")

    original_filename = sanitize_upload_filename(file.filename)

    with tracer.start_as_current_span("upload_source_image") as span:
        try:
            # Ensure the source images directory exists
            os.makedirs(settings.source_images_dir, exist_ok=True)

            # Validate and normalize note early (before writing large files to disk).
            try:
                note = normalize_note_value(note)
            except ValueError:
                raise HTTPException(
                    status_code=400,
                    detail=f"Note must be {MAX_NOTE_LENGTH} characters or fewer",
                )

            # Generate a unique filename to avoid collisions
            ext = storage_extension(original_filename)
            unique_name = f"{uuid.uuid4().hex}{ext}"
            stored_path = os.path.join(settings.source_images_dir, unique_name)

            # Stream the uploaded file to disk in chunks (handles large files)
            try:
                with open(stored_path, "wb") as f:
                    while True:
                        chunk = await file.read(UPLOAD_CHUNK_SIZE)
                        if not chunk:
                            break
                        f.write(chunk)
            except OSError as exc:
                with contextlib.suppress(OSError):
                    os.unlink(stored_path)
                if exc.errno == errno.ENOSPC:
                    logger.error(
                        "Upload failed: no space left on device",
                        extra={
                            "event": "upload.enospc",
                            "original_filename": original_filename,
                            "stored_path": stored_path,
                        },
                    )
                    raise HTTPException(
                        status_code=507,
                        detail="Insufficient storage \u2014 the data volume is full",
                    )
                raise

            # Get file size from what was written to disk
            file_size = os.path.getsize(stored_path)

            # Create the source image record
            src = SourceImage(
                original_filename=original_filename,
                stored_path=stored_path,
                status="pending",
                name=name,
                category_id=category_id,
                copyright=copyright,
                note=note,
                active=active,
                file_size=file_size,
            )
            db.add(src)
            await db.commit()
            await db.refresh(src)

            span.set_attribute("source_image.id", src.id)
            span.set_attribute("source_image.original_filename", original_filename)
            span.set_attribute("source_image.file_size", file_size)

            logger.info(
                "Source image uploaded, queuing for processing",
                extra={
                    "event": "upload.accepted",
                    "source_image_id": src.id,
                    "original_filename": original_filename,
                    "category_id": category_id,
                },
            )

            # Prefer the arq task queue; fall back to in-process BackgroundTasks
            # when Redis is unavailable (e.g. local development without Redis).
            source_image_id = src.id
            try:
                enqueue_result = await enqueue_process_source_image(source_image_id)
            except TaskQueueUnavailableError:
                bookkeeping_committed = False
                try:
                    src.status = "failed"
                    src.status_message = "Failed"
                    src.error_message = (
                        "Task queue unavailable; image processing was not started."
                    )
                    await db.commit()
                    bookkeeping_committed = True
                except Exception:
                    logger.exception(
                        "Failed to mark uploaded source image after queue rejection",
                        extra={
                            "event": "upload.queue_rejection_bookkeeping_failed",
                            "source_image_id": source_image_id,
                        },
                    )
                    with contextlib.suppress(Exception):
                        await db.rollback()
                    try:
                        async with async_session() as recovery_db:
                            await recovery_db.execute(
                                sql_update(SourceImage)
                                .where(
                                    SourceImage.id == source_image_id,
                                    SourceImage.status == "pending",
                                )
                                .values(
                                    status="failed",
                                    status_message="Failed",
                                    error_message=(
                                        "Task queue unavailable; image processing "
                                        "was not started."
                                    ),
                                )
                            )
                            await recovery_db.commit()
                            bookkeeping_committed = True
                    except Exception:
                        logger.exception(
                            "Fresh-session uploaded source-image bookkeeping failed",
                            extra={
                                "event": "upload.queue_rejection_recovery_failed",
                                "source_image_id": source_image_id,
                            },
                        )
                if bookkeeping_committed:
                    with contextlib.suppress(OSError):
                        os.unlink(stored_path)
                raise
            span.set_attribute("source_image.enqueued", enqueue_result.queued)
            if not enqueue_result.queued:
                background_tasks.add_task(process_source_image, source_image_id)

            return src
        except Exception as exc:
            record_exception_if_server_error(span, exc)
            raise


@router.get("/", response_model=list[SourceImageOut])
async def list_source_images(
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    status: Annotated[str | None, Query(max_length=50)] = None,
    limit: Annotated[int | None, Query(ge=1, le=500)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[SourceImage]:
    """List source images with their processing status, newest first.

    ``status`` narrows the result to a single processing state and ``limit``
    caps the number of rows returned, so callers that only care about recent
    failures do not have to download the whole table.
    """
    stmt = select(SourceImage).order_by(SourceImage.created_at.desc())
    if status is not None:
        stmt = stmt.where(SourceImage.status == status)
    if limit is not None:
        stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/{source_image_id}", response_model=SourceImageOut)
async def get_source_image(
    source_image_id: int,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
) -> SourceImage:
    """Get a single source image by ID."""
    src = await db.get(SourceImage, source_image_id)
    if src is None:
        raise HTTPException(status_code=404, detail="Source image not found")
    return src
