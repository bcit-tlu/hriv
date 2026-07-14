"""Helpers for rendering the backend Prometheus scrape payload."""

from __future__ import annotations

import asyncio

from .backup_metrics import render_backup_metrics
from .synthetic_metrics import render_synthetic_metrics


def _join_metric_payloads(*payloads: bytes) -> bytes:
    """Join Prometheus exposition payloads with clean newline separation."""
    chunks = [payload.rstrip() for payload in payloads if payload]
    if not chunks:
        return b""
    return b"\n\n".join(chunks) + b"\n"


async def render_metrics() -> tuple[bytes, str]:
    """Render the full Prometheus scrape payload for `/api/metrics`."""
    backup_content, media_type = await asyncio.to_thread(render_backup_metrics)
    synthetic_content, synthetic_media_type = await render_synthetic_metrics()
    if synthetic_media_type != media_type:
        raise RuntimeError("Metrics renderers returned inconsistent media types.")
    return _join_metric_payloads(backup_content, synthetic_content), media_type
