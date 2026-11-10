"""Legacy changelog endpoints (deprecated – removed by #1838).

Release notes are ``kind='release'`` announcements since
``0042_announcements``.  This shim keeps the pre-#1832 ``ChangelogEntry``
contract working for the current Admin → Changelog tab and What's New dialog
until the Announcements UI (#1837) replaces them.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..announcements import live_clause, mark_seen, utcnow
from ..auth import require_role
from ..database import get_db
from ..models import Announcement, User
from ..schemas import (
    ChangelogEntryCreate,
    ChangelogEntryOut,
    ChangelogEntryUpdate,
    ChangelogMarkReadResponse,
)

router = APIRouter(prefix="/changelog", tags=["changelog"], deprecated=True)

_admin_or_instructor = require_role("admin", "instructor")
_admin = require_role("admin")


def _legacy_shape(ann: Announcement) -> ChangelogEntryOut:
    return ChangelogEntryOut(
        id=ann.id,
        title=ann.title or "",
        body=ann.message,
        published_at=ann.publish_at or ann.created_at,
        created_at=ann.created_at,
        updated_at=ann.updated_at,
    )


async def _get_release(db: AsyncSession, entry_id: int) -> Announcement:
    result = await db.execute(
        select(Announcement).where(Announcement.id == entry_id, Announcement.kind == "release")
    )
    ann = result.scalar_one_or_none()
    if ann is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Changelog entry not found")
    return ann


@router.get("/", response_model=list[ChangelogEntryOut])
async def list_entries(
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, Depends(_admin_or_instructor)],
):
    result = await db.execute(
        select(Announcement)
        .where(Announcement.kind == "release")
        .order_by(Announcement.publish_at.desc().nulls_last(), Announcement.id.desc())
    )
    return [_legacy_shape(a) for a in result.scalars().all()]


@router.post(
    "/",
    response_model=ChangelogEntryOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_entry(
    body: ChangelogEntryCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(_admin)],
):
    now = utcnow()
    ann = Announcement(
        title=body.title,
        message=body.body,
        kind="release",
        audience="staff",
        author_id=current_user.id,
        publish_at=now,
        notified_at=now,
    )
    db.add(ann)
    await db.commit()
    await db.refresh(ann)
    return _legacy_shape(ann)


@router.post("/mark-read", response_model=ChangelogMarkReadResponse)
async def mark_read(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(_admin_or_instructor)],
):
    """Mark every live release note as seen for the current user."""
    result = await db.execute(
        select(Announcement).where(Announcement.kind == "release", live_clause())
    )
    mark_seen(current_user, result.scalars().all())
    await db.commit()
    return ChangelogMarkReadResponse(changelog_last_read_at=utcnow().isoformat())


@router.patch("/{entry_id}", response_model=ChangelogEntryOut)
async def update_entry(
    entry_id: int,
    body: ChangelogEntryUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, Depends(_admin)],
):
    ann = await _get_release(db, entry_id)
    if body.title is not None:
        ann.title = body.title
    if body.body is not None:
        ann.message = body.body
    # Republish is never silent: bump the version marker so readers see it again.
    now = utcnow()
    ann.publish_at = now
    ann.notified_at = now
    await db.commit()
    await db.refresh(ann)
    return _legacy_shape(ann)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry(
    entry_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, Depends(_admin)],
):
    ann = await _get_release(db, entry_id)
    await db.delete(ann)
    await db.commit()
    return None
