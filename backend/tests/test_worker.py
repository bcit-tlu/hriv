"""Tests for arq task queue with BackgroundTasks fallback (Phase 5.2)."""

import sys
from types import ModuleType
from unittest.mock import AsyncMock, MagicMock, patch

from app.worker import (
    admin_task_runner,
    enqueue_admin_task,
    enqueue_process_source_image,
    on_startup,
    process_source_image_task,
)


async def test_enqueue_falls_back_when_redis_unavailable() -> None:
    """When get_pool returns None, enqueue returns False (fallback)."""
    with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=None):
        result = await enqueue_process_source_image(42)

    assert result is False


async def test_enqueue_succeeds_when_redis_available() -> None:
    """When pool is available, enqueue returns True."""
    mock_pool = AsyncMock()
    mock_pool.enqueue_job = AsyncMock()

    with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=mock_pool):
        result = await enqueue_process_source_image(42)

    assert result is True
    mock_pool.enqueue_job.assert_awaited_once_with(
        "process_source_image_task", 42
    )


async def test_enqueue_returns_false_on_enqueue_failure() -> None:
    """If enqueue_job raises, return False for fallback."""
    mock_pool = AsyncMock()
    mock_pool.enqueue_job = AsyncMock(side_effect=Exception("connection lost"))

    with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=mock_pool):
        result = await enqueue_process_source_image(99)

    assert result is False


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


# ── Admin task enqueue tests ──────────────────────────────


async def test_enqueue_admin_task_redis_unavailable() -> None:
    """When get_pool returns None, enqueue_admin_task returns False."""
    with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=None):
        result = await enqueue_admin_task(1, "db_export")

    assert result is False


async def test_enqueue_admin_task_succeeds() -> None:
    """When pool is available, enqueue_admin_task returns True."""
    mock_pool = AsyncMock()
    mock_pool.enqueue_job = AsyncMock()

    with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=mock_pool):
        result = await enqueue_admin_task(1, "db_export")

    assert result is True
    mock_pool.enqueue_job.assert_awaited_once_with("admin_task_runner", 1, "db_export")


async def test_enqueue_admin_task_failure() -> None:
    """If enqueue_job raises, return False for fallback."""
    mock_pool = AsyncMock()
    mock_pool.enqueue_job = AsyncMock(side_effect=Exception("boom"))

    with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=mock_pool):
        result = await enqueue_admin_task(1, "files_export")

    assert result is False


# ── Admin task runner tests ───────────────────────────────


async def test_admin_task_runner_db_export() -> None:
    """admin_task_runner dispatches to run_db_export."""
    mock_run = AsyncMock()
    fake_admin_ops = ModuleType("app.admin_ops")
    fake_admin_ops.run_db_export = mock_run  # type: ignore[attr-defined]
    fake_admin_ops.run_db_import = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_files_export = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_files_import = AsyncMock()  # type: ignore[attr-defined]

    with patch.dict(sys.modules, {"app.admin_ops": fake_admin_ops}):
        await admin_task_runner({}, 42, "db_export")

    mock_run.assert_awaited_once_with(42)


async def test_admin_task_runner_files_import() -> None:
    """admin_task_runner dispatches to run_files_import."""
    mock_run = AsyncMock()
    fake_admin_ops = ModuleType("app.admin_ops")
    fake_admin_ops.run_db_export = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_db_import = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_files_export = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_files_import = mock_run  # type: ignore[attr-defined]

    with patch.dict(sys.modules, {"app.admin_ops": fake_admin_ops}):
        await admin_task_runner({}, 10, "files_import")

    mock_run.assert_awaited_once_with(10)


async def test_admin_task_runner_unknown_type() -> None:
    """admin_task_runner logs error for unknown task types and does not crash."""
    fake_admin_ops = ModuleType("app.admin_ops")
    fake_admin_ops.run_db_export = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_db_import = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_files_export = AsyncMock()  # type: ignore[attr-defined]
    fake_admin_ops.run_files_import = AsyncMock()  # type: ignore[attr-defined]

    with patch.dict(sys.modules, {"app.admin_ops": fake_admin_ops}):
        await admin_task_runner({}, 1, "unknown_type")

    # None of the runners should have been called
    fake_admin_ops.run_db_export.assert_not_awaited()  # type: ignore[union-attr]
    fake_admin_ops.run_files_import.assert_not_awaited()  # type: ignore[union-attr]
