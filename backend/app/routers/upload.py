"""Source image upload and processing status endpoints."""

import json
import logging
import os
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_role
from ..database import get_db, settings
from ..models import SourceImage, User
from ..processing import process_source_image
from ..schemas import SourceImageOut
from ..worker import enqueue_process_source_image

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/source-images", tags=["source-images"])

# Recognised image extensions (lowercase, with dot)
_IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".gif", ".webp", ".svs",
}

# 1 MiB chunks for streaming large uploads to disk
_UPLOAD_CHUNK_SIZE = 1024 * 1024


def _is_valid_image(filename: str, content_type: str | None) -> bool:
    """Accept the file if it has a recognised image extension *or* MIME type."""
    if content_type and content_type.startswith("image/"):
        return True
    return Path(filename).suffix.lower() in _IMAGE_EXTENSIONS


@router.post("/upload", response_model=SourceImageOut, status_code=201)
async def upload_source_image(
    file: Annotated[UploadFile, File()],
    background_tasks: BackgroundTasks,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    name: Annotated[str | None, Form()] = None,
    category_id: Annotated[int | None, Form()] = None,
    copyright: Annotated[str | None, Form()] = None,
    note: Annotated[str | None, Form()] = None,
    program_ids: Annotated[list[int], Form()] = [],
    active: Annotated[bool, Form()] = True,
    db: AsyncSession = Depends(get_db),
) -> SourceImage:
    """Upload a source image and trigger background tile generation."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    if not _is_valid_image(file.filename, file.content_type):
        raise HTTPException(status_code=400, detail="File must be an image")

    # Ensure the source images directory exists
    os.makedirs(settings.source_images_dir, exist_ok=True)

    # Generate a unique filename to avoid collisions
    ext = os.path.splitext(file.filename)[1] or ".bin"
    unique_name = f"{uuid.uuid4().hex}{ext}"
    stored_path = os.path.join(settings.source_images_dir, unique_name)

    # Stream the uploaded file to disk in chunks (handles large files like 360 MB TIFFs)
    with open(stored_path, "wb") as f:
        while True:
            chunk = await file.read(_UPLOAD_CHUNK_SIZE)
            if not chunk:
                break
            f.write(chunk)

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
        program=json.dumps(program_ids) if program_ids else None,
    )
    db.add(src)
    await db.commit()
    await db.refresh(src)

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
    if not enqueued:
        background_tasks.add_task(process_source_image, src.id)

    return src


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
