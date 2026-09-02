"""Tests for task queue health and durable metrics."""

import asyncio
from unittest.mock import AsyncMock, patch

from fakeredis import aioredis as fake_aioredis
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


# The exclusion path below runs against a real (fake) Redis instance rather
# than mocking ``pool.eval`` so ``_QUEUE_DEPTH_EXCLUDING_SCRIPT`` itself is
# exercised end-to-end (Lua syntax and exclusion logic, not just how
# ``collect_queue_state`` interprets a mocked return value). ``fakeredis``
# only executes Lua scripts when the optional ``lupa`` dependency is
# installed (see ``pyproject.toml``'s dev dependencies).


async def _fake_pool_with_queue(entries: dict[str, float]) -> fake_aioredis.FakeRedis:
    pool = fake_aioredis.FakeRedis()
    if entries:
        await pool.zadd(ARQ_QUEUE_NAME, entries)
    return pool


async def test_collect_queue_state_excludes_own_job_id_from_depth() -> None:
    """A caller running as an arq job itself (the reconciliation cron job)
    can discount its own in-flight queue entry so it can still observe an
    otherwise-idle queue (depth 0) while it is executing."""
    pool = await _fake_pool_with_queue({"reconciliation_sweep_task:123": 1_000.0})
    try:
        with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=pool):
            state = await collect_queue_state(
                exclude_job_ids={"reconciliation_sweep_task:123"}
            )
    finally:
        await pool.aclose()

    assert state["depth"] == 0
    assert state["oldest_pending_age_seconds"] is None


async def test_collect_queue_state_ignores_excluded_job_id_not_in_queue() -> None:
    """If the excluded job ID isn't present (e.g. it already finished),
    depth is reported unmodified rather than going negative."""
    pool = await _fake_pool_with_queue({"job": 1_000.0})
    try:
        with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=pool):
            state = await collect_queue_state(exclude_job_ids={"some-other-job"})
    finally:
        await pool.aclose()

    assert state["depth"] == 1
    assert state["oldest_pending_age_seconds"] is not None


async def test_collect_queue_state_exclusion_reports_oldest_real_entry() -> None:
    """A job enqueued before the sweep's own job — but excluded — must not
    hide a real pending job, and the reported oldest-age must reflect the
    real (non-excluded) job rather than the excluded one, even when the
    excluded job is the oldest entry in the queue.
    """
    pool = await _fake_pool_with_queue(
        {
            "reconciliation_sweep_task:123": 1_000.0,  # oldest, but excluded
            "new-pending-job": 2_000.0,
        }
    )
    try:
        with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=pool):
            state = await collect_queue_state(
                exclude_job_ids={"reconciliation_sweep_task:123"}
            )
    finally:
        await pool.aclose()

    assert state["depth"] == 1
    assert state["oldest_pending_age_seconds"] is not None


async def test_collect_queue_state_exclusion_is_bounded_not_full_scan() -> None:
    """The exclusion path must not transfer the whole queue to Python: with
    a large backlog and a small exclusion set, the reported depth/oldest-age
    must still be correct without a full ``ZRANGE(0, -1)`` walk. This is
    verified indirectly by asserting correctness against a queue much larger
    than the exclusion set — the Lua script only ever inspects a prefix of
    ``#excluded + 1`` members plus one ``ZSCORE`` per excluded ID.
    """
    entries = {f"backlog-job-{i}": float(1_000 + i) for i in range(500)}
    entries["reconciliation_sweep_task:123"] = 999.0  # oldest, but excluded
    pool = await _fake_pool_with_queue(entries)
    try:
        with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=pool):
            state = await collect_queue_state(
                exclude_job_ids={"reconciliation_sweep_task:123"}
            )
    finally:
        await pool.aclose()

    assert state["depth"] == 500
    assert state["oldest_pending_age_seconds"] is not None


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
