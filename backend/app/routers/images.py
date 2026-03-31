from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user, require_role
from ..database import get_db
from ..models import Image, Program, User
from ..schemas import ImageCreate, ImageUpdate, ImageBulkUpdate, ImageBulkDelete, ImageOut

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
    if not img.active and _user.role == "student":
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
    await db.commit()
    # Reload updated images
    stmt = select(Image).where(Image.id.in_(body.image_ids)).order_by(Image.name)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.patch("/{image_id}", response_model=ImageOut)
async def update_image(
    image_id: int,
    body: ImageUpdate,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
):
    img = await db.get(Image, image_id)
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    update_data = body.model_dump(exclude_unset=True)
    if "metadata_extra" in update_data:
        update_data["metadata_"] = update_data.pop("metadata_extra")
    program_ids = update_data.pop("program_ids", None)
    for key, value in update_data.items():
        setattr(img, key, value)
    if program_ids is not None:
        progs = (await db.execute(select(Program).where(Program.id.in_(program_ids)))).scalars().all()
        img.programs = list(progs)
    await db.commit()
    await db.refresh(img)
    return img


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
