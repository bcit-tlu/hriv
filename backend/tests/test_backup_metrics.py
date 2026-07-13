"""Tests for the backup metrics renderer and its short TTL cache."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch

import pytest

import app.backup_metrics as backup_metrics
from app.backup_access import BackupRestoreNotConfiguredError


def _clear_marker_cache() -> None:
    """Reset the module-level marker cache in the backup_metrics module."""
    with backup_metrics._marker_cache_lock:
        backup_metrics._marker_cache = None
        backup_metrics._marker_cache_time = 0.0


@pytest.fixture(autouse=True)
def _reset_cache():
    _clear_marker_cache()
    yield
    _clear_marker_cache()


async def test_render_backup_metrics_reads_marker() -> None:
    """A fresh render fetches the marker from Azure and sets the gauges."""
    marker = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "archive_size": 123456,
    }

    with patch("app.backup_metrics.get_last_success_marker", return_value=marker):
        content, _ = backup_metrics.render_backup_metrics()

    assert b"hriv_backup_configured 1.0" in content
    assert b"hriv_backup_last_outcome 1.0" in content
    assert b"hriv_backup_last_size_bytes 123456.0" in content
    assert b"hriv_backup_age_seconds" in content


async def test_marker_cache_avoids_repeated_azure_calls() -> None:
    """Within the TTL, repeated renders reuse the cached marker."""
    marker = {"created_at": datetime.now(timezone.utc).isoformat(), "archive_size": 1}

    with patch("app.backup_metrics.get_last_success_marker", return_value=marker) as mock_download:
        backup_metrics.render_backup_metrics()
        backup_metrics.render_backup_metrics()
        backup_metrics.render_backup_metrics()

    # Only one Azure download should occur because the cache is warm.
    assert mock_download.call_count == 1


async def test_marker_cache_refreshes_after_ttl(monkeypatch) -> None:
    """After the TTL expires, the next render fetches from Azure again."""
    marker = {"created_at": datetime.now(timezone.utc).isoformat(), "archive_size": 1}
    cache_time = [0.0]

    def _fake_monotonic() -> float:
        return cache_time[0]

    monkeypatch.setattr("app.backup_metrics.monotonic", _fake_monotonic)

    with patch("app.backup_metrics.get_last_success_marker", return_value=marker) as mock_download:
        cache_time[0] = 0.0
        backup_metrics.render_backup_metrics()

        # Still within TTL: no new download.
        cache_time[0] = 60.0
        backup_metrics.render_backup_metrics()
        assert mock_download.call_count == 1

        # TTL expired: should fetch again.
        cache_time[0] = 400.0
        backup_metrics.render_backup_metrics()
        assert mock_download.call_count == 2


async def test_not_configured_is_cached() -> None:
    """BackupRestoreNotConfiguredError is cached and not re-raised on subsequent calls."""
    with patch(
        "app.backup_metrics.get_last_success_marker",
        side_effect=BackupRestoreNotConfiguredError,
    ) as mock_download:
        content1, _ = backup_metrics.render_backup_metrics()
        content2, _ = backup_metrics.render_backup_metrics()

    assert b"hriv_backup_configured 0.0" in content1
    assert b"hriv_backup_configured 0.0" in content2
    assert mock_download.call_count == 1
