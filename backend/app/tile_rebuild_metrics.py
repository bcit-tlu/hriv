"""Tile-rebuild observability: OTel instruments and scrape-time gauges.

Emits the ``hriv.tile_rebuild.*`` contract for the durable parallel
tile-rebuild scheduler (#1189). Counters and histograms are OpenTelemetry
instruments: they are recorded in whichever process runs the code path — the
arq worker for pump/child execution and the API for creation and
cancellation — and exported via OTLP. Durable-state gauges are rendered at
``/api/metrics`` from PostgreSQL so worker-side execution is visible on the
API pod's scrape endpoint.

Label discipline follows ``docs/observability-conventions.md``: only bounded
``outcome`` / ``reason`` / ``state`` attributes. Job, item, and source-image
IDs stay in span attributes and structured logs — never in metric labels.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from opentelemetry import metrics
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Gauge, generate_latest
from sqlalchemy import func, select

from .database import get_async_session
from .models import ACTIVE_JOB_STATUSES, Job, JobItem

REBUILD_JOB_TYPE = "rebuild_tiles"

REBUILD_ITEM_OUTCOMES = frozenset(
    {"completed", "skipped", "failed", "cancelled"}
)
REBUILD_RETRY_REASONS = frozenset(
    {"transient", "lease_expired", "dispatch", "manual"}
)
REBUILD_RECLAIM_STATES = frozenset({"claimed", "started"})
REBUILD_PUMP_OUTCOMES = frozenset(
    {"dispatched", "idle", "locked", "failed"}
)
REBUILD_ENQUEUE_FAILURE_REASONS = frozenset(
    {"queue_unavailable", "submission_error"}
)

_meter = metrics.get_meter(__name__)

_item_duration = _meter.create_histogram(
    "hriv.tile_rebuild.item.duration",
    description="Per-item execution time from reservation to terminal outcome",
    unit="s",
)
_item_queue_wait = _meter.create_histogram(
    "hriv.tile_rebuild.item.queue_wait",
    description="Time from claim commit to execution reservation per attempt",
    unit="s",
)
_supervisor_duration = _meter.create_histogram(
    "hriv.tile_rebuild.supervisor.duration",
    description="Supervisor wall-clock time from start to terminal status",
    unit="s",
)
_cancellation_latency = _meter.create_histogram(
    "hriv.tile_rebuild.cancellation.latency",
    description="Time from cancellation request to cancelled supervisor status",
    unit="s",
)
_items_completed = _meter.create_counter(
    "hriv.tile_rebuild.items.completed",
    description="Child items reaching a terminal outcome",
    unit="1",
)
_item_retries = _meter.create_counter(
    "hriv.tile_rebuild.item.retries",
    description="Item attempts returned to queued for another try",
    unit="1",
)
_item_timeouts = _meter.create_counter(
    "hriv.tile_rebuild.item.timeouts",
    description="Item failures whose exception chain contains a timeout",
    unit="1",
)
_lease_reclaims = _meter.create_counter(
    "hriv.tile_rebuild.lease.reclaims",
    description="Running items reclaimed after lease expiry",
    unit="1",
)
_pump_runs = _meter.create_counter(
    "hriv.tile_rebuild.pump.runs",
    description="Tile-rebuild pump outcomes",
    unit="1",
)
_enqueue_failures = _meter.create_counter(
    "hriv.tile_rebuild.enqueue.failures",
    description="arq submissions that could not be delivered",
    unit="1",
)
_duplicate_deliveries = _meter.create_counter(
    "hriv.tile_rebuild.duplicate_deliveries",
    description="Child deliveries that found the claim already superseded",
    unit="1",
)

_registry = CollectorRegistry()
_active_jobs = Gauge(
    "hriv_tile_rebuild_jobs_active",
    "Durable tile-rebuild supervisors in an active state",
    registry=_registry,
)
_active_children = Gauge(
    "hriv_tile_rebuild_active_children",
    "Running tile-rebuild items under active supervisors (effective parallelism)",
    registry=_registry,
)
_queued_items = Gauge(
    "hriv_tile_rebuild_queued_items",
    "Queued tile-rebuild items under active supervisors",
    registry=_registry,
)

_STATE_READ_TIMEOUT_SECONDS = 5


def record_item_terminal(
    outcome: str,
    *,
    duration_seconds: float | None = None,
    count: int = 1,
) -> None:
    """Count item terminal transitions and an optional execution duration."""
    if outcome not in REBUILD_ITEM_OUTCOMES or count <= 0:
        return
    _items_completed.add(count, {"outcome": outcome})
    if count == 1 and duration_seconds is not None and duration_seconds >= 0:
        _item_duration.record(duration_seconds)


def record_item_retry(reason: str, *, count: int = 1) -> None:
    """Count item attempts returned to ``queued`` for another try."""
    if reason not in REBUILD_RETRY_REASONS or count <= 0:
        return
    _item_retries.add(count, {"reason": reason})


def record_item_timeout() -> None:
    """Count one item failure whose exception chain contains a timeout."""
    _item_timeouts.add(1)


def record_queue_wait(seconds: float) -> None:
    """Record claim-commit to execution-reservation latency."""
    if seconds >= 0:
        _item_queue_wait.record(seconds)


def record_lease_reclaims(*, claimed: int = 0, started: int = 0) -> None:
    """Count expired-lease reclaims by whether execution had started."""
    if claimed > 0:
        _lease_reclaims.add(claimed, {"state": "claimed"})
    if started > 0:
        _lease_reclaims.add(started, {"state": "started"})


def record_pump_run(outcome: str) -> None:
    """Count one pump cycle result."""
    if outcome not in REBUILD_PUMP_OUTCOMES:
        return
    _pump_runs.add(1, {"outcome": outcome})


def record_enqueue_failure(reason: str) -> None:
    """Count one arq submission that could not be delivered."""
    if reason not in REBUILD_ENQUEUE_FAILURE_REASONS:
        return
    _enqueue_failures.add(1, {"reason": reason})


def record_duplicate_delivery() -> None:
    """Count one child delivery that found its claim already superseded."""
    _duplicate_deliveries.add(1)


def record_supervisor_terminal(
    *,
    duration_seconds: float | None,
    cancellation_seconds: float | None,
) -> None:
    """Record supervisor wall-clock duration and optional cancel latency."""
    if duration_seconds is not None and duration_seconds >= 0:
        _supervisor_duration.record(duration_seconds)
    if cancellation_seconds is not None and cancellation_seconds >= 0:
        _cancellation_latency.record(cancellation_seconds)


def metadata_timestamp(
    metadata: dict | None,
    key: str,
) -> datetime | None:
    """Parse an ISO-8601 timestamp stored in a JSONB metadata field."""
    value = (metadata or {}).get(key)
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed


async def collect_tile_rebuild_state() -> dict[str, Any]:
    """Read durable rebuild state for the scrape-time gauges.

    PostgreSQL is authoritative for running/queued item counts, so the API
    pod's ``/api/metrics`` reflects work executing on the dedicated worker.
    A failed or slow read degrades to ``NaN`` rather than breaking the scrape.
    """
    state: dict[str, Any] = {
        "active_jobs": None,
        "running_items": None,
        "queued_items": None,
    }

    async def read_state() -> tuple[int, dict[str, int]]:
        async with get_async_session()() as session:
            active_jobs = int(
                (
                    await session.execute(
                        select(func.count())
                        .select_from(Job)
                        .where(
                            Job.job_type == REBUILD_JOB_TYPE,
                            Job.status.in_(ACTIVE_JOB_STATUSES),
                        )
                    )
                ).scalar_one()
            )
            rows = (
                await session.execute(
                    select(JobItem.status, func.count())
                    .join(Job, JobItem.job_id == Job.id)
                    .where(
                        Job.job_type == REBUILD_JOB_TYPE,
                        Job.status.in_(ACTIVE_JOB_STATUSES),
                    )
                    .group_by(JobItem.status)
                )
            ).all()
            return active_jobs, {status: int(count) for status, count in rows}

    try:
        active_jobs, counts = await asyncio.wait_for(
            read_state(),
            timeout=_STATE_READ_TIMEOUT_SECONDS,
        )
        state["active_jobs"] = active_jobs
        state["running_items"] = counts.get("running", 0)
        state["queued_items"] = counts.get("queued", 0)
    except Exception:
        pass
    return state


async def render_tile_rebuild_metrics() -> tuple[bytes, str]:
    """Render durable tile-rebuild gauges for the Prometheus endpoint."""
    state = await collect_tile_rebuild_state()
    _active_jobs.set(
        float("nan") if state["active_jobs"] is None else state["active_jobs"]
    )
    _active_children.set(
        float("nan")
        if state["running_items"] is None
        else state["running_items"]
    )
    _queued_items.set(
        float("nan") if state["queued_items"] is None else state["queued_items"]
    )
    return generate_latest(_registry), CONTENT_TYPE_LATEST
