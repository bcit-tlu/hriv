"""Tests for arq task queue with BackgroundTasks fallback (Phase 5.2)."""

import asyncio
import sys
from types import ModuleType
from unittest.mock import ANY, AsyncMock, MagicMock, patch

import pytest
from fakeredis import aioredis
from arq.constants import abort_jobs_ss, job_key_prefix
from arq.jobs import serialize_job
from arq.utils import timestamp_ms
from arq.worker import Worker, func
from opentelemetry.trace import StatusCode

from app.database import settings
from app.worker import (
    EnqueueResult,
    TaskQueueUnavailableError,
    WorkerSettings,
    admin_task_runner,
    bulk_import_task,
    enqueue_admin_task,
    enqueue_process_source_image,
    get_pool,
    _parse_redis_settings,
    on_startup,
    process_source_image_task,
    replace_image_task,
)


async def test_enqueue_falls_back_when_redis_unavailable() -> None:
    """When get_pool returns None, local mode returns an explicit fallback."""
    with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=None):
        result = await enqueue_process_source_image(42)

    assert result == EnqueueResult("fallback", "queue_unavailable")


async def test_enqueue_succeeds_when_redis_available() -> None:
    """When pool is available, enqueue returns True."""
    mock_pool = AsyncMock()
    mock_pool.enqueue_job = AsyncMock()

    with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=mock_pool):
        result = await enqueue_process_source_image(42)

    assert result.queued
    assert result.job is mock_pool.enqueue_job.return_value
    assert result.queued_at is not None
    mock_pool.enqueue_job.assert_awaited_once_with(
        "process_source_image_task", 42, ANY,
    )


async def test_abort_latch_survives_pruning_and_is_consumed_before_job_start() -> None:
    """Pin arq's past-dated abort marker behavior used by bulk imports."""

    executed = False

    async def noop(_ctx: dict[str, object]) -> None:
        nonlocal executed
        executed = True

    job_payload = serialize_job("noop", (), {}, None, timestamp_ms() - 1_000)
    redis = aioredis.FakeRedis()
    await redis.set(job_key_prefix + "latch-job", job_payload)
    await redis.zadd(abort_jobs_ss, {"latch-job": timestamp_ms() - 1_000})
    worker = Worker(
        [func(noop)],
        queue_name="arq:queue",
        redis_pool=redis,
        allow_abort_jobs=True,
        handle_signals=False,
    )
    worker.finish_failed_job = AsyncMock()

    await worker._cancel_aborted_jobs()
    assert abort_jobs_ss == "arq:abort"
    marker_score = await redis.zscore(abort_jobs_ss, "latch-job")
    assert marker_score is not None
    assert marker_score < timestamp_ms() + 60

    await worker.run_job("latch-job", timestamp_ms())

    assert await redis.zscore(abort_jobs_ss, "latch-job") is None
    assert executed is False
    worker.finish_failed_job.assert_awaited_once()
    await redis.aclose()


def test_api_redis_settings_use_low_retry_budget() -> None:
    """API submissions fail fast while worker settings retain arq defaults."""
    api_settings = _parse_redis_settings(api_pool=True)
    worker_settings = _parse_redis_settings()

    assert api_settings.conn_retries == 0
    assert api_settings.conn_retry_delay == 0
    assert worker_settings.conn_retries == 5
    assert worker_settings.conn_retry_delay == 1


async def test_enqueue_returns_fallback_on_enqueue_failure() -> None:
    """If enqueue_job raises, local mode returns an explicit fallback."""
    mock_pool = AsyncMock()
    mock_pool.enqueue_job = AsyncMock(side_effect=Exception("connection lost"))

    with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=mock_pool):
        result = await enqueue_process_source_image(99)

    assert result == EnqueueResult("fallback", "submission_failed")


async def test_enqueue_uses_shared_pool() -> None:
    """Task submissions use the shared API pool without a reconnect gate."""
    mock_pool = AsyncMock()
    with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=mock_pool) as get_pool_mock:
        result = await enqueue_process_source_image(42)

    assert result.queued
    get_pool_mock.assert_awaited_once_with()


async def test_get_pool_publishes_only_after_successful_ping() -> None:
    """An unverified pool is closed and never published globally."""
    worker_module = sys.modules["app.worker"]
    original_pool = worker_module._pool
    pool = AsyncMock()
    pool.ping = AsyncMock(side_effect=RuntimeError("ping failed"))
    worker_module._pool = None
    try:
        with patch("app.worker.create_pool", new_callable=AsyncMock, return_value=pool):
            result = await get_pool()

        assert result is None
        assert worker_module._pool is None
        pool.aclose.assert_awaited_once()
    finally:
        worker_module._pool = original_pool


async def test_get_pool_closes_duplicate_after_concurrent_publication() -> None:
    """Concurrent healthy connects publish one pool and close the loser."""
    worker_module = sys.modules["app.worker"]
    original_pool = worker_module._pool
    pools = [AsyncMock(), AsyncMock()]
    create_count = 0
    both_created = asyncio.Event()

    async def create_candidate(_settings):
        nonlocal create_count
        pool = pools[create_count]
        create_count += 1
        if create_count == len(pools):
            both_created.set()
        await both_created.wait()
        return pool

    worker_module._pool = None
    try:
        with patch("app.worker.create_pool", side_effect=create_candidate):
            results = await asyncio.gather(get_pool(), get_pool())

        assert results[0] is results[1]
        assert results[0] in pools
        loser = pools[0] if results[0] is pools[1] else pools[1]
        loser.aclose.assert_awaited_once()
    finally:
        worker_module._pool = original_pool


async def test_enqueue_rejects_in_required_mode() -> None:
    """Required mode raises instead of allowing in-process execution."""
    with (
        patch("app.worker.get_pool", new_callable=AsyncMock, return_value=None),
        patch.object(settings, "task_execution_mode", "required"),
    ):
        with pytest.raises(TaskQueueUnavailableError) as exc_info:
            await enqueue_process_source_image(42)

    assert exc_info.value.reason == "queue_unavailable"


async def test_enqueue_submission_rejects_in_required_mode() -> None:
    """Required mode rejects submission errors without a fallback."""
    mock_pool = AsyncMock()
    mock_pool.enqueue_job = AsyncMock(side_effect=ConnectionError("lost"))
    with (
        patch("app.worker.get_pool", new_callable=AsyncMock, return_value=mock_pool),
        patch.object(settings, "task_execution_mode", "required"),
    ):
        with pytest.raises(TaskQueueUnavailableError) as exc_info:
            await enqueue_process_source_image(42)

    assert exc_info.value.reason == "submission_failed"
    mock_pool.aclose.assert_not_awaited()


async def test_process_source_image_task_calls_processing() -> None:
    """The arq task wrapper delegates to process_source_image."""
    mock_process = AsyncMock()
    fake_processing = ModuleType("app.processing")
    fake_processing.process_source_image = mock_process  # type: ignore[attr-defined]

    with patch.dict(sys.modules, {"app.processing": fake_processing}):
        await process_source_image_task({}, 7)

    mock_process.assert_awaited_once_with(7)


async def test_on_startup_calls_setup_logging() -> None:
    """on_startup initialises structured logging for the arq worker."""
    with patch("app.worker.setup_logging") as mock_setup:
        await on_startup({})

    mock_setup.assert_called_once()


async def test_on_startup_logs_worker_identity() -> None:
    """Startup log should include the resolved worker service identity."""
    with (
        patch("app.worker.setup_logging"),
        patch("app.worker.get_worker_version", return_value="1.2.3"),
        patch.dict("os.environ", {"OTEL_SERVICE_NAME": "hriv-backend-worker"}, clear=True),
        patch("app.worker.logger") as mock_logger,
    ):
        await on_startup({})

    mock_logger.info.assert_called_once_with(
        "arq worker started",
        extra={
            "event": "worker.started",
            "service.name": "hriv-backend-worker",
            "service.version": "1.2.3",
        },
    )


def test_worker_settings_only_extend_timeout_for_admin_tasks() -> None:
    """Long timeout should apply to admin tasks without widening all jobs."""
    assert WorkerSettings.job_timeout == 7200
    assert WorkerSettings.max_jobs == 4
    assert WorkerSettings.allow_abort_jobs is True
    assert WorkerSettings.health_check_interval == 30
    assert WorkerSettings.health_check_key == "arq:queue:health-check"
    assert not hasattr(WorkerSettings, "cron_jobs")
    assert WorkerSettings.functions[:2] == [
        process_source_image_task,
        replace_image_task,
    ]
    bulk_import_fn = WorkerSettings.functions[2]
    assert bulk_import_fn.coroutine == bulk_import_task
    assert bulk_import_fn.max_tries == 1
    admin_fn = WorkerSettings.functions[3]
    assert admin_fn.name == "admin_task_runner"
    assert admin_fn.timeout_s == 86400


# ── Admin task enqueue tests ──────────────────────────────


async def test_enqueue_admin_task_redis_unavailable() -> None:
    """When get_pool returns None, enqueue_admin_task returns False."""
    with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=None):
        result = await enqueue_admin_task(1, "db_export")

    assert result == EnqueueResult("fallback", "queue_unavailable")


async def test_enqueue_admin_task_succeeds() -> None:
    """When pool is available, enqueue_admin_task returns True."""
    mock_pool = AsyncMock()
    mock_pool.enqueue_job = AsyncMock()

    with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=mock_pool):
        result = await enqueue_admin_task(1, "db_export")

    assert result.queued
    mock_pool.enqueue_job.assert_awaited_once_with(
        "admin_task_runner", 1, "db_export", ANY,
    )


async def test_enqueue_admin_task_failure() -> None:
    """If enqueue_job raises, return False for fallback."""
    mock_pool = AsyncMock()
    mock_pool.enqueue_job = AsyncMock(side_effect=Exception("boom"))

    with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=mock_pool):
        result = await enqueue_admin_task(1, "files_export")

    assert result == EnqueueResult("fallback", "submission_failed")


# ── Admin task runner tests ───────────────────────────────


async def test_admin_task_runner_db_export() -> None:
    """admin_task_runner dispatches to run_db_export."""
    mock_run = AsyncMock()
    fake_admin_ops = ModuleType("app.admin_ops")
    fake_admin_ops.run_db_export = mock_run  # type: ignore[attr-defined]
    fake_admin_ops.run_db_import = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_file_restore = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_files_export = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_files_import = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_rebuild_tiles = AsyncMock()  # type: ignore[attr-defined]

    with patch.dict(sys.modules, {"app.admin_ops": fake_admin_ops}):
        await admin_task_runner({}, 42, "db_export")

    mock_run.assert_awaited_once_with(42)


async def test_admin_task_runner_files_import() -> None:
    """admin_task_runner dispatches to run_files_import."""
    mock_run = AsyncMock()
    fake_admin_ops = ModuleType("app.admin_ops")
    fake_admin_ops.run_db_export = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_db_import = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_file_restore = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_files_export = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_files_import = mock_run  # type: ignore[attr-defined]
    fake_admin_ops.run_rebuild_tiles = AsyncMock()  # type: ignore[attr-defined]

    with patch.dict(sys.modules, {"app.admin_ops": fake_admin_ops}):
        await admin_task_runner({}, 10, "files_import")

    mock_run.assert_awaited_once_with(10)


async def test_admin_task_runner_file_restore() -> None:
    """admin_task_runner dispatches to run_file_restore."""
    mock_run = AsyncMock()
    fake_admin_ops = ModuleType("app.admin_ops")
    fake_admin_ops.run_db_export = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_db_import = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_file_restore = mock_run  # type: ignore[attr-defined]
    fake_admin_ops.run_files_export = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_files_import = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_rebuild_tiles = AsyncMock()  # type: ignore[attr-defined]

    with patch.dict(sys.modules, {"app.admin_ops": fake_admin_ops}):
        await admin_task_runner({}, 11, "file_restore")

    mock_run.assert_awaited_once_with(11)


async def test_admin_task_runner_unknown_type() -> None:
    """admin_task_runner logs error for unknown task types and does not crash."""
    fake_admin_ops = ModuleType("app.admin_ops")
    fake_admin_ops.run_db_export = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_db_import = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_file_restore = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_files_export = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_files_import = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_rebuild_tiles = AsyncMock()  # type: ignore[attr-defined]

    with patch.dict(sys.modules, {"app.admin_ops": fake_admin_ops}):
        await admin_task_runner({}, 1, "unknown_type")

    # None of the runners should have been called
    fake_admin_ops.run_db_export.assert_not_awaited()  # type: ignore[union-attr]
    fake_admin_ops.run_files_import.assert_not_awaited()  # type: ignore[union-attr]


# ── Exception recording on spans ─────────────────────────


async def test_process_source_image_task_records_exception_on_span() -> None:
    """When processing raises, the span records the exception and sets ERROR status."""
    error = RuntimeError("processing failed")
    mock_process = AsyncMock(side_effect=error)
    fake_processing = ModuleType("app.processing")
    fake_processing.process_source_image = mock_process  # type: ignore[attr-defined]

    mock_span = MagicMock()
    with (
        patch.dict(sys.modules, {"app.processing": fake_processing}),
        patch("app.worker.tracer") as mock_tracer,
    ):
        mock_tracer.start_as_current_span.return_value.__enter__ = MagicMock(return_value=mock_span)
        mock_tracer.start_as_current_span.return_value.__exit__ = MagicMock(return_value=False)

        with pytest.raises(RuntimeError, match="processing failed"):
            await process_source_image_task({}, 7)

    mock_span.record_exception.assert_called_once_with(error)
    set_status_call = mock_span.set_status.call_args
    assert set_status_call[0][0].status_code == StatusCode.ERROR


async def test_admin_task_runner_records_exception_on_span() -> None:
    """When the admin runner raises, the span records the exception and sets ERROR status."""
    error = RuntimeError("export failed")
    mock_run = AsyncMock(side_effect=error)
    fake_admin_ops = ModuleType("app.admin_ops")
    fake_admin_ops.run_db_export = mock_run  # type: ignore[attr-defined]
    fake_admin_ops.run_db_import = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_file_restore = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_files_export = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_files_import = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_rebuild_tiles = AsyncMock()  # type: ignore[attr-defined]

    mock_span = MagicMock()
    with (
        patch.dict(sys.modules, {"app.admin_ops": fake_admin_ops}),
        patch("app.worker.tracer") as mock_tracer,
    ):
        mock_tracer.start_as_current_span.return_value.__enter__ = MagicMock(return_value=mock_span)
        mock_tracer.start_as_current_span.return_value.__exit__ = MagicMock(return_value=False)

        with pytest.raises(RuntimeError, match="export failed"):
            await admin_task_runner({}, 42, "db_export")

    mock_span.record_exception.assert_called_once_with(error)
    set_status_call = mock_span.set_status.call_args
    assert set_status_call[0][0].status_code == StatusCode.ERROR


async def test_admin_task_runner_marks_interrupted_active_task_failed() -> None:
    """Cancelled admin tasks should be moved to a terminal failed state."""
    mock_run = AsyncMock(side_effect=asyncio.CancelledError())
    mock_update_task = AsyncMock()
    fake_admin_ops = ModuleType("app.admin_ops")
    fake_admin_ops._update_task = mock_update_task  # type: ignore[attr-defined]
    fake_admin_ops.run_db_export = mock_run  # type: ignore[attr-defined]
    fake_admin_ops.run_db_import = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_file_restore = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_files_export = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_files_import = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_rebuild_tiles = AsyncMock()  # type: ignore[attr-defined]

    task = MagicMock(status="running")
    session = AsyncMock()
    session.get = AsyncMock(return_value=task)
    session_cm = AsyncMock()
    session_cm.__aenter__.return_value = session
    session_cm.__aexit__.return_value = False

    mock_span = MagicMock()
    with (
        patch.dict(sys.modules, {"app.admin_ops": fake_admin_ops}),
        patch("app.worker.async_session", return_value=session_cm),
        patch("app.worker.tracer") as mock_tracer,
    ):
        mock_tracer.start_as_current_span.return_value.__enter__ = MagicMock(return_value=mock_span)
        mock_tracer.start_as_current_span.return_value.__exit__ = MagicMock(return_value=False)

        with pytest.raises(asyncio.CancelledError):
            await admin_task_runner({}, 42, "db_export")

    session.get.assert_awaited_once()
    mock_update_task.assert_awaited_once_with(
        session, task,
        status="failed",
        log_line="ERROR: Worker interrupted during db export. Rerun the task to continue.",
        error_message="Worker interrupted during db export.",
    )
    set_status_call = mock_span.set_status.call_args
    assert set_status_call[0][0].status_code == StatusCode.ERROR


async def test_admin_task_runner_interrupted_cancelling_task_becomes_cancelled() -> None:
    """Interrupted tasks already in cancelling state should land in cancelled."""
    mock_run = AsyncMock(side_effect=asyncio.CancelledError())
    mock_update_task = AsyncMock()
    fake_admin_ops = ModuleType("app.admin_ops")
    fake_admin_ops._update_task = mock_update_task  # type: ignore[attr-defined]
    fake_admin_ops.run_db_export = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_db_import = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_file_restore = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_files_export = mock_run  # type: ignore[attr-defined]
    fake_admin_ops.run_files_import = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_rebuild_tiles = AsyncMock()  # type: ignore[attr-defined]

    task = MagicMock(status="cancelling")
    session = AsyncMock()
    session.get = AsyncMock(return_value=task)
    session_cm = AsyncMock()
    session_cm.__aenter__.return_value = session
    session_cm.__aexit__.return_value = False

    with (
        patch.dict(sys.modules, {"app.admin_ops": fake_admin_ops}),
        patch("app.worker.async_session", return_value=session_cm),
    ):
        with pytest.raises(asyncio.CancelledError):
            await admin_task_runner({}, 77, "files_export")

    mock_update_task.assert_awaited_once_with(
        session, task,
        status="cancelled",
        log_line="Task cancelled while the worker was shutting down.",
    )
