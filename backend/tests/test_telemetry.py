"""Tests for the authenticated frontend telemetry ingestion endpoint."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.routers.telemetry import (
    TELEMETRY_SCHEMA_VERSION,
    TelemetryBatch,
    TelemetryEvent,
    ingest_telemetry_events,
)


def _make_request(traceparent: str | None = None) -> MagicMock:
    request = MagicMock()
    request.headers.get.side_effect = lambda key: (
        traceparent if key == "traceparent" else None
    )
    return request


def _allow_rate_limit():
    return patch(
        "app.routers.telemetry.check_telemetry_rate_limit",
        new_callable=AsyncMock,
        return_value=None,
    )


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
                image_id=7,
                category_id=3,
            ),
            TelemetryEvent(
                event="navigation.page_changed", action="navigate", page="browse"
            ),
        ]
    )
    request = _make_request()
    user = SimpleNamespace(id=42, role="student", metadata_={})

    with _allow_rate_limit():
        response = await ingest_telemetry_events(
            batch=batch, request=request, user=user, x_session_id="test-session"
        )

    assert response.status_code == 202

    telemetry_logs = [r for r in caplog.records if r.message == "frontend telemetry event"]
    assert len(telemetry_logs) == 2

    first, second = telemetry_logs
    assert getattr(first, "schema.version") == TELEMETRY_SCHEMA_VERSION
    assert getattr(first, "event.name") == "image.view.started"
    assert getattr(first, "event.outcome") == "success"
    assert getattr(first, "event.action") == "view"
    assert getattr(first, "event.duration_ms") == 12.5
    assert getattr(first, "image.id") == 7
    assert getattr(first, "category.id") == 3
    assert getattr(first, "event.synthetic") is False
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
    request = _make_request()
    user = SimpleNamespace(id=1, role="student", metadata_=None)

    with _allow_rate_limit():
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
    traceparent = "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01"
    request = _make_request(traceparent=traceparent)
    user = SimpleNamespace(id=1, role="student", metadata_={})

    with _allow_rate_limit():
        response = await ingest_telemetry_events(
            batch=batch, request=request, user=user, x_session_id=None
        )

    assert response.status_code == 202
    telemetry_logs = [r for r in caplog.records if r.message == "frontend telemetry event"]
    assert getattr(telemetry_logs[0], "trace.parent") == traceparent


async def test_telemetry_bounds_client_environment(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Bounded client-env fields pass through; unknown values coerce to 'other'."""
    caplog.set_level("INFO", logger="app.routers.telemetry")

    batch = TelemetryBatch(
        events=[
            TelemetryEvent(
                event="navigation.page_changed",
                browser_family="firefox",
                browser_major="128",
                os_family="definitely-not-real",
                device_class="mobile",
                viewport_bucket="md",
                touch=True,
            )
        ]
    )
    request = _make_request()
    user = SimpleNamespace(id=1, role="student", metadata_={})

    with _allow_rate_limit():
        await ingest_telemetry_events(
            batch=batch, request=request, user=user, x_session_id=None
        )

    log = [r for r in caplog.records if r.message == "frontend telemetry event"][0]
    assert getattr(log, "client.browser.family") == "firefox"
    assert getattr(log, "client.browser.major") == "128"
    # Unknown OS family is coerced to the bounded sentinel rather than stored raw.
    assert getattr(log, "client.os.family") == "other"
    assert getattr(log, "client.device.class") == "mobile"
    assert getattr(log, "client.viewport.bucket") == "md"
    assert getattr(log, "client.touch") is True


async def test_telemetry_bounds_non_numeric_browser_major(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A non-numeric browser major is coerced to 'other' rather than stored raw."""
    caplog.set_level("INFO", logger="app.routers.telemetry")

    batch = TelemetryBatch(
        events=[
            TelemetryEvent(
                event="navigation.page_changed",
                browser_family="chrome",
                browser_major="not-a-version",
            )
        ]
    )
    request = _make_request()
    user = SimpleNamespace(id=1, role="student", metadata_={})

    with _allow_rate_limit():
        await ingest_telemetry_events(
            batch=batch, request=request, user=user, x_session_id=None
        )

    log = [r for r in caplog.records if r.message == "frontend telemetry event"][0]
    assert getattr(log, "client.browser.major") == "other"


async def test_telemetry_synthetic_from_user_metadata(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Synthetic is decided from user metadata, not the client flag."""
    caplog.set_level("INFO", logger="app.routers.telemetry")

    # Client says synthetic=False, but the account metadata marks it synthetic.
    batch = TelemetryBatch(
        events=[TelemetryEvent(event="image.view.started", synthetic=False)]
    )
    request = _make_request()
    user = SimpleNamespace(id=99, role="student", metadata_={"synthetic": True})

    with _allow_rate_limit():
        await ingest_telemetry_events(
            batch=batch, request=request, user=user, x_session_id=None
        )

    log = [r for r in caplog.records if r.message == "frontend telemetry event"][0]
    assert getattr(log, "event.synthetic") is True


async def test_telemetry_rate_limited_returns_429() -> None:
    """A rate-limited user gets 429 with a Retry-After header and no logs."""
    batch = TelemetryBatch(events=[TelemetryEvent(event="image.view.started")])
    request = _make_request()
    user = SimpleNamespace(id=5, role="student", metadata_={})

    with patch(
        "app.routers.telemetry.check_telemetry_rate_limit",
        new_callable=AsyncMock,
        return_value=17,
    ):
        with pytest.raises(HTTPException) as exc_info:
            await ingest_telemetry_events(
                batch=batch, request=request, user=user, x_session_id=None
            )

    assert exc_info.value.status_code == 429
    assert exc_info.value.headers["Retry-After"] == "17"


async def test_telemetry_rejects_oversized_batch() -> None:
    """Batches exceeding the per-request limit are rejected during validation."""
    events = [TelemetryEvent(event="image.view.started") for _ in range(20)]
    with pytest.raises(ValueError):
        TelemetryBatch(events=events)


async def test_telemetry_rejects_oversized_event_name() -> None:
    """Event names exceeding the max length are rejected during validation."""
    with pytest.raises(ValueError):
        TelemetryEvent(event="x" * 101, outcome="success")
