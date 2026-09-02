"""Durable state transitions for supervisor jobs and child job items.

PostgreSQL is authoritative for item ownership and completion. Redis/arq
identifiers are retained only as execution metadata; a child must present its
claim token before it can heartbeat or finalize an item.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal, Sequence
from uuid import uuid4

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Job, JobItem

JobItemTerminalStatus = Literal[
    "completed",
    "skipped",
    "failed",
    "cancelled",
]

JOB_ITEM_STATUSES = (
    "queued",
    "running",
    "completed",
    "skipped",
    "failed",
    "cancelled",
)
TERMINAL_JOB_ITEM_STATUSES = frozenset(
    {"completed", "skipped", "failed", "cancelled"}
)


@dataclass(frozen=True)
class JobItemSpec:
    """One resource in a supervisor's immutable target snapshot."""

    resource_type: str
    resource_id: str | None
    metadata: dict | None = None


def add_job_item_snapshot(
    session: AsyncSession,
    job: Job,
    resources: Sequence[JobItemSpec],
) -> list[JobItem]:
    """Add the target snapshot and initialize the supervisor totals.

    The caller owns the surrounding transaction and should lock the ``Job``
    row before calling this helper. The database uniqueness constraint remains
    the final guard against duplicate resources across concurrent callers.
    """
    seen: set[tuple[str, str | None]] = set()
    items: list[JobItem] = []
    for resource in resources:
        key = (resource.resource_type, resource.resource_id)
        if key in seen:
            raise ValueError(f"Duplicate job item resource: {key!r}")
        seen.add(key)
        items.append(
            JobItem(
                job_id=job.id,
                resource_type=resource.resource_type,
                resource_id=resource.resource_id,
                metadata_=resource.metadata,
            )
        )

    session.add_all(items)
    job.total_count = len(items)
    job.completed_count = 0
    job.skipped_count = 0
    job.failed_count = 0
    job.cancelled_count = 0
    job.progress = 0
    return items


async def claim_job_items(
    session: AsyncSession,
    job_id: int,
    limit: int,
    lease_seconds: int,
    *,
    arq_job_id: str | None = None,
    now: datetime | None = None,
) -> list[JobItem]:
    """Atomically claim up to ``limit`` queued items using ``SKIP LOCKED``."""
    if limit <= 0:
        return []
    if lease_seconds <= 0:
        raise ValueError("lease_seconds must be positive")

    now = now or datetime.now(timezone.utc)
    result = await session.execute(
        select(JobItem)
        .where(
            JobItem.job_id == job_id,
            JobItem.status == "queued",
        )
        .order_by(JobItem.id)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    items = list(result.scalars().all())
    for item in items:
        item.status = "running"
        item.attempts += 1
        item.claim_token = uuid4().hex
        item.heartbeat_at = now
        item.lease_expires_at = now + timedelta(seconds=lease_seconds)
        item.arq_job_id = arq_job_id
        item.started_at = now
        item.completed_at = None
    await session.flush()
    return items


async def heartbeat_job_item(
    session: AsyncSession,
    item_id: int,
    claim_token: str,
    lease_seconds: int,
    *,
    now: datetime | None = None,
) -> bool:
    """Extend an owned running item's lease, returning whether it was owned."""
    if lease_seconds <= 0:
        raise ValueError("lease_seconds must be positive")
    now = now or datetime.now(timezone.utc)
    result = await session.execute(
        update(JobItem)
        .where(
            JobItem.id == item_id,
            JobItem.status == "running",
            JobItem.claim_token == claim_token,
        )
        .values(
            heartbeat_at=now,
            lease_expires_at=now + timedelta(seconds=lease_seconds),
            updated_at=now,
        )
    )
    return result.rowcount == 1


async def finalize_job_item(
    session: AsyncSession,
    item_id: int,
    claim_token: str,
    status: JobItemTerminalStatus,
    *,
    progress: int | None = None,
    error_message: str | None = None,
    now: datetime | None = None,
) -> bool:
    """Finalize an item only when the supplied claim still owns it."""
    if status not in TERMINAL_JOB_ITEM_STATUSES:
        raise ValueError(f"Invalid terminal item status: {status!r}")
    if progress is not None and not 0 <= progress <= 100:
        raise ValueError("progress must be between 0 and 100")

    now = now or datetime.now(timezone.utc)
    values: dict[str, object] = {
        "status": status,
        "completed_at": now,
        "updated_at": now,
        "claim_token": None,
        "heartbeat_at": None,
        "lease_expires_at": None,
        "arq_job_id": None,
        "error_message": error_message,
    }
    if status in {"completed", "skipped"}:
        values["progress"] = 100
    elif progress is not None:
        values["progress"] = progress

    result = await session.execute(
        update(JobItem)
        .where(
            JobItem.id == item_id,
            JobItem.status == "running",
            JobItem.claim_token == claim_token,
        )
        .values(**values)
    )
    return result.rowcount == 1


async def reclaim_expired_job_items(
    session: AsyncSession,
    *,
    job_id: int | None = None,
    now: datetime | None = None,
    limit: int | None = None,
) -> int:
    """Return expired running items to ``queued`` for retry/recovery."""
    now = now or datetime.now(timezone.utc)
    stmt = (
        update(JobItem)
        .where(
            JobItem.status == "running",
            JobItem.lease_expires_at.is_not(None),
            JobItem.lease_expires_at <= now,
        )
        .values(
            status="queued",
            claim_token=None,
            heartbeat_at=None,
            lease_expires_at=None,
            arq_job_id=None,
            updated_at=now,
        )
    )
    if job_id is not None:
        stmt = stmt.where(JobItem.job_id == job_id)
    if limit is not None:
        if limit <= 0:
            return 0
        expired = select(JobItem.id).where(
            JobItem.status == "running",
            JobItem.lease_expires_at.is_not(None),
            JobItem.lease_expires_at <= now,
        )
        if job_id is not None:
            expired = expired.where(JobItem.job_id == job_id)
        expired = expired.order_by(JobItem.id).limit(limit)
        stmt = stmt.where(JobItem.id.in_(expired))
    result = await session.execute(stmt)
    return result.rowcount


async def aggregate_job_items(
    session: AsyncSession,
    job_id: int,
) -> dict[str, int]:
    """Return deterministic status counts and terminal progress."""
    result = await session.execute(
        select(JobItem.status, func.count())
        .where(JobItem.job_id == job_id)
        .group_by(JobItem.status)
    )
    counts = {status: 0 for status in JOB_ITEM_STATUSES}
    counts.update({status: count for status, count in result.all()})
    total = sum(counts.values())
    terminal = sum(counts[status] for status in TERMINAL_JOB_ITEM_STATUSES)
    counts.update(
        {
            "total_count": total,
            "completed_count": counts["completed"],
            "skipped_count": counts["skipped"],
            "failed_count": counts["failed"],
            "cancelled_count": counts["cancelled"],
            "progress": (terminal * 100 // total) if total else 0,
        }
    )
    return counts


async def refresh_job_aggregate(
    session: AsyncSession,
    job_id: int,
) -> dict[str, int]:
    """Persist item-derived counts on a locked supervisor row."""
    result = await session.execute(
        select(Job).where(Job.id == job_id).with_for_update()
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise ValueError(f"Job {job_id} does not exist")

    counts = await aggregate_job_items(session, job_id)
    job.total_count = counts["total_count"]
    job.completed_count = counts["completed_count"]
    job.skipped_count = counts["skipped_count"]
    job.failed_count = counts["failed_count"]
    job.cancelled_count = counts["cancelled_count"]
    job.progress = counts["progress"]
    await session.flush()
    return counts
