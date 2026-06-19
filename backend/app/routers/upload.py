"""Source image upload and processing status endpoints."""

import contextlib
import errno
import logging
import os
import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from opentelemetry import trace
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_role
from ..database import get_db, settings
from ..image_validation import UPLOAD_CHUNK_SIZE, is_valid_image
from ..models import SourceImage, User
from ..processing import process_source_image
from ..schemas import MAX_NOTE_LENGTH, SourceImageOut
from ..tracing import record_exception_if_server_error
from ..worker import enqueue_process_source_image

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

    with tracer.start_as_current_span("upload_source_image") as span:
        try:
            # Ensure the source images directory exists
            os.makedirs(settings.source_images_dir, exist_ok=True)

            # Validate note length early (before writing large files to disk)
            if (
                note is not None
                and isinstance(note, str)
                and len(note) > MAX_NOTE_LENGTH
            ):
                raise HTTPException(
                    status_code=400,
                    detail=f"Note must be {MAX_NOTE_LENGTH} characters or fewer",
                )

            # Generate a unique filename to avoid collisions
            ext = os.path.splitext(file.filename)[1] or ".bin"
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
                            "original_filename": file.filename,
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
                original_filename=file.filename,
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
            span.set_attribute("source_image.original_filename", file.filename)
            span.set_attribute("source_image.file_size", file_size)

            logger.info(
                "Source image uploaded, queuing for processing",
                extra={
                    "event": "upload.accepted",
                    "source_image_id": src.id,
                    "original_filename": file.filename,
                    "category_id": category_id,
                },
            )

            # Prefer the arq task queue; fall back to in-process BackgroundTasks
            # when Redis is unavailable (e.g. local development without Redis).
            enqueued = await enqueue_process_source_image(src.id)
            span.set_attribute("source_image.enqueued", enqueued)
            if not enqueued:
                background_tasks.add_task(process_source_image, src.id)

            return src
        except Exception as exc:
            record_exception_if_server_error(span, exc)
            raise


@router.get("/", response_model=list[SourceImageOut])
async def list_source_images(
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
) -> list[SourceImage]:
    """List all source images with their processing status."""
    stmt = select(SourceImage).order_by(SourceImage.created_at.desc())
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
