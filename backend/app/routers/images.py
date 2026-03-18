from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user, require_role
from ..database import get_db
from ..models import Image, User
from ..schemas import ImageCreate, ImageUpdate, ImageOut

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
    stmt = stmt.order_by(Image.label)
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
    return img


@router.post("/", response_model=ImageOut, status_code=201)
async def create_image(
    body: ImageCreate,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
):
    img = Image(
        label=body.label,
        thumb=body.thumb,
        tile_sources=body.tile_sources,
        category_id=body.category_id,
        copyright=body.copyright,
        origin=body.origin,
        program=body.program,
        status=body.status,
        metadata_=body.metadata_extra or {},
    )
    db.add(img)
    await db.commit()
    await db.refresh(img)
    return img


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
    for key, value in update_data.items():
        setattr(img, key, value)
    await db.commit()
    await db.refresh(img)
    return img


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
