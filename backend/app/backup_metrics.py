"""Prometheus-format backup and restore metrics for the /api/metrics endpoint."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from threading import Lock
from time import monotonic
from typing import Any

from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Gauge, generate_latest

from .backup_access import (
    BackupRestoreNotConfiguredError,
    get_backup_observability_state,
    get_restore_observability_state,
    list_retained_backup_archives,
)

logger = logging.getLogger(__name__)

_registry = CollectorRegistry()
_render_lock = Lock()

_BACKUP_TYPES = ("database", "filesystem")
_RESTORE_TYPES = ("database", "filesystem")
_RESTORE_PURPOSES = ("operator", "test")
_CACHE_TTL_SECONDS = 300

_state_cache: tuple[dict | None, bool, float] | None = None
_state_cache_lock = Lock()
_archive_cache: tuple[dict[str, dict[str, Any]] | None, bool, float, float | None, bool] | None = None
_archive_cache_lock = Lock()
_restore_cache: tuple[dict | None, bool, float] | None = None
_restore_cache_lock = Lock()


def _parse_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _parse_numeric(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _attempt_outcome_value(section: dict[str, object] | None) -> float:
    if not isinstance(section, dict):
        return -1.0
    success = section.get("success")
    if success is True:
        return 1.0
    if success is False:
        return 0.0
    return -1.0


def _set_or_nan(gauge: Gauge, value: float | None) -> None:
    gauge.set(float("nan") if value is None else value)


def _fetch_backup_state() -> tuple[dict | None, bool]:
    global _state_cache

    with _state_cache_lock:
        if _state_cache is not None and monotonic() - _state_cache[2] < _CACHE_TTL_SECONDS:
            return _state_cache[:2]

        configured = True
        state: dict | None = None
        try:
            state = get_backup_observability_state()
        except BackupRestoreNotConfiguredError:
            configured = False
        except Exception:  # noqa: BLE001 - never break the metrics scrape
            logger.exception("Failed to refresh backup observability state")

        _state_cache = (state, configured, monotonic())
        return _state_cache[:2]


def _fetch_restore_state() -> tuple[dict | None, bool]:
    global _restore_cache

    with _restore_cache_lock:
        if _restore_cache is not None and monotonic() - _restore_cache[2] < _CACHE_TTL_SECONDS:
            return _restore_cache[:2]

        configured = True
        state: dict | None = None
        try:
            state = get_restore_observability_state()
        except BackupRestoreNotConfiguredError:
            configured = False
        except Exception:  # noqa: BLE001 - never break the metrics scrape
            logger.exception("Failed to refresh restore observability state")

        _restore_cache = (state, configured, monotonic())
        return _restore_cache[:2]


def _fetch_archive_summary() -> tuple[dict[str, dict[str, Any]] | None, bool, float | None, bool]:
    global _archive_cache

    with _archive_cache_lock:
        if _archive_cache is not None and monotonic() - _archive_cache[2] < _CACHE_TTL_SECONDS:
            return (_archive_cache[0], _archive_cache[1], _archive_cache[3], _archive_cache[4])

        configured = True
        last_successful_summary = _archive_cache[0] if _archive_cache is not None else None
        last_successful_at = _archive_cache[3] if _archive_cache is not None else None
        fetch_succeeded = False

        try:
            summary = list_retained_backup_archives()
            fetch_succeeded = True
        except BackupRestoreNotConfiguredError:
            configured = False
            summary = None
            last_successful_at = None
        except Exception:  # noqa: BLE001 - never break the metrics scrape
            logger.exception("Failed to refresh retained backup archive summary")
            summary = last_successful_summary

        cache_time = monotonic()
        if fetch_succeeded:
            last_successful_at = cache_time

        _archive_cache = (summary, configured, cache_time, last_successful_at, fetch_succeeded)
        return (summary, configured, last_successful_at, fetch_succeeded)


_backup_configured = Gauge(
    "hriv_backup_configured",
    "Whether Azure backup read credentials are configured",
    registry=_registry,
)

_backup_age = Gauge(
    "hriv_backup_age_seconds",
    "Worst-case seconds since the last successful database/filesystem backup completed; +Inf if any configured backup type lacks a valid success timestamp",
    registry=_registry,
)

_backup_last_attempt = Gauge(
    "hriv_backup_last_attempt_timestamp_seconds",
    "Unix timestamp when the latest backup attempt for this backup type started",
    labelnames=("backup_type",),
    registry=_registry,
)

_backup_last_success = Gauge(
    "hriv_backup_last_success_timestamp_seconds",
    "Unix timestamp when the latest successful backup for this backup type completed",
    labelnames=("backup_type",),
    registry=_registry,
)

_backup_last_outcome = Gauge(
    "hriv_backup_last_outcome",
    "Outcome of the latest backup attempt for this backup type: 1 success, 0 failure, -1 unknown",
    labelnames=("backup_type",),
    registry=_registry,
)

_backup_last_duration = Gauge(
    "hriv_backup_last_duration_seconds",
    "Duration in seconds of the latest backup attempt for this backup type",
    labelnames=("backup_type",),
    registry=_registry,
)

_backup_last_size = Gauge(
    "hriv_backup_last_size_bytes",
    "Payload size in bytes recorded for the latest backup attempt for this backup type",
    labelnames=("backup_type",),
    registry=_registry,
)

_backup_archives_retained = Gauge(
    "hriv_backup_archives_retained",
    "Number of retained backup archives classified for this backup type",
    labelnames=("backup_type",),
    registry=_registry,
)

_backup_oldest_archive = Gauge(
    "hriv_backup_oldest_archive_timestamp_seconds",
    "Unix timestamp of the oldest retained archive classified for this backup type",
    labelnames=("backup_type",),
    registry=_registry,
)

_backup_newest_archive = Gauge(
    "hriv_backup_newest_archive_timestamp_seconds",
    "Unix timestamp of the newest retained archive classified for this backup type",
    labelnames=("backup_type",),
    registry=_registry,
)

_backup_archive_listing_last_refresh = Gauge(
    "hriv_backup_archive_listing_last_refresh_timestamp_seconds",
    "Unix timestamp when retained backup archive classification was last refreshed successfully",
    registry=_registry,
)

_backup_archive_listing_last_outcome = Gauge(
    "hriv_backup_archive_listing_last_outcome",
    "Outcome of the most recent retained-archive classification refresh: 1 success, 0 failure, -1 not configured",
    registry=_registry,
)

_restore_last_attempt = Gauge(
    "hriv_restore_last_attempt_timestamp_seconds",
    "Unix timestamp when the latest restore attempt for this restore type and purpose started",
    labelnames=("restore_type", "purpose"),
    registry=_registry,
)

_restore_last_success = Gauge(
    "hriv_restore_last_success_timestamp_seconds",
    "Unix timestamp when the latest successful restore for this restore type and purpose completed",
    labelnames=("restore_type", "purpose"),
    registry=_registry,
)

_restore_last_outcome = Gauge(
    "hriv_restore_last_outcome",
    "Outcome of the latest restore attempt for this restore type and purpose: 1 success, 0 failure, -1 unknown",
    labelnames=("restore_type", "purpose"),
    registry=_registry,
)

_restore_last_duration = Gauge(
    "hriv_restore_last_duration_seconds",
    "Duration in seconds of the latest restore attempt for this restore type and purpose",
    labelnames=("restore_type", "purpose"),
    registry=_registry,
)


def _empty_summary() -> dict[str, dict[str, Any]]:
    return {
        backup_type: {
            "count": 0,
            "oldest_created_at": None,
            "newest_created_at": None,
        }
        for backup_type in _BACKUP_TYPES
    }


def _compatibility_backup_age(configured: bool, state: dict | None) -> float:
    if not configured:
        return 0.0

    if not isinstance(state, dict):
        return float("inf")

    now = datetime.now(timezone.utc)
    ages: list[float] = []
    for backup_type in _BACKUP_TYPES:
        section = state.get(backup_type)
        if not isinstance(section, dict):
            return float("inf")
        success_at = _parse_timestamp(section.get("last_success_completed_at"))
        if success_at is None:
            return float("inf")
        ages.append(max((now - success_at).total_seconds(), 0.0))

    return max(ages, default=float("inf"))


def _purpose_section(state: dict | None, purpose: str) -> dict | None:
    if not isinstance(state, dict):
        return None
    section = state.get(purpose)
    return section if isinstance(section, dict) else None


def render_backup_metrics() -> tuple[bytes, str]:
    """Return Prometheus exposition text for backup and restore state."""
    backup_state, backup_configured = _fetch_backup_state()
    archive_summary, archive_configured, archive_last_refresh_monotonic, archive_fetch_succeeded = (
        _fetch_archive_summary()
    )
    restore_state, restore_configured = _fetch_restore_state()

    with _render_lock:
        _backup_configured.set(1 if backup_configured else 0)
        _backup_age.set(_compatibility_backup_age(backup_configured, backup_state))

        if not archive_configured:
            _backup_archive_listing_last_outcome.set(-1)
            _backup_archive_listing_last_refresh.set(0)
            archive_summary = _empty_summary()
        else:
            _backup_archive_listing_last_outcome.set(1 if archive_fetch_succeeded else 0)
            if archive_last_refresh_monotonic is None:
                _backup_archive_listing_last_refresh.set(0)
            else:
                _backup_archive_listing_last_refresh.set(
                    max(datetime.now(timezone.utc).timestamp() - (monotonic() - archive_last_refresh_monotonic), 0.0)
                )
            archive_summary = archive_summary or _empty_summary()

        for backup_type in _BACKUP_TYPES:
            section = backup_state.get(backup_type) if isinstance(backup_state, dict) else None
            summary = archive_summary.get(backup_type, {})

            _set_or_nan(
                _backup_last_attempt.labels(backup_type=backup_type),
                (_parse_timestamp(section.get("started_at")).timestamp() if isinstance(section, dict) and _parse_timestamp(section.get("started_at")) else None),
            )
            _set_or_nan(
                _backup_last_success.labels(backup_type=backup_type),
                (
                    _parse_timestamp(section.get("last_success_completed_at")).timestamp()
                    if isinstance(section, dict) and _parse_timestamp(section.get("last_success_completed_at"))
                    else None
                ),
            )
            _backup_last_outcome.labels(backup_type=backup_type).set(_attempt_outcome_value(section))
            _set_or_nan(
                _backup_last_duration.labels(backup_type=backup_type),
                _parse_numeric(section.get("duration_seconds")) if isinstance(section, dict) else None,
            )
            _set_or_nan(
                _backup_last_size.labels(backup_type=backup_type),
                _parse_numeric(section.get("size_bytes")) if isinstance(section, dict) else None,
            )
            _backup_archives_retained.labels(backup_type=backup_type).set(float(summary.get("count", 0) or 0))
            _set_or_nan(
                _backup_oldest_archive.labels(backup_type=backup_type),
                summary["oldest_created_at"].timestamp() if isinstance(summary.get("oldest_created_at"), datetime) else None,
            )
            _set_or_nan(
                _backup_newest_archive.labels(backup_type=backup_type),
                summary["newest_created_at"].timestamp() if isinstance(summary.get("newest_created_at"), datetime) else None,
            )

        restore_available = restore_configured and isinstance(restore_state, dict)
        for purpose in _RESTORE_PURPOSES:
            purpose_state = _purpose_section(restore_state, purpose) if restore_available else None
            for restore_type in _RESTORE_TYPES:
                section = purpose_state.get(restore_type) if isinstance(purpose_state, dict) else None
                attempt_started = (
                    _parse_timestamp(section.get("started_at")) if isinstance(section, dict) else None
                )
                success_completed = (
                    _parse_timestamp(section.get("last_success_completed_at")) if isinstance(section, dict) else None
                )
                _set_or_nan(
                    _restore_last_attempt.labels(restore_type=restore_type, purpose=purpose),
                    attempt_started.timestamp() if attempt_started else None,
                )
                _set_or_nan(
                    _restore_last_success.labels(restore_type=restore_type, purpose=purpose),
                    success_completed.timestamp() if success_completed else None,
                )
                _restore_last_outcome.labels(restore_type=restore_type, purpose=purpose).set(
                    _attempt_outcome_value(section)
                )
                _set_or_nan(
                    _restore_last_duration.labels(restore_type=restore_type, purpose=purpose),
                    _parse_numeric(section.get("duration_seconds")) if isinstance(section, dict) else None,
                )

        return generate_latest(_registry), CONTENT_TYPE_LATEST
