"""Tests for the authenticated frontend telemetry ingestion endpoint."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.routers.telemetry import (
    SyntheticResultIngestResponse,
    TELEMETRY_SCHEMA_VERSION,
    TelemetryBatch,
    TelemetryEvent,
    ingest_synthetic_result,
    ingest_telemetry_events,
)
from app.synthetic_result import (
    StaleSyntheticResultError,
    StoredSyntheticJourneyState,
    SyntheticJourneyResult,
    SyntheticJourneyStep,
    SyntheticResultStorageUnavailableError,
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


def test_telemetry_accepts_current_and_omitted_schema_version() -> None:
    """The current schema version and an omitted version are both accepted."""
    assert TelemetryEvent(event="navigation.page_changed").schema_version is None
    assert (
        TelemetryEvent(
            event="navigation.page_changed", schema_version=TELEMETRY_SCHEMA_VERSION
        ).schema_version
        == TELEMETRY_SCHEMA_VERSION
    )


def test_telemetry_rejects_unsupported_schema_version() -> None:
    """An explicit unsupported schema version is rejected at validation time."""
    with pytest.raises(ValidationError):
        TelemetryEvent(event="navigation.page_changed", schema_version=2)


def test_telemetry_rejects_prohibited_extra_fields() -> None:
    """Unknown or privacy-sensitive extra fields are rejected at validation time."""
    with pytest.raises(ValidationError):
        TelemetryEvent.model_validate({
            "event": "navigation.page_changed",
            "user_email": "student@example.ca",
        })


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


def _make_synthetic_result(
    *,
    success: bool = True,
    failure_code: str | None = None,
) -> SyntheticJourneyResult:
    started_at = "2026-07-14T08:00:00Z"
    completed_at = "2026-07-14T08:00:03Z"
    return SyntheticJourneyResult(
        event_version=1,
        started_at=started_at,
        completed_at=completed_at,
        success=success,
        duration_ms=3000,
        failure_code=failure_code,
        component_version="1.2.3",
        steps=(
            [
                SyntheticJourneyStep(name="frontend", success=True, duration_ms=200),
                SyntheticJourneyStep(name="login", success=True, duration_ms=300),
            ]
            if success
            else [
                SyntheticJourneyStep(name="frontend", success=True, duration_ms=200),
                SyntheticJourneyStep(name="login", success=True, duration_ms=300),
                SyntheticJourneyStep(name="tile", success=False, duration_ms=1500),
            ]
        ),
    )


async def test_synthetic_result_requires_synthetic_account() -> None:
    request = _make_request()
    user = SimpleNamespace(id=7, role="student", metadata_={})

    with pytest.raises(HTTPException) as exc_info:
        await ingest_synthetic_result(
            result=_make_synthetic_result(), request=request, user=user
        )

    assert exc_info.value.status_code == 403


async def test_synthetic_result_stored_and_logged(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level("INFO", logger="app.routers.telemetry")
    result = _make_synthetic_result()
    request = _make_request(
        traceparent="00-1234567890abcdef1234567890abcdef-1234567890abcdef-01"
    )
    user = SimpleNamespace(id=9, role="student", metadata_={"synthetic": True})
    stored_state = StoredSyntheticJourneyState(
        latest_result=result,
        last_success_completed_at=result.completed_at,
        updated_at=result.completed_at,
    )

    with patch(
        "app.routers.telemetry.store_synthetic_result",
        new_callable=AsyncMock,
        return_value=stored_state,
    ):
        response = await ingest_synthetic_result(
            result=result, request=request, user=user
        )

    assert response == SyntheticResultIngestResponse(
        status="stored", completed_at=result.completed_at.isoformat()
    )
    log = [r for r in caplog.records if r.message == "synthetic journey result stored"][0]
    assert getattr(log, "event.name") == "synthetic.journey.result"
    assert getattr(log, "event.synthetic") is True
    assert getattr(log, "synthetic.component_version") == "1.2.3"
    assert getattr(log, "trace.parent") == request.headers.get("traceparent")


async def test_synthetic_result_rejects_stale_runs() -> None:
    request = _make_request()
    user = SimpleNamespace(id=9, role="student", metadata_={"synthetic": True})
    latest_completed_at = _make_synthetic_result().completed_at

    with patch(
        "app.routers.telemetry.store_synthetic_result",
        new_callable=AsyncMock,
        side_effect=StaleSyntheticResultError(latest_completed_at),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await ingest_synthetic_result(
                result=_make_synthetic_result(
                    success=False,
                    failure_code="tile_failed",
                ),
                request=request,
                user=user,
            )

    assert exc_info.value.status_code == 409
    assert latest_completed_at.isoformat() in exc_info.value.detail


async def test_synthetic_result_maps_storage_errors() -> None:
    request = _make_request()
    user = SimpleNamespace(id=9, role="student", metadata_={"synthetic": True})

    with patch(
        "app.routers.telemetry.store_synthetic_result",
        new_callable=AsyncMock,
        side_effect=SyntheticResultStorageUnavailableError,
    ):
        with pytest.raises(HTTPException) as exc_info:
            await ingest_synthetic_result(
                result=_make_synthetic_result(), request=request, user=user
            )

    assert exc_info.value.status_code == 503
