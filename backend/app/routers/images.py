import contextlib
import errno
import json
import logging
import os
import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, Response, UploadFile
from opentelemetry import trace
from sqlalchemy import select, update as sql_update
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user, require_role
from ..database import get_db, settings
from ..image_validation import UPLOAD_CHUNK_SIZE, is_valid_image
from ..models import Category, Image, SourceImage, User
from ..schemas import ImageCreate, ImageUpdate, ImageBulkUpdate, ImageBulkDelete, ImageReorderRequest, ImageOut, SourceImageOut
from ..tracing import record_exception_if_server_error
from ..visibility import get_student_excluded_category_ids, is_category_visible_to_student

logger = logging.getLogger(__name__)
tracer = trace.get_tracer(__name__)

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
        user_program_ids = {p.id for p in _user.programs}
        user_group_ids = {g.id for g in _user.groups}
        excluded = await get_student_excluded_category_ids(
            db, user_program_ids, user_group_ids
        )
        if excluded:
            stmt = stmt.where(
                (Image.category_id.is_(None)) | (~Image.category_id.in_(excluded))
            )
    stmt = stmt.order_by(Image.sort_order, Image.name)
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
        user_program_ids = {p.id for p in _user.programs}
        user_group_ids = {g.id for g in _user.groups}
        if not await is_category_visible_to_student(
            db, img.category_id, user_program_ids, user_group_ids
        ):
            raise HTTPException(status_code=404, detail="Image not found")
    return img


@router.post("/", response_model=ImageOut, status_code=201)
async def create_image(
    body: ImageCreate,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
):
    with tracer.start_as_current_span("image.create") as span:
        try:
            img = Image(
                name=body.name,
                thumb=body.thumb,
                tile_sources=body.tile_sources,
                category_id=body.category_id,
                copyright=body.copyright,
                note=body.note,
                active=body.active,
                sort_order=body.sort_order,
                metadata_=body.metadata_extra or {},
                width=body.width,
                height=body.height,
                file_size=body.file_size,
            )
            db.add(img)
            await db.commit()
            await db.refresh(img)
            span.set_attribute("image.id", img.id)
            span.set_attribute("image.category_id", body.category_id or 0)
            return img
        except Exception as exc:
            record_exception_if_server_error(span, exc)
            raise


@router.patch("/bulk", response_model=list[ImageOut])
async def bulk_update_images(
    body: ImageBulkUpdate,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
):
    """Bulk-update fields for multiple images."""
    with tracer.start_as_current_span("image.bulk_update") as span:
        try:
            span.set_attribute("image.count", len(body.image_ids))
            stmt = select(Image).where(Image.id.in_(body.image_ids))
            result = await db.execute(stmt)
            images = result.scalars().all()
            if len(images) != len(set(body.image_ids)):
                raise HTTPException(status_code=404, detail="One or more images not found")
            update_data = body.model_dump(exclude_unset=True, exclude={"image_ids"})
            for img in images:
                for key, value in update_data.items():
                    setattr(img, key, value)
                img.version = img.version + 1
            await db.commit()
            # Reload updated images
            stmt = select(Image).where(Image.id.in_(body.image_ids)).order_by(Image.sort_order, Image.name)
            result = await db.execute(stmt)
            return result.scalars().all()
        except Exception as exc:
            record_exception_if_server_error(span, exc)
            raise


@router.patch("/{image_id}", response_model=ImageOut)
async def update_image(
    image_id: int,
    body: ImageUpdate,
    request: Request,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
):
    with tracer.start_as_current_span("image.update") as span:
        try:
            span.set_attribute("image.id", image_id)
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
                span.set_attribute("image.optimistic_lock", True)
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
                span.set_attribute("image.optimistic_lock", False)
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
            for key, value in update_data.items():
                setattr(img, key, value)

            await db.commit()
            await db.refresh(img)

            response = Response(
                content=ImageOut.model_validate(img).model_dump_json(),
                media_type="application/json",
            )
            response.headers["ETag"] = f'"{img.version}"'
            return response
        except Exception as exc:
            record_exception_if_server_error(span, exc)
            raise





@router.post("/{image_id}/replace", response_model=SourceImageOut, status_code=201)
async def replace_image(
    image_id: int,
    file: Annotated[UploadFile, File()],
    background_tasks: BackgroundTasks,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
    name: Annotated[str | None, Form()] = None,
    category_id: Annotated[str | None, Form()] = None,
    copyright: Annotated[str | None, Form()] = None,
    note: Annotated[str | None, Form()] = None,
    active: Annotated[str | None, Form()] = None,
    metadata_extra: Annotated[str | None, Form()] = None,
) -> SourceImage:
    """Replace an existing image file, optionally updating metadata atomically.

    Uploads a new source file and triggers background processing that will
    regenerate tiles and thumbnails, update image dimensions and file size,
    and clear all canvas annotations and overlay metadata.

    When metadata fields are included in the multipart form, the image record
    is updated in the same transaction as the source-image creation, ensuring
    both succeed or both fail.
    """
    with tracer.start_as_current_span("image.replace") as span:
        try:
            span.set_attribute("image.id", image_id)
            img = await db.get(Image, image_id)
            if not img:
                raise HTTPException(status_code=404, detail="Image not found")

            if not file.filename:
                raise HTTPException(status_code=400, detail="No file provided")

            if not is_valid_image(file.filename, file.content_type):
                raise HTTPException(status_code=400, detail="File must be an image")

            # ── Apply optional metadata updates atomically ──────────
            has_metadata = any(
                v is not None
                for v in (name, category_id, copyright, note, active, metadata_extra)
            )
            if has_metadata:
                span.set_attribute("image.metadata_update", True)
                if name is not None:
                    img.name = name
                if category_id is not None:
                    try:
                        parsed_cat = int(category_id) if category_id != "" else None
                    except (ValueError, TypeError):
                        raise HTTPException(status_code=400, detail="Invalid category_id")
                    img.category_id = parsed_cat
                if copyright is not None:
                    img.copyright = copyright if copyright != "" else None
                if note is not None:
                    img.note = note if note != "" else None
                if active is not None:
                    img.active = active.lower() in ("true", "1")
                if metadata_extra is not None:
                    try:
                        img.metadata_ = json.loads(metadata_extra) if metadata_extra else None
                    except (json.JSONDecodeError, TypeError):
                        raise HTTPException(status_code=400, detail="Invalid metadata_extra")
                img.version = img.version + 1
            else:
                span.set_attribute("image.metadata_update", False)

            os.makedirs(settings.source_images_dir, exist_ok=True)

            ext = os.path.splitext(file.filename)[1] or ".bin"
            unique_name = f"{uuid.uuid4().hex}{ext}"
            stored_path = os.path.join(settings.source_images_dir, unique_name)

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
                        "Replace upload failed: no space left on device",
                        extra={
                            "event": "replace.enospc",
                            "image_id": image_id,
                            "original_filename": file.filename,
                            "stored_path": stored_path,
                        },
                    )
                    raise HTTPException(
                        status_code=507,
                        detail="Insufficient storage \u2014 the data volume is full",
                    )
                raise

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

            span.set_attribute("source_image.id", src.id)
            span.set_attribute("image.enqueued", False)

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
            span.set_attribute("image.enqueued", enqueued)
            if not enqueued:
                background_tasks.add_task(process_replace_image, src.id, image_id)

            return src
        except Exception as exc:
            record_exception_if_server_error(span, exc)
            raise


@router.delete("/bulk", status_code=204)
async def bulk_delete_images(
    body: ImageBulkDelete,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
):
    """Bulk-delete multiple images."""
    with tracer.start_as_current_span("image.bulk_delete") as span:
        try:
            span.set_attribute("image.count", len(body.image_ids))
            stmt = select(Image).where(Image.id.in_(body.image_ids))
            result = await db.execute(stmt)
            images = result.scalars().all()
            if len(images) != len(set(body.image_ids)):
                raise HTTPException(status_code=404, detail="One or more images not found")
            for img in images:
                await db.delete(img)
            await db.commit()
        except Exception as exc:
            record_exception_if_server_error(span, exc)
            raise


@router.put("/reorder", status_code=200)
async def reorder_images(
    body: ImageReorderRequest,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
):
    with tracer.start_as_current_span("image.reorder") as span:
        try:
            span.set_attribute("image.count", len(body.items))
            for item in body.items:
                img = await db.get(Image, item.id)
                if img is None:
                    raise HTTPException(status_code=404, detail=f"Image {item.id} not found")
                img.sort_order = item.sort_order
            await db.commit()
            return {"status": "ok"}
        except Exception as exc:
            record_exception_if_server_error(span, exc)
            raise


@router.delete("/{image_id}", status_code=204)
async def delete_image(
    image_id: int,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
):
    with tracer.start_as_current_span("image.delete") as span:
        try:
            span.set_attribute("image.id", image_id)
            img = await db.get(Image, image_id)
            if not img:
                raise HTTPException(status_code=404, detail="Image not found")
            await db.delete(img)
            await db.commit()
        except Exception as exc:
            record_exception_if_server_error(span, exc)
            raise
