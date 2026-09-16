"""Tests for the tile-rebuild observability contract (#1189)."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from app import tile_rebuild_metrics
from app.tile_rebuild_metrics import (
    metadata_timestamp,
    record_duplicate_delivery,
    record_enqueue_failure,
    record_item_retry,
    record_item_terminal,
    record_item_timeout,
    record_lease_reclaims,
    record_pump_run,
    record_queue_wait,
    record_supervisor_terminal,
    render_tile_rebuild_metrics,
)


def _patched(name: str) -> MagicMock:
    return MagicMock(name=name)


def test_record_item_terminal_counts_by_outcome_and_duration() -> None:
    counter = _patched("items_completed")
    histogram = _patched("item_duration")
    with (
        patch.object(tile_rebuild_metrics, "_items_completed", counter),
        patch.object(tile_rebuild_metrics, "_item_duration", histogram),
    ):
        record_item_terminal("completed", duration_seconds=1.5)

    counter.add.assert_called_once_with(1, {"outcome": "completed"})
    histogram.record.assert_called_once_with(1.5)


def test_record_item_terminal_rejects_unbounded_outcomes() -> None:
    counter = _patched("items_completed")
    histogram = _patched("item_duration")
    with (
        patch.object(tile_rebuild_metrics, "_items_completed", counter),
        patch.object(tile_rebuild_metrics, "_item_duration", histogram),
    ):
        # An open-ended value must never become a metric label.
        record_item_terminal("source_image:12345", duration_seconds=1.0)
        record_item_terminal("completed", count=0)

    counter.add.assert_not_called()
    histogram.record.assert_not_called()


def test_record_item_terminal_bulk_count_skips_duration() -> None:
    counter = _patched("items_completed")
    histogram = _patched("item_duration")
    with (
        patch.object(tile_rebuild_metrics, "_items_completed", counter),
        patch.object(tile_rebuild_metrics, "_item_duration", histogram),
    ):
        record_item_terminal("cancelled", count=7, duration_seconds=3.0)

    counter.add.assert_called_once_with(7, {"outcome": "cancelled"})
    histogram.record.assert_not_called()


def test_record_item_retry_counts_bounded_reasons() -> None:
    counter = _patched("item_retries")
    with patch.object(tile_rebuild_metrics, "_item_retries", counter):
        record_item_retry("transient")
        record_item_retry("lease_expired")
        record_item_retry("anything-else")

    assert counter.add.call_count == 2


def test_record_queue_wait_ignores_negative() -> None:
    histogram = _patched("item_queue_wait")
    with patch.object(tile_rebuild_metrics, "_item_queue_wait", histogram):
        record_queue_wait(0.25)
        record_queue_wait(-1.0)

    histogram.record.assert_called_once_with(0.25)


def test_record_lease_reclaims_splits_claimed_and_started() -> None:
    counter = _patched("lease_reclaims")
    with patch.object(tile_rebuild_metrics, "_lease_reclaims", counter):
        record_lease_reclaims(claimed=2, started=3)

    assert counter.add.call_args_list == [
        ((2, {"state": "claimed"}),),
        ((3, {"state": "started"}),),
    ]


def test_record_pump_run_rejects_unknown_outcome() -> None:
    counter = _patched("pump_runs")
    with patch.object(tile_rebuild_metrics, "_pump_runs", counter):
        record_pump_run("dispatched")
        record_pump_run("job-42")

    counter.add.assert_called_once_with(1, {"outcome": "dispatched"})


def test_record_enqueue_failure_rejects_unknown_reason() -> None:
    counter = _patched("enqueue_failures")
    with patch.object(tile_rebuild_metrics, "_enqueue_failures", counter):
        record_enqueue_failure("queue_unavailable")
        record_enqueue_failure("redis://host:6379")

    counter.add.assert_called_once_with(1, {"reason": "queue_unavailable"})


def test_record_item_timeout_and_duplicate_delivery_count() -> None:
    timeouts = _patched("item_timeouts")
    duplicates = _patched("duplicate_deliveries")
    with (
        patch.object(tile_rebuild_metrics, "_item_timeouts", timeouts),
        patch.object(tile_rebuild_metrics, "_duplicate_deliveries", duplicates),
    ):
        record_item_timeout()
        record_duplicate_delivery()

    timeouts.add.assert_called_once_with(1)
    duplicates.add.assert_called_once_with(1)


def test_record_supervisor_terminal_records_duration_and_cancel() -> None:
    duration = _patched("supervisor_duration")
    cancel = _patched("cancellation_latency")
    with (
        patch.object(tile_rebuild_metrics, "_supervisor_duration", duration),
        patch.object(tile_rebuild_metrics, "_cancellation_latency", cancel),
    ):
        record_supervisor_terminal(
            duration_seconds=120.0,
            cancellation_seconds=5.0,
        )

    duration.record.assert_called_once_with(120.0)
    cancel.record.assert_called_once_with(5.0)


def test_record_supervisor_terminal_skips_missing_values() -> None:
    duration = _patched("supervisor_duration")
    cancel = _patched("cancellation_latency")
    with (
        patch.object(tile_rebuild_metrics, "_supervisor_duration", duration),
        patch.object(tile_rebuild_metrics, "_cancellation_latency", cancel),
    ):
        record_supervisor_terminal(
            duration_seconds=None,
            cancellation_seconds=None,
        )

    duration.record.assert_not_called()
    cancel.record.assert_not_called()


def test_metadata_timestamp_parses_iso_values() -> None:
    parsed = metadata_timestamp(
        {"claimed_at": "2024-01-02T03:04:05+00:00"},
        "claimed_at",
    )
    assert parsed == datetime(2024, 1, 2, 3, 4, 5, tzinfo=timezone.utc)


def test_metadata_timestamp_handles_missing_or_bad_values() -> None:
    assert metadata_timestamp(None, "claimed_at") is None
    assert metadata_timestamp({}, "claimed_at") is None
    assert metadata_timestamp({"claimed_at": 123}, "claimed_at") is None
    assert metadata_timestamp({"claimed_at": "not-a-date"}, "claimed_at") is None


async def test_render_tile_rebuild_metrics_reports_durable_state() -> None:
    state = {"active_jobs": 1, "running_items": 3, "queued_items": 42}
    with patch(
        "app.tile_rebuild_metrics.collect_tile_rebuild_state",
        new_callable=AsyncMock,
        return_value=state,
    ):
        content, media_type = await render_tile_rebuild_metrics()

    assert media_type == "text/plain; version=0.0.4; charset=utf-8"
    assert b"hriv_tile_rebuild_jobs_active 1.0" in content
    assert b"hriv_tile_rebuild_active_children 3.0" in content
    assert b"hriv_tile_rebuild_queued_items 42.0" in content


async def test_render_tile_rebuild_metrics_degrades_to_nan() -> None:
    """A failed durable-state read degrades to NaN, never a broken scrape."""
    state = {"active_jobs": None, "running_items": None, "queued_items": None}
    with patch(
        "app.tile_rebuild_metrics.collect_tile_rebuild_state",
        new_callable=AsyncMock,
        return_value=state,
    ):
        content, _ = await render_tile_rebuild_metrics()

    assert b"hriv_tile_rebuild_jobs_active NaN" in content
    assert b"hriv_tile_rebuild_active_children NaN" in content
    assert b"hriv_tile_rebuild_queued_items NaN" in content


async def test_collect_tile_rebuild_state_swallows_read_errors() -> None:
    def failing_factory():
        raise RuntimeError("db down")

    with patch(
        "app.tile_rebuild_metrics.get_async_session",
        return_value=failing_factory,
    ):
        state = await tile_rebuild_metrics.collect_tile_rebuild_state()

    assert state == {
        "active_jobs": None,
        "running_items": None,
        "queued_items": None,
    }
