"""Announcement endpoint – single configurable site-wide banner."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_role
from ..database import get_db
from ..models import Announcement
from ..schemas import AnnouncementOut, AnnouncementUpdate

router = APIRouter(prefix="/announcement", tags=["announcement"])


@router.get("/", response_model=AnnouncementOut)
async def get_announcement(db: Annotated[AsyncSession, Depends(get_db)]):
    """Return the current announcement. Public – no auth required."""
    result = await db.execute(select(Announcement).where(Announcement.id == 1))
    ann = result.scalar_one_or_none()
    if ann is None:
        ann = Announcement(id=1, message="", enabled=False)
        db.add(ann)
        await db.commit()
        await db.refresh(ann)
    return ann


@router.put("/", response_model=AnnouncementOut)
async def update_announcement(
    body: AnnouncementUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _editor: Annotated[None, Depends(require_role("admin", "instructor"))],
):
    """Update the site-wide announcement. Admin and instructor."""
    result = await db.execute(select(Announcement).where(Announcement.id == 1))
    ann = result.scalar_one_or_none()
    if ann is None:
        ann = Announcement(id=1, message="", enabled=False)
        db.add(ann)
        await db.flush()

    if body.message is not None:
        ann.message = body.message
    if body.enabled is not None:
        ann.enabled = body.enabled

    await db.commit()
    await db.refresh(ann)
    return ann
