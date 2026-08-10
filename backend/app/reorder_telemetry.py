"""Correlation and structured-log helpers for reorder endpoints.

The frontend generates one ``operation_id`` per ordering operation and sends it
on persistence requests via the ``X-Reorder-Operation-Id`` header. These
helpers validate that header (bounded, low-risk charset) and emit one
structured log line per reorder request so a single operation can be followed
end-to-end across frontend events, backend spans, and logs.
"""

from __future__ import annotations

import logging
import re

from fastapi import HTTPException
from opentelemetry.trace import Span

from .middleware import get_request_id
from .reorder_metrics import observe_reorder_request

logger = logging.getLogger(__name__)

REORDER_OPERATION_ID_HEADER = "X-Reorder-Operation-Id"

# UUIDs plus a little slack; anything else is dropped so arbitrary client text
# never reaches traces or logs.
_OPERATION_ID_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")


def sanitize_reorder_operation_id(value: str | None) -> str | None:
    """Return *value* when it is a safe correlation ID, else ``None``."""
    if value is None or not _OPERATION_ID_RE.fullmatch(value):
        return None
    return value


def annotate_reorder_span(
    span: Span, *, entity: str, operation_id: str | None, item_count: int
) -> None:
    """Attach the shared reorder correlation attributes to *span*."""
    span.set_attribute("reorder.entity", entity)
    span.set_attribute("reorder.item_count", item_count)
    if operation_id is not None:
        span.set_attribute("reorder.operation_id", operation_id)


def classify_reorder_exception(exc: Exception) -> str:
    """Map an exception from a reorder endpoint to a bounded outcome.

    Mirrors the span convention in ``tracing.py``: 4xx HTTPExceptions are
    expected application behaviour and must not inflate the failure rate.
    409 marks an ordering conflict; other 4xx are client errors; everything
    else is a genuine server failure.
    """
    if isinstance(exc, HTTPException):
        if exc.status_code == 409:
            return "conflict"
        if 400 <= exc.status_code < 500:
            return "client_error"
    return "failure"


def record_reorder_result(
    *,
    entity: str,
    operation_id: str | None,
    item_count: int,
    duration_seconds: float,
    outcome: str,
) -> None:
    """Emit the structured log line and metrics for one reorder request."""
    observe_reorder_request(
        entity,
        duration_seconds=duration_seconds,
        item_count=item_count,
        outcome=outcome,
    )
    logger.info(
        "reorder.persisted",
        extra={
            "event.name": "reorder.persisted",
            "reorder.entity": entity,
            "reorder.operation_id": operation_id or "unknown",
            "reorder.item_count": item_count,
            "reorder.duration_seconds": round(duration_seconds, 6),
            "reorder.outcome": outcome,
            "request_id": get_request_id() or "unknown",
        },
    )
