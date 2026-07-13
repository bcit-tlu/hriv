"""Authenticated ingestion endpoint for frontend telemetry events.

Frontend events are sent here instead of directly to the OpenTelemetry collector
so that the backend can authenticate the caller, validate the event schema, and
prevent arbitrary event injection into the observability pipeline. The endpoint
returns quickly (202 Accepted) and emits structured logs that the OTel logging
handler forwards to the collector.
"""

from __future__ import annotations

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, Request, Response
from pydantic import BaseModel, Field
from pydantic.config import ConfigDict

from ..auth import get_current_user
from ..models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/telemetry", tags=["telemetry"])


# Event names the frontend is allowed to emit. Keep this allowlist small and
# review any new event for privacy/PII implications before adding it.
_ALLOWED_EVENTS = frozenset({
    "image.view.started",
    "image.view.ready",
    "image.view.failed",
    "navigation.page_changed",
})

# Hard limits to prevent accidental or malicious payload abuse. These are
# per-request guards; per-session/per-user rate limiting should be added at the
# edge (e.g. ingress/rate-limiter) or via Redis if abuse becomes a concern.
_MAX_EVENTS_PER_REQUEST = 10
_MAX_ATTRIBUTE_LENGTH = 1000


class TelemetryEvent(BaseModel):
    """A single frontend telemetry event."""

    model_config = ConfigDict(extra="forbid")

    event: str = Field(..., description="Stable, dotted event name")
    outcome: Literal["success", "failure", "unknown"] | None = None
    duration_ms: float | None = None
    error: str | None = Field(None, max_length=_MAX_ATTRIBUTE_LENGTH)
    action: str | None = Field(None, max_length=_MAX_ATTRIBUTE_LENGTH)
    page: str | None = Field(None, max_length=_MAX_ATTRIBUTE_LENGTH)
    synthetic: bool | None = None


class TelemetryBatch(BaseModel):
    """Batch of frontend telemetry events."""

    model_config = ConfigDict(extra="forbid")

    events: list[TelemetryEvent] = Field(..., max_length=_MAX_EVENTS_PER_REQUEST)


@router.post("/events", status_code=202)
async def ingest_telemetry_events(
    batch: TelemetryBatch,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    x_session_id: Annotated[str | None, Header(alias="X-Session-ID")] = None,
) -> Response:
    """Accept a batch of validated frontend telemetry events.

    Events are emitted as structured logs so the OTel logging handler can
    forward them to the collector. Invalid or unknown events are dropped silently
    to keep the endpoint fast and resilient.
    """
    for event in batch.events:
        if event.event not in _ALLOWED_EVENTS:
            continue

        extra: dict[str, object] = {
            "event.name": event.event,
            "event.outcome": event.outcome or "unknown",
            "browser.tab.session_id": x_session_id or "unknown",
            "user.id": user.id,
            "user.role": user.role,
        }
        if event.duration_ms is not None:
            extra["event.duration_ms"] = event.duration_ms
        if event.action:
            extra["event.action"] = event.action
        if event.page:
            extra["event.page"] = event.page
        if event.error:
            extra["error.type"] = event.error
        if event.synthetic:
            extra["event.synthetic"] = True

        # Propagate any trace context from the incoming request so frontend
        # spans and backend logs stay correlated.
        traceparent = request.headers.get("traceparent")
        if traceparent:
            extra["trace.parent"] = traceparent

        logger.info("frontend telemetry event", extra=extra)

    return Response(status_code=202)


