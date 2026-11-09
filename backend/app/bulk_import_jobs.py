"""Durable Job/JobItem state for resumable bulk imports (#1173).

A ``BulkImportJob`` row is the user-facing domain record; the generic
``Job``/``JobItem`` pair is its durable execution supervisor. At creation
time the POST endpoint snapshots one ``JobItem`` per staged file inside the
same transaction, so an API restart, crash, rolling deploy, or OOM kill can
never lose the work list: any API replica's coordinator sweep can re-claim
the supervisor lease and pick up exactly where the previous coordinator
stopped.

Coordinator ownership uses the same claim contract as ``JobItem`` rows but
on the supervisor: a CAS-guarded ``coordinator_token`` + heartbeat + lease
on ``jobs`` means at most one coordinator runs per import, takeover happens
only after lease expiry, and item finalization is token-guarded so a stale
coordinator can never double-count a file.

PostgreSQL is authoritative throughout; Redis/arq only schedules the
per-file ``process_source_image`` children (with deterministic job IDs so a
resumed dispatch deduplicates against a still-queued arq entry).
"""

import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Literal

from sqlalchemy import case, cast, func, or_, select, update
from sqlalchemy.dialects.postgresql import JSONB as JSONB_type
from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_async_session, settings
from .job_state import (
    JobItemSpec,
    add_job_item_snapshot,
    aggregate_job_items,
    derive_supervisor_status,
    finalize_job_item,
    refresh_job_aggregate,
)
from .models import BulkImportJob, Job, JobItem

logger = logging.getLogger(__name__)

BULK_IMPORT_JOB_TYPE = "bulk_import"
BULK_IMPORT_RESOURCE_TYPE = "bulk_import_file"

_TERMINAL_SUPERVISOR_STATUSES = frozenset(
    {"completed", "completed_with_errors", "failed", "cancelled"}
)
_ACTIVE_BULK_STATUSES = ("pending", "processing")
_ACTIVE_SUPERVISOR_STATUSES = ("queued", "running")


class BulkImportCoordinatorClaimLostError(RuntimeError):
    """Raised when a coordinator discovers its lease was superseded."""


def bulk_import_resource_id(stored_path: str) -> str:
    """Stable, fixed-length ``JobItem.resource_id`` for a staged file.

    ``stored_path`` itself can exceed ``job_items.resource_id``'s 255-char
    limit on deeply nested volume mounts, so items key on its SHA-256; the
    readable path stays in ``JobItem.metadata_['stored_path']``.
    """
    return hashlib.sha256(stored_path.encode("utf-8")).hexdigest()


def bulk_import_source_arq_job_id(source_image_id: int) -> str:
    """Deterministic arq job ID for one source image's processing run.

    arq enqueues return ``None`` when the ID already exists, which makes a
    resumed dispatch idempotent: a still-queued (or result-retained)
    processing job is observed rather than duplicated.
    """
    return f"process-source-image:{source_image_id}"


def _metadata_int(metadata: dict | None, key: str, default: int) -> int:
    value = (metadata or {}).get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return default
    return value


def coordinator_claims(metadata: dict | None) -> int:
    """How many coordinator leases this supervisor has already consumed."""
    value = (metadata or {}).get("coordinator_claims")
    return value if isinstance(value, int) and value >= 0 else 0


async def create_bulk_import_job(
    session: AsyncSession,
    *,
    bulk_import_job: BulkImportJob,
    file_entries: list[tuple[str, str]],
    copyright: str | None,
    note: str | None,
    active: bool,
    parallelism: int,
) -> Job:
    """Snapshot the durable supervisor + per-file items for a new import.

    Runs inside the caller's transaction (the same one that inserts the
    ``BulkImportJob`` row) so the domain record, supervisor, and item
    snapshot commit or roll back atomically. Does not commit.
    """
    now = datetime.now(timezone.utc)
    metadata = {
        "bulk_import_job_id": bulk_import_job.id,
        "copyright": copyright,
        "note": note,
        "active": active,
        "parallelism": parallelism,
        "coordinator_lease_seconds": (
            settings.bulk_import_coordinator_lease_seconds
        ),
        "coordinator_heartbeat_seconds": (
            settings.bulk_import_coordinator_heartbeat_seconds
        ),
        "item_lease_seconds": settings.bulk_import_item_lease_seconds,
        "max_coordinator_claims": settings.bulk_import_max_coordinator_claims,
        "max_item_attempts": settings.bulk_import_max_item_attempts,
        "coordinator_claims": 0,
    }
    job = Job(
        job_type=BULK_IMPORT_JOB_TYPE,
        status="queued",
        metadata_=metadata,
        requested_by=bulk_import_job.requested_by,
    )
    session.add(job)
    await session.flush()
    add_job_item_snapshot(
        session,
        job,
        [
            JobItemSpec(
                resource_type=BULK_IMPORT_RESOURCE_TYPE,
                resource_id=bulk_import_resource_id(stored_path),
                metadata={
                    "original_filename": original_filename,
                    "stored_path": stored_path,
                },
            )
            for original_filename, stored_path in file_entries
        ],
    )
    job.status = "running"
    job.started_at = now
    bulk_import_job.job_id = job.id
    await session.flush()
    return job


async def load_bulk_import_supervisor(
    session: AsyncSession,
    bulk_import_job_id: int,
) -> tuple[BulkImportJob, Job] | None:
    """Return ``(BulkImportJob, Job)`` for a durable import, or ``None``.

    ``None`` covers missing rows, legacy imports without a durable link, and
    supervisors of the wrong type — all cases the caller treats as
    "nothing durable to coordinate".
    """
    bulk_job = await session.get(BulkImportJob, bulk_import_job_id)
    if bulk_job is None or bulk_job.job_id is None:
        return None
    job = await session.get(Job, bulk_job.job_id)
    if job is None or job.job_type != BULK_IMPORT_JOB_TYPE:
        return None
    return bulk_job, job


async def list_active_bulk_import_supervisors(
    session: AsyncSession,
) -> list[dict[str, object]]:
    """Active durable imports joined with their supervisor lease state.

    Drives the API-side coordinator sweep. Each row carries everything the
    sweep needs to decide between "nudge a coordinator" (lease free),
    "already coordinated" (lease held), and "close out a stranded domain
    row" (supervisor already terminal).
    """
    result = await session.execute(
        select(
            BulkImportJob.id,
            BulkImportJob.job_id,
            Job.status,
            Job.coordinator_lease_expires_at,
        )
        .join(Job, Job.id == BulkImportJob.job_id)
        .where(
            BulkImportJob.status.in_(_ACTIVE_BULK_STATUSES),
            Job.job_type == BULK_IMPORT_JOB_TYPE,
        )
        .order_by(BulkImportJob.id)
    )
    now = datetime.now(timezone.utc)
    rows: list[dict[str, object]] = []
    for bulk_id, job_id, supervisor_status, lease_expires_at in result.all():
        lease_free = (
            lease_expires_at is None or lease_expires_at <= now
        )
        rows.append(
            {
                "bulk_import_job_id": bulk_id,
                "job_id": job_id,
                "supervisor_status": supervisor_status,
                "lease_free": lease_free,
            }
        )
    return rows


async def try_claim_bulk_import_coordinator(
    session: AsyncSession,
    job_id: int,
    *,
    token: str,
    lease_seconds: int,
    now: datetime | None = None,
) -> bool:
    """CAS-claim the supervisor coordinator lease; ``True`` iff we won.

    The claim succeeds only while the job is active and its lease is absent
    or expired, so at most one coordinator runs per import across replicas.
    """
    now = now or datetime.now(timezone.utc)
    result = await session.execute(
        update(Job)
        .where(
            Job.id == job_id,
            Job.job_type == BULK_IMPORT_JOB_TYPE,
            Job.status.in_(_ACTIVE_SUPERVISOR_STATUSES),
            or_(
                Job.coordinator_lease_expires_at.is_(None),
                Job.coordinator_lease_expires_at <= now,
            ),
        )
        .values(
            coordinator_token=token,
            coordinator_heartbeat_at=now,
            coordinator_lease_expires_at=now + timedelta(seconds=lease_seconds),
            updated_at=now,
        )
    )
    return result.rowcount == 1


async def heartbeat_bulk_import_coordinator(
    session: AsyncSession,
    job_id: int,
    token: str,
    lease_seconds: int,
    *,
    now: datetime | None = None,
) -> bool:
    """Extend the coordinator lease while ``token`` still owns it."""
    now = now or datetime.now(timezone.utc)
    result = await session.execute(
        update(Job)
        .where(
            Job.id == job_id,
            Job.job_type == BULK_IMPORT_JOB_TYPE,
            Job.coordinator_token == token,
            Job.status.in_(_ACTIVE_SUPERVISOR_STATUSES),
        )
        .values(
            coordinator_heartbeat_at=now,
            coordinator_lease_expires_at=now + timedelta(seconds=lease_seconds),
            updated_at=now,
        )
    )
    return result.rowcount == 1


async def release_bulk_import_coordinator(
    session: AsyncSession,
    job_id: int,
    token: str,
    *,
    now: datetime | None = None,
) -> None:
    """Drop the coordinator lease on clean exit so a peer can take over."""
    now = now or datetime.now(timezone.utc)
    await session.execute(
        update(Job)
        .where(
            Job.id == job_id,
            Job.coordinator_token == token,
        )
        .values(
            coordinator_token=None,
            coordinator_heartbeat_at=None,
            coordinator_lease_expires_at=None,
            updated_at=now,
        )
    )


async def increment_coordinator_claims(
    session: AsyncSession,
    job_id: int,
) -> int:
    """Bump ``metadata_.coordinator_claims`` and return the new value.

    Called in the same transaction as a won claim so the crash-loop cap is
    counted exactly once per coordinator start. Safe without extra locking:
    the CAS claim guarantees a single winner per lease period.
    """
    job = await session.get(Job, job_id)
    if job is None:
        raise ValueError(f"Job {job_id} does not exist")
    metadata = dict(job.metadata_ or {})
    claims = coordinator_claims(metadata) + 1
    metadata["coordinator_claims"] = claims
    job.metadata_ = metadata
    await session.flush()
    return claims


async def requeue_orphaned_bulk_import_items(
    session: AsyncSession,
    job_id: int,
    *,
    now: datetime | None = None,
) -> int:
    """Return every ``running`` item to ``queued`` on coordinator takeover.

    Called once, immediately after winning the supervisor lease: lease expiry
    proves the previous coordinator is gone, so *all* of its in-flight items
    are orphans — not just lease-expired ones (their heartbeats stopped with
    the process). Item claim tokens are cleared, which also invalidates any
    late finalize from a falsely-expired predecessor; per-file side effects
    stay idempotent through the ``SourceImage`` get-or-create path.
    """
    now = now or datetime.now(timezone.utc)
    result = await session.execute(
        update(JobItem)
        .where(
            JobItem.job_id == job_id,
            JobItem.status == "running",
        )
        .values(
            status="queued",
            claim_token=None,
            heartbeat_at=None,
            lease_expires_at=None,
            retry_not_before=None,
            arq_job_id=None,
            started_at=None,
            completed_at=None,
            updated_at=now,
        )
    )
    return result.rowcount


async def _record_bulk_import_failure(
    session: AsyncSession,
    bulk_import_job_id: int,
    filename: str,
    error_message: str | None,
) -> None:
    """Append one per-file failure to the ``BulkImportJob`` ledger."""
    error_entry = [
        {
            "filename": filename,
            "error": error_message or "Processing failed",
        }
    ]
    await session.execute(
        update(BulkImportJob)
        .where(BulkImportJob.id == bulk_import_job_id)
        .values(
            failed_count=BulkImportJob.failed_count + 1,
            errors=func.coalesce(BulkImportJob.errors, cast([], JSONB_type))
            + cast(error_entry, JSONB_type),
        )
    )


async def _bulk_import_counters(
    session: AsyncSession,
    bulk_import_job_id: int,
) -> tuple[int, int]:
    """Fresh ``(completed_count, failed_count)`` straight from the row."""
    result = await session.execute(
        select(
            BulkImportJob.completed_count,
            BulkImportJob.failed_count,
        ).where(BulkImportJob.id == bulk_import_job_id)
    )
    row = result.one_or_none()
    if row is None:
        return 0, 0
    return int(row[0]), int(row[1])


async def reclaim_expired_bulk_import_items(
    session: AsyncSession,
    job_id: int,
    bulk_import_job_id: int,
    *,
    max_attempts: int,
    limit: int = 100,
    now: datetime | None = None,
) -> tuple[int, int]:
    """Recover items whose claim lease expired under the live coordinator.

    Returns ``(requeued, exhausted)``. Items below ``max_attempts`` return to
    ``queued`` for another claim; exhausted items finalize ``failed`` — with
    the same ``BulkImportJob`` counter/error accounting a normal finalize
    would produce — so a crash-looping file cannot stall the import forever.
    The caller owns the transaction boundary.
    """
    now = now or datetime.now(timezone.utc)
    result = await session.execute(
        select(JobItem)
        .where(
            JobItem.job_id == job_id,
            JobItem.status == "running",
            JobItem.lease_expires_at.is_not(None),
            JobItem.lease_expires_at <= now,
        )
        .order_by(JobItem.id)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    items = list(result.scalars().all())
    requeued = 0
    exhausted = 0
    for item in items:
        item.claim_token = None
        item.heartbeat_at = None
        item.lease_expires_at = None
        item.retry_not_before = None
        item.arq_job_id = None
        item.started_at = None
        item.completed_at = None
        item.updated_at = now
        if item.attempts < max_attempts:
            item.status = "queued"
            requeued += 1
        else:
            item.status = "failed"
            error_message = (
                "Processing attempt lease expired repeatedly; the item was "
                "abandoned after exhausting retries."
            )
            item.error_message = error_message
            item.progress = 0
            filename = str(
                (item.metadata_ or {}).get("original_filename") or "unknown"
            )
            await _record_bulk_import_failure(
                session,
                bulk_import_job_id,
                filename,
                error_message,
            )
            exhausted += 1
    if items:
        await session.flush()
    if requeued or exhausted:
        logger.warning(
            "Reclaimed expired bulk-import items",
            extra={
                "event": "bulk_import.items_reclaimed",
                "job_id": job_id,
                "bulk_import_job_id": bulk_import_job_id,
                "requeued": requeued,
                "exhausted": exhausted,
            },
        )
    return requeued, exhausted


async def finalize_bulk_import_item(
    *,
    job_id: int,
    item_id: int,
    claim_token: str,
    bulk_import_job_id: int,
    filename: str,
    terminal_status: Literal["completed", "failed"],
    error_message: str | None = None,
) -> bool:
    """Finalize one item and fold its outcome into both aggregate records.

    Self-contained: token-guarded ``finalize_job_item``, the
    ``BulkImportJob`` counter/error append, the supervisor aggregate refresh
    + derived status, and — once every item is terminal — the
    ``BulkImportJob`` terminal transition all commit in one transaction.
    Exactly-once: only the current claim token's finalize wins, so
    overlapping coordinators cannot double-count a file. Returns ``False``
    when the claim was superseded.
    """
    async with get_async_session()() as session:
        won = await finalize_job_item(
            session,
            item_id,
            claim_token,
            terminal_status,
            error_message=error_message,
        )
        if not won:
            await session.rollback()
            return False

        if terminal_status == "completed":
            await session.execute(
                update(BulkImportJob)
                .where(BulkImportJob.id == bulk_import_job_id)
                .values(completed_count=BulkImportJob.completed_count + 1)
            )
        else:
            await _record_bulk_import_failure(
                session,
                bulk_import_job_id,
                filename,
                error_message,
            )

        # Once every item is terminal the import itself is done; the
        # BulkImportJob terminal rule matches the legacy coordinator: any
        # completed file makes the batch a (partial) success. This write
        # stays ahead of the ``jobs`` row lock taken by
        # ``refresh_bulk_import_supervisor`` so lock ordering matches
        # ``finalize_bulk_import_supervisor`` (bulk before jobs).
        counts = await aggregate_job_items(session, job_id)
        if counts["queued"] == 0 and counts["running"] == 0:
            completed_count, failed_count = await _bulk_import_counters(
                session, bulk_import_job_id
            )
            bulk_job = await session.get(
                BulkImportJob, bulk_import_job_id, populate_existing=True
            )
            if bulk_job is not None and bulk_job.status in _ACTIVE_BULK_STATUSES:
                bulk_job.status = (
                    "failed" if failed_count > 0 and completed_count == 0
                    else "completed"
                )
                bulk_job.updated_at = datetime.now(timezone.utc)

        await refresh_bulk_import_supervisor(session, job_id)
        await session.commit()
        return True


async def refresh_bulk_import_supervisor(
    session: AsyncSession,
    job_id: int,
) -> dict[str, int]:
    """Re-aggregate items onto the supervisor and derive its status.

    Returns the item status counts. When the derived status is terminal the
    supervisor's progress/completion fields are stamped. The caller owns the
    transaction boundary.
    """
    counts = await refresh_job_aggregate(session, job_id)
    job = await session.get(Job, job_id, populate_existing=True)
    if job is None:
        raise ValueError(f"Bulk-import job {job_id} does not exist")
    now = datetime.now(timezone.utc)
    status = derive_supervisor_status(job.status, counts)
    previous = job.status
    job.status = status
    if status in _TERMINAL_SUPERVISOR_STATUSES:
        job.progress = 100
        if job.completed_at is None:
            job.completed_at = now
    else:
        job.completed_at = None
    if status != previous:
        logger.info(
            "Bulk-import supervisor status changed",
            extra={
                "event": "bulk_import.supervisor_status",
                "job_id": job_id,
                "status": status,
                "previous_status": previous,
            },
        )
    await session.flush()
    return counts


async def finalize_bulk_import_supervisor(
    *,
    job_id: int,
    bulk_import_job_id: int,
) -> dict[str, int]:
    """Coordinator final pass: aggregate, derive, and close the import.

    Self-contained and idempotent — safe to call after the last item
    finalize already did the same work, and safe when a coordinator exits
    early because the ``BulkImportJob`` is already terminal.

    Lock ordering note: the ``BulkImportJob`` write happens *before*
    ``refresh_job_aggregate`` takes ``SELECT ... FOR UPDATE`` on the
    ``jobs`` row, matching ``finalize_bulk_import_item``'s
    items → bulk → jobs order so the two paths cannot deadlock.
    """
    async with get_async_session()() as session:
        counts = await aggregate_job_items(session, job_id)
        if counts["queued"] == 0 and counts["running"] == 0:
            bulk_job = await session.get(
                BulkImportJob, bulk_import_job_id, populate_existing=True
            )
            if bulk_job is not None and bulk_job.status in _ACTIVE_BULK_STATUSES:
                bulk_job.status = (
                    "failed"
                    if bulk_job.failed_count > 0 and bulk_job.completed_count == 0
                    else "completed"
                )
                bulk_job.updated_at = datetime.now(timezone.utc)
        await refresh_bulk_import_supervisor(session, job_id)
        await session.commit()
        return counts


async def finalize_bulk_import_abandoned(
    *,
    bulk_import_job_id: int,
    job_id: int,
    abandonment_note: str,
) -> None:
    """Terminally fail a crash-looping durable import (claim cap hit).

    Cancels every non-terminal item so the supervisor's item-derived
    accounting stays coherent, marks the ``Job`` failed, and applies the
    same ``BulkImportJob`` finalization rule the legacy abandonment path
    uses. Self-contained; commits.
    """
    now = datetime.now(timezone.utc)
    async with get_async_session()() as session:
        await session.execute(
            update(JobItem)
            .where(
                JobItem.job_id == job_id,
                JobItem.status.in_(("queued", "running")),
            )
            .values(
                status="cancelled",
                claim_token=None,
                heartbeat_at=None,
                lease_expires_at=None,
                retry_not_before=None,
                arq_job_id=None,
                started_at=None,
                completed_at=now,
                updated_at=now,
            )
        )
        await session.execute(
            update(BulkImportJob)
            .where(
                BulkImportJob.id == bulk_import_job_id,
                BulkImportJob.status.in_(_ACTIVE_BULK_STATUSES),
            )
            .values(
                # Match the coordinator finalizer: any completed image
                # counts as partial success, so "failed" means nothing
                # was imported.
                status=case(
                    (BulkImportJob.completed_count > 0, "completed"),
                    else_="failed",
                ),
                failed_count=BulkImportJob.total_count
                - BulkImportJob.completed_count,
                errors=func.coalesce(BulkImportJob.errors, cast([], JSONB_type))
                + cast([{"error": abandonment_note}], JSONB_type),
                updated_at=now,
            )
        )
        job = await session.get(Job, job_id, populate_existing=True)
        if job is not None:
            job.status = "failed"
            job.progress = 100
            job.error_message = abandonment_note
            job.completed_at = now
            job.coordinator_token = None
            job.coordinator_heartbeat_at = None
            job.coordinator_lease_expires_at = None
            job.updated_at = now
        await session.commit()
    logger.warning(
        "Bulk-import job abandoned after coordinator claim cap",
        extra={
            "event": "bulk_import.claim_cap_exceeded",
            "job_id": job_id,
            "bulk_import_job_id": bulk_import_job_id,
        },
    )


__all__ = [
    "BULK_IMPORT_JOB_TYPE",
    "BULK_IMPORT_RESOURCE_TYPE",
    "BulkImportCoordinatorClaimLostError",
    "bulk_import_resource_id",
    "bulk_import_source_arq_job_id",
    "coordinator_claims",
    "create_bulk_import_job",
    "finalize_bulk_import_abandoned",
    "finalize_bulk_import_item",
    "finalize_bulk_import_supervisor",
    "heartbeat_bulk_import_coordinator",
    "increment_coordinator_claims",
    "list_active_bulk_import_supervisors",
    "load_bulk_import_supervisor",
    "reclaim_expired_bulk_import_items",
    "requeue_orphaned_bulk_import_items",
    "release_bulk_import_coordinator",
    "refresh_bulk_import_supervisor",
    "try_claim_bulk_import_coordinator",
]
