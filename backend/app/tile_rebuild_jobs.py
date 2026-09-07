"""Durable, PostgreSQL-authoritative tile-rebuild scheduling."""

import asyncio
import errno
import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal, Protocol, TypeAlias, cast

from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import (
    DisconnectionError,
    InterfaceError,
    OperationalError,
)
from sqlalchemy.exc import (
    TimeoutError as SQLAlchemyTimeoutError,
)
from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_async_session, settings
from .job_state import (
    JobItemSpec,
    add_job_item_snapshot,
    claim_job_items,
    derive_supervisor_status,
    finalize_job_item,
    heartbeat_job_item,
    refresh_job_aggregate,
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
REBUILD_RECONCILE_BATCH_SIZE = 100

ExecutionStart = Literal["cancelled", "duplicate", "ready", "skipped"]
TileRebuildResult = Literal[
    "cancelled",
    "duplicate",
    "completed",
    "skipped",
]
JSONScalar: TypeAlias = str | int | float | bool | None
JSONValue: TypeAlias = (
    JSONScalar | list["JSONValue"] | dict[str, "JSONValue"]
)
JobMetadata: TypeAlias = dict[str, JSONValue]


class _TileRebuildSourceFactory(Protocol):
    def __call__(
        self,
        *,
        source_image_id: int,
        image_id: int | None,
        stored_path: str,
    ) -> object:
        pass


class _ProcessingModule(Protocol):
    TileRebuildSource: _TileRebuildSourceFactory

    async def select_rebuild_targets(
        self,
        session: AsyncSession,
        *,
        scope: str,
        image_ids: list[int] | None,
    ) -> list[SourceImage]:
        pass

    async def prepare_source_image_tile_rebuild(
        self,
        source: object,
    ) -> object:
        pass

    async def promote_source_image_tile_rebuild(
        self,
        session: AsyncSession,
        source_image: SourceImage,
        prepared: object,
    ) -> object:
        pass

    async def finish_promoted_tile_rebuild(
        self,
        promoted: object,
    ) -> None:
        pass

    async def rollback_promoted_tile_rebuild(
        self,
        promoted: object,
    ) -> None:
        pass

    async def discard_prepared_tile_rebuild(
        self,
        prepared: object,
    ) -> None:
        pass


def _load_processing() -> _ProcessingModule:
    """Load the libvips-backed pipeline only when rebuild work needs it."""
    from . import processing

    return cast(_ProcessingModule, processing)


class TileRebuildParallelDisabledError(RuntimeError):
    """Raised when a caller requests a new disabled parallel rebuild."""


class TileRebuildAlreadyActiveError(RuntimeError):
    """Raised when a serial or durable tile rebuild is already active."""


class TileRebuildLeaseLostError(RuntimeError):
    """Raised when a durable tile rebuild child loses its item lease."""


class TileRebuildDispatchError(RuntimeError):
    """Raised when a claimed child cannot be submitted."""


class TileRebuildLeaseExpiredError(RuntimeError):
    """Raised when reconciliation finds an expired child lease."""


class TileRebuildStateError(RuntimeError):
    """Raised when a requested rebuild transition is not valid."""


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


TRANSIENT_FILESYSTEM_ERRNOS = frozenset(
    {
        errno.EAGAIN,
        errno.EBUSY,
        errno.EINTR,
        errno.EMFILE,
        errno.ENFILE,
        errno.ETIMEDOUT,
    }
)
TRANSIENT_REBUILD_ERROR_TYPES = (
    ConnectionError,
    TimeoutError,
    DisconnectionError,
    InterfaceError,
    OperationalError,
    SQLAlchemyTimeoutError,
    TileRebuildDispatchError,
    TileRebuildLeaseExpiredError,
)


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


def is_transient_rebuild_error(exc: BaseException) -> bool:
    """Classify bounded typed failures without inspecting message text."""
    current: BaseException | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, TRANSIENT_REBUILD_ERROR_TYPES):
            return True
        if (
            isinstance(current, OSError)
            and current.errno in TRANSIENT_FILESYSTEM_ERRNOS
        ):
            return True
        current = current.__cause__ or current.__context__
    return False


def rebuild_error_summary(exc: BaseException) -> str:
    """Return a bounded error category safe for durable display."""
    error_type = type(exc)
    category = f"{error_type.__module__}.{error_type.__name__}"
    if isinstance(exc, OSError) and exc.errno is not None:
        category = (
            f"{category} ({errno.errorcode.get(exc.errno, 'UNKNOWN')})"
        )
    return category[:255]


def rebuild_retry_delay_seconds(
    attempts: int,
    base_seconds: int,
    cap_seconds: int,
) -> int:
    """Return bounded exponential delay after a claimed attempt."""
    if attempts <= 0 or base_seconds <= 0 or cap_seconds <= 0:
        raise ValueError("Retry policy values must be positive")
    if base_seconds >= cap_seconds:
        return cap_seconds
    max_doublings = (cap_seconds // base_seconds).bit_length()
    exponent = min(attempts - 1, max_doublings)
    return min(base_seconds * (2**exponent), cap_seconds)


async def _lock_tile_rebuild_job(
    session: AsyncSession,
    job_id: int,
) -> Job:
    result = await session.execute(
        select(Job)
        .where(Job.id == job_id, Job.job_type == REBUILD_JOB_TYPE)
        .with_for_update()
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise ValueError(f"Tile rebuild job {job_id} does not exist")
    return job


def _clear_rebuild_item_ownership(item: JobItem) -> None:
    item.claim_token = None
    item.heartbeat_at = None
    item.lease_expires_at = None
    item.arq_job_id = None
    item.started_at = None


def _release_rebuild_attempt(
    job: Job,
    item: JobItem,
    *,
    retryable: bool,
    error_message: str,
    now: datetime,
) -> Literal["cancelled", "failed", "queued"]:
    _clear_rebuild_item_ownership(item)
    item.updated_at = now

    if job.status == "cancelling":
        item.status = "cancelled"
        item.retry_not_before = None
        item.error_message = None
        item.completed_at = now
        return "cancelled"

    item.error_message = error_message
    max_attempts = _metadata_positive_int(
        job.metadata_,
        "max_attempts",
        settings.rebuild_max_attempts,
    )
    if retryable and item.attempts < max_attempts:
        base_seconds = _metadata_positive_int(
            job.metadata_,
            "retry_backoff_base_seconds",
            settings.rebuild_retry_backoff_base_seconds,
        )
        cap_seconds = _metadata_positive_int(
            job.metadata_,
            "retry_backoff_cap_seconds",
            settings.rebuild_retry_backoff_cap_seconds,
        )
        item.status = "queued"
        item.progress = 0
        item.retry_not_before = now + timedelta(
            seconds=rebuild_retry_delay_seconds(
                item.attempts,
                base_seconds,
                cap_seconds,
            )
        )
        item.completed_at = None
        return "queued"

    item.status = "failed"
    item.retry_not_before = None
    item.completed_at = now
    return "failed"


async def _recover_expired_rebuild_items(
    session: AsyncSession,
    job: Job,
    *,
    limit: int,
    now: datetime,
) -> int:
    if limit <= 0:
        return 0
    result = await session.execute(
        select(JobItem)
        .where(
            JobItem.job_id == job.id,
            JobItem.status == "running",
            JobItem.lease_expires_at.is_not(None),
            JobItem.lease_expires_at <= now,
        )
        .order_by(JobItem.id)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    items = list(result.scalars().all())
    error_message = rebuild_error_summary(TileRebuildLeaseExpiredError())
    for item in items:
        _release_rebuild_attempt(
            job,
            item,
            retryable=True,
            error_message=error_message,
            now=now,
        )
    return len(items)


async def _refresh_tile_rebuild_job(
    session: AsyncSession,
    job_id: int,
) -> dict[str, int]:
    counts = await refresh_job_aggregate(session, job_id)
    job = await session.get(Job, job_id)
    if job is None:
        raise ValueError(f"Job {job_id} does not exist")

    status = derive_supervisor_status(job.status, counts)
    job.status = status
    if status in {
        "completed",
        "completed_with_errors",
        "failed",
        "cancelled",
    }:
        job.progress = 100
        if job.completed_at is None:
            job.completed_at = datetime.now(timezone.utc)
    else:
        job.completed_at = None
    await session.flush()
    return counts


async def _cancel_pending_rebuild_items(
    session: AsyncSession,
    job_id: int,
    *,
    limit: int,
    now: datetime,
) -> int:
    if limit <= 0:
        return 0
    result = await session.execute(
        select(JobItem)
        .where(
            JobItem.job_id == job_id,
            or_(
                JobItem.status == "queued",
                and_(
                    JobItem.status == "running",
                    JobItem.started_at.is_(None),
                ),
            ),
        )
        .order_by(JobItem.id)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    items = list(result.scalars().all())
    for item in items:
        item.status = "cancelled"
        item.claim_token = None
        item.heartbeat_at = None
        item.lease_expires_at = None
        item.retry_not_before = None
        item.arq_job_id = None
        item.error_message = None
        item.started_at = None
        item.completed_at = now
        item.updated_at = now
    return len(items)


async def request_job_cancellation(
    session: AsyncSession,
    job_id: int,
    *,
    batch_size: int = REBUILD_RECONCILE_BATCH_SIZE,
    now: datetime | None = None,
) -> int:
    """Request cancellation and drain one bounded pending-item batch."""
    current = now or datetime.now(timezone.utc)
    job = await _lock_tile_rebuild_job(session, job_id)
    if job.status in {
        "completed",
        "completed_with_errors",
        "failed",
        "cancelled",
    }:
        return 0
    job.status = "cancelling"
    cancelled = await _cancel_pending_rebuild_items(
        session,
        job_id,
        limit=batch_size,
        now=current,
    )
    await _refresh_tile_rebuild_job(session, job_id)
    return cancelled


async def retry_failed_job_items(
    session: AsyncSession,
    job_id: int,
    item_ids: Sequence[int] | None = None,
    *,
    batch_size: int = REBUILD_RECONCILE_BATCH_SIZE,
) -> int:
    """Reset failed items to queued while preserving attempt history."""
    job = await _lock_tile_rebuild_job(session, job_id)
    if job.status in {"cancelling", "cancelled", "completed"}:
        raise TileRebuildStateError(
            f"Tile rebuild job {job_id} cannot retry from {job.status}"
        )

    if item_ids is None:
        if batch_size <= 0:
            return 0
        result = await session.execute(
            select(JobItem)
            .where(
                JobItem.job_id == job_id,
                JobItem.status == "failed",
            )
            .order_by(JobItem.id)
            .limit(batch_size)
            .with_for_update(skip_locked=True)
        )
        items = list(result.scalars().all())
    else:
        requested_ids = set(item_ids)
        if not requested_ids:
            return 0
        result = await session.execute(
            select(JobItem)
            .where(
                JobItem.job_id == job_id,
                JobItem.id.in_(requested_ids),
            )
            .order_by(JobItem.id)
            .with_for_update()
        )
        items = list(result.scalars().all())
        if {item.id for item in items} != requested_ids:
            raise ValueError("One or more tile rebuild items do not exist")
        invalid = [
            item
            for item in items
            if item.status not in {"failed", "queued"}
        ]
        if invalid:
            raise TileRebuildStateError(
                "Tile rebuild items can only be retried from failed state"
            )

    retried = 0
    for item in items:
        if item.status == "queued":
            continue
        item.status = "queued"
        item.progress = 0
        item.error_message = None
        item.claim_token = None
        item.heartbeat_at = None
        item.lease_expires_at = None
        item.retry_not_before = None
        item.arq_job_id = None
        item.started_at = None
        item.completed_at = None
        retried += 1

    if retried and job.status in {"completed_with_errors", "failed"}:
        job.status = "running"
        job.completed_at = None
    await _refresh_tile_rebuild_job(session, job_id)
    return retried


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

    processing = _load_processing()
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
        "max_attempts": settings.rebuild_max_attempts,
        "retry_backoff_base_seconds": (
            settings.rebuild_retry_backoff_base_seconds
        ),
        "retry_backoff_cap_seconds": (
            settings.rebuild_retry_backoff_cap_seconds
        ),
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
    if job is None:
        return [], True
    current = datetime.now(timezone.utc)
    await _recover_expired_rebuild_items(
        session,
        job,
        limit=REBUILD_RECONCILE_BATCH_SIZE,
        now=current,
    )
    if job.status == "cancelling":
        await _cancel_pending_rebuild_items(
            session,
            job_id,
            limit=REBUILD_RECONCILE_BATCH_SIZE,
            now=current,
        )
        await _refresh_tile_rebuild_job(session, job_id)
        return [], True
    if job.status not in {"queued", "running"}:
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
        outcome = await _submit_claimed_rebuild(dispatch, submit)
        if outcome == "submitted":
            submitted += 1
        elif outcome == "released":
            released += 1

    return PumpResult(
        claimed=len(dispatches),
        submitted=submitted,
        released=released,
    )


async def _submit_claimed_rebuild(
    dispatch: TileRebuildDispatch,
    submit: Callable[[TileRebuildDispatch], Awaitable[bool]],
) -> Literal["duplicate", "released", "submitted"]:
    async with get_async_session()() as session:
        try:
            job = await _lock_tile_rebuild_job(session, dispatch.job_id)
        except ValueError:
            await session.rollback()
            return "duplicate"
        result = await session.execute(
            select(JobItem)
            .where(
                JobItem.id == dispatch.item_id,
                JobItem.job_id == dispatch.job_id,
                JobItem.status == "running",
                JobItem.claim_token == dispatch.claim_token,
                JobItem.started_at.is_(None),
            )
            .with_for_update()
        )
        item = result.scalar_one_or_none()
        if item is None:
            await session.rollback()
            return "duplicate"

        if job.status in {"queued", "running"}:
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
                dispatch_error = TileRebuildDispatchError()
                queued = False
            else:
                dispatch_error = TileRebuildDispatchError()
            if queued:
                await session.commit()
                return "submitted"
        elif job.status != "cancelling":
            await session.rollback()
            return "duplicate"
        else:
            dispatch_error = TileRebuildDispatchError()

        _release_rebuild_attempt(
            job,
            item,
            retryable=True,
            error_message=rebuild_error_summary(dispatch_error),
            now=datetime.now(timezone.utc),
        )
        await _refresh_tile_rebuild_job(session, dispatch.job_id)
        await session.commit()
        return "released"


async def _reserve_rebuild_source(
    job_id: int,
    item_id: int,
    claim_token: str,
) -> ReservedRebuild:
    async with get_async_session()() as session:
        job = await _lock_tile_rebuild_job(session, job_id)
        if job.status == "cancelling":
            finalized = await finalize_job_item(
                session,
                item_id,
                claim_token,
                "cancelled",
            )
            if finalized:
                await _refresh_tile_rebuild_job(session, job_id)
            await session.commit()
            return ReservedRebuild(outcome="cancelled")
        if job.status not in {"queued", "running"}:
            await session.rollback()
            return ReservedRebuild(outcome="duplicate")

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
        if (
            item is None
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
            processing = _load_processing()
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
    exc: BaseException,
) -> None:
    async with get_async_session()() as session:
        job = await _lock_tile_rebuild_job(session, job_id)
        result = await session.execute(
            select(JobItem)
            .where(
                JobItem.id == item_id,
                JobItem.job_id == job_id,
                JobItem.status == "running",
                JobItem.claim_token == claim_token,
            )
            .with_for_update()
        )
        item = result.scalar_one_or_none()
        if item is None:
            await session.rollback()
            return
        _release_rebuild_attempt(
            job,
            item,
            retryable=is_transient_rebuild_error(exc),
            error_message=rebuild_error_summary(exc),
            now=datetime.now(timezone.utc),
        )
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
            raise TileRebuildLeaseLostError(
                f"Tile rebuild item {item_id} lost claim {claim_token}"
            )


async def _process_reserved_tile_rebuild(
    job_id: int,
    item_id: int,
    claim_token: str,
    processing: _ProcessingModule,
    source_image_id: int,
    image_id: int | None,
    stored_path: str,
) -> TileRebuildResult:
    """Process an already-reserved durable tile rebuild child."""
    source = processing.TileRebuildSource(
        source_image_id=source_image_id,
        image_id=image_id,
        stored_path=stored_path,
    )
    prepared = None
    promoted = None
    committed = False
    try:
        preparation_task = asyncio.create_task(
            processing.prepare_source_image_tile_rebuild(source)
        )
        try:
            prepared = await asyncio.shield(preparation_task)
        except asyncio.CancelledError:
            preparation_task.cancel()
            await asyncio.gather(preparation_task, return_exceptions=True)
            raise
        async with get_async_session()() as session:
            job = await _lock_tile_rebuild_job(session, job_id)
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

            if job.status == "cancelling":
                finalized = await finalize_job_item(
                    session,
                    item_id,
                    claim_token,
                    "cancelled",
                )
                if finalized:
                    await _refresh_tile_rebuild_job(session, job_id)
                await session.commit()
                await processing.discard_prepared_tile_rebuild(prepared)
                return "cancelled"
            if job.status not in {"queued", "running"}:
                await session.rollback()
                await processing.discard_prepared_tile_rebuild(prepared)
                return "duplicate"

            source_image = await session.get(SourceImage, source_image_id)
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
                exc,
            )
        raise


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

    processing = _load_processing()
    heartbeat_task = asyncio.create_task(
        _heartbeat_rebuild_item(
            item_id,
            claim_token,
            reservation.heartbeat_seconds,
            reservation.lease_seconds,
        )
    )
    operation_task = asyncio.create_task(
        _process_reserved_tile_rebuild(
            job_id,
            item_id,
            claim_token,
            processing,
            reservation.source_image_id,
            reservation.image_id,
            reservation.stored_path,
        )
    )
    try:
        done, _pending = await asyncio.wait(
            [operation_task, heartbeat_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        if operation_task in done:
            heartbeat_task.cancel()
            await asyncio.gather(heartbeat_task, return_exceptions=True)
            return operation_task.result()

        heartbeat_error = (
            None
            if heartbeat_task.cancelled()
            else heartbeat_task.exception()
        )
        operation_task.cancel()
        await asyncio.gather(operation_task, return_exceptions=True)
        if heartbeat_error is not None:
            raise heartbeat_error
        raise TileRebuildLeaseLostError(
            f"Tile rebuild item {item_id} heartbeat stopped"
        )
    finally:
        heartbeat_task.cancel()
        operation_task.cancel()
        await asyncio.gather(
            heartbeat_task,
            operation_task,
            return_exceptions=True,
        )


async def active_tile_rebuild_job_ids(
    *,
    limit: int = REBUILD_RECONCILE_BATCH_SIZE,
) -> list[int]:
    """Return durable rebuild jobs that may need pumping."""
    if limit <= 0:
        return []
    async with get_async_session()() as session:
        result = await session.execute(
            select(Job.id)
            .where(
                Job.job_type == REBUILD_JOB_TYPE,
                Job.status.in_(ACTIVE_JOB_STATUSES),
            )
            .order_by(Job.id)
            .limit(limit)
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
