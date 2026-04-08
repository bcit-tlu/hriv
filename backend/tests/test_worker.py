"""Tests for arq task queue with BackgroundTasks fallback (Phase 5.2)."""

import sys
from types import ModuleType
from unittest.mock import AsyncMock, MagicMock, patch

from app.worker import enqueue_process_source_image, process_source_image_task


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
