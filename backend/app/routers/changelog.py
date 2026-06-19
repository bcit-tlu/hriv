"""In-app changelog notifications for admin and instructor users."""

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_role
from ..database import get_db
from ..models import ChangelogEntry, User
from ..schemas import (
    ChangelogEntryCreate,
    ChangelogEntryOut,
    ChangelogEntryUpdate,
    ChangelogMarkReadResponse,
)

router = APIRouter(prefix="/changelog", tags=["changelog"])

_admin_or_instructor = require_role("admin", "instructor")
_admin = require_role("admin")


@router.get("/", response_model=list[ChangelogEntryOut])
async def list_entries(
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, Depends(_admin_or_instructor)],
):
    result = await db.execute(
        select(ChangelogEntry).order_by(ChangelogEntry.published_at.desc())
    )
    return list(result.scalars().all())


@router.post(
    "/",
    response_model=ChangelogEntryOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_entry(
    body: ChangelogEntryCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, Depends(_admin)],
):
    entry = ChangelogEntry(title=body.title, body=body.body)
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.post("/mark-read", response_model=ChangelogMarkReadResponse)
async def mark_read(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(_admin_or_instructor)],
):
    now = datetime.now(timezone.utc).isoformat()
    meta = dict(current_user.metadata_ or {})
    meta["changelog_last_read_at"] = now
    current_user.metadata_ = meta
    await db.commit()
    return ChangelogMarkReadResponse(changelog_last_read_at=now)


@router.patch("/{entry_id}", response_model=ChangelogEntryOut)
async def update_entry(
    entry_id: int,
    body: ChangelogEntryUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, Depends(_admin)],
):
    entry = await db.get(ChangelogEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Changelog entry not found")

    if body.title is not None:
        entry.title = body.title
    if body.body is not None:
        entry.body = body.body
    entry.published_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry(
    entry_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, Depends(_admin)],
):
    entry = await db.get(ChangelogEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Changelog entry not found")

    await db.delete(entry)
    await db.commit()

