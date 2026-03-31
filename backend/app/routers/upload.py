"""Source image upload and processing status endpoints."""

import os
import uuid
from typing import Annotated

import json

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_role
from ..database import get_db, settings
from ..models import SourceImage, User
from ..processing import process_source_image
from ..schemas import SourceImageOut

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
    program_ids: Annotated[list[int], Form()] = [],
    db: AsyncSession = Depends(get_db),
) -> SourceImage:
    """Upload a source image and trigger background tile generation."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    # Ensure the source images directory exists
    os.makedirs(settings.source_images_dir, exist_ok=True)

    # Generate a unique filename to avoid collisions
    ext = os.path.splitext(file.filename)[1] or ".bin"
    unique_name = f"{uuid.uuid4().hex}{ext}"
    stored_path = os.path.join(settings.source_images_dir, unique_name)

    # Write the uploaded file to disk
    contents = await file.read()
    with open(stored_path, "wb") as f:
        f.write(contents)

    # Create the source image record
    src = SourceImage(
        original_filename=file.filename,
        stored_path=stored_path,
        status="pending",
        name=name,
        category_id=category_id,
        copyright=copyright,
        note=note,
        program=json.dumps(program_ids) if program_ids else None,
    )
    db.add(src)
    await db.commit()
    await db.refresh(src)

    # Fire off the background processing task
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
