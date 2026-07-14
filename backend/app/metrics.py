"""Helpers for rendering the backend Prometheus scrape payload."""

from __future__ import annotations

import asyncio

from .backup_metrics import render_backup_metrics
from .build_info_metrics import render_build_info_metrics
from .synthetic_metrics import render_synthetic_metrics
from .synthetic_result import load_stored_synthetic_result_state


def _join_metric_payloads(*payloads: bytes) -> bytes:
    """Join Prometheus exposition payloads with clean newline separation."""
    chunks = [payload.rstrip() for payload in payloads if payload]
    if not chunks:
        return b""
    return b"\n\n".join(chunks) + b"\n"


async def render_metrics() -> tuple[bytes, str]:
    """Render the full Prometheus scrape payload for `/api/metrics`."""
    synthetic_state = await load_stored_synthetic_result_state()
    (
        (backup_content, media_type),
        (build_info_content, build_info_media_type),
        (synthetic_content, synthetic_media_type),
    ) = await asyncio.gather(
        asyncio.to_thread(render_backup_metrics),
        render_build_info_metrics(synthetic_state),
        render_synthetic_metrics(synthetic_state),
    )
    if synthetic_media_type != media_type or build_info_media_type != media_type:
        raise RuntimeError("Metrics renderers returned inconsistent media types.")
    return _join_metric_payloads(backup_content, build_info_content, synthetic_content), media_type
