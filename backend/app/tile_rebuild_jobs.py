"""Durable, PostgreSQL-authoritative tile-rebuild scheduling."""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal, TypeAlias

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import processing
from .database import get_async_session, settings
from .job_state import (
    JobItemSpec,
    add_job_item_snapshot,
    claim_job_items,
    finalize_job_item,
    heartbeat_job_item,
    reclaim_expired_job_items,
    refresh_job_aggregate,
    release_job_item_claim,
    reserve_job_item_execution,
)
from .models import ACTIVE_JOB_STATUSES, Job, JobItem, SourceImage
from .rebuild_locks import (
    acquire_rebuild_creation_lock,
    find_active_rebuild,
    try_acquire_rebuild_pump_lock,
)

logger = logging.getLogger(__name__)

REBUILD_JOB_TYPE = "rebuild_tiles"
REBUILD_RESOURCE_TYPE = "source_image"

ExecutionStart = Literal["duplicate", "ready", "skipped"]
TileRebuildResult = Literal["duplicate", "completed", "skipped"]
JSONScalar: TypeAlias = str | int | float | bool | None
JSONValue: TypeAlias = (
    JSONScalar | list["JSONValue"] | dict[str, "JSONValue"]
)
JobMetadata: TypeAlias = dict[str, JSONValue]


class TileRebuildParallelDisabledError(RuntimeError):
    """Raised when a caller requests a new disabled parallel rebuild."""


class TileRebuildAlreadyActiveError(RuntimeError):
    """Raised when a serial or durable tile rebuild is already active."""


@dataclass(frozen=True, slots=True)
class TileRebuildDispatch:
    """One committed child claim ready for arq submission."""

    job_id: int
    item_id: int
    claim_token: str
    attempt: int
    arq_job_id: str


@dataclass(frozen=True, slots=True)
class PumpResult:
    """Summary of one bounded pump attempt."""

    claimed: int = 0
    submitted: int = 0
    released: int = 0
    lock_acquired: bool = True


@dataclass(frozen=True, slots=True)
class ReservedRebuild:
    """Execution reservation outcome and immutable processing input."""

    outcome: ExecutionStart
    source_image_id: int | None = None
    image_id: int | None = None
    stored_path: str | None = None
    heartbeat_seconds: int | None = None
    lease_seconds: int | None = None


def tile_rebuild_arq_job_id(
    job_id: int,
    item_id: int,
    attempt: int,
) -> str:
    """Return the deterministic arq identifier for one claim attempt."""
    return f"rebuild:{job_id}:{item_id}:{attempt}"


def _metadata_positive_int(
    metadata: JobMetadata | None,
    key: str,
    default: int,
) -> int:
    value = (metadata or {}).get(key, default)
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"Invalid tile rebuild metadata value for {key!r}")
    return value


def _metadata_scope(metadata: JobMetadata | None) -> str:
    value = (metadata or {}).get("scope", "missing_stale")
    if not isinstance(value, str):
        raise TypeError("Invalid tile rebuild scope metadata")
    return value


async def _refresh_tile_rebuild_job(
    session: AsyncSession,
    job_id: int,
) -> dict[str, int]:
    counts = await refresh_job_aggregate(session, job_id)
    job = await session.get(Job, job_id)
    if job is None:
        raise ValueError(f"Job {job_id} does not exist")

    terminal_count = (
        counts["completed_count"]
        + counts["skipped_count"]
        + counts["failed_count"]
        + counts["cancelled_count"]
    )
    if counts["total_count"] > 0 and terminal_count == counts["total_count"]:
        if job.status == "cancelling":
            job.status = "cancelled"
        elif counts["failed_count"] > 0:
            job.status = "completed_with_errors"
        else:
            job.status = "completed"
        job.progress = 100
        job.completed_at = datetime.now(timezone.utc)
    await session.flush()
    return counts


async def create_tile_rebuild_job(
    session: AsyncSession,
    *,
    scope: str,
    image_ids: list[int] | None,
    requested_by: int | None,
) -> Job:
    """Create and snapshot a disabled-by-default durable rebuild."""
    if (
        not settings.rebuild_parallel_enabled
        or settings.task_execution_mode != "required"
    ):
        raise TileRebuildParallelDisabledError(
            "Parallel tile rebuilds require enabled, required queue execution"
        )

    await acquire_rebuild_creation_lock(session)
    active = await find_active_rebuild(session)
    if active is not None:
        raise TileRebuildAlreadyActiveError(
            f"Tile rebuild {active.kind} #{active.id} is {active.status}"
        )

    targets = await processing.select_rebuild_targets(
        session,
        scope=scope,
        image_ids=image_ids,
    )
    now = datetime.now(timezone.utc)
    metadata = {
        "execution_mode": "parallel",
        "scope": scope,
        "image_ids": image_ids,
        "parallelism": settings.rebuild_parallelism,
        "child_timeout_seconds": settings.rebuild_child_timeout_seconds,
        "lease_seconds": settings.rebuild_lease_seconds,
        "heartbeat_seconds": settings.rebuild_heartbeat_seconds,
        "pump_cadence_seconds": settings.rebuild_pump_cadence_seconds,
    }
    job = Job(
        job_type=REBUILD_JOB_TYPE,
        status="queued",
        metadata_=metadata,
        requested_by=requested_by,
    )
    session.add(job)
    await session.flush()
    add_job_item_snapshot(
        session,
        job,
        [
            JobItemSpec(
                resource_type=REBUILD_RESOURCE_TYPE,
                resource_id=str(source.id),
                metadata={
                    "image_id": source.image_id,
                    "stored_path": source.stored_path,
                },
            )
            for source in targets
        ],
    )
    job.status = "running"
    job.started_at = now
    if not targets:
        job.status = "completed"
        job.progress = 100
        job.completed_at = now
    await session.commit()
    await session.refresh(job)
    return job


async def claim_tile_rebuild_window(
    session: AsyncSession,
    job_id: int,
) -> tuple[list[TileRebuildDispatch], bool]:
    """Claim only the PostgreSQL-derived free slots for one job."""
    if not await try_acquire_rebuild_pump_lock(session, job_id):
        return [], False

    result = await session.execute(
        select(Job)
        .where(Job.id == job_id, Job.job_type == REBUILD_JOB_TYPE)
        .with_for_update()
    )
    job = result.scalar_one_or_none()
    if job is None or job.status not in {"queued", "running"}:
        return [], True

    lease_seconds = _metadata_positive_int(
        job.metadata_,
        "lease_seconds",
        settings.rebuild_lease_seconds,
    )
    parallelism = _metadata_positive_int(
        job.metadata_,
        "parallelism",
        settings.rebuild_parallelism,
    )
    await reclaim_expired_job_items(session, job_id=job_id)
    running_count = int(
        (
            await session.execute(
                select(func.count()).select_from(JobItem).where(
                    JobItem.job_id == job_id,
                    JobItem.status == "running",
                )
            )
        ).scalar_one()
    )
    free_slots = max(parallelism - running_count, 0)
    claimed = await claim_job_items(
        session,
        job_id,
        free_slots,
        lease_seconds,
    )
    dispatches: list[TileRebuildDispatch] = []
    for item in claimed:
        if item.claim_token is None:
            raise RuntimeError(f"Claimed item {item.id} has no claim token")
        item.arq_job_id = tile_rebuild_arq_job_id(
            job_id,
            item.id,
            item.attempts,
        )
        dispatches.append(
            TileRebuildDispatch(
                job_id=job_id,
                item_id=item.id,
                claim_token=item.claim_token,
                attempt=item.attempts,
                arq_job_id=item.arq_job_id,
            )
        )
    await _refresh_tile_rebuild_job(session, job_id)
    await session.flush()
    return dispatches, True


async def pump_tile_rebuild_job(
    job_id: int,
    submit: Callable[[TileRebuildDispatch], Awaitable[bool]],
) -> PumpResult:
    """Claim, commit, then submit enough children to fill one window."""
    async with get_async_session()() as session:
        dispatches, lock_acquired = await claim_tile_rebuild_window(
            session,
            job_id,
        )
        await session.commit()

    if not lock_acquired:
        return PumpResult(lock_acquired=False)

    submitted = 0
    released = 0
    for dispatch in dispatches:
        try:
            queued = await submit(dispatch)
        except Exception:
            logger.warning(
                "Tile rebuild child submission failed",
                exc_info=True,
                extra={
                    "event": "rebuild.child_submission_failed",
                    "job_id": dispatch.job_id,
                    "item_id": dispatch.item_id,
                    "arq_job_id": dispatch.arq_job_id,
                },
            )
            queued = False
        if queued:
            submitted += 1
            continue
        async with get_async_session()() as release_session:
            was_released = await release_job_item_claim(
                release_session,
                dispatch.job_id,
                dispatch.item_id,
                dispatch.claim_token,
            )
            await release_session.commit()
        if was_released:
            released += 1

    return PumpResult(
        claimed=len(dispatches),
        submitted=submitted,
        released=released,
    )


async def _reserve_rebuild_source(
    job_id: int,
    item_id: int,
    claim_token: str,
) -> ReservedRebuild:
    async with get_async_session()() as session:
        reserved = await reserve_job_item_execution(
            session,
            job_id,
            item_id,
            claim_token,
        )
        if not reserved:
            await session.rollback()
            return ReservedRebuild(outcome="duplicate")

        item = await session.get(JobItem, item_id)
        job = await session.get(Job, job_id)
        if (
            item is None
            or job is None
            or item.job_id != job_id
            or item.resource_type != REBUILD_RESOURCE_TYPE
            or item.resource_id is None
        ):
            raise ValueError("Tile rebuild claim has invalid durable state")

        heartbeat_seconds = _metadata_positive_int(
            job.metadata_,
            "heartbeat_seconds",
            settings.rebuild_heartbeat_seconds,
        )
        lease_seconds = _metadata_positive_int(
            job.metadata_,
            "lease_seconds",
            settings.rebuild_lease_seconds,
        )
        source_id = int(item.resource_id)
        source = await session.get(SourceImage, source_id)
        targets = []
        if source is not None and source.image_id is not None:
            targets = await processing.select_rebuild_targets(
                session,
                scope=_metadata_scope(job.metadata_),
                image_ids=[source.image_id],
            )
        if source is None or not any(target.id == source_id for target in targets):
            finalized = await finalize_job_item(
                session,
                item_id,
                claim_token,
                "skipped",
            )
            if finalized:
                await _refresh_tile_rebuild_job(session, job_id)
            await session.commit()
            return ReservedRebuild(outcome="skipped")

        result = ReservedRebuild(
            outcome="ready",
            source_image_id=source.id,
            image_id=source.image_id,
            stored_path=source.stored_path,
            heartbeat_seconds=heartbeat_seconds,
            lease_seconds=lease_seconds,
        )
        await session.commit()
        return result


async def _finalize_rebuild_failure(
    job_id: int,
    item_id: int,
    claim_token: str,
    error_message: str,
) -> None:
    async with get_async_session()() as session:
        finalized = await finalize_job_item(
            session,
            item_id,
            claim_token,
            "failed",
            error_message=error_message,
        )
        if finalized:
            await _refresh_tile_rebuild_job(session, job_id)
        await session.commit()


async def _heartbeat_rebuild_item(
    item_id: int,
    claim_token: str,
    heartbeat_seconds: int,
    lease_seconds: int,
) -> None:
    while True:
        await asyncio.sleep(heartbeat_seconds)
        async with get_async_session()() as session:
            renewed = await heartbeat_job_item(
                session,
                item_id,
                claim_token,
                lease_seconds,
            )
            await session.commit()
        if not renewed:
            return


async def process_tile_rebuild_item(
    job_id: int,
    item_id: int,
    claim_token: str,
) -> TileRebuildResult:
    """Reserve and process one durable tile rebuild child."""
    reservation = await _reserve_rebuild_source(job_id, item_id, claim_token)
    if reservation.outcome != "ready":
        return reservation.outcome
    if (
        reservation.source_image_id is None
        or reservation.stored_path is None
        or reservation.heartbeat_seconds is None
        or reservation.lease_seconds is None
    ):
        raise RuntimeError("Ready tile rebuild reservation has no source")

    heartbeat_task = asyncio.create_task(
        _heartbeat_rebuild_item(
            item_id,
            claim_token,
            reservation.heartbeat_seconds,
            reservation.lease_seconds,
        )
    )
    source = processing.TileRebuildSource(
        source_image_id=reservation.source_image_id,
        image_id=reservation.image_id,
        stored_path=reservation.stored_path,
    )
    prepared = None
    promoted = None
    committed = False
    try:
        prepared = await processing.prepare_source_image_tile_rebuild(source)
        async with get_async_session()() as session:
            claim_result = await session.execute(
                select(JobItem)
                .where(
                    JobItem.id == item_id,
                    JobItem.job_id == job_id,
                    JobItem.status == "running",
                    JobItem.claim_token == claim_token,
                    JobItem.started_at.is_not(None),
                )
                .with_for_update()
            )
            if claim_result.scalar_one_or_none() is None:
                await session.rollback()
                await processing.discard_prepared_tile_rebuild(prepared)
                return "duplicate"

            source_image = await session.get(SourceImage, source.source_image_id)
            if source_image is None:
                await processing.discard_prepared_tile_rebuild(prepared)
                finalized = await finalize_job_item(
                    session,
                    item_id,
                    claim_token,
                    "skipped",
                )
                if finalized:
                    await _refresh_tile_rebuild_job(session, job_id)
                await session.commit()
                return "skipped"

            promoted = await processing.promote_source_image_tile_rebuild(
                session,
                source_image,
                prepared,
            )
            finalized = await finalize_job_item(
                session,
                item_id,
                claim_token,
                "completed",
            )
            if not finalized:
                raise RuntimeError("Tile rebuild claim was lost before commit")
            await _refresh_tile_rebuild_job(session, job_id)
            try:
                await session.commit()
            except Exception:
                await session.rollback()
                raise
            committed = True
        await processing.finish_promoted_tile_rebuild(promoted)
        return "completed"
    except asyncio.CancelledError:
        if promoted is not None and not committed:
            await processing.rollback_promoted_tile_rebuild(promoted)
        elif prepared is not None and promoted is None:
            await processing.discard_prepared_tile_rebuild(prepared)
        raise
    except Exception as exc:
        if promoted is not None and not committed:
            await processing.rollback_promoted_tile_rebuild(promoted)
        elif prepared is not None and promoted is None:
            await processing.discard_prepared_tile_rebuild(prepared)
        if not committed:
            await _finalize_rebuild_failure(
                job_id,
                item_id,
                claim_token,
                str(exc),
            )
        raise
    finally:
        heartbeat_task.cancel()
        with suppress(asyncio.CancelledError):
            await heartbeat_task


async def active_tile_rebuild_job_ids() -> list[int]:
    """Return durable rebuild jobs that may need pumping."""
    async with get_async_session()() as session:
        result = await session.execute(
            select(Job.id)
            .where(
                Job.job_type == REBUILD_JOB_TYPE,
                Job.status.in_(ACTIVE_JOB_STATUSES),
            )
            .order_by(Job.id)
        )
        return list(result.scalars().all())


async def reconcile_tile_rebuild_jobs(
    submit: Callable[[TileRebuildDispatch], Awaitable[bool]],
) -> None:
    """Reclaim and repump active durable rebuilds."""
    for job_id in await active_tile_rebuild_job_ids():
        await pump_tile_rebuild_job(
            job_id,
            submit,
        )
