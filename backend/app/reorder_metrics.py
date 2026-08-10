"""Prometheus metrics for ordering (reorder) operations.

Server-side reorder requests are observed by ``PUT /api/tile-order``, the
sole ordering writer (the per-entity category/image reorder endpoints were
removed in #998, so their ``entity`` labels only appear in historical data).
Client-side operation states (ignored, queued, coalesced, stale-discarded, …)
are counted when the authenticated telemetry ingestion endpoint accepts a
``reorder.operation`` event.

Labels stay on the bounded allowlist in ``docs/observability-conventions.md``:
entity (``tile``; ``category``/``image`` are legacy), outcome, and a small closed set of client
operation states. Operation IDs, category IDs, and revisions belong in traces
and structured logs, never in metric labels.
"""

from __future__ import annotations

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Histogram,
    generate_latest,
)

_registry = CollectorRegistry()

REORDER_ENTITIES = frozenset({"category", "image", "tile"})
# Sentinel that unrecognized entities are coerced to, and the full domain of
# the `entity` metric label (the caller allowlist plus the sentinel).
REORDER_ENTITY_OTHER = "other"
REORDER_ENTITY_LABELS = REORDER_ENTITIES | frozenset({REORDER_ENTITY_OTHER})
REORDER_OUTCOMES = frozenset({"success", "failure", "conflict", "client_error"})

# The frontend reorder diagnostics vocabulary
# (frontend/src/reorderDiagnostics.ts) plus the "other" sentinel that
# unrecognized client-supplied states are coerced to server-side.
REORDER_CLIENT_STATES = frozenset({
    "ignored",
    "queued",
    "coalesced",
    "submitted",
    "committed",
    "conflicted",
    "failed",
    "stale_discarded",
    "abandoned",
    "other",
})

_request_duration = Histogram(
    "hriv_reorder_request_duration_seconds",
    "Duration of reorder persistence requests by entity",
    labelnames=("entity",),
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
    registry=_registry,
)
_request_items = Histogram(
    "hriv_reorder_request_items",
    "Number of items in each reorder persistence request by entity",
    labelnames=("entity",),
    buckets=(1, 5, 10, 25, 50, 100, 250, 500, 1000),
    registry=_registry,
)
_requests_total = Counter(
    "hriv_reorder_requests_total",
    "Reorder persistence requests by entity and outcome",
    labelnames=("entity", "outcome"),
    registry=_registry,
)
_client_operations_total = Counter(
    "hriv_reorder_client_operations_total",
    "Client-reported reorder operation state transitions",
    labelnames=("state",),
    registry=_registry,
)


def observe_reorder_request(
    entity: str, *, duration_seconds: float, item_count: int, outcome: str
) -> None:
    """Record one server-side reorder request observation."""
    if entity not in REORDER_ENTITIES:
        entity = REORDER_ENTITY_OTHER
    if outcome not in REORDER_OUTCOMES:
        outcome = "failure"
    _request_duration.labels(entity=entity).observe(duration_seconds)
    _request_items.labels(entity=entity).observe(item_count)
    _requests_total.labels(entity=entity, outcome=outcome).inc()


def record_client_reorder_operation(state: str | None) -> None:
    """Count one client-reported reorder operation state transition."""
    if state not in REORDER_CLIENT_STATES:
        state = "other"
    _client_operations_total.labels(state=state).inc()


def render_reorder_metrics() -> tuple[bytes, str]:
    """Render the reorder metrics Prometheus exposition payload."""
    return generate_latest(_registry), CONTENT_TYPE_LATEST
