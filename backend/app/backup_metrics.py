"""Prometheus-format backup metrics for the /api/metrics endpoint.

These metrics are intentionally separate from the OpenTelemetry auto-
instrumented metrics emitted by the backend. Backup age must be surfaced
as a continuously-scraped gauge because the backup job itself only runs
once per day.
"""

from datetime import datetime, timezone
from threading import Lock

from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Gauge, generate_latest

from .backup_access import BackupRestoreNotConfiguredError, get_last_success_marker

_registry = CollectorRegistry()
_render_lock = Lock()

_backup_configured = Gauge(
    "hriv_backup_configured",
    "Whether Azure backup read credentials are configured",
    registry=_registry,
)

_backup_age = Gauge(
    "hriv_backup_age_seconds",
    "Seconds since the last successful backup completed",
    registry=_registry,
)

_backup_size = Gauge(
    "hriv_backup_last_size_bytes",
    "Size in bytes of the last successful backup archive",
    registry=_registry,
)

_backup_outcome = Gauge(
    "hriv_backup_last_outcome",
    "Outcome of the last backup attempt: 1 success, 0 unknown, -1 stale/missing",
    registry=_registry,
)


_CONTENT_TYPE = CONTENT_TYPE_LATEST


def render_backup_metrics() -> tuple[bytes, str]:
    """Return Prometheus exposition text and content type for backup status.

    Reads the LAST_SUCCESS marker from Azure Blob Storage. If backup restore
    is not configured or the marker is missing, the gauges still return
    valid values so dashboards can distinguish "not configured" from
    "configured but stale".
    """
    marker: dict | None = None
    configured = True

    try:
        marker = get_last_success_marker()
    except BackupRestoreNotConfiguredError:
        configured = False

    with _render_lock:
        _backup_configured.set(1 if configured else 0)

        if not configured or marker is None:
            _backup_age.set(0)
            _backup_size.set(0)
            _backup_outcome.set(-1 if configured else 0)
            return generate_latest(_registry), _CONTENT_TYPE

        created_at_raw = marker.get("created_at")
        archive_size = marker.get("archive_size")

        try:
            created_at = datetime.fromisoformat(str(created_at_raw))
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            age = max((datetime.now(timezone.utc) - created_at).total_seconds(), 0)
            _backup_age.set(age)
            _backup_outcome.set(1)
        except Exception:
            _backup_age.set(0)
            _backup_outcome.set(0)

        if isinstance(archive_size, (int, float)):
            _backup_size.set(archive_size)
        else:
            _backup_size.set(0)

        return generate_latest(_registry), _CONTENT_TYPE
