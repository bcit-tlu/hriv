"""Tests for task queue health and durable metrics."""

from unittest.mock import AsyncMock, patch

from redis.exceptions import ConnectionError

from app.database import settings
from app.queue_metrics import (
    ARQ_QUEUE_NAME,
    HEALTH_CHECK_KEY,
    collect_queue_state,
    queue_health,
    render_queue_metrics,
)


async def test_collect_queue_state_reads_depth_and_heartbeat() -> None:
    pool = AsyncMock()
    pool.zcard.return_value = 3
    pool.zrange.return_value = [(b"job", 1_000.0)]
    pool.ttl.return_value = 25
    with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=pool):
        state = await collect_queue_state()

    assert state["queue_up"] is True
    assert state["depth"] == 3
    assert state["oldest_pending_age_seconds"] is not None
    assert state["worker_heartbeat_age_seconds"] == 6
    pool.zcard.assert_awaited_once_with(ARQ_QUEUE_NAME)
    pool.ttl.assert_awaited_once_with(HEALTH_CHECK_KEY)


async def test_queue_metrics_render_contains_execution_mode() -> None:
    with (
        patch("app.queue_metrics.collect_queue_state", new_callable=AsyncMock, return_value={
            "queue_up": True,
            "depth": 0,
            "oldest_pending_age_seconds": None,
            "worker_heartbeat_age_seconds": 2,
        }),
        patch.object(settings, "task_execution_mode", "required"),
    ):
        content, _ = await render_queue_metrics()

    assert b"hriv_task_queue_up 1.0" in content
    assert b'hriv_task_execution_mode_info{mode="required"} 1.0' in content


async def test_queue_health_marks_stale_worker_degraded() -> None:
    with patch("app.queue_metrics.collect_queue_state", new_callable=AsyncMock, return_value={
        "queue_up": True,
        "depth": 0,
        "oldest_pending_age_seconds": None,
        "worker_heartbeat_age_seconds": None,
    }):
        state = await queue_health()

    assert state["worker_up"] is False
    assert state["degraded"] is True


async def test_collect_queue_state_invalidates_pool_on_redis_error() -> None:
    pool = AsyncMock()
    pool.zcard.side_effect = ConnectionError("redis disconnected")
    with (
        patch("app.worker.get_pool", new_callable=AsyncMock, return_value=pool),
        patch("app.worker._discard_pool", new_callable=AsyncMock) as discard_pool,
    ):
        state = await collect_queue_state()

    assert state["queue_up"] is False
    discard_pool.assert_awaited_once_with(arm_backoff=False)
