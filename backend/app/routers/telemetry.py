"""Authenticated ingestion endpoint for frontend telemetry events.

Frontend events are sent here instead of directly to the OpenTelemetry collector
so that the backend can authenticate the caller, validate the event schema, and
prevent arbitrary event injection into the observability pipeline. The endpoint
returns quickly (202 Accepted) and emits structured logs that the OTel logging
handler forwards to the collector.

Design constraints for decision-maker analytics:

- Events are **versioned** (``schema_version``) so dashboards and log parsers
  can evolve without silently misreading older records.
- Domain identifiers (image id, category id) are emitted as **structured event
  fields**, never as Prometheus labels, to keep cardinality out of metrics.
- Client environment is reduced to **bounded, low-cardinality buckets**
  (browser family/major, OS family, device class, viewport bucket, touch) and
  coerced against allowlists so a client cannot inject high-cardinality or
  free-text values.
- ``synthetic`` is decided **server-side** from the authenticated user's stored
  metadata; the client-supplied flag can only ever add to (never clear) that.
"""

from __future__ import annotations

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from pydantic.config import ConfigDict

from ..auth import get_current_user
from ..auth_events import is_synthetic_user
from ..models import User
from ..rate_limit import check_telemetry_rate_limit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/telemetry", tags=["telemetry"])


# Bump when the wire/log shape changes in a backward-incompatible way.
TELEMETRY_SCHEMA_VERSION = 1


# Event names the frontend is allowed to emit. Keep this allowlist small and
# review any new event for privacy/PII implications before adding it.
_ALLOWED_EVENTS = frozenset({
    "image.view.started",
    "image.view.ready",
    "image.view.failed",
    "navigation.page_changed",
})

# Hard limits to prevent accidental or malicious payload abuse. These are
# per-request guards; per-user rate limiting is enforced separately below via
# the shared Redis rate limiter.
_MAX_EVENTS_PER_REQUEST = 10
_MAX_ATTRIBUTE_LENGTH = 1000

# Bounded allowlists for client-environment buckets. Anything outside these
# sets is coerced to "other" so metrics/dashboards stay low-cardinality and a
# client cannot inject arbitrary strings into the analytics pipeline.
_BROWSER_FAMILIES = frozenset({
    "chrome", "firefox", "safari", "edge", "opera", "samsung", "other",
})
_OS_FAMILIES = frozenset({
    "windows", "macos", "ios", "android", "linux", "chromeos", "other",
})
_DEVICE_CLASSES = frozenset({"desktop", "mobile", "tablet", "other"})
_VIEWPORT_BUCKETS = frozenset({"xs", "sm", "md", "lg", "xl"})


def _bounded(value: str | None, allowed: frozenset[str]) -> str | None:
    """Return *value* when in *allowed*, else ``"other"`` (or ``None`` if unset)."""
    if value is None:
        return None
    return value if value in allowed else "other"


def _bounded_major(value: str | None) -> str | None:
    """Return a browser major version as a bare number string, else ``"other"``.

    Browser majors are inherently low-cardinality numeric strings; anything a
    client sends that is not a short run of digits is coerced to ``"other"`` so
    the field cannot carry arbitrary text into the analytics pipeline.
    """
    if value is None:
        return None
    return value if value.isdigit() and len(value) <= 4 else "other"


class TelemetryEvent(BaseModel):
    """A single frontend telemetry event."""

    model_config = ConfigDict(extra="forbid")

    event: str = Field(..., max_length=100, description="Stable, dotted event name")
    # Only the current schema version is accepted; an omitted version is treated
    # as the current one for backward compatibility, but an explicit unsupported
    # version is rejected (422) so the log shape stays well-defined.
    schema_version: Literal[1] | None = None
    outcome: Literal["success", "failure", "unknown"] | None = None
    duration_ms: float | None = None
    error: str | None = Field(None, max_length=_MAX_ATTRIBUTE_LENGTH)
    action: str | None = Field(None, max_length=_MAX_ATTRIBUTE_LENGTH)
    page: str | None = Field(None, max_length=_MAX_ATTRIBUTE_LENGTH)
    synthetic: bool | None = None

    # Structured domain identifiers (never used as Prometheus labels).
    image_id: int | None = None
    category_id: int | None = None

    # Bounded client-environment buckets.
    browser_family: str | None = Field(None, max_length=32)
    browser_major: str | None = Field(None, max_length=16)
    os_family: str | None = Field(None, max_length=32)
    device_class: str | None = Field(None, max_length=32)
    viewport_bucket: str | None = Field(None, max_length=8)
    touch: bool | None = None


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
    to keep the endpoint fast and resilient. Per-user + per-tab rate limiting
    protects the log pipeline from a misbehaving client without letting tabs of a
    shared student account throttle one another.
    """
    retry_after = await check_telemetry_rate_limit(user.id, x_session_id)
    if retry_after is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Telemetry rate limit exceeded.",
            headers={"Retry-After": str(retry_after)},
        )

    # Synthetic classification is authoritative from the authenticated user's
    # stored metadata. A client-supplied ``synthetic`` flag is never trusted to
    # decide this (it could otherwise hide a real user's traffic from reports);
    # it is recorded separately below purely as a non-authoritative hint for
    # monitor correlation.
    server_synthetic = is_synthetic_user(user)

    # Propagate any trace context from the incoming request so frontend spans
    # and backend logs stay correlated. Computed once per request.
    traceparent = request.headers.get("traceparent")

    for event in batch.events:
        if event.event not in _ALLOWED_EVENTS:
            continue

        extra: dict[str, object] = {
            "schema.version": event.schema_version or TELEMETRY_SCHEMA_VERSION,
            "event.name": event.event,
            "event.outcome": event.outcome or "unknown",
            "event.synthetic": server_synthetic,
            "browser.tab.session_id": x_session_id or "unknown",
            "user.id": user.id,
            "user.role": user.role,
        }
        # Non-authoritative client hint, kept only for monitor correlation and
        # never used as the analytics synthetic dimension.
        if event.synthetic is not None:
            extra["event.client_synthetic"] = event.synthetic
        if event.duration_ms is not None:
            extra["event.duration_ms"] = event.duration_ms
        if event.action:
            extra["event.action"] = event.action
        if event.page:
            extra["event.page"] = event.page
        if event.error:
            extra["error.type"] = event.error
        if event.image_id is not None:
            extra["image.id"] = event.image_id
        if event.category_id is not None:
            extra["category.id"] = event.category_id

        browser_family = _bounded(event.browser_family, _BROWSER_FAMILIES)
        if browser_family is not None:
            extra["client.browser.family"] = browser_family
        browser_major = _bounded_major(event.browser_major)
        if browser_major is not None:
            extra["client.browser.major"] = browser_major
        os_family = _bounded(event.os_family, _OS_FAMILIES)
        if os_family is not None:
            extra["client.os.family"] = os_family
        device_class = _bounded(event.device_class, _DEVICE_CLASSES)
        if device_class is not None:
            extra["client.device.class"] = device_class
        viewport_bucket = _bounded(event.viewport_bucket, _VIEWPORT_BUCKETS)
        if viewport_bucket is not None:
            extra["client.viewport.bucket"] = viewport_bucket
        if event.touch is not None:
            extra["client.touch"] = event.touch

        if traceparent:
            extra["trace.parent"] = traceparent

        logger.info("frontend telemetry event", extra=extra)

    return Response(status_code=202)
