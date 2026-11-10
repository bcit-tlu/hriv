"""Legacy site-wide banner endpoint (deprecated – removed by #1838).

Since ``0042_announcements`` the banner is just the newest broadcast
announcement (``audience='everyone'`` ∧ ``banner=true``).  This shim keeps the
pre-#1832 ``{message, enabled}`` contract working for the current frontend
until the new Announcements UI (#1837/#1838) replaces it.
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..announcements import is_live, utcnow
from ..auth import require_role
from ..database import get_db
from ..models import Announcement, User
from ..schemas import LegacyAnnouncementOut, LegacyAnnouncementUpdate

router = APIRouter(prefix="/announcement", tags=["announcement"], deprecated=True)


def _legacy_shape(ann: Announcement | None) -> LegacyAnnouncementOut:
    if ann is None:
        now = utcnow()
        return LegacyAnnouncementOut(id=0, message="", enabled=False, created_at=now, updated_at=now)
    return LegacyAnnouncementOut(
        id=ann.id,
        message=ann.message,
        enabled=is_live(ann),
        created_at=ann.created_at,
        updated_at=ann.updated_at,
    )


async def _broadcast_banner(db: AsyncSession) -> Announcement | None:
    result = await db.execute(
        select(Announcement)
        .where(
            Announcement.audience == "everyone",
            Announcement.banner.is_(True),
            # The legacy banner was always a plain notice; admin-only kinds
            # (release/warning) posted via /api/announcements stay out of reach.
            Announcement.kind == "notice",
        )
        .order_by(Announcement.publish_at.desc().nulls_last(), Announcement.id.desc())
        .limit(1)
    )
    return result.scalars().first()


@router.get("/", response_model=LegacyAnnouncementOut)
async def get_announcement(db: Annotated[AsyncSession, Depends(get_db)]):
    """Return the broadcast banner in the legacy shape. Public – no auth required."""
    return _legacy_shape(await _broadcast_banner(db))


@router.put("/", response_model=LegacyAnnouncementOut)
async def update_announcement(
    body: LegacyAnnouncementUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    editor: Annotated[User, Depends(require_role("admin", "instructor"))],
):
    """Upsert the broadcast banner. Admin and instructor."""
    ann = await _broadcast_banner(db)
    if ann is None:
        ann = Announcement(
            message="",
            kind="notice",
            audience="everyone",
            banner=True,
            author_id=editor.id,
        )
        db.add(ann)
        await db.flush()

    if body.message is not None:
        ann.message = body.message
    if body.enabled is not None:
        if body.enabled and not is_live(ann):
            now = utcnow()
            ann.publish_at = now
            ann.notified_at = now
            ann.expires_at = None
        elif not body.enabled:
            ann.publish_at = None
            ann.notified_at = None

    await db.commit()
    await db.refresh(ann)
    return _legacy_shape(ann)
