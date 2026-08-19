"""Tests for top-level metrics payload aggregation."""

from __future__ import annotations

from unittest.mock import patch

from app.metrics import render_metrics


async def test_render_metrics_joins_backup_build_synthetic_and_reorder_payloads() -> None:
    with (
        patch("app.metrics.load_stored_synthetic_result_state", return_value="state"),
        patch("app.metrics.render_backup_metrics", return_value=(b"backup_metric 1\n", "text/plain")),
        patch("app.metrics.render_build_info_metrics", return_value=(b"build_metric 1\n", "text/plain")),
        patch("app.metrics.render_synthetic_metrics", return_value=(b"synthetic_metric 1\n", "text/plain")),
        patch("app.metrics.render_reorder_metrics", return_value=(b"reorder_metric 1\n", "text/plain")),
        patch("app.metrics.render_queue_metrics", return_value=(b"queue_metric 1\n", "text/plain")),
    ):
        content, media_type = await render_metrics()

    assert media_type == "text/plain"
    assert content == (
        b"backup_metric 1\n\nbuild_metric 1\n\nsynthetic_metric 1\n\nreorder_metric 1\n\nqueue_metric 1\n"
    )
