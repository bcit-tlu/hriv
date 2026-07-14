"""Prometheus-format gauges for authoritative synthetic journey state."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from threading import Lock

from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Gauge, generate_latest

from .synthetic_result import (
    SYNTHETIC_STEP_NAMES,
    StoredSyntheticJourneyState,
    load_stored_synthetic_result_state,
)

_registry = CollectorRegistry()
_render_lock = Lock()

_synthetic_last_run = Gauge(
    "hriv_synthetic_last_run_timestamp_seconds",
    "Unix timestamp of the most recent completed synthetic journey run",
    registry=_registry,
)
_synthetic_last_success = Gauge(
    "hriv_synthetic_last_success_timestamp_seconds",
    "Unix timestamp of the most recent successful synthetic journey run",
    registry=_registry,
)
_synthetic_journey_success = Gauge(
    "hriv_synthetic_journey_success",
    "Outcome of the most recent synthetic journey run: 1 success, 0 failure or missing",
    registry=_registry,
)
_synthetic_journey_duration = Gauge(
    "hriv_synthetic_journey_duration_seconds",
    "Duration in seconds of the most recent synthetic journey run",
    registry=_registry,
)
_synthetic_result_age = Gauge(
    "hriv_synthetic_result_age_seconds",
    "Seconds since the most recent completed synthetic journey run; +Inf if no result exists",
    registry=_registry,
)
_synthetic_step_success = Gauge(
    "hriv_synthetic_step_success",
    "Outcome of each step in the most recent synthetic journey run: 1 success, 0 failure or not reached",
    labelnames=("step",),
    registry=_registry,
)
_synthetic_step_duration = Gauge(
    "hriv_synthetic_step_duration_seconds",
    "Duration in seconds of each step in the most recent synthetic journey run; 0 when the step was not reached",
    labelnames=("step",),
    registry=_registry,
)


def _render_synthetic_metrics_payload(state) -> tuple[bytes, str]:
    """Render Prometheus exposition text for the given synthetic journey state."""
    with _render_lock:
        if state is None:
            _synthetic_last_run.set(0)
            _synthetic_last_success.set(0)
            _synthetic_journey_success.set(0)
            _synthetic_journey_duration.set(0)
            _synthetic_result_age.set(float("inf"))
            for step_name in SYNTHETIC_STEP_NAMES:
                _synthetic_step_success.labels(step=step_name).set(0)
                _synthetic_step_duration.labels(step=step_name).set(0)
            return generate_latest(_registry), CONTENT_TYPE_LATEST

        latest = state.latest_result
        latest_completed_at = latest.completed_at.timestamp()
        _synthetic_last_run.set(latest_completed_at)
        _synthetic_last_success.set(
            state.last_success_completed_at.timestamp()
            if state.last_success_completed_at is not None
            else 0
        )
        _synthetic_journey_success.set(1 if latest.success else 0)
        _synthetic_journey_duration.set(latest.duration_ms / 1000.0)
        _synthetic_result_age.set(
            max(datetime.now(timezone.utc).timestamp() - latest_completed_at, 0)
        )

        steps_by_name = {step.name: step for step in latest.steps}
        for step_name in SYNTHETIC_STEP_NAMES:
            step = steps_by_name.get(step_name)
            _synthetic_step_success.labels(step=step_name).set(
                1 if step is not None and step.success else 0
            )
            _synthetic_step_duration.labels(step=step_name).set(
                (step.duration_ms / 1000.0) if step is not None else 0
            )

        return generate_latest(_registry), CONTENT_TYPE_LATEST


async def render_synthetic_metrics(
    state: StoredSyntheticJourneyState | None = None,
) -> tuple[bytes, str]:
    """Return Prometheus exposition text for the stored synthetic journey state."""
    if state is None:
        state = await load_stored_synthetic_result_state()
    return await asyncio.to_thread(_render_synthetic_metrics_payload, state)
