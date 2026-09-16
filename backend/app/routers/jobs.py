"""Admin visibility and bounded operator controls for durable jobs.

Exposes the durable ``Job``/``JobItem`` tile-rebuild workflow (#1067 phases
2A-2D): a read-only list/detail surface plus rebuild-scoped mutations
(create, cancel, item retry).  Mutations verify ``job_type="rebuild_tiles"``
so the control surface stays narrow while the job model remains generic.

All routes are admin-only, matching the ``AdminTask`` listing precedent in
``admin.py``.  Responses never serialize claim tokens; item error summaries
are already bounded and sanitized by
``tile_rebuild_jobs.rebuild_error_summary``.
"""

import logging
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_role
from ..database import get_db, settings
from ..job_state import aggregate_job_items
from ..models import Job, JobItem, User
from ..schemas import (
    JobItemOut,
    JobItemStatus,
    JobItemsPageOut,
    JobOut,
    JobRetryOut,
    RebuildTilesCapabilityOut,
    RebuildTilesRequest,
)
from ..tile_rebuild_jobs import (
    REBUILD_JOB_TYPE,
    TileRebuildAlreadyActiveError,
    TileRebuildParallelDisabledError,
    TileRebuildStateError,
    create_tile_rebuild_job,
    request_job_cancellation,
    retry_failed_job_items,
)
from ..worker import enqueue_tile_rebuild_pump

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/jobs", tags=["jobs"])

_admin = require_role("admin")

# Supervisor states in which cancellation is an idempotent success rather
# than a conflict.  Terminal-success states (completed, completed_with_errors,
# failed) reject with 409.
_CANCELLABLE_JOB_STATUSES = frozenset(
    {"queued", "running", "cancelling", "cancelled"}
)


def _apply_counts(out: JobOut, counts: dict[str, int]) -> JobOut:
    """Attach the derived (non-persisted) queued/running counts."""
    out.queued_count = counts["queued"]
    out.running_count = counts["running"]
    return out


async def _job_out(db: AsyncSession, job: Job) -> JobOut:
    """Serialize one job with derived per-status item counts."""
    counts = await aggregate_job_items(db, job.id)
    return _apply_counts(JobOut.model_validate(job), counts)


async def _get_rebuild_job(db: AsyncSession, job_id: int) -> Job:
    """Load a ``rebuild_tiles`` job or raise 404.

    Mutation routes verify the job type here so rebuild controls can never
    touch items of another job type.
    """
    result = await db.execute(
        select(Job).where(Job.id == job_id, Job.job_type == REBUILD_JOB_TYPE)
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


async def _request_pump(job_id: int, trigger_id: str) -> None:
    """Best-effort pump request; the periodic sweep recovers missed ones."""
    enqueued = await enqueue_tile_rebuild_pump(job_id, trigger_id)
    if not enqueued:
        logger.warning(
            "Tile rebuild pump request was not enqueued; the periodic "
            "sweep will recover it",
            extra={
                "event": "jobs.rebuild_pump_enqueue_failed",
                "job_id": job_id,
                "trigger_id": trigger_id,
            },
        )


@router.get("/", response_model=list[JobOut])
async def list_jobs(
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, Depends(_admin)],
):
    """List recent jobs (newest first) with derived per-status counts."""
    result = await db.execute(select(Job).order_by(Job.id.desc()).limit(50))
    jobs = list(result.scalars().all())
    if not jobs:
        return []
    count_rows = await db.execute(
        select(JobItem.job_id, JobItem.status, func.count())
        .where(JobItem.job_id.in_([job.id for job in jobs]))
        .group_by(JobItem.job_id, JobItem.status)
    )
    per_job: dict[int, dict[str, int]] = {}
    for job_id, item_status, count in count_rows.all():
        per_job.setdefault(job_id, {})[item_status] = count
    out = []
    for job in jobs:
        counts = per_job.get(job.id, {})
        serialized = JobOut.model_validate(job)
        serialized.queued_count = counts.get("queued", 0)
        serialized.running_count = counts.get("running", 0)
        out.append(serialized)
    return out


@router.get("/rebuild-tiles", response_model=RebuildTilesCapabilityOut)
async def get_rebuild_tiles_capability(
    _user: Annotated[User, Depends(_admin)],
):
    """Report whether parallel tile-rebuild creation is enabled.

    Mirrors the gate in ``create_tile_rebuild_job`` so the UI only selects
    the parallel endpoint when creation can actually succeed.
    """
    return RebuildTilesCapabilityOut(
        enabled=(
            settings.rebuild_parallel_enabled
            and settings.task_execution_mode == "required"
        ),
        parallelism=settings.rebuild_parallelism,
    )


@router.post("/rebuild-tiles", response_model=JobOut, status_code=201)
async def start_rebuild_tiles_job(
    request: RebuildTilesRequest,
    user: Annotated[User, Depends(_admin)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a durable parallel tile-rebuild job and request its first pump.

    Rejected with 409 when parallel mode is disabled
    (``REBUILD_PARALLEL_ENABLED`` off or ``TASK_EXECUTION_MODE`` not
    ``required``) or when another serial or durable rebuild is already
    active.  The serial ``AdminTask`` rebuild endpoint is unchanged and
    remains the fallback when parallel mode is off.
    """
    try:
        job = await create_tile_rebuild_job(
            db,
            scope=request.scope,
            image_ids=request.image_ids,
            requested_by=user.id,
        )
    except TileRebuildParallelDisabledError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except TileRebuildAlreadyActiveError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    # The service already committed; the pump trigger must follow the commit
    # so the worker never observes a job whose items are not yet visible.
    await _request_pump(job.id, f"create:{job.id}")
    return await _job_out(db, job)


@router.get("/{job_id}", response_model=JobOut)
async def get_job(
    job_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, Depends(_admin)],
):
    """Get a single job's bounded supervisor state (no item payload)."""
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return await _job_out(db, job)


@router.get("/{job_id}/items", response_model=JobItemsPageOut)
async def list_job_items(
    job_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, Depends(_admin)],
    status: JobItemStatus | None = None,
    after_id: Annotated[int | None, Query(ge=1)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
):
    """Bounded keyset-paginated inspection of a job's items.

    Ordered by ``id`` ascending; pass ``next_after_id`` back as ``after_id``
    for the next page.  ``next_after_id`` is ``null`` when the page is
    exhausted.
    """
    exists = await db.execute(select(Job.id).where(Job.id == job_id))
    if exists.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Job not found")

    stmt = select(JobItem).where(JobItem.job_id == job_id)
    if status is not None:
        stmt = stmt.where(JobItem.status == status)
    if after_id is not None:
        stmt = stmt.where(JobItem.id > after_id)
    stmt = stmt.order_by(JobItem.id).limit(limit + 1)
    rows = list((await db.execute(stmt)).scalars().all())
    page = rows[:limit]
    next_after_id = page[-1].id if len(rows) > limit else None
    return JobItemsPageOut(
        items=[JobItemOut.model_validate(item) for item in page],
        next_after_id=next_after_id,
    )


@router.post("/{job_id}/cancel", response_model=JobOut)
async def cancel_rebuild_job(
    job_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, Depends(_admin)],
):
    """Idempotently request supervisor cancellation of a rebuild job.

    Returns the current job for ``queued``, ``running``, ``cancelling``, and
    already-``cancelled`` jobs; returns 409 for ``completed``, ``failed``,
    and ``completed_with_errors``.
    """
    job = await _get_rebuild_job(db, job_id)
    if job.status not in _CANCELLABLE_JOB_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Tile rebuild job {job_id} is {job.status} "
                "and cannot be cancelled"
            ),
        )
    await request_job_cancellation(db, job_id)
    # The lock's populate_existing refresh makes `job` authoritative now —
    # a job that completed between the pre-check and lock acquisition must
    # still answer 409 rather than being overwritten.
    if job.status not in _CANCELLABLE_JOB_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Tile rebuild job {job_id} is {job.status} "
                "and cannot be cancelled"
            ),
        )
    await db.commit()
    # A pump drains queued items into cancelled and finalizes the supervisor
    # sooner than waiting for running children or the periodic sweep.
    await _request_pump(job_id, f"cancel:{job_id}")
    await db.refresh(job)
    return await _job_out(db, job)


@router.post("/{job_id}/items/{item_id}/retry", response_model=JobRetryOut)
async def retry_rebuild_job_item(
    job_id: int,
    item_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, Depends(_admin)],
):
    """Requeue one failed item without altering successful history.

    ``queued`` items are treated as already retried (idempotent); items in
    any other state, or an item outside this job, are rejected.
    """
    job = await _get_rebuild_job(db, job_id)
    try:
        requeued = await retry_failed_job_items(db, job_id, [item_id])
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except TileRebuildStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await db.commit()
    if requeued:
        await _request_pump(
            job_id, f"retry:{item_id}:{uuid4().hex[:8]}"
        )
    return JobRetryOut(
        requeued_count=requeued,
        job=await _job_out(db, job),
    )


@router.post("/{job_id}/retry-failed", response_model=JobRetryOut)
async def retry_failed_rebuild_job_items(
    job_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _user: Annotated[User, Depends(_admin)],
):
    """Requeue every failed item through the bounded, repeatable service.

    Calls the #1188 service in fixed-size batches until no failed items
    remain, so the router never loads the full item set into memory.
    """
    job = await _get_rebuild_job(db, job_id)
    requeued = 0
    try:
        while True:
            batch = await retry_failed_job_items(db, job_id)
            if batch == 0:
                break
            requeued += batch
    except TileRebuildStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await db.commit()
    if requeued:
        await _request_pump(
            job_id, f"retry-failed:{uuid4().hex[:8]}"
        )
    return JobRetryOut(
        requeued_count=requeued,
        job=await _job_out(db, job),
    )
