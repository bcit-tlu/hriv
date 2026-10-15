import os

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import SourceImage, User
from .schemas import ImageSourceInfoOut


async def latest_completed_source(db: AsyncSession, image_id: int) -> SourceImage | None:
    stmt = (
        select(SourceImage)
        .where(SourceImage.image_id == image_id, SourceImage.status == "completed")
        .order_by(SourceImage.id.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def build_image_source_info(
    db: AsyncSession, image_id: int, viewer: User
) -> ImageSourceInfoOut:
    src = await latest_completed_source(db, image_id)
    if src is None:
        return ImageSourceInfoOut()

    uploaded_by_name = None
    if viewer.role in ("admin", "instructor") and src.uploaded_by is not None:
        uploader = await db.get(User, src.uploaded_by)
        if uploader is not None:
            uploaded_by_name = uploader.name

    file_type = os.path.splitext(src.original_filename)[1].lstrip(".").upper() or None
    return ImageSourceInfoOut(
        original_filename=src.original_filename,
        file_type=file_type,
        uploaded_by_name=uploaded_by_name,
    )
