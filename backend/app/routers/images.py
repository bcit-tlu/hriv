import json
import logging
import os
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, Response, UploadFile
from sqlalchemy import select, update as sql_update
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user, require_role
from ..database import get_db, settings
from ..models import Category, Image, Program, SourceImage, User
from ..schemas import ImageCreate, ImageUpdate, ImageBulkUpdate, ImageBulkDelete, ImageOut, SourceImageOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/images", tags=["images"])


@router.get("/", response_model=list[ImageOut])
async def list_images(
    _user: Annotated[User, Depends(get_current_user)],
    category_id: int | None = None,
    uncategorized: bool = False,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Image)
    if uncategorized:
        stmt = stmt.where(Image.category_id.is_(None))
    elif category_id is not None:
        stmt = stmt.where(Image.category_id == category_id)
    if _user.role == "student":
        stmt = stmt.where(Image.active.is_(True))
        # Exclude images belonging to hidden categories
        hidden_cat_ids = select(Category.id).where(Category.status == "hidden").scalar_subquery()
        stmt = stmt.where(
            (Image.category_id.is_(None)) | (~Image.category_id.in_(hidden_cat_ids))
        )
    stmt = stmt.order_by(Image.name)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{image_id}", response_model=ImageOut)
async def get_image(
    image_id: int,
    _user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    img = await db.get(Image, image_id)
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    if _user.role == "student":
        if not img.active:
            raise HTTPException(status_code=404, detail="Image not found")
        # Block access to images in hidden categories
        if img.category_id is not None:
            cat = await db.get(Category, img.category_id)
            if cat and cat.status == "hidden":
                raise HTTPException(status_code=404, detail="Image not found")
    return img


@router.post("/", response_model=ImageOut, status_code=201)
async def create_image(
    body: ImageCreate,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
):
    img = Image(
        name=body.name,
        thumb=body.thumb,
        tile_sources=body.tile_sources,
        category_id=body.category_id,
        copyright=body.copyright,
        note=body.note,
        active=body.active,
        metadata_=body.metadata_extra or {},
        width=body.width,
        height=body.height,
        file_size=body.file_size,
    )
    if body.program_ids:
        progs = (await db.execute(select(Program).where(Program.id.in_(body.program_ids)))).scalars().all()
        img.programs = list(progs)
    db.add(img)
    await db.commit()
    await db.refresh(img)
    return img


@router.patch("/bulk", response_model=list[ImageOut])
async def bulk_update_images(
    body: ImageBulkUpdate,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
):
    """Bulk-update fields for multiple images."""
    stmt = select(Image).where(Image.id.in_(body.image_ids))
    result = await db.execute(stmt)
    images = result.scalars().all()
    if len(images) != len(set(body.image_ids)):
        raise HTTPException(status_code=404, detail="One or more images not found")
    update_data = body.model_dump(exclude_unset=True, exclude={"image_ids", "program_ids"})
    program_ids = body.program_ids
    progs: list[Program] | None = None
    if program_ids is not None:
        progs = list((await db.execute(select(Program).where(Program.id.in_(program_ids)))).scalars().all())
    for img in images:
        for key, value in update_data.items():
            setattr(img, key, value)
        if progs is not None:
            img.programs = progs
        img.version = img.version + 1
    await db.commit()
    # Reload updated images
    stmt = select(Image).where(Image.id.in_(body.image_ids)).order_by(Image.name)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.patch("/{image_id}", response_model=ImageOut)
async def update_image(
    image_id: int,
    body: ImageUpdate,
    request: Request,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
):
    img = await db.get(Image, image_id)
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")

    # Optimistic concurrency: if the client sends If-Match, verify the
    # version has not changed since the client last read the resource.
    # The version check and increment are performed atomically via a
    # single UPDATE … WHERE version = :client_version statement. Doing
    # the compare-and-swap in one database round-trip closes the TOCTOU
    # window where two concurrent writers could both observe version=N,
    # both pass an in-memory check, and both commit version=N+1 —
    # silently losing one update.
    if_match = request.headers.get("If-Match")
    if if_match is not None:
        try:
            client_version = int(if_match.strip('"'))
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid If-Match header")
        cas = await db.execute(
            sql_update(Image)
            .where(Image.id == image_id, Image.version == client_version)
            .values(version=Image.version + 1)
        )
        if cas.rowcount == 0:
            raise HTTPException(
                status_code=409,
                detail="Resource has been modified by another client",
            )
        # Sync the in-memory instance so that SQLAlchemy's subsequent
        # UPDATE for field changes doesn't revert the version bump.
        img.version = client_version + 1
    else:
        # No optimistic concurrency requested — bump version unconditionally.
        img.version = img.version + 1

    update_data = body.model_dump(exclude_unset=True)
    if "metadata_extra" in update_data:
        update_data["metadata_"] = update_data.pop("metadata_extra")
    # Server-side partial merge: apply provided keys to existing metadata.
    # Keys with None values are deleted; all other keys are set/updated.
    merge_patch = update_data.pop("metadata_extra_merge", None)
    if merge_patch is not None:
        current = dict(img.metadata_ or {})
        for key, value in merge_patch.items():
            if value is None:
                current.pop(key, None)
            else:
                current[key] = value
        update_data["metadata_"] = current if current else None
    program_ids = update_data.pop("program_ids", None)
    for key, value in update_data.items():
        setattr(img, key, value)
    if program_ids is not None:
        progs = (await db.execute(select(Program).where(Program.id.in_(program_ids)))).scalars().all()
        img.programs = list(progs)

    await db.commit()
    await db.refresh(img)

    response = Response(
        content=ImageOut.model_validate(img).model_dump_json(),
        media_type="application/json",
    )
    response.headers["ETag"] = f'"{img.version}"'
    return response


_IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".gif", ".webp", ".svs",
}
_IMAGE_MIME_TYPES = {
    "image/jpeg", "image/png", "image/tiff", "image/gif", "image/webp",
}
_UPLOAD_CHUNK_SIZE = 1024 * 1024


def _is_valid_image(filename: str, content_type: str | None) -> bool:
    if content_type and content_type in _IMAGE_MIME_TYPES:
        return True
    return Path(filename).suffix.lower() in _IMAGE_EXTENSIONS


@router.post("/{image_id}/replace", response_model=SourceImageOut, status_code=201)
async def replace_image(
    image_id: int,
    file: Annotated[UploadFile, File()],
    background_tasks: BackgroundTasks,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
) -> SourceImage:
    """Replace an existing image file.

    Uploads a new source file and triggers background processing that will
    regenerate tiles and thumbnails, update image dimensions and file size,
    and clear all canvas annotations and overlay metadata.
    """
    img = await db.get(Image, image_id)
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    if not _is_valid_image(file.filename, file.content_type):
        raise HTTPException(status_code=400, detail="File must be an image")

    os.makedirs(settings.source_images_dir, exist_ok=True)

    ext = os.path.splitext(file.filename)[1] or ".bin"
    unique_name = f"{uuid.uuid4().hex}{ext}"
    stored_path = os.path.join(settings.source_images_dir, unique_name)

    with open(stored_path, "wb") as f:
        while True:
            chunk = await file.read(_UPLOAD_CHUNK_SIZE)
            if not chunk:
                break
            f.write(chunk)

    file_size = os.path.getsize(stored_path)

    src = SourceImage(
        original_filename=file.filename,
        stored_path=stored_path,
        status="pending",
        name=img.name,
        category_id=img.category_id,
        copyright=img.copyright,
        note=img.note,
        active=img.active,
        file_size=file_size,
        image_id=image_id,
    )
    db.add(src)
    await db.commit()
    await db.refresh(src)

    logger.info(
        "Replacement image uploaded, queuing for processing",
        extra={
            "event": "replace.accepted",
            "source_image_id": src.id,
            "target_image_id": image_id,
            "original_filename": file.filename,
        },
    )

    from ..processing import process_replace_image
    from ..worker import enqueue_replace_image

    enqueued = await enqueue_replace_image(src.id, image_id)
    if not enqueued:
        background_tasks.add_task(process_replace_image, src.id, image_id)

    return src


@router.delete("/bulk", status_code=204)
async def bulk_delete_images(
    body: ImageBulkDelete,
    _user: Annotated[User, Depends(require_role("admin"))],
    db: AsyncSession = Depends(get_db),
):
    """Bulk-delete multiple images."""
    stmt = select(Image).where(Image.id.in_(body.image_ids))
    result = await db.execute(stmt)
    images = result.scalars().all()
    if len(images) != len(set(body.image_ids)):
        raise HTTPException(status_code=404, detail="One or more images not found")
    for img in images:
        await db.delete(img)
    await db.commit()


@router.delete("/{image_id}", status_code=204)
async def delete_image(
    image_id: int,
    _user: Annotated[User, Depends(require_role("admin"))],
    db: AsyncSession = Depends(get_db),
):
    img = await db.get(Image, image_id)
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    await db.delete(img)
    await db.commit()
