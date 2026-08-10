"""Tests for reorder correlation, structured logs, and metrics (epic #975)."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.reorder_metrics import (
    observe_reorder_request,
    record_client_reorder_operation,
    render_reorder_metrics,
)
from app.reorder_telemetry import (
    annotate_reorder_span,
    classify_reorder_exception,
    record_reorder_result,
    sanitize_reorder_operation_id,
)
from app.routers.telemetry import (
    TelemetryBatch,
    TelemetryEvent,
    ingest_telemetry_events,
)

OPERATION_ID = "b1946ac9-4931-4a95-bb32-9f8e4a2c9d11"


# ── sanitize_reorder_operation_id ────────────────────────


def test_classify_reorder_exception_buckets() -> None:
    assert classify_reorder_exception(HTTPException(status_code=409)) == "conflict"
    assert classify_reorder_exception(HTTPException(status_code=400)) == "client_error"
    assert classify_reorder_exception(HTTPException(status_code=404)) == "client_error"
    assert classify_reorder_exception(HTTPException(status_code=500)) == "failure"
    assert classify_reorder_exception(RuntimeError("db down")) == "failure"


def test_sanitize_accepts_uuid_and_safe_ids() -> None:
    assert sanitize_reorder_operation_id(OPERATION_ID) == OPERATION_ID
    assert sanitize_reorder_operation_id("op-abc123-xyz") == "op-abc123-xyz"


@pytest.mark.parametrize(
    "value",
    [None, "", "short", "a" * 65, "bad id with spaces", "semi;colon", "quote'x-longer"],
)
def test_sanitize_rejects_unsafe_ids(value: str | None) -> None:
    assert sanitize_reorder_operation_id(value) is None


# ── span annotation ──────────────────────────────────────


def test_annotate_reorder_span_sets_attributes() -> None:
    span = MagicMock()
    annotate_reorder_span(span, entity="category", operation_id=OPERATION_ID, item_count=5)
    span.set_attribute.assert_any_call("reorder.entity", "category")
    span.set_attribute.assert_any_call("reorder.item_count", 5)
    span.set_attribute.assert_any_call("reorder.operation_id", OPERATION_ID)


def test_annotate_reorder_span_omits_missing_operation_id() -> None:
    span = MagicMock()
    annotate_reorder_span(span, entity="image", operation_id=None, item_count=2)
    calls = [c.args[0] for c in span.set_attribute.call_args_list]
    assert "reorder.operation_id" not in calls


# ── metrics ──────────────────────────────────────────────


def test_reorder_metrics_render_and_coerce_labels() -> None:
    observe_reorder_request(
        "category", duration_seconds=0.05, item_count=80, outcome="success"
    )
    observe_reorder_request(
        "not-an-entity", duration_seconds=0.01, item_count=1, outcome="not-an-outcome"
    )
    record_client_reorder_operation("ignored")
    record_client_reorder_operation("definitely-not-a-state")

    payload, media_type = render_reorder_metrics()
    text = payload.decode()
    assert "text/plain" in media_type
    assert 'hriv_reorder_requests_total{entity="category",outcome="success"}' in text
    # Unknown entity/outcome are coerced to bounded values, never emitted raw.
    assert "not-an-entity" not in text
    assert "not-an-outcome" not in text
    assert 'hriv_reorder_requests_total{entity="other",outcome="failure"}' in text
    assert 'hriv_reorder_client_operations_total{state="ignored"}' in text
    assert 'hriv_reorder_client_operations_total{state="other"}' in text
    assert "definitely-not-a-state" not in text
    assert "hriv_reorder_request_duration_seconds" in text
    assert "hriv_reorder_request_items" in text


# ── structured log line ──────────────────────────────────


def test_record_reorder_result_emits_structured_log(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level("INFO", logger="app.reorder_telemetry")
    record_reorder_result(
        entity="image",
        operation_id=OPERATION_ID,
        item_count=600,
        duration_seconds=1.234567,
        outcome="success",
    )
    records = [r for r in caplog.records if r.message == "reorder.persisted"]
    assert len(records) == 1
    record = records[0]
    assert getattr(record, "reorder.entity") == "image"
    assert getattr(record, "reorder.operation_id") == OPERATION_ID
    assert getattr(record, "reorder.item_count") == 600
    assert getattr(record, "reorder.duration_seconds") == pytest.approx(1.234567)
    assert getattr(record, "reorder.outcome") == "success"


# ── telemetry ingestion of reorder.operation events ──────


def _make_request() -> MagicMock:
    request = MagicMock()
    request.headers.get.return_value = None
    return request


def _make_db() -> MagicMock:
    async def execute(_stmt):
        return iter(())

    db = MagicMock()
    db.execute = AsyncMock(side_effect=execute)
    return db


def _allow_rate_limit():
    return patch(
        "app.routers.telemetry.check_telemetry_rate_limit",
        new_callable=AsyncMock,
        return_value=None,
    )


async def test_ingest_reorder_operation_event(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level("INFO", logger="app.routers.telemetry")
    batch = TelemetryBatch(
        events=[
            TelemetryEvent(
                event="reorder.operation",
                outcome="success",
                operation_id=OPERATION_ID,
                state="committed",
                item_type="category",
                from_index=3,
                to_index=17,
                category_count=80,
                image_count=0,
                queue_depth=0,
                local_revision=4,
                duration_ms=250.0,
            )
        ]
    )
    user = SimpleNamespace(id=7, role="instructor", metadata_={})

    with _allow_rate_limit():
        response = await ingest_telemetry_events(
            batch=batch,
            request=_make_request(),
            user=user,
            db=_make_db(),
            x_session_id="tab-1",
        )
    assert response.status_code == 202

    records = [r for r in caplog.records if r.message == "frontend telemetry event"]
    assert len(records) == 1
    record = records[0]
    assert getattr(record, "event.name") == "reorder.operation"
    assert getattr(record, "reorder.state") == "committed"
    assert getattr(record, "reorder.operation_id") == OPERATION_ID
    assert getattr(record, "reorder.item_type") == "category"
    assert getattr(record, "reorder.from_index") == 3
    assert getattr(record, "reorder.to_index") == 17
    assert getattr(record, "reorder.category_count") == 80
    assert getattr(record, "reorder.image_count") == 0
    assert getattr(record, "reorder.queue_depth") == 0
    assert getattr(record, "reorder.local_revision") == 4


async def test_ingest_reorder_operation_bounds_untrusted_fields(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Unknown states are coerced and unsafe operation IDs are dropped."""
    caplog.set_level("INFO", logger="app.routers.telemetry")
    batch = TelemetryBatch(
        events=[
            TelemetryEvent(
                event="reorder.operation",
                state="totally-made-up",
                operation_id="bad id with spaces",
                item_type="not-a-type",
            )
        ]
    )
    user = SimpleNamespace(id=7, role="instructor", metadata_={})

    with _allow_rate_limit():
        await ingest_telemetry_events(
            batch=batch,
            request=_make_request(),
            user=user,
            db=_make_db(),
            x_session_id="tab-1",
        )

    records = [r for r in caplog.records if r.message == "frontend telemetry event"]
    assert len(records) == 1
    record = records[0]
    assert getattr(record, "reorder.state") == "other"
    assert getattr(record, "reorder.item_type") == "other"
    assert "reorder.operation_id" not in record.__dict__


async def test_ingest_reorder_operation_missing_state_skips_counter(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Absent states log as ``missing`` and never feed the metric."""
    caplog.set_level("INFO", logger="app.routers.telemetry")
    batch = TelemetryBatch(
        events=[TelemetryEvent(event="reorder.operation", operation_id=OPERATION_ID)]
    )
    user = SimpleNamespace(id=7, role="instructor", metadata_={})

    with (
        _allow_rate_limit(),
        patch("app.routers.telemetry.record_client_reorder_operation") as counter,
    ):
        await ingest_telemetry_events(
            batch=batch,
            request=_make_request(),
            user=user,
            db=_make_db(),
            x_session_id="tab-1",
        )

    counter.assert_not_called()
    records = [r for r in caplog.records if r.message == "frontend telemetry event"]
    assert len(records) == 1
    assert getattr(records[0], "reorder.state") == "missing"


async def test_ingest_reorder_operation_synthetic_user_skips_counter(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Synthetic-monitor events stay in logs but out of the client counter."""
    caplog.set_level("INFO", logger="app.routers.telemetry")
    batch = TelemetryBatch(
        events=[
            TelemetryEvent(
                event="reorder.operation",
                operation_id=OPERATION_ID,
                state="committed",
            )
        ]
    )
    user = SimpleNamespace(id=7, role="instructor", metadata_={"synthetic": True})

    with (
        _allow_rate_limit(),
        patch("app.routers.telemetry.record_client_reorder_operation") as counter,
    ):
        await ingest_telemetry_events(
            batch=batch,
            request=_make_request(),
            user=user,
            db=_make_db(),
            x_session_id="tab-1",
        )

    counter.assert_not_called()
    records = [r for r in caplog.records if r.message == "frontend telemetry event"]
    assert len(records) == 1
    assert getattr(records[0], "reorder.state") == "committed"
    assert getattr(records[0], "event.synthetic") is True
