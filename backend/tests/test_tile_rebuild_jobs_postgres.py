import asyncio
import errno
import os
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.admin_ops import (
    _run_rebuild_with_heartbeat,
    reconcile_stale_tasks,
)
from app.job_state import (
    claim_job_items,
    finalize_job_item,
    reclaim_expired_job_items,
    reserve_job_item_execution,
)
from app.models import AdminTask, Job, JobItem
from app.routers.jobs import cancel_rebuild_job, list_job_items
from app.rebuild_locks import (
    acquire_rebuild_creation_lock,
    find_active_rebuild,
    try_acquire_rebuild_pump_lock,
)
from app.tile_rebuild_jobs import (
    TileRebuildStateError,
    _finalize_rebuild_failure,
    _submit_claimed_rebuild,
    claim_tile_rebuild_window,
    request_job_cancellation,
    retry_failed_job_items,
)

DB_URL = os.environ.get("REORDER_FIXTURE_DATABASE_URL", "")

requires_db = pytest.mark.skipif(
    not DB_URL,
    reason="REORDER_FIXTURE_DATABASE_URL not set (needs PostgreSQL)",
)


@pytest.fixture
async def db_factory():
    engine = create_async_engine(DB_URL)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield factory
    async with factory() as session:
        await session.execute(
            delete(AdminTask).where(
                AdminTask.task_type == "rebuild_tiles",
                AdminTask.log == "wave-1-postgres-test",
            )
        )
        job_ids = (
            await session.execute(
                select(Job.id).where(
                    Job.job_type == "rebuild_tiles",
                    Job.error_message == "wave-1-postgres-test",
                )
            )
        ).scalars().all()
        if job_ids:
            await session.execute(
                delete(JobItem).where(JobItem.job_id.in_(job_ids))
            )
            await session.execute(delete(Job).where(Job.id.in_(job_ids)))
        await session.commit()
    await engine.dispose()


async def _create_job(
    factory: async_sessionmaker,
    *,
    status: str = "running",
    item_count: int = 0,
) -> int:
    async with factory() as session:
        job = Job(
            job_type="rebuild_tiles",
            status=status,
            error_message="wave-1-postgres-test",
            metadata_={
                "parallelism": 2,
                "lease_seconds": 90,
                "max_attempts": 2,
                "retry_backoff_base_seconds": 60,
                "retry_backoff_cap_seconds": 900,
            },
        )
        session.add(job)
        await session.flush()
        session.add_all(
            [
                JobItem(
                    job_id=job.id,
                    resource_type="source_image",
                    resource_id=str(index),
                )
                for index in range(item_count)
            ]
        )
        await session.commit()
        return job.id


@requires_db
async def test_active_rebuild_partial_unique_index(db_factory) -> None:
    first_id = await _create_job(db_factory)
    async with db_factory() as session:
        session.add(
            Job(
                job_type="rebuild_tiles",
                status="queued",
                error_message="wave-1-postgres-test",
            )
        )
        with pytest.raises(IntegrityError):
            await session.flush()
        await session.rollback()

    async with db_factory() as session:
        first = await session.get(Job, first_id)
        first.status = "completed"
        await session.commit()
    await _create_job(db_factory, status="running")


@requires_db
async def test_pump_advisory_lock_is_nonblocking(db_factory) -> None:
    async with db_factory() as first, db_factory() as second:
        assert await try_acquire_rebuild_pump_lock(first, 7654321)
        assert not await try_acquire_rebuild_pump_lock(second, 7654321)
        await first.commit()
        assert await try_acquire_rebuild_pump_lock(second, 7654321)
        await second.rollback()


@requires_db
async def test_creation_lock_serializes_serial_and_durable_rebuilds(
    db_factory,
) -> None:
    async with db_factory() as first, db_factory() as second:
        await acquire_rebuild_creation_lock(first)
        serial = AdminTask(
            task_type="rebuild_tiles",
            status="running",
            log="wave-1-postgres-test",
        )
        first.add(serial)
        await first.flush()

        blocked = asyncio.create_task(acquire_rebuild_creation_lock(second))
        await asyncio.sleep(0.05)
        assert not blocked.done()
        await first.commit()
        await asyncio.wait_for(blocked, timeout=1)
        active = await find_active_rebuild(second)
        assert active is not None
        assert active.kind == "task"
        assert active.id == serial.id
        await second.rollback()


@requires_db
async def test_serial_rebuild_heartbeat_prevents_stale_overlap(
    db_factory,
    monkeypatch,
) -> None:
    async with db_factory() as session:
        serial = AdminTask(
            task_type="rebuild_tiles",
            status="running",
            log="wave-1-postgres-test",
            updated_at=datetime.now(timezone.utc) - timedelta(seconds=5),
        )
        session.add(serial)
        await session.commit()
        task_id = serial.id

    work_started = asyncio.Event()
    work_release = asyncio.Event()

    async def long_image_rebuild() -> None:
        work_started.set()
        await work_release.wait()

    monkeypatch.setattr(
        "app.admin_ops.get_async_session",
        lambda: db_factory,
    )
    monkeypatch.setattr(
        "app.admin_ops._REBUILD_HEARTBEAT_INTERVAL_SECONDS",
        0.01,
    )
    runner = asyncio.create_task(
        _run_rebuild_with_heartbeat(task_id, long_image_rebuild())
    )
    await work_started.wait()
    await asyncio.sleep(0.05)

    async with db_factory() as session:
        assert await reconcile_stale_tasks(session, stale_after_seconds=1) == 0
        active = await find_active_rebuild(session)
        assert active is not None
        assert active.kind == "task"
        assert active.id == task_id

    work_release.set()
    assert await runner is None


@requires_db
async def test_skip_locked_claims_are_disjoint(db_factory) -> None:
    job_id = await _create_job(db_factory, item_count=4)
    async with db_factory() as first, db_factory() as second:
        first_claims = await claim_job_items(first, job_id, 2, 90)
        second_claims = await claim_job_items(second, job_id, 2, 90)

        assert len(first_claims) == 2
        assert len(second_claims) == 2
        assert {item.id for item in first_claims}.isdisjoint(
            item.id for item in second_claims
        )
        await first.rollback()
        await second.rollback()


@requires_db
async def test_concurrent_pumps_claim_one_bounded_window(db_factory) -> None:
    job_id = await _create_job(db_factory, item_count=4)
    async with db_factory() as first, db_factory() as second:
        results = await asyncio.gather(
            claim_tile_rebuild_window(first, job_id),
            claim_tile_rebuild_window(second, job_id),
        )

        acquired = [result[1] for result in results]
        dispatches = [item for result in results for item in result[0]]
        assert acquired.count(True) == 1
        assert acquired.count(False) == 1
        assert len(dispatches) == 2
        await first.rollback()
        await second.rollback()


@requires_db
async def test_committed_unsubmitted_claim_is_reclaimed_with_new_id(
    db_factory,
) -> None:
    job_id = await _create_job(db_factory, item_count=1)
    async with db_factory() as session:
        first, acquired = await claim_tile_rebuild_window(session, job_id)
        assert acquired
        await session.commit()
    assert first[0].arq_job_id.endswith(":1")

    async with db_factory() as session:
        item = await session.get(JobItem, first[0].item_id)
        item.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.commit()

    async with db_factory() as session:
        delayed, acquired = await claim_tile_rebuild_window(session, job_id)
        assert acquired
        await session.commit()
    assert delayed == []

    async with db_factory() as session:
        item = await session.get(JobItem, first[0].item_id)
        assert item.status == "queued"
        assert item.retry_not_before is not None
        item.retry_not_before = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.commit()

    async with db_factory() as session:
        second, acquired = await claim_tile_rebuild_window(session, job_id)
        assert acquired
        await session.commit()
    assert second[0].arq_job_id.endswith(":2")
    assert second[0].arq_job_id != first[0].arq_job_id


@requires_db
async def test_reservation_cas_and_reclaim_clear_execution_start(
    db_factory,
) -> None:
    job_id = await _create_job(db_factory, item_count=1)
    async with db_factory() as session:
        claimed = await claim_job_items(session, job_id, 1, 90)
        item_id = claimed[0].id
        claim_token = claimed[0].claim_token
        assert claimed[0].started_at is None
        await session.commit()

    assert claim_token is not None
    async with db_factory() as first:
        assert await reserve_job_item_execution(
            first,
            job_id,
            item_id,
            claim_token,
        )
        await first.commit()
    async with db_factory() as duplicate:
        assert not await reserve_job_item_execution(
            duplicate,
            job_id,
            item_id,
            claim_token,
        )
        await duplicate.rollback()

    async with db_factory() as session:
        item = await session.get(JobItem, item_id)
        item.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.commit()
    async with db_factory() as session:
        assert await reclaim_expired_job_items(
            session,
            job_id=job_id,
        ) == 1
        await session.commit()
    async with db_factory() as session:
        item = await session.get(JobItem, item_id)
        assert item.status == "queued"
        assert item.claim_token is None
        assert item.started_at is None


@requires_db
async def test_cancellation_preserves_started_completion_and_drains_pending(
    db_factory,
) -> None:
    job_id = await _create_job(db_factory, item_count=3)
    async with db_factory() as session:
        claims = await claim_job_items(session, job_id, 2, 90)
        started = claims[0]
        unstarted = claims[1]
        assert started.claim_token is not None
        assert await reserve_job_item_execution(
            session,
            job_id,
            started.id,
            started.claim_token,
        )
        await session.commit()

    async with db_factory() as session:
        assert await request_job_cancellation(session, job_id) == 2
        await session.commit()

    async with db_factory() as session:
        job = await session.get(Job, job_id)
        items = (
            await session.execute(
                select(JobItem)
                .where(JobItem.job_id == job_id)
                .order_by(JobItem.id)
            )
        ).scalars().all()
        assert job.status == "cancelling"
        assert items[0].status == "running"
        assert items[1].id == unstarted.id
        assert items[1].status == "cancelled"
        assert items[2].status == "cancelled"

    async with db_factory() as session:
        assert await finalize_job_item(
            session,
            started.id,
            started.claim_token,
            "completed",
        )
        assert await request_job_cancellation(session, job_id) == 0
        await session.commit()

    async with db_factory() as session:
        job = await session.get(Job, job_id)
        completed = await session.get(JobItem, started.id)
        assert job.status == "cancelled"
        assert job.progress == 100
        assert job.completed_count == 1
        assert job.cancelled_count == 2
        assert completed.status == "completed"


@requires_db
async def test_cancellation_serializes_with_claiming(db_factory) -> None:
    job_id = await _create_job(db_factory, status="queued", item_count=1)
    async with db_factory() as cancelling, db_factory() as claiming:
        assert await request_job_cancellation(cancelling, job_id) == 1
        blocked_claim = asyncio.create_task(
            claim_tile_rebuild_window(claiming, job_id)
        )
        await asyncio.sleep(0.05)
        assert not blocked_claim.done()

        await cancelling.commit()
        dispatches, acquired = await asyncio.wait_for(
            blocked_claim,
            timeout=1,
        )
        assert acquired
        assert dispatches == []
        await claiming.commit()

    async with db_factory() as session:
        job = await session.get(Job, job_id)
        item = (
            await session.execute(
                select(JobItem).where(JobItem.job_id == job_id)
            )
        ).scalar_one()
        assert job.status == "cancelled"
        assert item.status == "cancelled"
        assert item.attempts == 0


@requires_db
async def test_expired_lease_retries_then_fails_after_exhaustion(
    db_factory,
) -> None:
    job_id = await _create_job(db_factory, item_count=1)
    async with db_factory() as session:
        first, acquired = await claim_tile_rebuild_window(session, job_id)
        assert acquired
        assert first[0].attempt == 1
        await session.commit()

    async with db_factory() as session:
        item = await session.get(JobItem, first[0].item_id)
        item.started_at = datetime.now(timezone.utc)
        item.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.commit()

    async with db_factory() as session:
        delayed, acquired = await claim_tile_rebuild_window(session, job_id)
        assert acquired
        assert delayed == []
        await session.commit()

    async with db_factory() as session:
        item = await session.get(JobItem, first[0].item_id)
        assert item.status == "queued"
        assert item.attempts == 1
        assert item.claim_token is None
        assert item.started_at is None
        assert item.retry_not_before is not None
        item.retry_not_before = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.commit()

    async with db_factory() as session:
        second, acquired = await claim_tile_rebuild_window(session, job_id)
        assert acquired
        assert second[0].attempt == 2
        await session.commit()

    async with db_factory() as session:
        item = await session.get(JobItem, second[0].item_id)
        item.started_at = datetime.now(timezone.utc)
        item.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.commit()

    async with db_factory() as session:
        exhausted, acquired = await claim_tile_rebuild_window(session, job_id)
        assert acquired
        assert exhausted == []
        await session.commit()

    async with db_factory() as session:
        job = await session.get(Job, job_id)
        item = await session.get(JobItem, second[0].item_id)
        assert job.status == "failed"
        assert job.failed_count == 1
        assert job.progress == 100
        assert item.status == "failed"
        assert item.attempts == 2
        assert item.retry_not_before is None


@requires_db
async def test_explicit_retry_is_idempotent_and_preserves_success(
    db_factory,
) -> None:
    job_id = await _create_job(
        db_factory,
        status="completed_with_errors",
        item_count=2,
    )
    async with db_factory() as session:
        items = (
            await session.execute(
                select(JobItem)
                .where(JobItem.job_id == job_id)
                .order_by(JobItem.id)
            )
        ).scalars().all()
        items[0].status = "completed"
        items[0].attempts = 1
        items[0].progress = 100
        items[0].completed_at = datetime.now(timezone.utc)
        items[1].status = "failed"
        items[1].attempts = 2
        items[1].progress = 100
        items[1].completed_at = datetime.now(timezone.utc)
        await session.commit()
        completed_id = items[0].id
        failed_id = items[1].id

    async with db_factory() as session:
        assert await retry_failed_job_items(
            session,
            job_id,
            [failed_id],
        ) == 1
        await session.commit()

    async with db_factory() as session:
        assert await retry_failed_job_items(
            session,
            job_id,
            [failed_id],
        ) == 0
        with pytest.raises(TileRebuildStateError):
            await retry_failed_job_items(
                session,
                job_id,
                [completed_id],
            )
        await session.rollback()

    async with db_factory() as session:
        job = await session.get(Job, job_id)
        completed = await session.get(JobItem, completed_id)
        retried = await session.get(JobItem, failed_id)
        assert job.status == "running"
        assert job.completed_at is None
        assert completed.status == "completed"
        assert completed.attempts == 1
        assert retried.status == "queued"
        assert retried.attempts == 2
        assert retried.retry_not_before is None


@requires_db
async def test_cancellation_serializes_after_explicit_retry(
    db_factory,
) -> None:
    job_id = await _create_job(db_factory, item_count=1)
    async with db_factory() as session:
        job = await session.get(Job, job_id)
        item = (
            await session.execute(
                select(JobItem).where(JobItem.job_id == job_id)
            )
        ).scalar_one()
        job.status = "failed"
        job.failed_count = 1
        job.progress = 100
        job.completed_at = datetime.now(timezone.utc)
        item.status = "failed"
        item.attempts = 2
        item.completed_at = datetime.now(timezone.utc)
        await session.commit()
        item_id = item.id

    async with db_factory() as retrying, db_factory() as cancelling:
        assert await retry_failed_job_items(
            retrying,
            job_id,
            [item_id],
        ) == 1
        cancellation = asyncio.create_task(
            request_job_cancellation(cancelling, job_id)
        )
        await asyncio.sleep(0.05)
        assert not cancellation.done()

        await retrying.commit()
        assert await asyncio.wait_for(cancellation, timeout=1) == 1
        await cancelling.commit()

    async with db_factory() as session:
        job = await session.get(Job, job_id)
        item = await session.get(JobItem, item_id)
        assert job.status == "cancelled"
        assert job.failed_count == 0
        assert job.cancelled_count == 1
        assert item.status == "cancelled"
        assert item.attempts == 2


@requires_db
async def test_cancellation_after_claim_prevents_child_submission(
    db_factory,
    monkeypatch,
) -> None:
    job_id = await _create_job(db_factory, item_count=1)
    async with db_factory() as session:
        dispatches, acquired = await claim_tile_rebuild_window(session, job_id)
        assert acquired
        await session.commit()
    dispatch = dispatches[0]

    async with db_factory() as session:
        assert await request_job_cancellation(session, job_id) == 1
        await session.commit()

    monkeypatch.setattr(
        "app.tile_rebuild_jobs.get_async_session",
        lambda: db_factory,
    )
    submit = AsyncMock(return_value=True)
    assert await _submit_claimed_rebuild(dispatch, submit) == "duplicate"
    submit.assert_not_awaited()


@requires_db
async def test_submission_failure_uses_durable_backoff(
    db_factory,
    monkeypatch,
) -> None:
    job_id = await _create_job(db_factory, item_count=1)
    async with db_factory() as session:
        dispatches, acquired = await claim_tile_rebuild_window(session, job_id)
        assert acquired
        await session.commit()
    dispatch = dispatches[0]

    monkeypatch.setattr(
        "app.tile_rebuild_jobs.get_async_session",
        lambda: db_factory,
    )
    assert (
        await _submit_claimed_rebuild(
            dispatch,
            AsyncMock(return_value=False),
        )
        == "released"
    )
    assert (
        await _submit_claimed_rebuild(
            dispatch,
            AsyncMock(return_value=True),
        )
        == "duplicate"
    )

    async with db_factory() as session:
        item = await session.get(JobItem, dispatch.item_id)
        assert item.status == "queued"
        assert item.attempts == 1
        assert item.retry_not_before is not None
        assert item.claim_token is None
        assert item.started_at is None


@requires_db
async def test_failure_finalization_retries_transient_once(
    db_factory,
    monkeypatch,
) -> None:
    job_id = await _create_job(db_factory, item_count=1)
    async with db_factory() as session:
        first = await claim_job_items(session, job_id, 1, 90)
        await session.commit()
    item_id = first[0].id
    first_token = first[0].claim_token
    assert first_token is not None

    monkeypatch.setattr(
        "app.tile_rebuild_jobs.get_async_session",
        lambda: db_factory,
    )
    await _finalize_rebuild_failure(
        job_id,
        item_id,
        first_token,
        OSError(errno.EAGAIN, "try again"),
    )

    async with db_factory() as session:
        item = await session.get(JobItem, item_id)
        assert item.status == "queued"
        assert item.retry_not_before is not None
        item.retry_not_before = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.commit()

    async with db_factory() as session:
        second = await claim_job_items(session, job_id, 1, 90)
        await session.commit()
    second_token = second[0].claim_token
    assert second_token is not None
    await _finalize_rebuild_failure(
        job_id,
        item_id,
        second_token,
        ValueError("malformed image"),
    )
    await _finalize_rebuild_failure(
        job_id,
        item_id,
        second_token,
        ValueError("duplicate finalizer"),
    )

    async with db_factory() as session:
        job = await session.get(Job, job_id)
        item = await session.get(JobItem, item_id)
        assert job.status == "failed"
        assert job.failed_count == 1
        assert item.status == "failed"
        assert item.attempts == 2
        assert item.error_message == "builtins.ValueError"


@requires_db
async def test_items_endpoint_keyset_pagination_over_real_rows(
    db_factory,
) -> None:
    """Bounded item page walks a real table via id keyset (#1191)."""
    job_id = await _create_job(db_factory, item_count=5)
    async with db_factory() as session:
        items = (
            await session.execute(
                select(JobItem)
                .where(JobItem.job_id == job_id)
                .order_by(JobItem.id)
            )
        ).scalars().all()
        for item in items[:3]:
            item.status = "failed"
        await session.commit()

    async with db_factory() as session:
        page1 = await list_job_items(
            job_id, session, None, status="failed", limit=2
        )
        assert [i.resource_id for i in page1.items] == ["0", "1"]
        assert page1.next_after_id == page1.items[-1].id

        page2 = await list_job_items(
            job_id,
            session,
            None,
            status="failed",
            after_id=page1.next_after_id,
            limit=2,
        )
        assert [i.resource_id for i in page2.items] == ["2"]
        assert page2.next_after_id is None

        unfiltered = await list_job_items(job_id, session, None)
        assert len(unfiltered.items) == 5
        assert unfiltered.next_after_id is None


@requires_db
async def test_rebuild_mutations_reject_non_rebuild_jobs(db_factory) -> None:
    """job_type filter means bulk_import jobs 404 on rebuild routes."""
    async with db_factory() as session:
        other = Job(
            job_type="bulk_import",
            status="running",
            error_message="wave-1-postgres-test",
        )
        session.add(other)
        await session.commit()
        other_id = other.id
    try:
        async with db_factory() as session:
            with pytest.raises(HTTPException) as exc_info:
                await cancel_rebuild_job(other_id, session, None)
            assert exc_info.value.status_code == 404
    finally:
        async with db_factory() as session:
            await session.execute(delete(Job).where(Job.id == other_id))
            await session.commit()


@requires_db
async def test_cancellation_uses_locked_row_not_stale_identity(
    db_factory,
) -> None:
    """A session that pre-loaded the job unlocked must decide on the locked
    row's real status, not the stale identity-map snapshot (#1191 review)."""
    job_id = await _create_job(db_factory, status="running", item_count=1)
    async with db_factory() as session:
        # Preload the row without a lock so it enters the identity map.
        stale = await session.get(Job, job_id)
        assert stale is not None and stale.status == "running"
        async with db_factory() as other:
            row = await other.get(Job, job_id)
            row.status = "completed"
            await other.commit()
        # populate_existing refreshes the locked row, so the service sees
        # "completed" and leaves the terminal state untouched.
        assert await request_job_cancellation(session, job_id) == 0
        assert stale.status == "completed"
        await session.rollback()


@requires_db
async def test_parallelism_bounds_claims_and_stamps_claimed_at(
    db_factory,
) -> None:
    """Scale invariant: a 10-item job under parallelism=2 can never have
    more than two claims outstanding, and every claim stamps the
    ``claimed_at`` metadata used for the queue-wait histogram."""
    job_id = await _create_job(db_factory, item_count=10)
    async with db_factory() as session:
        first, acquired = await claim_tile_rebuild_window(session, job_id)
        assert acquired
        assert len(first) == 2
        await session.commit()

    # The window is full: a second pump must claim nothing.
    async with db_factory() as session:
        second, acquired = await claim_tile_rebuild_window(session, job_id)
        assert acquired
        assert second == []
        await session.commit()

    async with db_factory() as session:
        items = (
            await session.execute(
                select(JobItem)
                .where(JobItem.job_id == job_id)
                .order_by(JobItem.id)
            )
        ).scalars().all()
        running = [item for item in items if item.status == "running"]
        assert len(running) == 2
        for item in running:
            claimed_at = item.metadata_.get("claimed_at")
            assert claimed_at is not None
            assert datetime.fromisoformat(claimed_at).tzinfo is not None

    # Completing one child frees exactly one slot for the next claim.
    async with db_factory() as session:
        assert await finalize_job_item(
            session,
            first[0].item_id,
            first[0].claim_token,
            "completed",
        )
        await session.commit()
    async with db_factory() as session:
        third, acquired = await claim_tile_rebuild_window(session, job_id)
        assert acquired
        assert len(third) == 1
        assert third[0].item_id not in {d.item_id for d in first}
        await session.commit()
