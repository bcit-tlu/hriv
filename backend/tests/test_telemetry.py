"""Tests for the authenticated frontend telemetry ingestion endpoint."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.routers.telemetry import TelemetryBatch, TelemetryEvent, ingest_telemetry_events


async def test_telemetry_events_accepted_and_logged(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Valid batches are accepted as 202 and emitted as structured logs."""
    caplog.set_level("INFO", logger="app.routers.telemetry")

    batch = TelemetryBatch(
        events=[
            TelemetryEvent(
                event="image.view.started",
                outcome="success",
                action="view",
                duration_ms=12.5,
            ),
            TelemetryEvent(
                event="navigation.page_changed", action="navigate", page="browse"
            ),
        ]
    )
    request = MagicMock()
    request.headers.get.return_value = None
    user = SimpleNamespace(id=42, role="student")

    response = await ingest_telemetry_events(
        batch=batch, request=request, user=user, x_session_id="test-session"
    )

    assert response.status_code == 202

    telemetry_logs = [r for r in caplog.records if r.message == "frontend telemetry event"]
    assert len(telemetry_logs) == 2

    first, second = telemetry_logs
    assert getattr(first, "event.name") == "image.view.started"
    assert getattr(first, "event.outcome") == "success"
    assert getattr(first, "event.action") == "view"
    assert getattr(first, "event.duration_ms") == 12.5
    assert getattr(first, "user.id") == 42
    assert getattr(first, "user.role") == "student"
    assert getattr(first, "browser.tab.session_id") == "test-session"

    assert getattr(second, "event.name") == "navigation.page_changed"
    assert getattr(second, "event.page") == "browse"


async def test_telemetry_drops_unknown_events(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Unknown event names are silently dropped but the request still succeeds."""
    caplog.set_level("INFO", logger="app.routers.telemetry")

    batch = TelemetryBatch(
        events=[
            TelemetryEvent(event="image.view.started"),
            TelemetryEvent(event="not.allowed.event"),
        ]
    )
    request = MagicMock()
    request.headers.get.return_value = None
    user = SimpleNamespace(id=1, role="student")

    response = await ingest_telemetry_events(
        batch=batch, request=request, user=user, x_session_id=None
    )

    assert response.status_code == 202
    telemetry_logs = [r for r in caplog.records if r.message == "frontend telemetry event"]
    assert len(telemetry_logs) == 1
    assert getattr(telemetry_logs[0], "event.name") == "image.view.started"


async def test_telemetry_propagates_traceparent(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A traceparent header on the request is copied into the emitted log."""
    caplog.set_level("INFO", logger="app.routers.telemetry")

    batch = TelemetryBatch(events=[TelemetryEvent(event="image.view.started")])
    request = MagicMock()
    request.headers.get.side_effect = lambda key: (
        "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01"
        if key == "traceparent"
        else None
    )
    user = SimpleNamespace(id=1, role="student")

    response = await ingest_telemetry_events(
        batch=batch, request=request, user=user, x_session_id=None
    )

    assert response.status_code == 202
    telemetry_logs = [r for r in caplog.records if r.message == "frontend telemetry event"]
    assert getattr(telemetry_logs[0], "trace.parent") == "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01"


async def test_telemetry_rejects_oversized_batch() -> None:
    """Batches exceeding the per-request limit are rejected during validation."""
    events = [TelemetryEvent(event="image.view.started") for _ in range(20)]
    with pytest.raises(ValueError):
        TelemetryBatch(events=events)


async def test_telemetry_rejects_oversized_event_name() -> None:
    """Event names exceeding the max length are rejected during validation."""
    with pytest.raises(ValueError):
        TelemetryEvent(event="x" * 101, outcome="success")
