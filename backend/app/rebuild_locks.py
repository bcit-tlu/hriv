"""PostgreSQL locks and active-run checks shared by tile rebuild paths."""

from dataclasses import dataclass

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    ACTIVE_JOB_STATUSES,
    ACTIVE_TASK_STATUSES,
    AdminTask,
    Job,
)

REBUILD_CREATION_LOCK_KEY = 7_035_202_106_700_001
REBUILD_PUMP_LOCK_NAMESPACE = 1_067_118_7


@dataclass(frozen=True, slots=True)
class ActiveRebuild:
    """One active serial or durable tile rebuild."""

    kind: str
    id: int
    status: str


async def acquire_rebuild_creation_lock(session: AsyncSession) -> None:
    """Serialize serial and durable rebuild creation for this transaction."""
    await session.execute(
        text("SELECT pg_advisory_xact_lock(:key)").bindparams(
            key=REBUILD_CREATION_LOCK_KEY,
        )
    )


async def try_acquire_rebuild_pump_lock(
    session: AsyncSession,
    job_id: int,
) -> bool:
    """Try to become the sole pump transaction for one durable rebuild."""
    result = await session.execute(
        text(
            "SELECT pg_try_advisory_xact_lock(:namespace, :job_id)"
        ).bindparams(
            namespace=REBUILD_PUMP_LOCK_NAMESPACE,
            job_id=job_id,
        )
    )
    return bool(result.scalar_one())


async def find_active_rebuild(
    session: AsyncSession,
) -> ActiveRebuild | None:
    """Return the active serial or durable rebuild, if one exists."""
    serial = (
        await session.execute(
            select(AdminTask)
            .where(
                AdminTask.task_type == "rebuild_tiles",
                AdminTask.status.in_(ACTIVE_TASK_STATUSES),
            )
            .order_by(AdminTask.id)
            .limit(1)
        )
    ).scalars().first()
    if serial is not None:
        return ActiveRebuild(kind="task", id=serial.id, status=serial.status)

    durable = (
        await session.execute(
            select(Job)
            .where(
                Job.job_type == "rebuild_tiles",
                Job.status.in_(ACTIVE_JOB_STATUSES),
            )
            .order_by(Job.id)
            .limit(1)
        )
    ).scalars().first()
    if durable is not None:
        return ActiveRebuild(kind="job", id=durable.id, status=durable.status)
    return None
