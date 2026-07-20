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
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..auth_events import is_synthetic_user
from ..database import get_db
from ..models import Category, Image, User
from ..rate_limit import check_telemetry_rate_limit
from ..synthetic_result import (
    StaleSyntheticResultError,
    StoredSyntheticJourneyState,
    SyntheticJourneyResult,
    SyntheticResultStorageUnavailableError,
    store_synthetic_result,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/telemetry", tags=["telemetry"])


# Bump when the wire/log shape changes in a backward-incompatible way.
TELEMETRY_SCHEMA_VERSION = 2


# Event names the frontend is allowed to emit. Keep this allowlist small and
# review any new event for privacy/PII implications before adding it.
_ALLOWED_EVENTS = frozenset({
    "annotation.created",
    "annotation.deleted",
    "application.session_heartbeat",
    "application.session_started",
    "auth.login_succeeded",
    "auth.logout_selected",
    "category.created",
    "feedback.report_issue_opened",
    "feedback.report_issue_submitted",
    "frontend.error",
    "frontend.performance",
    "image.share_selected",
    "image.upload.completed",
    "image.view.started",
    "image.view.ready",
    "image.view.ended",
    "image.view.failed",
    "navigation.page_changed",
    "ui.toolbar_action",
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
_PAGES = frozenset({"browse", "manage", "people", "admin", "unknown", "other"})
_NAV_DIRECTIONS = frozenset({"down", "up", "jump"})
_VIEWPORT_BUCKETS = frozenset({"xs", "sm", "md", "lg", "xl"})
_UNITS = frozenset({"ms", "score"})
_UPLOAD_MODES = frozenset({"single", "bulk"})
_FILE_TYPES = frozenset({
    "jpg", "jpeg", "png", "gif", "webp", "tif", "tiff", "svs", "zip",
    "mixed", "other",
})
_ERROR_CODES = frozenset({
    "api_http_4xx",
    "api_http_5xx",
    "api_network_error",
    "image_viewer_init_failed",
    "image_viewer_open_failed",
    "react_render_error",
    "unhandled_promise_rejection",
    "window_runtime_error",
    "other",
})


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

    model_config = ConfigDict(extra="ignore")

    event: str = Field(..., max_length=100, description="Stable, dotted event name")
    # Only the current schema version is accepted; an omitted version is treated
    # as the current one for backward compatibility, but an explicit unsupported
    # version is rejected (422) so the log shape stays well-defined.
    schema_version: Literal[1, 2] | None = None
    event_version: Literal[1] | None = None
    outcome: Literal["success", "failure", "unknown"] | None = None
    duration_ms: float | None = None
    error: str | None = Field(None, max_length=_MAX_ATTRIBUTE_LENGTH)
    error_code: str | None = Field(None, max_length=64)
    action: str | None = Field(None, max_length=_MAX_ATTRIBUTE_LENGTH)
    page: str | None = Field(None, max_length=_MAX_ATTRIBUTE_LENGTH)
    from_page: str | None = Field(None, max_length=32)
    direction: str | None = Field(None, max_length=16)
    synthetic: bool | None = None
    request_id: str | None = Field(None, max_length=128)
    trace_id: str | None = Field(None, max_length=64)
    value: float | None = None
    unit: str | None = Field(None, max_length=16)
    upload_mode: str | None = Field(None, max_length=16)
    file_type: str | None = Field(None, max_length=16)

    # Structured domain identifiers (never used as Prometheus labels).
    image_id: int | None = None
    category_id: int | None = None
    from_category_id: int | None = None

    # Bounded client-environment buckets.
    browser_family: str | None = Field(None, max_length=32)
    browser_major: str | None = Field(None, max_length=16)
    os_family: str | None = Field(None, max_length=32)
    device_class: str | None = Field(None, max_length=32)
    viewport_bucket: str | None = Field(None, max_length=8)
    touch_capable: bool | None = None
    touch: bool | None = None


class TelemetryBatch(BaseModel):
    """Batch of frontend telemetry events."""

    model_config = ConfigDict(extra="ignore")

    events: list[TelemetryEvent] = Field(..., max_length=_MAX_EVENTS_PER_REQUEST)


class SyntheticResultIngestResponse(BaseModel):
    """Response schema for accepted authoritative synthetic journey results."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["stored"]
    completed_at: str


async def _lookup_display_names(
    db: AsyncSession, events: list[TelemetryEvent]
) -> tuple[dict[int, str], dict[int, str]]:
    """Resolve image names and category labels for the ids in *events*.

    Dashboards present these human-readable names alongside the numeric ids.
    Ids that no longer resolve (deleted rows) are simply absent from the maps.
    """
    allowed = [e for e in events if e.event in _ALLOWED_EVENTS]
    image_ids = {e.image_id for e in allowed if e.image_id is not None}
    category_ids = {
        cid
        for e in allowed
        for cid in (e.category_id, e.from_category_id)
        if cid is not None
    }
    image_names: dict[int, str] = {}
    category_labels: dict[int, str] = {}
    if image_ids:
        rows = await db.execute(
            select(Image.id, Image.name).where(Image.id.in_(image_ids))
        )
        image_names = {row.id: row.name for row in rows}
    if category_ids:
        rows = await db.execute(
            select(Category.id, Category.label).where(Category.id.in_(category_ids))
        )
        category_labels = {row.id: row.label for row in rows}
    return image_names, category_labels


@router.post("/events", status_code=202)
async def ingest_telemetry_events(
    batch: TelemetryBatch,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
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

    # Name enrichment is cosmetic and must never fail ingestion: on any DB
    # error, degrade to id-only logging so the batch is still recorded.
    try:
        image_names, category_labels = await _lookup_display_names(db, batch.events)
    except Exception:
        logger.warning("telemetry display-name lookup failed", exc_info=True)
        image_names, category_labels = {}, {}

    for event in batch.events:
        if event.event not in _ALLOWED_EVENTS:
            continue

        extra: dict[str, object] = {
            "schema.version": event.schema_version or TELEMETRY_SCHEMA_VERSION,
            "event.version": event.event_version or 1,
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
        from_page = _bounded(event.from_page, _PAGES)
        if from_page is not None:
            extra["event.from_page"] = from_page
        direction = _bounded(event.direction, _NAV_DIRECTIONS)
        if direction is not None:
            extra["event.direction"] = direction
        if event.error:
            extra["error.type"] = event.error
        error_code = _bounded(event.error_code, _ERROR_CODES)
        if error_code is not None:
            extra["error.code"] = error_code
        if event.image_id is not None:
            extra["image.id"] = event.image_id
            image_name = image_names.get(event.image_id)
            if image_name is not None:
                extra["image.name"] = image_name
        if event.category_id is not None:
            extra["category.id"] = event.category_id
            category_label = category_labels.get(event.category_id)
            if category_label is not None:
                extra["category.label"] = category_label
        if event.from_category_id is not None:
            extra["category.from_id"] = event.from_category_id
            from_category_label = category_labels.get(event.from_category_id)
            if from_category_label is not None:
                extra["category.from_label"] = from_category_label
        if event.request_id:
            extra["request.id"] = event.request_id
        if event.trace_id:
            extra["trace.id"] = event.trace_id
        if event.value is not None:
            extra["event.value"] = event.value
        unit = _bounded(event.unit, _UNITS)
        if unit is not None:
            extra["event.unit"] = unit
        upload_mode = _bounded(event.upload_mode, _UPLOAD_MODES)
        if upload_mode is not None:
            extra["upload.mode"] = upload_mode
        file_type = _bounded(event.file_type, _FILE_TYPES)
        if file_type is not None:
            extra["file.type"] = file_type

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
        touch_capable = (
            event.touch_capable if event.touch_capable is not None else event.touch
        )
        if touch_capable is not None:
            extra["client.touch_capable"] = touch_capable

        if traceparent:
            extra["trace.parent"] = traceparent

        logger.info("frontend telemetry event", extra=extra)

    return Response(status_code=202)


@router.post("/synthetic-result", status_code=202, response_model=SyntheticResultIngestResponse)
async def ingest_synthetic_result(
    result: SyntheticJourneyResult,
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
) -> SyntheticResultIngestResponse:
    """Persist the latest authoritative synthetic journey result for Prometheus."""
    if not is_synthetic_user(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Synthetic result ingestion requires a synthetic account.",
        )

    try:
        stored_state = await store_synthetic_result(result)
    except StaleSyntheticResultError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Synthetic result is stale compared with the stored latest run: "
                f"{exc.latest_completed_at.isoformat()}"
            ),
        ) from exc
    except SyntheticResultStorageUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Synthetic result storage is unavailable.",
        ) from exc

    _log_synthetic_result(result, stored_state, request, user)
    return SyntheticResultIngestResponse(
        status="stored",
        completed_at=stored_state.latest_result.completed_at.isoformat(),
    )


def _log_synthetic_result(
    result: SyntheticJourneyResult,
    stored_state: StoredSyntheticJourneyState,
    request: Request,
    user: User,
) -> None:
    """Emit the authoritative synthetic result as a structured backend log."""
    step_names = [step.name for step in result.steps]
    failed_steps = [step.name for step in result.steps if not step.success]
    extra: dict[str, object] = {
        "schema.version": result.event_version,
        "event.name": "synthetic.journey.result",
        "event.outcome": "success" if result.success else "failure",
        "event.synthetic": True,
        "synthetic.component_version": result.component_version or "unknown",
        "synthetic.started_at": result.started_at.isoformat(),
        "synthetic.completed_at": result.completed_at.isoformat(),
        "synthetic.duration_ms": result.duration_ms,
        "synthetic.step_count": len(result.steps),
        "synthetic.steps": ",".join(step_names),
        "synthetic.failed_steps": ",".join(failed_steps),
        "synthetic.last_success_completed_at": (
            stored_state.last_success_completed_at.isoformat()
            if stored_state.last_success_completed_at is not None
            else ""
        ),
        "user.id": user.id,
        "user.role": user.role,
    }
    if result.failure_code is not None:
        extra["error.type"] = result.failure_code

    traceparent = request.headers.get("traceparent")
    if traceparent:
        extra["trace.parent"] = traceparent

    logger.info("synthetic journey result stored", extra=extra)
