"""Read-only visibility into durable long-running jobs (:class:`Job`/:class:`JobItem`).

This is intentionally read-only for now: no code creates ``Job``/``JobItem``
rows yet (see #1067), so this router only exposes the operational-visibility
API described in that issue's phase 1. Admin-only, matching the existing
``AdminTask`` listing precedent in ``admin.py``.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import require_role
from ..database import get_db
from ..models import Job, User
from ..schemas import JobDetailOut, JobOut

router = APIRouter(prefix="/jobs", tags=["jobs"])

_admin = require_role("admin")


@router.get("/", response_model=list[JobOut])
async def list_jobs(
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, Depends(_admin)],
):
    """List recent jobs (newest first)."""
    result = await db.execute(select(Job).order_by(Job.id.desc()).limit(50))
    return list(result.scalars().all())


@router.get("/{job_id}", response_model=JobDetailOut)
async def get_job(
    job_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, Depends(_admin)],
):
    """Get a single job, including its child job items."""
    result = await db.execute(
        select(Job).where(Job.id == job_id).options(selectinload(Job.items))
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
