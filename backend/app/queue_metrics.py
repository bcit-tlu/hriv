"""Task queue metrics and health state."""

from __future__ import annotations

import time
from typing import Any

from arq.constants import default_queue_name, health_check_key_suffix
from opentelemetry import metrics
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Gauge, generate_latest
from redis.exceptions import RedisError

from .database import settings

_meter = metrics.get_meter(__name__)
_enqueue_counter = _meter.create_counter(
    "hriv.task_enqueue.completed",
    description="Task enqueue outcomes by job type",
    unit="1",
)

_registry = CollectorRegistry()
_queue_up = Gauge("hriv_task_queue_up", "Whether Redis is reachable", registry=_registry)
_queue_depth = Gauge("hriv_task_queue_depth", "Number of pending arq jobs", registry=_registry)
_oldest_pending_age = Gauge(
    "hriv_task_queue_oldest_pending_age_seconds",
    "Age of the oldest pending arq job",
    registry=_registry,
)
_heartbeat_age = Gauge(
    "hriv_task_queue_worker_heartbeat_age_seconds",
    "Age of the worker heartbeat",
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


def record_enqueue(job_type: str, outcome: str, reason: str) -> None:
    """Record one bounded enqueue outcome in OpenTelemetry."""
    _enqueue_counter.add(
        1,
        {"job_type": job_type, "outcome": outcome, "reason": reason},
    )


async def collect_queue_state() -> dict[str, Any]:
    """Read queue depth and worker heartbeat without breaking a scrape."""
    from .worker import WorkerSettings, _invalidate_pool, get_pool

    pool = await get_pool()
    state: dict[str, Any] = {
        "queue_up": pool is not None,
        "depth": None,
        "oldest_pending_age_seconds": None,
        "worker_heartbeat_age_seconds": None,
    }
    if pool is None:
        return state
    try:
        now_ms = time.time() * 1000
        health_check_interval = WorkerSettings.health_check_interval
        state["depth"] = await pool.zcard(ARQ_QUEUE_NAME)
        oldest = await pool.zrange(ARQ_QUEUE_NAME, 0, 0, withscores=True)
        if oldest:
            score = oldest[0][1] if isinstance(oldest[0], tuple) else oldest[0]
            state["oldest_pending_age_seconds"] = max(0.0, (now_ms - float(score)) / 1000)
        remaining_ttl = await pool.ttl(HEALTH_CHECK_KEY)
        if remaining_ttl != -2:
            state["worker_heartbeat_age_seconds"] = (
                0.0
                if remaining_ttl == -1
                else max(
                    0.0,
                    health_check_interval + 1 - float(remaining_ttl),
                )
            )
    except RedisError:
        _invalidate_pool()
        state["queue_up"] = False
    except Exception:
        state["queue_up"] = False
    return state


async def render_queue_metrics() -> tuple[bytes, str]:
    """Render queue gauges for the backend Prometheus endpoint."""
    state = await collect_queue_state()
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
    _execution_mode.labels(mode=settings.task_execution_mode).set(1)
    return generate_latest(_registry), CONTENT_TYPE_LATEST


async def queue_health() -> dict[str, Any]:
    """Return the queue and worker liveness state for the health endpoint."""
    state = await collect_queue_state()
    state["mode"] = settings.task_execution_mode
    state["worker_up"] = state["worker_heartbeat_age_seconds"] is not None
    state["degraded"] = not state["queue_up"] or not state["worker_up"]
    return state
