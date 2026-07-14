"""Tests for the backup metrics renderer and its cache behavior."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch

import pytest

import app.backup_metrics as backup_metrics
from app.backup_access import BackupRestoreNotConfiguredError


def _clear_caches() -> None:
    with backup_metrics._state_cache_lock:
        backup_metrics._state_cache = None
    with backup_metrics._archive_cache_lock:
        backup_metrics._archive_cache = None


@pytest.fixture(autouse=True)
def _reset_cache():
    _clear_caches()
    yield
    _clear_caches()


def _state(
    *,
    db_success: bool | None = True,
    fs_success: bool | None = True,
    db_started_at: str = "2026-07-13T08:00:00+00:00",
    db_completed_at: str = "2026-07-13T08:00:42+00:00",
    fs_started_at: str = "2026-07-13T08:01:00+00:00",
    fs_completed_at: str = "2026-07-13T08:09:00+00:00",
    db_size: int | None = 12345678,
    fs_size: int | None = 987654321,
) -> dict:
    return {
        "schema_version": 2,
        "database": {
            "started_at": db_started_at,
            "completed_at": db_completed_at,
            "success": db_success,
            "duration_seconds": 42,
            "size_bytes": db_size,
            "last_success_started_at": db_started_at if db_success else "2026-07-12T08:00:00+00:00",
            "last_success_completed_at": db_completed_at if db_success else "2026-07-12T08:00:42+00:00",
            "last_success_duration_seconds": 42,
            "last_success_size_bytes": db_size,
        },
        "filesystem": {
            "started_at": fs_started_at,
            "completed_at": fs_completed_at,
            "success": fs_success,
            "duration_seconds": 480,
            "size_bytes": fs_size,
            "last_success_started_at": fs_started_at if fs_success else "2026-07-11T08:01:00+00:00",
            "last_success_completed_at": fs_completed_at if fs_success else "2026-07-11T08:09:00+00:00",
            "last_success_duration_seconds": 480,
            "last_success_size_bytes": fs_size,
        },
    }


def _archive_summary() -> dict:
    return {
        "database": {
            "count": 3,
            "oldest_created_at": datetime(2026, 7, 10, 8, 0, tzinfo=timezone.utc),
            "newest_created_at": datetime(2026, 7, 13, 8, 0, tzinfo=timezone.utc),
        },
        "filesystem": {
            "count": 2,
            "oldest_created_at": datetime(2026, 7, 11, 8, 0, tzinfo=timezone.utc),
            "newest_created_at": datetime(2026, 7, 13, 8, 0, tzinfo=timezone.utc),
        },
    }


async def test_render_backup_metrics_exposes_split_backup_state() -> None:
    state = _state()
    archives = _archive_summary()

    with (
        patch("app.backup_metrics.get_backup_observability_state", return_value=state),
        patch("app.backup_metrics.list_retained_backup_archives", return_value=archives),
    ):
        content, _ = backup_metrics.render_backup_metrics()

    assert b'hriv_backup_configured 1.0' in content
    assert b'hriv_backup_last_attempt_timestamp_seconds{backup_type="database"}' in content
    assert b'hriv_backup_last_success_timestamp_seconds{backup_type="filesystem"}' in content
    assert b'hriv_backup_last_outcome{backup_type="database"} 1.0' in content
    assert b'hriv_backup_last_duration_seconds{backup_type="filesystem"} 480.0' in content
    assert b'hriv_backup_last_size_bytes{backup_type="database"} 1.2345678e+07' in content
    assert b'hriv_backup_archives_retained{backup_type="database"} 3.0' in content
    assert b'hriv_backup_oldest_archive_timestamp_seconds{backup_type="filesystem"}' in content
    assert b'hriv_backup_archive_listing_last_outcome 1.0' in content


async def test_render_backup_metrics_preserves_failed_attempt_with_older_success() -> None:
    state = _state(db_success=True, fs_success=False)

    with (
        patch("app.backup_metrics.get_backup_observability_state", return_value=state),
        patch("app.backup_metrics.list_retained_backup_archives", return_value=_archive_summary()),
    ):
        content, _ = backup_metrics.render_backup_metrics()

    assert b'hriv_backup_last_outcome{backup_type="filesystem"} 0.0' in content
    assert b'hriv_backup_last_success_timestamp_seconds{backup_type="filesystem"}' in content


async def test_marker_cache_avoids_repeated_calls() -> None:
    with (
        patch("app.backup_metrics.get_backup_observability_state", return_value=_state()) as state_fetch,
        patch("app.backup_metrics.list_retained_backup_archives", return_value=_archive_summary()) as archive_fetch,
    ):
        backup_metrics.render_backup_metrics()
        backup_metrics.render_backup_metrics()
        backup_metrics.render_backup_metrics()

    assert state_fetch.call_count == 1
    assert archive_fetch.call_count == 1


async def test_cache_refreshes_after_ttl(monkeypatch) -> None:
    cache_time = [0.0]

    def _fake_monotonic() -> float:
        return cache_time[0]

    monkeypatch.setattr("app.backup_metrics.monotonic", _fake_monotonic)

    with (
        patch("app.backup_metrics.get_backup_observability_state", return_value=_state()) as state_fetch,
        patch("app.backup_metrics.list_retained_backup_archives", return_value=_archive_summary()) as archive_fetch,
    ):
        cache_time[0] = 0.0
        backup_metrics.render_backup_metrics()
        cache_time[0] = 60.0
        backup_metrics.render_backup_metrics()
        cache_time[0] = 400.0
        backup_metrics.render_backup_metrics()

    assert state_fetch.call_count == 2
    assert archive_fetch.call_count == 2


async def test_not_configured_reports_disabled_state() -> None:
    with (
        patch(
            "app.backup_metrics.get_backup_observability_state",
            side_effect=BackupRestoreNotConfiguredError,
        ),
        patch(
            "app.backup_metrics.list_retained_backup_archives",
            side_effect=BackupRestoreNotConfiguredError,
        ),
    ):
        content, _ = backup_metrics.render_backup_metrics()

    assert b'hriv_backup_configured 0.0' in content
    assert b'hriv_backup_archive_listing_last_outcome -1.0' in content
    assert b'hriv_backup_age_seconds 0.0' in content


async def test_missing_state_reports_infinite_age() -> None:
    with (
        patch("app.backup_metrics.get_backup_observability_state", return_value=None),
        patch("app.backup_metrics.list_retained_backup_archives", return_value=_archive_summary()),
    ):
        content, _ = backup_metrics.render_backup_metrics()

    assert b'hriv_backup_age_seconds +Inf' in content
    assert b'hriv_backup_last_outcome{backup_type="database"} -1.0' in content


async def test_archive_listing_failure_preserves_stale_summary_without_zeroing() -> None:
    archives = _archive_summary()
    state = _state()
    cache_time = [0.0]

    def _fake_monotonic() -> float:
        return cache_time[0]

    with patch("app.backup_metrics.monotonic", _fake_monotonic):
        with (
            patch("app.backup_metrics.get_backup_observability_state", return_value=state),
            patch("app.backup_metrics.list_retained_backup_archives", return_value=archives),
        ):
            cache_time[0] = 0.0
            backup_metrics.render_backup_metrics()

        with (
            patch("app.backup_metrics.get_backup_observability_state", return_value=state),
            patch(
                "app.backup_metrics.list_retained_backup_archives",
                side_effect=RuntimeError("azure listing failed"),
            ),
        ):
            cache_time[0] = 400.0
            content, _ = backup_metrics.render_backup_metrics()

    assert b'hriv_backup_archive_listing_last_outcome 0.0' in content
    assert b'hriv_backup_archives_retained{backup_type="database"} 3.0' in content


async def test_invalid_numeric_fields_render_nan() -> None:
    state = _state(db_size=None, fs_size=None)
    state["database"]["duration_seconds"] = "bad"
    state["filesystem"]["started_at"] = "not-a-timestamp"

    with (
        patch("app.backup_metrics.get_backup_observability_state", return_value=state),
        patch("app.backup_metrics.list_retained_backup_archives", return_value=_archive_summary()),
    ):
        content, _ = backup_metrics.render_backup_metrics()

    assert b'hriv_backup_last_duration_seconds{backup_type="database"} NaN' in content
    assert b'hriv_backup_last_attempt_timestamp_seconds{backup_type="filesystem"} NaN' in content
