import asyncio
import os
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.admin_ops import (
    _run_rebuild_with_heartbeat,
    reconcile_stale_tasks,
)
from app.job_state import (
    claim_job_items,
    reclaim_expired_job_items,
    reserve_job_item_execution,
)
from app.models import AdminTask, Job, JobItem
from app.rebuild_locks import (
    acquire_rebuild_creation_lock,
    find_active_rebuild,
    try_acquire_rebuild_pump_lock,
)
from app.tile_rebuild_jobs import claim_tile_rebuild_window

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
