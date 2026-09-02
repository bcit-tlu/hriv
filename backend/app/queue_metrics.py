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


def _decode_member(member: bytes | str) -> str:
    """Normalise a raw ZRANGE member to ``str`` for exclusion-set lookups."""
    return member.decode() if isinstance(member, bytes) else member


async def collect_queue_state(*, exclude_job_ids: set[str] | None = None) -> dict[str, Any]:
    """Read queue depth and worker heartbeat without breaking a scrape.

    *exclude_job_ids* lets a caller running as an arq job itself (e.g. the
    reconciliation sweep's own cron job — see ``reconciliation.py``) discount
    its own in-flight entry from ``depth``. arq keeps queued *and*
    currently-executing job IDs in the queue sorted set until the job
    finishes, so without this a periodic cron job would always observe
    ``depth >= 1`` (itself) and never treat the queue as idle. When set,
    ``depth`` and ``oldest_pending_age_seconds`` are both derived from a
    single ``ZRANGE`` snapshot (rather than separate ``ZCARD``/``ZRANK``
    calls) so a job enqueued between reads can't be double-counted or
    dropped, and so the reported oldest-entry age can never describe an
    entry that ``depth`` has excluded.
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
        health_check_interval = WorkerSettings.health_check_interval
        if exclude_job_ids:
            # Read depth, exclusions, and the oldest-entry age from a single
            # ZRANGE snapshot rather than separate ZCARD/ZRANK/ZRANGE calls:
            # a job enqueued between separate reads could otherwise leave
            # depth understating real queue contents (or the oldest-age
            # figure describing an entry that depth has excluded).
            members = await pool.zrange(ARQ_QUEUE_NAME, 0, -1, withscores=True)
            kept = [
                (member, score)
                for member, score in members
                if _decode_member(member) not in exclude_job_ids
            ]
            depth = len(kept)
            oldest_age = None
            if kept:
                oldest_score = min(score for _member, score in kept)
                oldest_age = max(0.0, (now_ms - float(oldest_score)) / 1000)
        else:
            depth = await pool.zcard(ARQ_QUEUE_NAME)
            oldest = await pool.zrange(ARQ_QUEUE_NAME, 0, 0, withscores=True)
            oldest_age = None
            if oldest:
                score = oldest[0][1]
                oldest_age = max(0.0, (now_ms - float(score)) / 1000)
        remaining_ttl = await pool.ttl(HEALTH_CHECK_KEY)
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
