"""Prometheus-format build information metrics for deployed HRIV components."""

from __future__ import annotations

import asyncio
from threading import Lock

from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Gauge, generate_latest

from .component_versions import (
    get_backend_commit_sha,
    get_backend_version,
    get_backup_commit_sha,
    get_backup_version,
    get_frontend_commit_sha,
    get_frontend_version,
    get_synthetic_commit_sha,
    get_synthetic_version,
    get_worker_commit_sha,
    get_worker_version,
)
from .synthetic_result import StoredSyntheticJourneyState, load_stored_synthetic_result_state

_registry = CollectorRegistry()
_render_lock = Lock()

_build_info = Gauge(
    "hriv_build_info",
    "Build identity for deployed HRIV components with version and commit labels",
    labelnames=("component", "version", "commit_sha"),
    registry=_registry,
)


def _render_build_info_payload(state: StoredSyntheticJourneyState | None) -> tuple[bytes, str]:
    synthetic_version = (
        state.latest_result.component_version
        if state is not None and state.latest_result.component_version
        else None
    )

    rows = (
        ("backend", get_backend_version(), get_backend_commit_sha()),
        ("worker", get_worker_version(), get_worker_commit_sha()),
        ("backup", get_backup_version(), get_backup_commit_sha()),
        ("frontend", get_frontend_version(), get_frontend_commit_sha()),
        ("synthetic", get_synthetic_version(synthetic_version), get_synthetic_commit_sha()),
    )

    with _render_lock:
        _build_info.clear()
        for component, version, commit_sha in rows:
            _build_info.labels(
                component=component,
                version=version,
                commit_sha=commit_sha,
            ).set(1)

        return generate_latest(_registry), CONTENT_TYPE_LATEST


async def render_build_info_metrics() -> tuple[bytes, str]:
    """Return Prometheus exposition text for HRIV component build identities."""
    state = await load_stored_synthetic_result_state()
    return await asyncio.to_thread(_render_build_info_payload, state)
