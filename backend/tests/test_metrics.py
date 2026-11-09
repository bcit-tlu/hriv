"""Tests for top-level metrics payload aggregation."""

from __future__ import annotations

import time
from contextlib import ExitStack
from unittest.mock import patch

from prometheus_client import CONTENT_TYPE_LATEST

from app.metrics import render_metrics


def _patch_renderers(
    stack: ExitStack, *, media_type: str = "text/plain", **overrides
) -> None:
    renderers = {
        "load_stored_synthetic_result_state": "state",
        "render_backup_metrics": (b"backup_metric 1\n", media_type),
        "render_build_info_metrics": (b"build_metric 1\n", media_type),
        "render_synthetic_metrics": (b"synthetic_metric 1\n", media_type),
        "render_reorder_metrics": (b"reorder_metric 1\n", media_type),
        "render_queue_metrics": (b"queue_metric 1\n", media_type),
        "render_tile_rebuild_metrics": (b"rebuild_metric 1\n", media_type),
        "render_db_pool_metrics": (b"db_pool_metric 1\n", media_type),
    }
    renderers.update(overrides)
    for name, value in renderers.items():
        stack.enter_context(patch(f"app.metrics.{name}", return_value=value))


async def test_render_metrics_joins_all_renderer_payloads() -> None:
    with ExitStack() as stack:
        _patch_renderers(stack)
        content, media_type = await render_metrics()

    assert media_type == "text/plain"
    assert content == (
        b"backup_metric 1\n\nbuild_metric 1\n\nsynthetic_metric 1\n\n"
        b"reorder_metric 1\n\nqueue_metric 1\n\nrebuild_metric 1\n\n"
        b"db_pool_metric 1\n"
    )


async def test_render_metrics_serves_stale_backup_payload_on_timeout(
    monkeypatch,
) -> None:
    """A slow backup refresh must not hold the scrape open past the timeout."""
    monkeypatch.setattr("app.metrics._BACKUP_RENDER_TIMEOUT_SECONDS", 0.05)

    def _slow_render() -> tuple[bytes, str]:
        time.sleep(2)
        return (b"fresh_backup 1\n", "text/plain")

    with ExitStack() as stack:
        _patch_renderers(stack, media_type=CONTENT_TYPE_LATEST)
        stack.enter_context(
            patch("app.metrics.render_backup_metrics", side_effect=_slow_render)
        )
        stack.enter_context(
            patch(
                "app.metrics.last_backup_metrics_payload",
                return_value=(b"stale_backup 1\n", CONTENT_TYPE_LATEST),
            )
        )

        began = time.monotonic()
        content, media_type = await render_metrics()

    assert time.monotonic() - began < 1
    assert media_type == CONTENT_TYPE_LATEST
    assert b"stale_backup 1" in content
    assert b"fresh_backup" not in content


async def test_render_metrics_omits_backup_section_without_stale_payload(
    monkeypatch,
) -> None:
    """With no rendered payload yet, a timeout yields an empty backup section."""
    monkeypatch.setattr("app.metrics._BACKUP_RENDER_TIMEOUT_SECONDS", 0.05)

    def _slow_render() -> tuple[bytes, str]:
        time.sleep(2)
        return (b"fresh_backup 1\n", "text/plain")

    with ExitStack() as stack:
        _patch_renderers(stack, media_type=CONTENT_TYPE_LATEST)
        stack.enter_context(
            patch("app.metrics.render_backup_metrics", side_effect=_slow_render)
        )
        stack.enter_context(
            patch("app.metrics.last_backup_metrics_payload", return_value=None)
        )

        content, media_type = await render_metrics()

    assert media_type == CONTENT_TYPE_LATEST
    assert b"backup_metric" not in content
    assert b"build_metric 1" in content
