"""Tests for task queue health and durable metrics."""

import asyncio
from unittest.mock import ANY, AsyncMock, patch

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
    assert state["worker_up"] is True
    pool.zcard.assert_awaited_once_with(ARQ_QUEUE_NAME)
    pool.ttl.assert_awaited_once_with(HEALTH_CHECK_KEY)


async def test_collect_queue_state_excludes_own_job_id_from_depth() -> None:
    """A caller running as an arq job itself (the reconciliation cron job)
    can discount its own in-flight queue entry so it can still observe an
    otherwise-idle queue (depth 0) while it is executing."""
    pool = AsyncMock()
    # {reconciliation_sweep_task:123: 1000.0} is the only queue member and it
    # is excluded, so the script reports depth 0 and no oldest entry.
    pool.eval.return_value = (0, None)
    pool.ttl.return_value = 25
    with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=pool):
        state = await collect_queue_state(
            exclude_job_ids={"reconciliation_sweep_task:123"}
        )

    assert state["depth"] == 0
    assert state["oldest_pending_age_seconds"] is None
    pool.eval.assert_awaited_once_with(
        ANY, 1, ARQ_QUEUE_NAME, "reconciliation_sweep_task:123"
    )
    pool.zcard.assert_not_awaited()
    pool.zrange.assert_not_awaited()


async def test_collect_queue_state_ignores_excluded_job_id_not_in_queue() -> None:
    """If the excluded job ID isn't present (e.g. it already finished),
    depth is reported unmodified rather than going negative."""
    pool = AsyncMock()
    # The excluded ID isn't in the queue, so the script's ZSCORE check for it
    # finds nothing and the one real job is still counted.
    pool.eval.return_value = (1, "1000.0")
    pool.ttl.return_value = 25
    with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=pool):
        state = await collect_queue_state(exclude_job_ids={"some-other-job"})

    assert state["depth"] == 1
    assert state["oldest_pending_age_seconds"] is not None


async def test_collect_queue_state_exclusion_is_atomic_and_bounded() -> None:
    """The exclusion path must not transfer the whole queue to Python (cost
    must stay bounded by the exclusion set size, not queue depth) and must
    compute depth/oldest-age from a single atomic Redis-side operation so a
    concurrent enqueue can't desync the two figures the way separate
    ZCARD/ZRANK/ZRANGE calls could.
    """
    pool = AsyncMock()
    # One real pending job (not excluded) alongside the sweep's own in-flight
    # entry — the script reports depth 1 and the real job's age.
    pool.eval.return_value = (1, "2000.0")
    pool.ttl.return_value = 25
    with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=pool):
        state = await collect_queue_state(
            exclude_job_ids={"reconciliation_sweep_task:123"}
        )

    assert state["depth"] == 1
    assert state["oldest_pending_age_seconds"] is not None
    # A single EVAL call replaces what would otherwise be a ZCARD + ZRANGE
    # (or worse, a full ZRANGE(0, -1) transfer) — confirms the bounded,
    # atomic implementation rather than a Python-side full-queue scan.
    pool.eval.assert_awaited_once()
    pool.zcard.assert_not_awaited()
    pool.zrange.assert_not_awaited()
    pool.zrank.assert_not_awaited()


async def test_queue_metrics_render_contains_execution_mode() -> None:
    with (
        patch("app.queue_metrics.collect_queue_state", new_callable=AsyncMock, return_value={
            "queue_up": True,
            "depth": 0,
            "oldest_pending_age_seconds": None,
            "worker_heartbeat_age_seconds": 2,
            "worker_up": True,
        }),
        patch.object(settings, "task_execution_mode", "required"),
    ):
        content, _ = await render_queue_metrics()

    assert b"hriv_task_queue_up 1.0" in content
    assert b"hriv_task_queue_worker_up 1.0" in content
    assert b'hriv_task_execution_mode_info{mode="required"} 1.0' in content


async def test_queue_metrics_render_works_on_another_event_loop() -> None:
    with patch(
        "app.queue_metrics.collect_queue_state",
        new_callable=AsyncMock,
        return_value={
            "queue_up": True,
            "depth": 0,
            "oldest_pending_age_seconds": None,
            "worker_heartbeat_age_seconds": None,
            "worker_up": False,
        },
    ):
        content, _ = await render_queue_metrics()

    assert b"hriv_task_queue_worker_up 0.0" in content


async def test_queue_metrics_clears_previous_execution_mode() -> None:
    state = {
        "queue_up": True,
        "depth": 0,
        "oldest_pending_age_seconds": None,
        "worker_heartbeat_age_seconds": None,
        "worker_up": True,
    }
    with (
        patch("app.queue_metrics.collect_queue_state", new_callable=AsyncMock, return_value=state),
        patch.object(settings, "task_execution_mode", "local"),
    ):
        await render_queue_metrics()
    with (
        patch("app.queue_metrics.collect_queue_state", new_callable=AsyncMock, return_value=state),
        patch.object(settings, "task_execution_mode", "required"),
    ):
        content, _ = await render_queue_metrics()

    assert b'hriv_task_execution_mode_info{mode="local"}' not in content
    assert b'hriv_task_execution_mode_info{mode="required"} 1.0' in content


async def test_queue_health_marks_stale_worker_degraded() -> None:
    with (
        patch("app.queue_metrics.collect_queue_state", new_callable=AsyncMock, return_value={
            "queue_up": True,
            "depth": 0,
            "oldest_pending_age_seconds": None,
            "worker_heartbeat_age_seconds": None,
            "worker_up": False,
        }),
        patch.object(settings, "task_execution_mode", "required"),
    ):
        state = await queue_health()

    assert state["worker_up"] is False
    assert state["degraded"] is True


async def test_queue_health_ignores_missing_worker_in_local_mode() -> None:
    with (
        patch("app.queue_metrics.collect_queue_state", new_callable=AsyncMock, return_value={
            "queue_up": True,
            "depth": 0,
            "oldest_pending_age_seconds": None,
            "worker_heartbeat_age_seconds": None,
            "worker_up": False,
        }),
        patch.object(settings, "task_execution_mode", "local"),
    ):
        state = await queue_health()

    assert state["worker_up"] is False
    assert state["degraded"] is False


async def test_collect_queue_state_reports_redis_error() -> None:
    pool = AsyncMock()
    pool.zcard.side_effect = ConnectionError("redis disconnected")
    with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=pool):
        state = await collect_queue_state()

    assert state["queue_up"] is False
    assert state["depth"] is None
    assert state["oldest_pending_age_seconds"] is None
    assert state["worker_heartbeat_age_seconds"] is None
    assert state["worker_up"] is None


async def test_collect_queue_state_bounds_stalled_redis_read() -> None:
    pool = AsyncMock()

    async def stalled_read(*_args: object) -> None:
        await asyncio.Future()

    pool.zcard.side_effect = stalled_read
    with (
        patch("app.worker.get_pool", new_callable=AsyncMock, return_value=pool),
        patch("app.queue_metrics._QUEUE_STATE_READ_TIMEOUT_SECONDS", 0.001),
    ):
        state = await collect_queue_state()

    assert state == {
        "queue_up": False,
        "depth": None,
        "oldest_pending_age_seconds": None,
        "worker_heartbeat_age_seconds": None,
        "worker_up": None,
    }
