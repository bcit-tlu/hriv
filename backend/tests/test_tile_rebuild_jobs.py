import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, call

import pytest

from app import tile_rebuild_jobs
from app.database import settings
from app.tile_rebuild_jobs import (
    PumpResult,
    ReservedRebuild,
    TileRebuildAlreadyActiveError,
    TileRebuildDispatch,
    TileRebuildParallelDisabledError,
    active_tile_rebuild_job_ids,
    claim_tile_rebuild_window,
    create_tile_rebuild_job,
    process_tile_rebuild_item,
    pump_tile_rebuild_job,
    reconcile_tile_rebuild_jobs,
    tile_rebuild_arq_job_id,
)


def _execute_result(*, scalar=None):
    result = MagicMock()
    result.scalar_one_or_none.return_value = scalar
    result.scalar_one.return_value = scalar
    return result


def _session_context(session: MagicMock) -> MagicMock:
    context = MagicMock()
    context.__aenter__ = AsyncMock(return_value=session)
    context.__aexit__ = AsyncMock(return_value=False)
    return context


def test_tile_rebuild_arq_job_id_is_attempt_specific() -> None:
    assert tile_rebuild_arq_job_id(7, 11, 3) == "rebuild:7:11:3"


async def test_refresh_tile_rebuild_job_completes_with_errors(
    monkeypatch,
) -> None:
    job = SimpleNamespace(
        status="running",
        progress=67,
        completed_at=None,
    )
    counts = {
        "total_count": 3,
        "completed_count": 2,
        "skipped_count": 0,
        "failed_count": 1,
        "cancelled_count": 0,
    }
    session = MagicMock()
    session.get = AsyncMock(return_value=job)
    session.flush = AsyncMock()
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.refresh_job_aggregate",
        AsyncMock(return_value=counts),
    )

    result = await tile_rebuild_jobs._refresh_tile_rebuild_job(session, 7)

    assert result == counts
    assert job.status == "completed_with_errors"
    assert job.progress == 100
    assert job.completed_at is not None


async def test_rebuild_item_heartbeat_stops_when_claim_is_lost(
    monkeypatch,
) -> None:
    session = MagicMock()
    session.commit = AsyncMock()
    factory = MagicMock(return_value=_session_context(session))
    heartbeat = AsyncMock(return_value=False)
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.get_async_session",
        MagicMock(return_value=factory),
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.heartbeat_job_item",
        heartbeat,
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.asyncio.sleep",
        AsyncMock(),
    )

    await tile_rebuild_jobs._heartbeat_rebuild_item(11, "claim", 30, 90)

    heartbeat.assert_awaited_once_with(session, 11, "claim", 90)
    session.commit.assert_awaited_once()


async def test_create_tile_rebuild_job_is_disabled_by_default(
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "rebuild_parallel_enabled", False)
    session = MagicMock()

    with pytest.raises(TileRebuildParallelDisabledError):
        await create_tile_rebuild_job(
            session,
            scope="missing_stale",
            image_ids=None,
            requested_by=1,
        )


async def test_create_tile_rebuild_job_requires_required_mode(
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "rebuild_parallel_enabled", True)
    monkeypatch.setattr(settings, "task_execution_mode", "local")
    session = MagicMock()

    with pytest.raises(TileRebuildParallelDisabledError):
        await create_tile_rebuild_job(
            session,
            scope="all",
            image_ids=[3],
            requested_by=1,
        )


async def test_create_tile_rebuild_job_rejects_active_rebuild(
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "rebuild_parallel_enabled", True)
    monkeypatch.setattr(settings, "task_execution_mode", "required")
    session = MagicMock()
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.acquire_rebuild_creation_lock",
        AsyncMock(),
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.find_active_rebuild",
        AsyncMock(
            return_value=SimpleNamespace(
                kind="task",
                id=17,
                status="running",
            )
        ),
    )

    with pytest.raises(TileRebuildAlreadyActiveError):
        await create_tile_rebuild_job(
            session,
            scope="all",
            image_ids=None,
            requested_by=1,
        )


async def test_create_tile_rebuild_job_snapshots_selected_sources(
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "rebuild_parallel_enabled", True)
    monkeypatch.setattr(settings, "task_execution_mode", "required")
    monkeypatch.setattr(settings, "rebuild_parallelism", 3)
    sources = [
        SimpleNamespace(
            id=101,
            image_id=201,
            original_filename="one.svs",
            stored_path="/sources/one.svs",
            tile_cache_status="missing",
        ),
        SimpleNamespace(
            id=102,
            image_id=202,
            original_filename="two.svs",
            stored_path="/sources/two.svs",
            tile_cache_status="stale",
        ),
    ]
    session = MagicMock()
    session.add = MagicMock()
    session.add_all = MagicMock()

    async def _flush() -> None:
        added_job = session.add.call_args.args[0]
        if added_job.id is None:
            added_job.id = 7

    session.flush = AsyncMock(side_effect=_flush)
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    select_targets = AsyncMock(return_value=sources)
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.acquire_rebuild_creation_lock",
        AsyncMock(),
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.find_active_rebuild",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs._load_processing",
        MagicMock(
            return_value=SimpleNamespace(
                select_rebuild_targets=select_targets,
            )
        ),
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.refresh_job_aggregate",
        AsyncMock(),
    )

    job = await create_tile_rebuild_job(
        session,
        scope="missing_stale",
        image_ids=[201, 202],
        requested_by=9,
    )

    select_targets.assert_awaited_once_with(
        session,
        scope="missing_stale",
        image_ids=[201, 202],
    )
    assert job.id == 7
    assert job.total_count == 2
    assert job.metadata_["execution_mode"] == "parallel"
    assert job.metadata_["parallelism"] == 3
    items = session.add_all.call_args.args[0]
    assert [item.resource_id for item in items] == ["101", "102"]
    assert [item.metadata_["image_id"] for item in items] == [201, 202]


async def test_claim_window_uses_database_running_count(
    monkeypatch,
) -> None:
    job = SimpleNamespace(
        id=7,
        job_type="rebuild_tiles",
        status="running",
        metadata_={"parallelism": 3, "lease_seconds": 90},
    )
    claimed = [
        SimpleNamespace(
            id=11,
            attempts=2,
            claim_token="claim-11",
            arq_job_id=None,
        )
    ]
    session = MagicMock()
    session.execute = AsyncMock(
        side_effect=[
            _execute_result(scalar=job),
            _execute_result(scalar=2),
        ]
    )
    session.flush = AsyncMock()
    lock = AsyncMock(return_value=True)
    reclaim = AsyncMock(return_value=0)
    claim = AsyncMock(return_value=claimed)
    aggregate = AsyncMock()
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.try_acquire_rebuild_pump_lock",
        lock,
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.reclaim_expired_job_items",
        reclaim,
    )
    monkeypatch.setattr("app.tile_rebuild_jobs.claim_job_items", claim)
    monkeypatch.setattr(
        "app.tile_rebuild_jobs._refresh_tile_rebuild_job",
        aggregate,
    )

    dispatches, acquired = await claim_tile_rebuild_window(session, 7)

    assert acquired
    claim.assert_awaited_once_with(session, 7, 1, 90)
    assert dispatches == [
        TileRebuildDispatch(
            job_id=7,
            item_id=11,
            claim_token="claim-11",
            attempt=2,
            arq_job_id="rebuild:7:11:2",
        )
    ]
    assert claimed[0].arq_job_id == "rebuild:7:11:2"


async def test_claim_window_stops_when_another_pump_holds_lock(
    monkeypatch,
) -> None:
    session = MagicMock()
    session.execute = AsyncMock()
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.try_acquire_rebuild_pump_lock",
        AsyncMock(return_value=False),
    )

    assert await claim_tile_rebuild_window(session, 7) == ([], False)
    session.execute.assert_not_awaited()


async def test_pump_commits_claims_before_submission(monkeypatch) -> None:
    session = MagicMock()
    committed = False

    async def _commit() -> None:
        nonlocal committed
        committed = True

    session.commit = AsyncMock(side_effect=_commit)
    factory = MagicMock(return_value=_session_context(session))
    dispatch = TileRebuildDispatch(
        job_id=7,
        item_id=11,
        claim_token="claim",
        attempt=1,
        arq_job_id="rebuild:7:11:1",
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.get_async_session",
        MagicMock(return_value=factory),
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.claim_tile_rebuild_window",
        AsyncMock(return_value=([dispatch], True)),
    )

    async def _submit(value: TileRebuildDispatch) -> bool:
        assert value == dispatch
        assert committed
        return True

    result = await pump_tile_rebuild_job(7, _submit)

    assert result == PumpResult(claimed=1, submitted=1)


async def test_pump_releases_unstarted_claim_after_submission_failure(
    monkeypatch,
) -> None:
    claim_session = MagicMock()
    claim_session.commit = AsyncMock()
    release_session = MagicMock()
    release_session.commit = AsyncMock()
    contexts = iter(
        [
            _session_context(claim_session),
            _session_context(release_session),
        ]
    )
    factory = MagicMock(side_effect=lambda: next(contexts))
    dispatch = TileRebuildDispatch(
        job_id=7,
        item_id=11,
        claim_token="claim",
        attempt=1,
        arq_job_id="rebuild:7:11:1",
    )
    release = AsyncMock(return_value=True)
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.get_async_session",
        MagicMock(return_value=factory),
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.claim_tile_rebuild_window",
        AsyncMock(return_value=([dispatch], True)),
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.release_job_item_claim",
        release,
    )

    result = await pump_tile_rebuild_job(
        7,
        AsyncMock(side_effect=RuntimeError("redis unavailable")),
    )

    assert result == PumpResult(claimed=1, released=1)
    release.assert_awaited_once_with(release_session, 7, 11, "claim")


async def test_duplicate_child_delivery_does_not_process(monkeypatch) -> None:
    reserve = AsyncMock(
        return_value=ReservedRebuild(outcome="duplicate")
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs._reserve_rebuild_source",
        reserve,
    )

    assert await process_tile_rebuild_item(7, 11, "claim") == "duplicate"


async def test_skipped_child_delivery_does_not_process(monkeypatch) -> None:
    reserve = AsyncMock(return_value=ReservedRebuild(outcome="skipped"))
    monkeypatch.setattr(
        "app.tile_rebuild_jobs._reserve_rebuild_source",
        reserve,
    )

    assert await process_tile_rebuild_item(7, 11, "claim") == "skipped"


async def test_ready_child_promotes_and_finalizes_current_claim(
    monkeypatch,
) -> None:
    prepared = object()
    promoted = object()
    source_image = SimpleNamespace(id=101)
    processing = SimpleNamespace(
        TileRebuildSource=SimpleNamespace,
        prepare_source_image_tile_rebuild=AsyncMock(
            return_value=prepared,
        ),
        promote_source_image_tile_rebuild=AsyncMock(
            return_value=promoted,
        ),
        finish_promoted_tile_rebuild=AsyncMock(),
        rollback_promoted_tile_rebuild=AsyncMock(),
        discard_prepared_tile_rebuild=AsyncMock(),
    )
    session = MagicMock()
    session.execute = AsyncMock(return_value=_execute_result(scalar=object()))
    session.get = AsyncMock(return_value=source_image)
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    factory = MagicMock(return_value=_session_context(session))
    finalize = AsyncMock(return_value=True)
    refresh = AsyncMock()
    monkeypatch.setattr(
        "app.tile_rebuild_jobs._reserve_rebuild_source",
        AsyncMock(
            return_value=ReservedRebuild(
                outcome="ready",
                source_image_id=101,
                image_id=201,
                stored_path="/sources/one.svs",
                heartbeat_seconds=30,
                lease_seconds=90,
            )
        ),
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs._heartbeat_rebuild_item",
        AsyncMock(),
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.get_async_session",
        MagicMock(return_value=factory),
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.finalize_job_item",
        finalize,
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs._refresh_tile_rebuild_job",
        refresh,
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs._load_processing",
        MagicMock(return_value=processing),
    )

    result = await process_tile_rebuild_item(7, 11, "claim")

    assert result == "completed"
    processing.promote_source_image_tile_rebuild.assert_awaited_once_with(
        session,
        source_image,
        prepared,
    )
    finalize.assert_awaited_once_with(
        session,
        11,
        "claim",
        "completed",
    )
    refresh.assert_awaited_once_with(session, 7)
    session.commit.assert_awaited_once()
    processing.finish_promoted_tile_rebuild.assert_awaited_once_with(
        promoted
    )
    processing.rollback_promoted_tile_rebuild.assert_not_awaited()


async def test_commit_failure_rolls_back_promotion_and_fails_item(
    monkeypatch,
) -> None:
    prepared = object()
    promoted = object()
    processing = SimpleNamespace(
        TileRebuildSource=SimpleNamespace,
        prepare_source_image_tile_rebuild=AsyncMock(
            return_value=prepared,
        ),
        promote_source_image_tile_rebuild=AsyncMock(
            return_value=promoted,
        ),
        finish_promoted_tile_rebuild=AsyncMock(),
        rollback_promoted_tile_rebuild=AsyncMock(),
        discard_prepared_tile_rebuild=AsyncMock(),
    )
    session = MagicMock()
    session.execute = AsyncMock(return_value=_execute_result(scalar=object()))
    session.get = AsyncMock(return_value=SimpleNamespace(id=101))
    session.commit = AsyncMock(side_effect=RuntimeError("commit failed"))
    session.rollback = AsyncMock()
    factory = MagicMock(return_value=_session_context(session))
    finalize_failure = AsyncMock()
    monkeypatch.setattr(
        "app.tile_rebuild_jobs._reserve_rebuild_source",
        AsyncMock(
            return_value=ReservedRebuild(
                outcome="ready",
                source_image_id=101,
                image_id=201,
                stored_path="/sources/one.svs",
                heartbeat_seconds=30,
                lease_seconds=90,
            )
        ),
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs._heartbeat_rebuild_item",
        AsyncMock(),
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.get_async_session",
        MagicMock(return_value=factory),
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.finalize_job_item",
        AsyncMock(return_value=True),
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs._refresh_tile_rebuild_job",
        AsyncMock(),
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs._finalize_rebuild_failure",
        finalize_failure,
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs._load_processing",
        MagicMock(return_value=processing),
    )

    with pytest.raises(RuntimeError, match="commit failed"):
        await process_tile_rebuild_item(7, 11, "claim")

    session.rollback.assert_awaited_once()
    processing.rollback_promoted_tile_rebuild.assert_awaited_once_with(
        promoted
    )
    processing.finish_promoted_tile_rebuild.assert_not_awaited()
    finalize_failure.assert_awaited_once_with(
        7,
        11,
        "claim",
        "commit failed",
    )


async def test_cancelled_child_discards_prepared_tiles(
    monkeypatch,
) -> None:
    prepared = object()
    processing = SimpleNamespace(
        TileRebuildSource=SimpleNamespace,
        prepare_source_image_tile_rebuild=AsyncMock(
            return_value=prepared,
        ),
        discard_prepared_tile_rebuild=AsyncMock(),
    )
    session = MagicMock()
    session.execute = AsyncMock(side_effect=asyncio.CancelledError())
    session.rollback = AsyncMock()
    factory = MagicMock(return_value=_session_context(session))
    monkeypatch.setattr(
        "app.tile_rebuild_jobs._reserve_rebuild_source",
        AsyncMock(
            return_value=ReservedRebuild(
                outcome="ready",
                source_image_id=101,
                image_id=201,
                stored_path="/sources/one.svs",
                heartbeat_seconds=30,
                lease_seconds=90,
            )
        ),
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.get_async_session",
        MagicMock(return_value=factory),
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs._load_processing",
        MagicMock(return_value=processing),
    )

    with pytest.raises(asyncio.CancelledError):
        await process_tile_rebuild_item(7, 11, "claim")

    processing.discard_prepared_tile_rebuild.assert_awaited_once_with(prepared)


async def test_cancelled_child_stops_heartbeat_during_slow_preparation(
    monkeypatch,
) -> None:
    """Child timeout stops lease renewal while preparation is cancelled."""
    preparation_started = asyncio.Event()
    preparation_cancelled = asyncio.Event()
    cleanup_release = asyncio.Event()
    heartbeat_stopped = asyncio.Event()

    async def prepare_source_image_tile_rebuild(_source):
        preparation_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            preparation_cancelled.set()
            await cleanup_release.wait()
            raise

    async def heartbeat_rebuild_item(*_args) -> None:
        try:
            await asyncio.Event().wait()
        finally:
            heartbeat_stopped.set()

    processing = SimpleNamespace(
        TileRebuildSource=SimpleNamespace,
        prepare_source_image_tile_rebuild=AsyncMock(
            side_effect=prepare_source_image_tile_rebuild,
        ),
        discard_prepared_tile_rebuild=AsyncMock(),
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs._reserve_rebuild_source",
        AsyncMock(
            return_value=ReservedRebuild(
                outcome="ready",
                source_image_id=101,
                image_id=201,
                stored_path="/sources/one.svs",
                heartbeat_seconds=30,
                lease_seconds=90,
            )
        ),
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs._heartbeat_rebuild_item",
        heartbeat_rebuild_item,
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs._load_processing",
        MagicMock(return_value=processing),
    )

    child = asyncio.create_task(
        process_tile_rebuild_item(7, 11, "claim")
    )
    await preparation_started.wait()
    child.cancel()
    await preparation_cancelled.wait()

    assert heartbeat_stopped.is_set()
    assert not child.done()
    cleanup_release.set()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(child, timeout=0.1)

    processing.discard_prepared_tile_rebuild.assert_not_awaited()


async def test_active_tile_rebuild_job_ids_reads_postgres(
    monkeypatch,
) -> None:
    session = MagicMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = [7, 9]
    session.execute = AsyncMock(return_value=result)
    factory = MagicMock(return_value=_session_context(session))
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.get_async_session",
        MagicMock(return_value=factory),
    )

    assert await active_tile_rebuild_job_ids() == [7, 9]


async def test_reconcile_tile_rebuild_jobs_repumps_each_active_job(
    monkeypatch,
) -> None:
    submit = AsyncMock()
    pump = AsyncMock()
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.active_tile_rebuild_job_ids",
        AsyncMock(return_value=[7, 9]),
    )
    monkeypatch.setattr(
        "app.tile_rebuild_jobs.pump_tile_rebuild_job",
        pump,
    )

    await reconcile_tile_rebuild_jobs(submit)

    assert pump.await_args_list == [call(7, submit), call(9, submit)]
