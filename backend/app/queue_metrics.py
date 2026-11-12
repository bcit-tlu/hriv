"""Task queue metrics and health state."""

from __future__ import annotations

import asyncio
import time
import weakref
from typing import Any

from arq.constants import default_queue_name, health_check_key_suffix
from opentelemetry import metrics
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Gauge, generate_latest

from .database import settings

_meter = metrics.get_meter(__name__)
_enqueue_counter = _meter.create_counter(
    "hriv.task_enqueue.completed",
    description="Task enqueue outcomes by job type",
    unit="1",
)

_registry = CollectorRegistry()
_render_locks: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()


def _get_render_lock() -> asyncio.Lock:
    """Return the metrics-render lock for the current event loop."""
    loop = asyncio.get_running_loop()
    lock = _render_locks.get(loop)
    if lock is None:
        lock = asyncio.Lock()
        _render_locks[loop] = lock
    return lock


_queue_up = Gauge("hriv_task_queue_up", "Whether Redis is reachable", registry=_registry)
_queue_depth = Gauge(
    "hriv_task_queue_depth",
    "Number of queued or executing arq jobs",
    registry=_registry,
)
_oldest_pending_age = Gauge(
    "hriv_task_queue_oldest_pending_age_seconds",
    "Age of the oldest queued or executing arq job",
    registry=_registry,
)
_heartbeat_age = Gauge(
    "hriv_task_queue_worker_heartbeat_age_seconds",
    "Age of the worker heartbeat",
    registry=_registry,
)
_worker_up = Gauge(
    "hriv_task_queue_worker_up",
    "Whether the dedicated worker heartbeat key exists",
    registry=_registry,
)
_execution_mode = Gauge(
    "hriv_task_execution_mode_info",
    "Configured task execution mode",
    labelnames=("mode",),
    registry=_registry,
)

# Counting-queue gauges (#1661/#1669). Created lazily on first render so a
# deployment with no counting worker starts with no series rather than a
# stale 0.0 that would look like a live, empty queue.
_count_gauges: dict[str, Gauge] = {}


def _counting_gauges() -> dict[str, Gauge]:
    if not _count_gauges:
        _count_gauges["depth"] = Gauge(
            "hriv_count_queue_depth",
            "Number of queued or executing arq count jobs",
            registry=_registry,
        )
        _count_gauges["oldest_pending_age"] = Gauge(
            "hriv_count_queue_oldest_pending_age_seconds",
            "Age of the oldest queued or executing arq count job",
            registry=_registry,
        )
        _count_gauges["worker_up"] = Gauge(
            "hriv_count_worker_up",
            "Whether the counting-worker heartbeat key exists",
            registry=_registry,
        )
        _count_gauges["heartbeat_age"] = Gauge(
            "hriv_count_worker_heartbeat_age_seconds",
            "Age of the counting-worker heartbeat",
            registry=_registry,
        )
    return _count_gauges

ARQ_QUEUE_NAME = default_queue_name
HEALTH_CHECK_KEY = ARQ_QUEUE_NAME + health_check_key_suffix
HEALTH_CHECK_INTERVAL_SECONDS = 30
_QUEUE_STATE_READ_TIMEOUT_SECONDS = 5


def record_enqueue(job_type: str, outcome: str, reason: str) -> None:
    """Record one bounded enqueue outcome in OpenTelemetry."""
    _enqueue_counter.add(
        1,
        {"job_type": job_type, "outcome": outcome, "reason": reason},
    )


# Computes a coherent (depth, oldest-non-excluded-score) pair in one atomic
# round trip, without ever transferring the full queue to Python. Redis
# executes the whole script as a single operation, so there is no window for
# a concurrent enqueue to desync the two figures the way separate
# ZCARD/ZRANK/ZRANGE calls could (see ``collect_queue_state``). Cost is
# bounded by the (small, fixed) number of excluded IDs rather than queue
# depth: ZCARD is O(1), one ZSCORE per excluded ID is O(log N), and the
# oldest-non-excluded lookup only ever inspects a prefix of
# ``#excluded + 1`` members (a sorted set can't have more than
# ``#excluded`` distinct excluded members ahead of the first kept one).
_QUEUE_DEPTH_EXCLUDING_SCRIPT = """
local queue_key = KEYS[1]
local total = redis.call('ZCARD', queue_key)
local excluded_present = 0
for i = 1, #ARGV do
    if redis.call('ZSCORE', queue_key, ARGV[i]) then
        excluded_present = excluded_present + 1
    end
end
local depth = total - excluded_present
local prefix = redis.call('ZRANGE', queue_key, 0, #ARGV, 'WITHSCORES')
local oldest_score = false
for i = 1, #prefix, 2 do
    local member = prefix[i]
    local is_excluded = false
    for j = 1, #ARGV do
        if member == ARGV[j] then
            is_excluded = true
            break
        end
    end
    if not is_excluded then
        oldest_score = prefix[i + 1]
        break
    end
end
return {depth, oldest_score}
"""


async def collect_queue_state(
    *,
    exclude_job_ids: set[str] | None = None,
    queue_name: str = ARQ_QUEUE_NAME,
    health_check_key: str = HEALTH_CHECK_KEY,
    health_check_interval_seconds: float | None = None,
) -> dict[str, Any]:
    """Read queue depth and worker heartbeat without breaking a scrape.

    *exclude_job_ids* lets a caller running as an arq job itself (e.g. the
    reconciliation sweep's own cron job — see ``reconciliation.py``) discount
    its own in-flight entry from ``depth``. arq keeps queued *and*
    currently-executing job IDs in the queue sorted set until the job
    finishes, so without this a periodic cron job would always observe
    ``depth >= 1`` (itself) and never treat the queue as idle. When set,
    ``queue_name`` / ``health_check_key`` point the read at a non-default
    arq queue (the counting queue); ``health_check_interval_seconds``
    overrides the heartbeat-age base for a worker class with a different
    interval. ``depth`` and ``oldest_pending_age_seconds`` are both
    computed by a single atomic Lua script (``_QUEUE_DEPTH_EXCLUDING_SCRIPT``) rather than
    separate ZCARD/ZRANK/ZRANGE round trips: this avoids the race where a
    job enqueued between separate reads could be dropped from ``depth`` (or
    make ``oldest_pending_age_seconds`` describe an entry ``depth`` has
    excluded), and — unlike transferring the whole queue to Python — stays
    bounded even when the queue holds a large backlog.
    """
    from .worker import WorkerSettings, get_pool

    pool = await get_pool()
    state: dict[str, Any] = {
        "queue_up": pool is not None,
        "depth": None,
        "oldest_pending_age_seconds": None,
        "worker_heartbeat_age_seconds": None,
        "worker_up": None,
    }
    if pool is None:
        return state

    async def read_state() -> tuple[int, float | None, float | None, bool | None]:
        now_ms = time.time() * 1000
        health_check_interval = (
            health_check_interval_seconds
            if health_check_interval_seconds is not None
            else WorkerSettings.health_check_interval
        )
        if exclude_job_ids:
            depth, oldest_score = await pool.eval(
                _QUEUE_DEPTH_EXCLUDING_SCRIPT,
                1,
                queue_name,
                *exclude_job_ids,
            )
            oldest_age = None
            if oldest_score is not None:
                oldest_age = max(0.0, (now_ms - float(oldest_score)) / 1000)
        else:
            depth = await pool.zcard(queue_name)
            oldest = await pool.zrange(queue_name, 0, 0, withscores=True)
            oldest_age = None
            if oldest:
                score = oldest[0][1]
                oldest_age = max(0.0, (now_ms - float(score)) / 1000)
        remaining_ttl = await pool.ttl(health_check_key)
        worker_up = remaining_ttl != -2
        heartbeat_age = None
        if remaining_ttl != -2:
            # arq.record_health() sets health_check_interval + 1 TTL; this
            # reads the API pod's interval, so worker overrides skew this age.
            heartbeat_age = (
                0.0
                if remaining_ttl == -1
                else max(
                    0.0,
                    health_check_interval + 1 - float(remaining_ttl),
                )
            )
        return depth, oldest_age, heartbeat_age, worker_up

    try:
        (
            state["depth"],
            state["oldest_pending_age_seconds"],
            state["worker_heartbeat_age_seconds"],
            state["worker_up"],
        ) = await asyncio.wait_for(
            read_state(),
            timeout=_QUEUE_STATE_READ_TIMEOUT_SECONDS,
        )
    except Exception:
        state["queue_up"] = False
        state["depth"] = None
        state["oldest_pending_age_seconds"] = None
        state["worker_heartbeat_age_seconds"] = None
        state["worker_up"] = None
    return state


async def render_queue_metrics() -> tuple[bytes, str]:
    """Render queue gauges for the backend Prometheus endpoint."""
    state = await collect_queue_state()
    async with _get_render_lock():
        _queue_up.set(1 if state["queue_up"] else 0)
        _queue_depth.set(float("nan") if state["depth"] is None else state["depth"])
        _oldest_pending_age.set(
            float("nan")
            if state["oldest_pending_age_seconds"] is None
            else state["oldest_pending_age_seconds"]
        )
        _heartbeat_age.set(
            float("nan")
            if state["worker_heartbeat_age_seconds"] is None
            else state["worker_heartbeat_age_seconds"]
        )
        _worker_up.set(
            float("nan")
            if state["worker_up"] is None
            else 1 if state["worker_up"] else 0
        )
        _execution_mode.clear()
        _execution_mode.labels(mode=settings.task_execution_mode).set(1)
        # Never import app.counting.worker here: it pulls numpy and the
        # ML outliners, which the API image does not install. The worker
        # uses the same HEALTH_CHECK_INTERVAL_SECONDS constant.
        count_state = await collect_queue_state(
            queue_name=settings.counting_queue_name,
            health_check_key=settings.counting_queue_name + health_check_key_suffix,
            health_check_interval_seconds=int(HEALTH_CHECK_INTERVAL_SECONDS),
        )
        gauges = _counting_gauges()
        gauges["depth"].set(
            float("nan") if count_state["depth"] is None else count_state["depth"]
        )
        gauges["oldest_pending_age"].set(
            float("nan")
            if count_state["oldest_pending_age_seconds"] is None
            else count_state["oldest_pending_age_seconds"]
        )
        gauges["worker_up"].set(
            float("nan")
            if count_state["worker_up"] is None
            else 1 if count_state["worker_up"] else 0
        )
        gauges["heartbeat_age"].set(
            float("nan")
            if count_state["worker_heartbeat_age_seconds"] is None
            else count_state["worker_heartbeat_age_seconds"]
        )
        return generate_latest(_registry), CONTENT_TYPE_LATEST


async def queue_health() -> dict[str, Any]:
    """Return the queue and worker liveness state for the health endpoint."""
    state = await collect_queue_state()
    state["mode"] = settings.task_execution_mode
    state["degraded"] = not state["queue_up"] or (
        settings.task_execution_mode == "required"
        and state["worker_up"] is not True
    )
    return state
