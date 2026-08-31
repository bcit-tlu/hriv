"""HRIV Disaster Recovery Backup Service.

Standalone service that snapshots the PostgreSQL database and image
filesystem on a cron schedule, uploads archives to Azure Blob Storage,
and can restore from any snapshot after a fresh redeployment.

Usage:
    python backup.py backup          # Run a one-shot backup now
    python backup.py restore          # Restore the latest snapshot
    python backup.py restore <name>   # Restore a specific snapshot
    python backup.py restore-test     # Restore into the configured test target
    python backup.py list             # List available snapshots
    python backup.py status           # Show the last-success heartbeat
    python backup.py cron             # Start the cron scheduler (default)
"""

from __future__ import annotations

import contextlib
import copy
import fcntl
import hashlib
import io
import json
import logging
import os
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid
from collections.abc import Callable, Iterator
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

from azure.core import MatchConditions
from azure.core.exceptions import (
    ResourceExistsError,
    ResourceModifiedError,
    ResourceNotFoundError,
)
from azure.storage.blob import BlobServiceClient, ContainerClient
from croniter import croniter

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

LOG_FORMAT = "%(asctime)s [%(levelname)s] %(message)s"


def setup_logging() -> None:
    """Configure console logging while preserving OTEL log export."""
    root = logging.getLogger()
    root.setLevel(logging.INFO)

    otel_handlers = [
        handler
        for handler in root.handlers
        if type(handler).__module__.startswith("opentelemetry")
    ]

    for handler in root.handlers[:]:
        root.removeHandler(handler)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(logging.Formatter(LOG_FORMAT))
    root.addHandler(console_handler)

    for handler in otel_handlers:
        root.addHandler(handler)


setup_logging()
log = logging.getLogger("hriv-backup")


def _env(name: str, default: str | None = None, required: bool = False) -> str:
    value = os.environ.get(name, default)
    if required and not value:
        log.error("Required environment variable %s is not set", name)
        sys.exit(1)
    return value or ""


# Database
DATABASE_URL: str = _env("DATABASE_URL", "postgresql://hriv:hriv@db:5432/hriv")

# Filesystem
DATA_DIR: str = _env("DATA_DIR", "/data")

# Azure Blob Storage
AZURE_STORAGE_CONNECTION_STRING: str = _env("AZURE_STORAGE_CONNECTION_STRING", "")
AZURE_STORAGE_CONTAINER: str = _env("AZURE_STORAGE_CONTAINER", "")
AZURE_BLOB_PREFIX: str = _env("AZURE_BLOB_PREFIX", "hriv-backups")

# Schedule & retention
BACKUP_CRON_SCHEDULE: str = _env("BACKUP_CRON_SCHEDULE", "0 2 * * *")
BACKUP_RETENTION_COUNT: int = int(_env("BACKUP_RETENTION_COUNT", "30"))
BACKUP_STALE_HOURS: int = int(_env("BACKUP_STALE_HOURS", "26"))
# Directory used to stage archives while they are being built. Defaults to a
# hidden directory on the /backups volume so the archive never occupies
# pod-local ephemeral storage.
BACKUP_STAGING_DIR: str = _env("BACKUP_STAGING_DIR", "")
RESTORE_TEST_DATABASE_URL: str = _env("RESTORE_TEST_DATABASE_URL", "")
RESTORE_TEST_DATA_DIR: str = _env("RESTORE_TEST_DATA_DIR", "")

# Operating mode: "development" backs up DB + source images + tiles.
# "production" backs up DB + source images only; tiles are excluded and
# must be protected by Longhorn snapshots or rebuilt from source images.
BACKUP_MODE: str = _env("BACKUP_MODE", "development").lower()
if BACKUP_MODE not in ("development", "production"):
    log.error("BACKUP_MODE must be 'development' or 'production', got %s", BACKUP_MODE)
    sys.exit(1)


def _exclude_tiles() -> bool:
    """Return True when the service is configured for production mode."""
    return BACKUP_MODE == "production"


def _local_backup_dir() -> Path:
    return Path("/backups")


_SNAPSHOT_STAMP_RE = re.compile(r"(\d{8}-\d{6})")
_STAGING_DIR_NAME = ".staging"
_STAGING_PREFIX = "hriv-bak-"
_RESTORE_PREFIX = "hriv-restore-"
_STALE_STAGING_HOURS = 24


def _staging_root() -> Path | None:
    """Return the directory archives are staged in, or *None* for pod-local tmp."""
    root = (
        Path(BACKUP_STAGING_DIR)
        if BACKUP_STAGING_DIR
        else _local_backup_dir() / _STAGING_DIR_NAME
    )
    probe = root / f".probe-{uuid.uuid4().hex}"
    try:
        root.mkdir(parents=True, exist_ok=True)
        probe.write_bytes(b"")
        probe.unlink()
    except OSError:
        log.warning(
            "Staging directory %s is unusable - falling back to pod-local temporary storage",
            root,
        )
        return None
    return root


def _newest_mtime(entry: Path) -> float:
    """Return the newest mtime of *entry* or anything beneath it."""
    newest = entry.stat().st_mtime
    for child in entry.rglob("*"):
        try:
            newest = max(newest, child.stat().st_mtime)
        except OSError:
            continue
    return newest


def _sweep_stale_staging(root: Path) -> None:
    """Remove staging directories left behind by interrupted backups or restores.

    A directory is only removed when nothing inside it has been touched for
    ``_STALE_STAGING_HOURS``, so a long-running backup still writing into its
    workspace is never swept out from under itself.
    """
    cutoff = time.time() - _STALE_STAGING_HOURS * 3600
    for prefix in (_STAGING_PREFIX, _RESTORE_PREFIX):
        for entry in root.glob(f"{prefix}*"):
            try:
                if _newest_mtime(entry) >= cutoff:
                    continue
            except OSError:
                continue
            shutil.rmtree(str(entry), ignore_errors=True)
            log.info("Removed stale backup staging directory %s", entry)


def _staging_tempdir(prefix: str) -> tempfile.TemporaryDirectory:
    """Return a workspace on the backups volume, falling back to pod-local tmp.

    Staging archives and restore extractions off pod-local storage keeps them
    clear of the container's ephemeral-storage limit.
    """
    root = _staging_root()
    if root is not None:
        _sweep_stale_staging(root)
    return tempfile.TemporaryDirectory(prefix=prefix, dir=str(root) if root is not None else None)


def _snapshot_stem(snapshot_name: str) -> str:
    return snapshot_name.removesuffix(".tar.gz")


def _manifest_sidecar_name(snapshot_name: str) -> str:
    return f"{_snapshot_stem(snapshot_name)}.manifest.json"


def _manifest_sidecar_path(archive_path: Path) -> Path:
    return archive_path.with_name(_manifest_sidecar_name(archive_path.name))


def _manifest_sidecar_blob_name(snapshot_name: str) -> str:
    prefix = f"{AZURE_BLOB_PREFIX}/" if AZURE_BLOB_PREFIX else ""
    return f"{prefix}{_manifest_sidecar_name(snapshot_name)}"


def _archive_blob_name(snapshot_name: str) -> str:
    prefix = f"{AZURE_BLOB_PREFIX}/" if AZURE_BLOB_PREFIX else ""
    return f"{prefix}{_snapshot_stem(snapshot_name)}.tar.gz"


def _last_success_marker_path() -> Path:
    return _local_backup_dir() / "LAST_SUCCESS.json"


def _last_success_marker_blob_name() -> str:
    prefix = f"{AZURE_BLOB_PREFIX}/" if AZURE_BLOB_PREFIX else ""
    return f"{prefix}LAST_SUCCESS.json"


def _backup_state_path() -> Path:
    return _local_backup_dir() / "BACKUP_STATE.json"


def _backup_state_blob_name() -> str:
    prefix = f"{AZURE_BLOB_PREFIX}/" if AZURE_BLOB_PREFIX else ""
    return f"{prefix}BACKUP_STATE.json"


def _restore_state_path() -> Path:
    return _local_backup_dir() / "RESTORE_STATE.json"


def _restore_state_blob_name() -> str:
    prefix = f"{AZURE_BLOB_PREFIX}/" if AZURE_BLOB_PREFIX else ""
    return f"{prefix}RESTORE_STATE.json"


def _atomic_write_bytes(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f".{path.name}.{uuid.uuid4()}.tmp")
    tmp_path.write_bytes(payload)
    tmp_path.replace(path)


# ---------------------------------------------------------------------------
# Shared observability state: coordination and ordering-aware merges
#
# Several backup or restore runs can be in flight at once (the cron loop plus
# an on-demand ``kubectl exec`` invocation, or two containers sharing the
# /backups volume). Every shared JSON document is therefore updated with a
# read -> merge -> write cycle instead of a blind overwrite:
#
#   * local files are serialised with an advisory flock on a sidecar lock file
#     that lives next to them on the /backups volume, so the lock is visible to
#     every process sharing the volume and is released by the kernel when a
#     writer is killed;
#   * Azure blobs are updated with an ETag compare-and-set, because a local
#     lock cannot coordinate writers that only share a storage account.
#
# The merge rules — not the lock — are what guarantee correctness: a slower or
# older run can never overwrite a newer attempt record, and a failed run can
# never erase a newer last-success record.
# ---------------------------------------------------------------------------

STATE_LOCK_FILENAME = ".hriv-backup-state.lock"
BACKUP_STATE_SCHEMA_VERSION = 2
RESTORE_STATE_SCHEMA_VERSION = 1
_STATE_LOCK_TIMEOUT_SECONDS = 30.0
_STATE_LOCK_POLL_SECONDS = 0.05
_AZURE_CAS_ATTEMPTS = 5
_MAX_ATTEMPT_HISTORY = 10
_EPOCH = datetime.min.replace(tzinfo=timezone.utc)

_ATTEMPT_FIELDS = (
    "run_id",
    "started_at",
    "completed_at",
    "success",
    "duration_seconds",
    "size_bytes",
    "archive_key",
)
_LAST_SUCCESS_FIELDS = (
    "last_success_started_at",
    "last_success_completed_at",
    "last_success_duration_seconds",
    "last_success_size_bytes",
    "last_success_archive_key",
)
_RESTORE_ATTEMPT_FIELDS = (
    "run_id",
    "started_at",
    "completed_at",
    "success",
    "duration_seconds",
    "archive_name",
)
_RESTORE_LAST_SUCCESS_FIELDS = (
    "last_success_started_at",
    "last_success_completed_at",
    "last_success_duration_seconds",
    "last_success_archive_name",
)


def _new_run_id() -> str:
    return uuid.uuid4().hex


def _parse_iso(value: object) -> datetime | None:
    """Parse an ISO-8601 timestamp, assuming UTC when no offset is present."""
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _state_lock_path() -> Path:
    return _local_backup_dir() / STATE_LOCK_FILENAME


@contextlib.contextmanager
def _state_lock() -> Iterator[bool]:
    """Hold an exclusive advisory lock on the shared state lock file.

    Yields True when the lock was acquired. The lock is only ever held around a
    read/merge/write of a few kilobytes, so a wait longer than
    ``_STATE_LOCK_TIMEOUT_SECONDS`` means something is wedged; the caller then
    abandons the update instead of racing an unserialised read/merge/write that
    could drop another run's result.
    """
    path = _state_lock_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
    except OSError:
        log.exception("Failed to open state lock %s", path)
        yield False
        return

    try:
        deadline = time.monotonic() + _STATE_LOCK_TIMEOUT_SECONDS
        acquired = False
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
                break
            except OSError:
                if time.monotonic() >= deadline:
                    break
                time.sleep(_STATE_LOCK_POLL_SECONDS)

        if not acquired:
            log.warning(
                "Timed out after %.0fs waiting for %s",
                _STATE_LOCK_TIMEOUT_SECONDS,
                path,
            )
            yield False
            return

        try:
            yield True
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)


def _read_json_file(path: Path) -> dict | None:
    try:
        if not path.exists():
            return None
        payload = json.loads(path.read_text())
    except Exception:
        log.exception("Failed to read %s", path)
        return None
    return payload if isinstance(payload, dict) else None


def _download_json_with_etag(
    container: ContainerClient,
    blob_name: str,
) -> tuple[dict | None, str | None, str]:
    """Return ``(document, etag, presence)`` for a JSON blob.

    ``presence`` is ``"missing"``, ``"exists"`` or ``"unknown"``. ``"unknown"``
    means the current document could not be established, so no conditional write
    can be built from it; the caller retries rather than replacing a document it
    was unable to merge with.
    """
    try:
        stream = container.download_blob(blob_name)
        etag = getattr(getattr(stream, "properties", None), "etag", None)
        raw = stream.readall()
    except ResourceNotFoundError:
        return None, None, "missing"
    except Exception:
        log.exception("Failed to read %s", blob_name)
        return None, None, "unknown"

    if not isinstance(etag, str) or not etag:
        return None, None, "unknown"

    try:
        document = json.loads(raw)
    except Exception:
        log.warning("Ignoring unparseable %s; replacing it", blob_name)
        return None, etag, "exists"

    return (document if isinstance(document, dict) else None), etag, "exists"


def _commit_shared_json(
    *,
    local_path: Path,
    blob_name: str,
    incoming: dict,
    merge: Callable[[dict | None, dict], dict],
    label: str,
) -> None:
    """Merge ``incoming`` into the shared document and store the result."""
    try:
        if _azure_configured():
            container = _blob_container_client()
            for _ in range(_AZURE_CAS_ATTEMPTS):
                existing, etag, presence = _download_json_with_etag(container, blob_name)
                if presence == "unknown":
                    continue
                payload = json.dumps(merge(existing, incoming), indent=2).encode()
                try:
                    if presence == "missing":
                        container.upload_blob(blob_name, io.BytesIO(payload), overwrite=False)
                    else:
                        container.upload_blob(
                            blob_name,
                            io.BytesIO(payload),
                            overwrite=True,
                            etag=etag,
                            match_condition=MatchConditions.IfNotModified,
                        )
                    return
                except (ResourceExistsError, ResourceModifiedError):
                    # Another writer won the race; re-read and merge again.
                    continue
            log.warning("Gave up updating %s after %d attempts", label, _AZURE_CAS_ATTEMPTS)
            return

        with _state_lock() as locked:
            if not locked:
                log.warning("Skipping %s update; state lock unavailable", label)
                return
            existing = _read_json_file(local_path)
            payload = json.dumps(merge(existing, incoming), indent=2).encode()
            _atomic_write_bytes(local_path, payload)
    except Exception:
        log.exception("Failed to write %s", label)


def _attempt_sort_key(section: object) -> tuple[datetime, datetime, str]:
    """Order attempt records by completion, then start, then run id.

    A run that has finished always outranks one that merely started earlier, so
    the record on disk describes the most recently *finished* attempt.
    """
    if not isinstance(section, dict):
        return (_EPOCH, _EPOCH, "")
    started = _parse_iso(section.get("started_at"))
    completed = _parse_iso(section.get("completed_at"))
    return (
        completed or started or _EPOCH,
        started or _EPOCH,
        str(section.get("run_id") or ""),
    )


def _success_sort_key(section: object) -> datetime | None:
    if not isinstance(section, dict):
        return None
    return _parse_iso(section.get("last_success_completed_at")) or _parse_iso(
        section.get("last_success_started_at")
    )


def _merge_section(
    existing: dict,
    incoming: dict,
    attempt_fields: tuple[str, ...],
    success_fields: tuple[str, ...],
) -> dict:
    """Merge one attempt section, keeping the newest attempt and success.

    A run may commit the same attempt more than once (the database archive key,
    for example, is only known once the filesystem archive exists), so a write
    from the run that already owns the record is applied even though its
    ordering key is unchanged.
    """
    merged = copy.deepcopy(existing)

    incoming_key = _attempt_sort_key(incoming)
    existing_key = _attempt_sort_key(existing)
    same_attempt = incoming_key == existing_key and bool(incoming.get("run_id"))

    if incoming_key > existing_key or same_attempt:
        for field in attempt_fields:
            merged[field] = incoming.get(field)

    incoming_success = _success_sort_key(incoming)
    existing_success = _success_sort_key(existing)
    if incoming_success is not None and (
        existing_success is None
        or incoming_success > existing_success
        or (same_attempt and incoming_success == existing_success)
    ):
        for field in success_fields:
            merged[field] = incoming.get(field)

    return merged


def _state_sort_key(state: object) -> tuple[datetime, datetime, str]:
    if not isinstance(state, dict):
        return (_EPOCH, _EPOCH, "")
    return max(_attempt_sort_key(state.get(backup_type)) for backup_type in ("database", "filesystem"))


def _attempt_history_entries(state: dict) -> list[dict]:
    entries: list[dict] = []
    for backup_type in ("database", "filesystem"):
        section = state.get(backup_type)
        if not isinstance(section, dict) or section.get("started_at") is None:
            continue
        entries.append(
            {
                "run_id": section.get("run_id") or state.get("run_id"),
                "backup_type": backup_type,
                "snapshot_name": state.get("snapshot_name"),
                "started_at": section.get("started_at"),
                "completed_at": section.get("completed_at"),
                "success": section.get("success"),
                "size_bytes": section.get("size_bytes"),
                "archive_key": section.get("archive_key"),
            }
        )
    return entries


def _merge_attempt_history(existing: dict | None, incoming: dict) -> list[dict]:
    """Return the newest ``_MAX_ATTEMPT_HISTORY`` attempts across both runs.

    Per-run history survives concurrent writers, so a run whose attempt record
    lost the freshness comparison is still visible for debugging. Candidates are
    considered oldest document first, and an equal ordering key replaces the
    entry held so far, so a run re-committing its own finished attempt (adding
    the database ``archive_key``, say) enriches its history entry too.
    """
    history: dict[tuple[str, str], dict] = {}
    candidates: list[dict] = []
    if isinstance(existing, dict) and isinstance(existing.get("attempts"), list):
        candidates.extend(entry for entry in existing["attempts"] if isinstance(entry, dict))
    candidates.extend(_attempt_history_entries(incoming))

    for entry in candidates:
        key = (str(entry.get("run_id") or ""), str(entry.get("backup_type") or ""))
        current = history.get(key)
        if current is None or _attempt_sort_key(entry) >= _attempt_sort_key(current):
            history[key] = entry

    ordered = sorted(history.values(), key=_attempt_sort_key, reverse=True)
    return ordered[:_MAX_ATTEMPT_HISTORY]


def _merge_backup_state(existing: dict | None, incoming: dict) -> dict:
    """Merge a backup observability state document.

    Attempt records advance only for a strictly newer attempt, and
    ``last_success_*`` fields advance only for a strictly newer success, so a
    late-finishing failure cannot regress a newer success.
    """
    if (
        not isinstance(existing, dict)
        or existing.get("schema_version") != BACKUP_STATE_SCHEMA_VERSION
    ):
        merged = copy.deepcopy(incoming)
        merged["attempts"] = _merge_attempt_history(None, incoming)
        return merged

    merged = copy.deepcopy(existing)
    merged["schema_version"] = BACKUP_STATE_SCHEMA_VERSION

    if _state_sort_key(incoming) >= _state_sort_key(existing):
        for key in ("run_id", "snapshot_name", "backup_mode", "tiles_excluded", "storage_prefix"):
            if key in incoming:
                merged[key] = incoming[key]

    for backup_type in ("database", "filesystem"):
        incoming_section = incoming.get(backup_type)
        if not isinstance(incoming_section, dict):
            continue
        existing_section = merged.get(backup_type)
        if not isinstance(existing_section, dict):
            merged[backup_type] = copy.deepcopy(incoming_section)
            continue
        merged[backup_type] = _merge_section(
            existing_section,
            incoming_section,
            _ATTEMPT_FIELDS,
            _LAST_SUCCESS_FIELDS,
        )

    merged["attempts"] = _merge_attempt_history(existing, incoming)
    updated_candidates = [
        value
        for value in (
            _parse_iso(existing.get("updated_at")),
            _parse_iso(incoming.get("updated_at")),
        )
        if value is not None
    ]
    if updated_candidates:
        merged["updated_at"] = max(updated_candidates).isoformat()
    return merged


def _merge_restore_state(existing: dict | None, incoming: dict) -> dict:
    if (
        not isinstance(existing, dict)
        or existing.get("schema_version") != RESTORE_STATE_SCHEMA_VERSION
    ):
        return copy.deepcopy(incoming)

    merged = copy.deepcopy(existing)
    merged["schema_version"] = RESTORE_STATE_SCHEMA_VERSION
    for purpose in ("operator", "test"):
        incoming_purpose = incoming.get(purpose)
        existing_purpose = merged.get(purpose)
        if not isinstance(incoming_purpose, dict):
            continue
        if not isinstance(existing_purpose, dict):
            merged[purpose] = copy.deepcopy(incoming_purpose)
            continue
        for restore_type in ("database", "filesystem"):
            incoming_section = incoming_purpose.get(restore_type)
            if not isinstance(incoming_section, dict):
                continue
            existing_section = existing_purpose.get(restore_type)
            if not isinstance(existing_section, dict):
                existing_purpose[restore_type] = copy.deepcopy(incoming_section)
                continue
            existing_purpose[restore_type] = _merge_section(
                existing_section,
                incoming_section,
                _RESTORE_ATTEMPT_FIELDS,
                _RESTORE_LAST_SUCCESS_FIELDS,
            )
    return merged


def _marker_sort_key(marker: object) -> tuple[datetime, datetime, str]:
    """Order last-success markers by completion time, then by snapshot time."""
    if not isinstance(marker, dict):
        return (_EPOCH, _EPOCH, "")
    created = _parse_iso(marker.get("created_at"))
    completed = _parse_iso(marker.get("completed_at"))
    return (completed or created or _EPOCH, created or _EPOCH, str(marker.get("run_id") or ""))


def _merge_marker_types(existing: object, incoming: object) -> dict:
    merged: dict[str, dict] = {}
    for source in (existing, incoming):
        if not isinstance(source, dict):
            continue
        for backup_type, entry in source.items():
            if not isinstance(entry, dict):
                continue
            current = merged.get(backup_type)
            if current is None or _marker_sort_key(entry) > _marker_sort_key(current):
                merged[backup_type] = copy.deepcopy(entry)
    return merged


def _merge_last_success_marker(existing: dict | None, incoming: dict) -> dict:
    """Keep the newest overall marker plus the newest marker for each type."""
    if not isinstance(existing, dict):
        merged = copy.deepcopy(incoming)
        merged["types"] = _merge_marker_types(None, incoming.get("types"))
        return merged

    if _marker_sort_key(incoming) >= _marker_sort_key(existing):
        merged = copy.deepcopy(incoming)
    else:
        merged = copy.deepcopy(existing)
    merged["types"] = _merge_marker_types(existing.get("types"), incoming.get("types"))
    return merged


def _new_backup_state(snapshot_name: str, run_id: str | None = None) -> dict:
    def _blank_section() -> dict[str, object]:
        return {
            "run_id": None,
            "started_at": None,
            "completed_at": None,
            "success": None,
            "duration_seconds": None,
            "size_bytes": None,
            "archive_key": None,
            "last_success_started_at": None,
            "last_success_completed_at": None,
            "last_success_duration_seconds": None,
            "last_success_size_bytes": None,
            "last_success_archive_key": None,
        }

    return {
        "schema_version": BACKUP_STATE_SCHEMA_VERSION,
        "run_id": run_id or _new_run_id(),
        "snapshot_name": snapshot_name,
        "backup_mode": BACKUP_MODE,
        "tiles_excluded": _exclude_tiles(),
        "storage_prefix": AZURE_BLOB_PREFIX,
        "database": _blank_section(),
        "filesystem": _blank_section(),
    }


def _mark_attempt_started(
    state: dict,
    backup_type: str,
    *,
    started_at: datetime,
) -> None:
    section = state[backup_type]
    section["run_id"] = state.get("run_id")
    section["started_at"] = started_at.isoformat()
    section["completed_at"] = None
    section["success"] = None
    section["duration_seconds"] = None
    section["size_bytes"] = None
    section["archive_key"] = None


def _mark_attempt_finished(
    state: dict,
    backup_type: str,
    *,
    started_at: datetime,
    completed_at: datetime,
    success: bool,
    size_bytes: int | None,
    archive_key: str | None = None,
) -> None:
    duration_seconds = max((completed_at - started_at).total_seconds(), 0.0)
    section = state[backup_type]
    section["run_id"] = state.get("run_id")
    section["started_at"] = started_at.isoformat()
    section["completed_at"] = completed_at.isoformat()
    section["success"] = success
    section["duration_seconds"] = duration_seconds
    section["size_bytes"] = size_bytes
    section["archive_key"] = archive_key
    if success:
        section["last_success_started_at"] = section["started_at"]
        section["last_success_completed_at"] = section["completed_at"]
        section["last_success_duration_seconds"] = duration_seconds
        section["last_success_size_bytes"] = size_bytes
        section["last_success_archive_key"] = archive_key


def _write_backup_state(state: dict) -> None:
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    _commit_shared_json(
        local_path=_backup_state_path(),
        blob_name=_backup_state_blob_name(),
        incoming=state,
        merge=_merge_backup_state,
        label="backup observability state",
    )


def _new_restore_state(run_id: str | None = None) -> dict:
    def _blank_section() -> dict[str, object]:
        return {
            "run_id": None,
            "started_at": None,
            "completed_at": None,
            "success": None,
            "duration_seconds": None,
            "archive_name": None,
            "last_success_started_at": None,
            "last_success_completed_at": None,
            "last_success_duration_seconds": None,
            "last_success_archive_name": None,
        }

    return {
        "schema_version": RESTORE_STATE_SCHEMA_VERSION,
        "run_id": run_id or _new_run_id(),
        "operator": {
            "database": _blank_section(),
            "filesystem": _blank_section(),
        },
        "test": {
            "database": _blank_section(),
            "filesystem": _blank_section(),
        },
    }


def _read_restore_state() -> dict | None:
    try:
        if _azure_configured():
            container = _blob_container_client()
            stream = container.download_blob(_restore_state_blob_name())
            return json.loads(stream.readall())

        path = _restore_state_path()
        if not path.exists():
            return None
        return json.loads(path.read_text())
    except ResourceNotFoundError:
        return None
    except Exception:
        log.exception("Failed to read restore observability state")
        return None


def _seed_restore_success_history(state: dict, previous_state: dict | None) -> None:
    if (
        not isinstance(previous_state, dict)
        or previous_state.get("schema_version") != RESTORE_STATE_SCHEMA_VERSION
    ):
        return

    for purpose in ("operator", "test"):
        previous_purpose = previous_state.get(purpose)
        current_purpose = state.get(purpose)
        if not isinstance(previous_purpose, dict) or not isinstance(current_purpose, dict):
            continue
        for restore_type in ("database", "filesystem"):
            previous_section = previous_purpose.get(restore_type)
            current_section = current_purpose.get(restore_type)
            if not isinstance(previous_section, dict) or not isinstance(current_section, dict):
                continue
            current_section.update(previous_section)


def _write_restore_state(state: dict) -> None:
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    _commit_shared_json(
        local_path=_restore_state_path(),
        blob_name=_restore_state_blob_name(),
        incoming=state,
        merge=_merge_restore_state,
        label="restore observability state",
    )


def _restore_section(state: dict, purpose: str, restore_type: str) -> dict[str, object]:
    return state[purpose][restore_type]


def _mark_restore_started(
    state: dict,
    purpose: str,
    restore_type: str,
    *,
    started_at: datetime,
    archive_name: str,
) -> None:
    section = _restore_section(state, purpose, restore_type)
    section["run_id"] = state.get("run_id")
    section["started_at"] = started_at.isoformat()
    section["completed_at"] = None
    section["success"] = None
    section["duration_seconds"] = None
    section["archive_name"] = archive_name


def _mark_restore_finished(
    state: dict,
    purpose: str,
    restore_type: str,
    *,
    started_at: datetime,
    completed_at: datetime,
    success: bool,
    archive_name: str,
) -> None:
    duration_seconds = max((completed_at - started_at).total_seconds(), 0.0)
    section = _restore_section(state, purpose, restore_type)
    section["run_id"] = state.get("run_id")
    section["started_at"] = started_at.isoformat()
    section["completed_at"] = completed_at.isoformat()
    section["success"] = success
    section["duration_seconds"] = duration_seconds
    section["archive_name"] = archive_name
    if success:
        section["last_success_started_at"] = section["started_at"]
        section["last_success_completed_at"] = section["completed_at"]
        section["last_success_duration_seconds"] = duration_seconds
        section["last_success_archive_name"] = archive_name


def _attach_archive_key_to_success(state: dict, backup_type: str, archive_key: str) -> None:
    section = state[backup_type]
    if section.get("success") is not True:
        return
    section["archive_key"] = archive_key
    section["last_success_archive_key"] = archive_key


def _marker_types_from_state(state: dict | None, snapshot_name: str) -> dict[str, dict]:
    """Describe this run's successful types for the marker's ``types`` block."""
    if not isinstance(state, dict):
        return {}

    types: dict[str, dict] = {}
    for backup_type in ("database", "filesystem"):
        section = state.get(backup_type)
        if not isinstance(section, dict) or section.get("success") is not True:
            continue
        types[backup_type] = {
            "run_id": section.get("run_id") or state.get("run_id"),
            "snapshot_name": snapshot_name,
            "created_at": section.get("started_at"),
            "completed_at": section.get("completed_at"),
            "size_bytes": section.get("size_bytes"),
            "archive_key": section.get("archive_key"),
        }
    return types


def _write_last_success_marker(
    snapshot_name: str,
    *,
    created_at: datetime,
    completed_at: datetime,
    archive_size: int | None,
    run_id: str | None = None,
    state: dict | None = None,
) -> None:
    """Record the newest successful snapshot.

    ``created_at`` stays the snapshot's own timestamp (it names the archive);
    ``completed_at`` is when the snapshot actually became restorable and is what
    freshness is measured from. Ordering against a concurrent run is settled by
    ``_merge_last_success_marker`` at commit time.
    """
    marker = {
        "snapshot_name": snapshot_name,
        "created_at": created_at.isoformat(),
        "completed_at": completed_at.isoformat(),
        "archive_size": archive_size,
        "backup_mode": BACKUP_MODE,
        "tiles_excluded": _exclude_tiles(),
        "run_id": run_id,
        "types": _marker_types_from_state(state, snapshot_name),
    }

    _commit_shared_json(
        local_path=_last_success_marker_path(),
        blob_name=_last_success_marker_blob_name(),
        incoming=marker,
        merge=_merge_last_success_marker,
        label="last-success marker",
    )


def _read_backup_state() -> dict | None:
    try:
        if _azure_configured():
            container = _blob_container_client()
            stream = container.download_blob(_backup_state_blob_name())
            return json.loads(stream.readall())

        path = _backup_state_path()
        if not path.exists():
            return None
        return json.loads(path.read_text())
    except ResourceNotFoundError:
        return None
    except Exception:
        log.exception("Failed to read backup observability state")
        return None


def _seed_last_success_history(state: dict, previous_state: dict | None) -> None:
    if (
        not isinstance(previous_state, dict)
        or previous_state.get("schema_version") != BACKUP_STATE_SCHEMA_VERSION
    ):
        return

    for backup_type in ("database", "filesystem"):
        previous_section = previous_state.get(backup_type)
        current_section = state.get(backup_type)
        if not isinstance(previous_section, dict) or not isinstance(current_section, dict):
            continue
        for key in (
            "last_success_started_at",
            "last_success_completed_at",
            "last_success_duration_seconds",
            "last_success_size_bytes",
            "last_success_archive_key",
        ):
            current_section[key] = previous_section.get(key)


def _read_last_success_marker() -> dict | None:
    try:
        if _azure_configured():
            container = _blob_container_client()
            stream = container.download_blob(_last_success_marker_blob_name())
            return json.loads(stream.readall())

        path = _last_success_marker_path()
        if not path.exists():
            return None
        return json.loads(path.read_text())
    except ResourceNotFoundError:
        return None
    except Exception:
        log.exception("Failed to read last-success marker")
        return None


def _format_age(delta: timedelta) -> str:
    seconds = max(0, int(delta.total_seconds()))
    days, rem = divmod(seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, secs = divmod(rem, 60)
    parts: list[str] = []
    if days:
        parts.append(f"{days}d")
    if hours or parts:
        parts.append(f"{hours}h")
    if minutes or parts:
        parts.append(f"{minutes}m")
    if not parts:
        parts.append(f"{secs}s")
    return " ".join(parts)


# ---------------------------------------------------------------------------
# Helpers – parse DATABASE_URL into pg* components
# ---------------------------------------------------------------------------

def _parse_db_url(url: str) -> dict[str, str]:
    """Parse a PostgreSQL URL into components for pg_dump / psql."""
    # Normalise async driver prefix
    clean = url.replace("postgresql+asyncpg://", "postgresql://")
    parsed = urlparse(clean)
    return {
        "host": parsed.hostname or "db",
        "port": str(parsed.port or 5432),
        "user": parsed.username or "hriv",
        "password": parsed.password or "",
        "dbname": parsed.path.lstrip("/") or "hriv",
    }


def _pg_env(db: dict[str, str]) -> dict[str, str]:
    """Return an env dict with PGPASSWORD set for pg_dump/psql."""
    env = os.environ.copy()
    env["PGPASSWORD"] = db["password"]
    return env


# ---------------------------------------------------------------------------
# Azure Blob Storage client
# ---------------------------------------------------------------------------

def _blob_container_client() -> ContainerClient:
    """Create an Azure Blob Storage container client from env config."""
    service = BlobServiceClient.from_connection_string(AZURE_STORAGE_CONNECTION_STRING)
    return service.get_container_client(AZURE_STORAGE_CONTAINER)


def _azure_configured() -> bool:
    return bool(AZURE_STORAGE_CONNECTION_STRING and AZURE_STORAGE_CONTAINER)


# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------

def _snapshot_sort_key(name: str) -> tuple[str, str]:
    """Sort key for an ``hriv-backup-*`` archive name.

    Archives sort by their ``YYYYMMDD-HHMMSS`` stamp, with the full name as a
    deterministic tie-break between snapshots taken in the same second.
    """
    m = _SNAPSHOT_STAMP_RE.search(name)
    return (m.group(1) if m else name, name)


def _backup_sort_key(path: Path) -> tuple[str, str]:
    return _snapshot_sort_key(path.name)


def _snapshot_exists(snapshot_name: str) -> bool:
    if _azure_configured():
        try:
            container = _blob_container_client()
            blob_name = _archive_blob_name(snapshot_name)
            return any(
                blob.name == blob_name
                for blob in container.list_blobs(name_starts_with=blob_name)
            )
        except Exception:
            log.exception("Failed to check whether snapshot %s already exists", snapshot_name)
            return False
    return (_local_backup_dir() / f"{snapshot_name}.tar.gz").exists()


def _new_snapshot_name(created_at: datetime) -> str:
    """Return a collision-resistant snapshot name for *created_at*.

    The ``YYYYMMDD-HHMMSS`` prefix keeps lexical ordering chronological; the
    random suffix distinguishes invocations that start in the same second.
    """
    stamp = created_at.strftime("%Y%m%d-%H%M%S")
    for _ in range(3):
        candidate = f"hriv-backup-{stamp}-{uuid.uuid4().hex[:8]}"
        if not _snapshot_exists(candidate):
            return candidate
    raise RuntimeError(f"Could not allocate a unique snapshot name for {stamp}")


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _tar_filter(
    exclude_tiles: bool,
    tiles_arcname: str,
) -> Callable[[tarfile.TarInfo], tarfile.TarInfo | None]:
    """Return a tar filter that drops the generated tile tree when requested."""

    def _filter(tarinfo: tarfile.TarInfo) -> tarfile.TarInfo | None:
        if not exclude_tiles:
            return tarinfo
        if tarinfo.name == tiles_arcname or tarinfo.name.startswith(tiles_arcname + "/"):
            return None
        return tarinfo

    return _filter


def run_backup() -> Path | None:
    """Create a snapshot archive and upload it to Azure Blob Storage.

    Returns the local path to the archive, or *None* on failure.
    """
    created_at = datetime.now(timezone.utc)
    snapshot_name = _new_snapshot_name(created_at)
    run_id = _new_run_id()
    log.info("Starting backup: %s (run %s)", snapshot_name, run_id)
    backup_state = _new_backup_state(snapshot_name, run_id)
    _seed_last_success_history(backup_state, _read_backup_state())

    db = _parse_db_url(DATABASE_URL)
    pg = _pg_env(db)

    with _staging_tempdir(_STAGING_PREFIX) as tmpdir:
        work = Path(tmpdir) / snapshot_name
        work.mkdir()

        # 1. pg_dump ----------------------------------------------------------
        dump_path = work / "db.sql"
        log.info("Dumping database %s@%s:%s/%s …", db["user"], db["host"], db["port"], db["dbname"])
        db_started_at = datetime.now(timezone.utc)
        _mark_attempt_started(backup_state, "database", started_at=db_started_at)
        _write_backup_state(backup_state)
        result = subprocess.run(
            [
                "pg_dump",
                "-h", db["host"],
                "-p", db["port"],
                "-U", db["user"],
                "-d", db["dbname"],
                "--no-owner",
                "--no-acl",
                "-F", "plain",
                "-f", str(dump_path),
            ],
            env=pg,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            log.error("pg_dump failed: %s", result.stderr)
            _mark_attempt_finished(
                backup_state,
                "database",
                started_at=db_started_at,
                completed_at=datetime.now(timezone.utc),
                success=False,
                size_bytes=None,
            )
            _write_backup_state(backup_state)
            return None
        log.info("Database dump complete (%s bytes)", dump_path.stat().st_size)
        _mark_attempt_finished(
            backup_state,
            "database",
            started_at=db_started_at,
            completed_at=datetime.now(timezone.utc),
            success=True,
            size_bytes=dump_path.stat().st_size,
        )
        _write_backup_state(backup_state)

        # 2. Filesystem snapshot -----------------------------------------------
        data_src = Path(DATA_DIR)
        has_data = data_src.exists() and any(data_src.iterdir())
        if not has_data:
            log.warning("Data directory %s is empty or missing – skipping filesystem snapshot", DATA_DIR)
        filesystem_started_at = datetime.now(timezone.utc)
        _mark_attempt_started(backup_state, "filesystem", started_at=filesystem_started_at)
        _write_backup_state(backup_state)

        # 3. Manifest ----------------------------------------------------------
        tiles_path = Path(DATA_DIR) / "tiles"
        manifest = {
            "snapshot_name": snapshot_name,
            "created_at": created_at.isoformat(),
            "database_url_host": db["host"],
            "database_name": db["dbname"],
            "data_dir": DATA_DIR,
            "backup_mode": BACKUP_MODE,
            "tiles_excluded": _exclude_tiles(),
            "files": {},
        }
        filesystem_size_bytes = 0

        for fpath in sorted(work.rglob("*")):
            if fpath.is_file():
                rel = str(fpath.relative_to(work))
                manifest["files"][rel] = {
                    "size": fpath.stat().st_size,
                    "sha256": _sha256(fpath),
                }

        # Include checksums for filesystem data files
        if has_data:
            log.info("Computing checksums for filesystem data …")
            for fpath in sorted(data_src.rglob("*")):
                if fpath.is_file():
                    if _exclude_tiles() and fpath.is_relative_to(tiles_path):
                        continue
                    filesystem_size_bytes += fpath.stat().st_size
                    rel = "data/" + str(fpath.relative_to(data_src))
                    manifest["files"][rel] = {
                        "size": fpath.stat().st_size,
                        "sha256": _sha256(fpath),
                    }

        manifest_path = work / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2))
        manifest_payload = manifest_path.read_bytes()

        # 4. Create tar.gz (stream filesystem data directly into archive) ----
        archive_name = f"{snapshot_name}.tar.gz"
        archive_path = Path(tmpdir) / archive_name
        archive_key: str
        marker_archive_size: int | None = None
        try:
            log.info("Creating archive %s …", archive_name)
            tiles_arcname = f"{snapshot_name}/data/tiles"
            filter_func = _tar_filter(_exclude_tiles(), tiles_arcname)
            with tarfile.open(str(archive_path), "w:gz") as tar:
                # Add db dump and manifest from the work directory
                tar.add(str(work), arcname=snapshot_name, filter=filter_func)
                # Stream filesystem data directly into the archive (avoids 2x disk copy)
                if has_data:
                    log.info("Streaming filesystem data from %s into archive …", DATA_DIR)
                    tar.add(str(data_src), arcname=f"{snapshot_name}/data", filter=filter_func)
            archive_size = archive_path.stat().st_size
            log.info("Archive created: %s (%s bytes)", archive_name, archive_size)

            # 5. Upload to Azure Blob Storage --------------------------------
            if _azure_configured():
                blob_name = _archive_blob_name(archive_name)
                log.info("Uploading to azure://%s/%s …", AZURE_STORAGE_CONTAINER, blob_name)
                container = _blob_container_client()
                with open(archive_path, "rb") as data:
                    container.upload_blob(blob_name, data, overwrite=False)
                log.info("Upload complete")
                try:
                    container.upload_blob(
                        _manifest_sidecar_blob_name(snapshot_name),
                        io.BytesIO(manifest_payload),
                        overwrite=True,
                    )
                    log.info("Manifest sidecar uploaded")
                except Exception:
                    log.exception("Manifest sidecar upload failed")

                # 6. Enforce retention policy --------------------------------
                _enforce_retention(container)
                archive_key = blob_name
                marker_archive_size = archive_size
            else:
                log.warning(
                    "Azure Blob Storage not configured – archive saved locally at %s only. "
                    "Set AZURE_STORAGE_CONNECTION_STRING and AZURE_STORAGE_CONTAINER to enable cloud storage.",
                    archive_path,
                )
                # Publish to a persistent location so it survives tmpdir cleanup.
                # A same-filesystem rename avoids staging a second full copy.
                persistent = _local_backup_dir()
                persistent.mkdir(parents=True, exist_ok=True)
                final = persistent / archive_name
                try:
                    os.replace(str(archive_path), str(final))
                except OSError:
                    shutil.move(str(archive_path), str(final))
                log.info("Local backup saved to %s", final)
                try:
                    _atomic_write_bytes(_manifest_sidecar_path(final), manifest_payload)
                    log.info("Local manifest sidecar saved to %s", _manifest_sidecar_path(final))
                except Exception:
                    log.exception("Local manifest sidecar write failed")
                _enforce_local_retention()
                archive_key = str(final)
                marker_archive_size = final.stat().st_size
        except Exception:
            log.exception("Filesystem backup failed")
            _mark_attempt_finished(
                backup_state,
                "filesystem",
                started_at=filesystem_started_at,
                completed_at=datetime.now(timezone.utc),
                success=False,
                size_bytes=filesystem_size_bytes,
            )
            _write_backup_state(backup_state)
            return None

        filesystem_completed_at = datetime.now(timezone.utc)
        _mark_attempt_finished(
            backup_state,
            "filesystem",
            started_at=filesystem_started_at,
            completed_at=filesystem_completed_at,
            success=True,
            size_bytes=filesystem_size_bytes,
            archive_key=archive_key,
        )
        _attach_archive_key_to_success(backup_state, "database", archive_key)
        _write_backup_state(backup_state)
        _write_last_success_marker(
            snapshot_name,
            created_at=created_at,
            completed_at=filesystem_completed_at,
            archive_size=marker_archive_size,
            run_id=run_id,
            state=backup_state,
        )

        if not _azure_configured():
            return Path(archive_key)

    log.info("Backup %s completed successfully", snapshot_name)
    # archive_path inside tmpdir is gone; return a sentinel Path for truthy check
    return Path(archive_name)


def _enforce_retention(container: ContainerClient) -> None:
    """Delete old snapshots beyond BACKUP_RETENTION_COUNT."""
    if BACKUP_RETENTION_COUNT <= 0:
        return

    prefix = f"{AZURE_BLOB_PREFIX}/" if AZURE_BLOB_PREFIX else ""
    try:
        blobs = []
        for blob in container.list_blobs(name_starts_with=prefix):
            if blob.name.endswith(".tar.gz"):
                blobs.append(blob)

        blobs.sort(
            key=lambda b: _snapshot_sort_key(b.name.rsplit("/", 1)[-1]),
            reverse=True,
        )

        if len(blobs) > BACKUP_RETENTION_COUNT:
            to_delete = blobs[BACKUP_RETENTION_COUNT:]
            log.info(
                "Retention policy: keeping %d, deleting %d old snapshot(s)",
                BACKUP_RETENTION_COUNT,
                len(to_delete),
            )
            for blob in to_delete:
                container.delete_blob(blob.name)
                try:
                    container.delete_blob(_manifest_sidecar_blob_name(blob.name.rsplit("/", 1)[-1]))
                except ResourceNotFoundError:
                    # Sidecar manifest may already be gone; continue retention cleanup.
                    log.debug("Manifest sidecar already absent for %s; continuing", blob.name)
                log.info("  Deleted %s", blob.name)
    except Exception:
        log.exception("Failed to enforce retention policy")


def _enforce_local_retention() -> None:
    """Delete old local snapshots beyond BACKUP_RETENTION_COUNT."""
    if BACKUP_RETENTION_COUNT <= 0:
        return

    local_dir = _local_backup_dir()
    if not local_dir.exists():
        return

    archives = sorted(
        local_dir.glob("hriv-backup-*.tar.gz"),
        key=_backup_sort_key,
        reverse=True,
    )
    if len(archives) > BACKUP_RETENTION_COUNT:
        to_delete = archives[BACKUP_RETENTION_COUNT:]
        log.info(
            "Local retention policy: keeping %d, deleting %d old snapshot(s)",
            BACKUP_RETENTION_COUNT,
            len(to_delete),
        )
        for f in to_delete:
            f.unlink()
            sidecar = _manifest_sidecar_path(f)
            try:
                sidecar.unlink()
            except FileNotFoundError:
                # Missing local sidecar is expected; archive deletion already succeeded.
                log.debug("Local manifest sidecar already absent for %s; continuing", f.name)
            log.info("  Deleted %s", f.name)


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

def list_snapshots() -> list[dict]:
    """List available snapshots in Azure Blob Storage or locally."""
    if not _azure_configured():
        # List local backups
        local_dir = _local_backup_dir()
        if not local_dir.exists():
            log.info("No local backups found")
            return []
        snapshots = []
        for f in sorted(
            local_dir.glob("hriv-backup-*.tar.gz"),
            key=_backup_sort_key,
            reverse=True,
        ):
            snapshots.append({
                "name": f.name,
                "size": f.stat().st_size,
                "last_modified": datetime.fromtimestamp(
                    f.stat().st_mtime, tz=timezone.utc
                ).isoformat(),
                "location": "local",
            })
        return snapshots

    prefix = f"{AZURE_BLOB_PREFIX}/" if AZURE_BLOB_PREFIX else ""
    container = _blob_container_client()

    snapshots = []
    for blob in container.list_blobs(name_starts_with=prefix):
        if blob.name.endswith(".tar.gz"):
            name = blob.name.rsplit("/", 1)[-1]
            snapshots.append({
                "name": name,
                "blob_name": blob.name,
                "size": blob.size,
                "last_modified": blob.last_modified.isoformat(),
                "location": "azure",
            })

    snapshots.sort(key=lambda s: _snapshot_sort_key(s["name"]), reverse=True)
    return snapshots


def run_status() -> bool:
    """Print the last-success heartbeat and return whether backup health is fresh."""
    marker = _read_last_success_marker()
    try:
        snapshots = list_snapshots()
    except Exception:
        log.exception("Failed to list snapshots")
        snapshots = []
    newest = snapshots[0]["name"] if snapshots else "(none)"
    snapshot_count = len(snapshots)
    now = datetime.now(timezone.utc)
    print(f"Newest snapshot: {newest}")
    print(f"Snapshot count: {snapshot_count}")

    if not marker:
        print("Status: MISSING")
        print("Last successful backup: (missing)")
        return False

    try:
        # Age is measured from when the snapshot became restorable, falling back
        # to the snapshot timestamp for markers written before completed_at.
        completed_at = _parse_iso(marker.get("completed_at")) or _parse_iso(marker.get("created_at"))
        if completed_at is None:
            raise ValueError("marker has no usable timestamp")
        age = now - completed_at
        stale_after = timedelta(hours=BACKUP_STALE_HOURS)
        stale = age > stale_after
        status_label = "STALE" if stale else "FRESH"
        if not stale and snapshot_count == 0:
            status_label = "NO_SNAPSHOTS"
        print(f"Status: {status_label}")
        print(f"Last successful backup: {completed_at.isoformat()}")
        print(f"Age: {_format_age(age)}")
        print(f"Backup mode: {marker.get('backup_mode', '?')}")
        print(f"Tiles excluded: {marker.get('tiles_excluded', '?')}")
        if stale or snapshot_count == 0:
            return False
        return True
    except Exception:
        log.exception("Invalid last-success marker payload")
        print("Status: MISSING")
        print("Last successful backup: (missing)")
        return False


# ---------------------------------------------------------------------------
# Maintenance flag
# ---------------------------------------------------------------------------

_MAINTENANCE_FILENAME = ".maintenance"


def _maintenance_flag_path() -> Path:
    """Path to the maintenance flag file on the shared data volume."""
    return Path(DATA_DIR) / _MAINTENANCE_FILENAME


def _set_maintenance(enabled: bool) -> None:
    path = _maintenance_flag_path()
    if enabled:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()
        log.info("Maintenance mode ENABLED (%s)", path)
    else:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        log.info("Maintenance mode DISABLED (%s)", path)


# ---------------------------------------------------------------------------
# Restore
# ---------------------------------------------------------------------------

def run_restore(
    snapshot_name: str | None = None,
    *,
    purpose: str = "operator",
    database_url: str | None = None,
    data_dir: str | None = None,
    maintenance: bool = True,
) -> bool:
    """Download and restore a snapshot.

    Operator restores run with maintenance mode enabled so the application is
    unavailable while tables and files are replaced. Restore tests target a
    separate database/data directory and therefore skip maintenance mode.
    """
    if maintenance:
        _set_maintenance(True)
    try:
        return _run_restore_inner(
            snapshot_name,
            purpose=purpose,
            database_url=database_url,
            data_dir=data_dir,
        )
    finally:
        if maintenance:
            _set_maintenance(False)


def run_restore_test(snapshot_name: str | None = None) -> bool:
    """Restore a snapshot into the configured non-production test target."""
    if not RESTORE_TEST_DATABASE_URL or not RESTORE_TEST_DATA_DIR:
        log.error(
            "RESTORE_TEST_DATABASE_URL and RESTORE_TEST_DATA_DIR must be set for restore-test",
            extra={"event": "restore.test_not_configured"},
        )
        return False

    return run_restore(
        snapshot_name,
        purpose="test",
        database_url=RESTORE_TEST_DATABASE_URL,
        data_dir=RESTORE_TEST_DATA_DIR,
        maintenance=False,
    )


def _run_restore_inner(
    snapshot_name: str | None = None,
    *,
    purpose: str = "operator",
    database_url: str | None = None,
    data_dir: str | None = None,
) -> bool:
    """Core restore logic (called inside the maintenance-flag guard)."""
    target_database_url = database_url or DATABASE_URL
    target_data_dir = data_dir or DATA_DIR

    # Locate the snapshot -------------------------------------------------------
    if _azure_configured():
        snapshots = list_snapshots()
        if not snapshots:
            log.error("No snapshots found")
            return False

        if snapshot_name:
            available = [s["name"] for s in snapshots]
            resolved = _resolve_snapshot_name(snapshot_name, available)
            if resolved is None:
                log.error("Snapshot %s not found. Available: %s", snapshot_name, available)
                return False
            target = next(s for s in snapshots if s["name"] == resolved)
        else:
            target = snapshots[0]
            log.info("Using latest snapshot: %s", target["name"])

        # Download ---------------------------------------------------------------
        with _staging_tempdir(_RESTORE_PREFIX) as tmpdir:
            archive_path = Path(tmpdir) / target["name"]
            log.info("Downloading azure://%s/%s …", AZURE_STORAGE_CONTAINER, target["blob_name"])
            container = _blob_container_client()
            with open(archive_path, "wb") as f:
                stream = container.download_blob(target["blob_name"])
                stream.readinto(f)
            log.info("Download complete (%s bytes)", archive_path.stat().st_size)
            return _restore_from_archive(
                archive_path,
                purpose=purpose,
                database_url=target_database_url,
                data_dir=target_data_dir,
            )
    else:
        # Local restore
        local_dir = _local_backup_dir()
        if snapshot_name:
            available = [p.name for p in local_dir.glob("hriv-backup-*.tar.gz")]
            resolved = _resolve_snapshot_name(snapshot_name, available)
            if resolved is not None:
                archive_path = local_dir / resolved
            else:
                fname = (
                    snapshot_name
                    if snapshot_name.endswith(".tar.gz")
                    else f"{snapshot_name}.tar.gz"
                )
                archive_path = local_dir / fname
                if not archive_path.exists():
                    log.error(
                        "Snapshot %s not found. Available: %s",
                        snapshot_name,
                        sorted(available),
                    )
                    return False
        else:
            archives = sorted(
                local_dir.glob("hriv-backup-*.tar.gz"),
                key=_backup_sort_key,
                reverse=True,
            )
            if not archives:
                log.error("No local backups found in %s", local_dir)
                return False
            archive_path = archives[0]
            log.info("Using latest local snapshot: %s", archive_path.name)

        if not archive_path.exists():
            log.error("Snapshot file not found: %s", archive_path)
            return False
        return _restore_from_archive(
            archive_path,
            purpose=purpose,
            database_url=target_database_url,
            data_dir=target_data_dir,
        )


def _resolve_snapshot_name(requested: str, available: list[str]) -> str | None:
    """Resolve *requested* against *available* archive names.

    Accepts an exact archive name, a name without the ``.tar.gz`` suffix, or an
    unambiguous prefix so timestamp-only names still address snapshots written
    with a random suffix.
    """
    stem = _snapshot_stem(requested)
    exact = [name for name in available if _snapshot_stem(name) == stem]
    if exact:
        return exact[0]

    prefixed = sorted(name for name in available if _snapshot_stem(name).startswith(stem))
    if len(prefixed) == 1:
        return prefixed[0]
    if len(prefixed) > 1:
        log.error("Snapshot %s is ambiguous. Matches: %s", requested, prefixed)
    return None


def _restore_ignore_tiles(
    data_archive: Path,
    exclude_tiles: bool,
) -> Callable[[str, list[str]], set[str]] | None:
    """Return an ignore function for shutil.copytree that preserves the tiles tree in production mode."""

    if not exclude_tiles:
        return None

    def _ignore(_dir: str, names: list[str]) -> set[str]:
        if Path(_dir) == data_archive and "tiles" in names:
            return {"tiles"}
        return set()

    return _ignore


def _restore_from_archive(
    archive_path: Path,
    *,
    purpose: str = "operator",
    database_url: str | None = None,
    data_dir: str | None = None,
) -> bool:
    """Extract an archive and restore database + filesystem."""
    log.info(
        "Restoring from %s …",
        archive_path.name,
        extra={
            "event": "restore.started",
            "purpose": purpose,
            "archive_name": archive_path.name,
            "maintenance_enabled": purpose == "operator",
        },
    )

    restore_state = _new_restore_state()
    _seed_restore_success_history(restore_state, _read_restore_state())
    target_database_url = database_url or DATABASE_URL
    target_data_dir = data_dir or DATA_DIR

    with _staging_tempdir(_RESTORE_PREFIX) as tmpdir:
        # Extract ---------------------------------------------------------------
        log.info("Extracting archive …")
        with tarfile.open(str(archive_path), "r:gz") as tar:
            tar.extractall(path=tmpdir, filter="data")

        # Find the snapshot directory (first dir inside the archive)
        entries = list(Path(tmpdir).iterdir())
        if len(entries) == 1 and entries[0].is_dir():
            snapshot_dir = entries[0]
        else:
            snapshot_dir = Path(tmpdir)

        # Read manifest
        manifest_path = snapshot_dir / "manifest.json"
        archive_backup_mode = None
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text())
            archive_backup_mode = manifest.get("backup_mode")
            log.info("Snapshot: %s (created %s)", manifest.get("snapshot_name", "?"), manifest.get("created_at", "?"))
            if archive_backup_mode and archive_backup_mode != BACKUP_MODE:
                log.warning(
                    "Backup mode mismatch: archive was created in %r but current BACKUP_MODE is %r. "
                    "Tiles will be handled according to the current mode; rebuild tiles from source images if needed.",
                    archive_backup_mode,
                    BACKUP_MODE,
                )

        # 1. Restore database ---------------------------------------------------
        dump_path = snapshot_dir / "db.sql"
        if dump_path.exists():
            db = _parse_db_url(target_database_url)
            pg = _pg_env(db)

            log.info("Restoring database …")
            database_started_at = datetime.now(timezone.utc)
            _mark_restore_started(
                restore_state,
                purpose,
                "database",
                started_at=database_started_at,
                archive_name=archive_path.name,
            )
            _write_restore_state(restore_state)

            # Drop and recreate the database contents by restoring into a clean state
            # First, terminate existing connections and drop/recreate tables
            drop_sql = """
DO $$ DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;
END $$;
"""
            result = subprocess.run(
                [
                    "psql",
                    "-h", db["host"],
                    "-p", db["port"],
                    "-U", db["user"],
                    "-d", db["dbname"],
                    "-c", drop_sql,
                ],
                env=pg,
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                log.warning("Table cleanup returned non-zero: %s", result.stderr)

            # Restore the dump
            result = subprocess.run(
                [
                    "psql",
                    "-h", db["host"],
                    "-p", db["port"],
                    "-U", db["user"],
                    "-d", db["dbname"],
                    "--set", "ON_ERROR_STOP=on",
                    "-f", str(dump_path),
                ],
                env=pg,
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                log.error("Database restore failed: %s", result.stderr)
                _mark_restore_finished(
                    restore_state,
                    purpose,
                    "database",
                    started_at=database_started_at,
                    completed_at=datetime.now(timezone.utc),
                    success=False,
                    archive_name=archive_path.name,
                )
                _write_restore_state(restore_state)
                return False
            _mark_restore_finished(
                restore_state,
                purpose,
                "database",
                started_at=database_started_at,
                completed_at=datetime.now(timezone.utc),
                success=True,
                archive_name=archive_path.name,
            )
            _write_restore_state(restore_state)
            log.info("Database restored successfully")
        else:
            log.warning("No db.sql found in snapshot – skipping database restore")
            database_started_at = datetime.now(timezone.utc)
            _mark_restore_started(
                restore_state,
                purpose,
                "database",
                started_at=database_started_at,
                archive_name=archive_path.name,
            )
            _mark_restore_finished(
                restore_state,
                purpose,
                "database",
                started_at=database_started_at,
                completed_at=database_started_at,
                success=False,
                archive_name=archive_path.name,
            )
            _write_restore_state(restore_state)

        # 2. Restore filesystem -------------------------------------------------
        data_archive = snapshot_dir / "data"
        if data_archive.exists() and data_archive.is_dir():
            data_dest = Path(target_data_dir)
            filesystem_started_at = datetime.now(timezone.utc)
            _mark_restore_started(
                restore_state,
                purpose,
                "filesystem",
                started_at=filesystem_started_at,
                archive_name=archive_path.name,
            )
            _write_restore_state(restore_state)
            log.info("Restoring filesystem data to %s …", target_data_dir)
            try:
                exclude_tiles = _exclude_tiles()
                # Clear existing data (preserve the maintenance flag and, in production, the tiles tree)
                if data_dest.exists():
                    for child in data_dest.iterdir():
                        if child.name == _MAINTENANCE_FILENAME:
                            continue
                        if exclude_tiles and child.name == "tiles":
                            continue
                        if child.is_dir():
                            shutil.rmtree(str(child))
                        else:
                            child.unlink()

                # Copy restored data
                ignore = _restore_ignore_tiles(data_archive, exclude_tiles)
                if ignore:
                    shutil.copytree(str(data_archive), str(data_dest), dirs_exist_ok=True, ignore=ignore)
                else:
                    shutil.copytree(str(data_archive), str(data_dest), dirs_exist_ok=True)
            except Exception:
                _mark_restore_finished(
                    restore_state,
                    purpose,
                    "filesystem",
                    started_at=filesystem_started_at,
                    completed_at=datetime.now(timezone.utc),
                    success=False,
                    archive_name=archive_path.name,
                )
                _write_restore_state(restore_state)
                raise
            _mark_restore_finished(
                restore_state,
                purpose,
                "filesystem",
                started_at=filesystem_started_at,
                completed_at=datetime.now(timezone.utc),
                success=True,
                archive_name=archive_path.name,
            )
            _write_restore_state(restore_state)
            log.info("Filesystem data restored")
        else:
            log.warning("No data/ directory in snapshot – skipping filesystem restore")
            filesystem_started_at = datetime.now(timezone.utc)
            _mark_restore_started(
                restore_state,
                purpose,
                "filesystem",
                started_at=filesystem_started_at,
                archive_name=archive_path.name,
            )
            _mark_restore_finished(
                restore_state,
                purpose,
                "filesystem",
                started_at=filesystem_started_at,
                completed_at=filesystem_started_at,
                success=False,
                archive_name=archive_path.name,
            )
            _write_restore_state(restore_state)

    database_success = _restore_section(restore_state, purpose, "database").get("success") is True
    filesystem_success = _restore_section(restore_state, purpose, "filesystem").get("success") is True
    overall_success = database_success and filesystem_success
    if overall_success:
        log.info(
            "Restore completed successfully",
            extra={
                "event": "restore.completed",
                "purpose": purpose,
                "archive_name": archive_path.name,
                "target_data_dir": target_data_dir,
            },
        )
    else:
        log.error(
            "Restore completed with missing or failed components",
            extra={
                "event": "restore.failed",
                "purpose": purpose,
                "archive_name": archive_path.name,
                "database_success": database_success,
                "filesystem_success": filesystem_success,
            },
        )
    return overall_success


# ---------------------------------------------------------------------------
# Cron scheduler
# ---------------------------------------------------------------------------

_shutdown = False


def _handle_signal(signum, frame):
    global _shutdown
    log.info("Received signal %s – shutting down …", signum)
    _shutdown = True


def run_cron() -> None:
    """Run the backup on a cron schedule."""
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    log.info("HRIV Backup Service started")
    log.info("  Schedule : %s", BACKUP_CRON_SCHEDULE)
    log.info("  Retention: %d snapshots", BACKUP_RETENTION_COUNT)
    log.info("  Mode     : %s", BACKUP_MODE)
    log.info("  Azure container: %s", AZURE_STORAGE_CONTAINER or "(not configured – local only)")
    log.info("  Data dir : %s", DATA_DIR)

    cron = croniter(BACKUP_CRON_SCHEDULE, datetime.now(timezone.utc))

    while not _shutdown:
        next_run = cron.get_next(datetime)
        log.info("Next backup scheduled for %s UTC", next_run.strftime("%Y-%m-%d %H:%M:%S"))

        # Sleep until the next run, checking for shutdown every 30s
        while not _shutdown:
            now = datetime.now(timezone.utc)
            remaining = (next_run - now).total_seconds()
            if remaining <= 0:
                break
            time.sleep(min(remaining, 30))

        if _shutdown:
            break

        log.info("Cron trigger – starting backup")
        try:
            run_backup()
        except Exception:
            log.exception("Backup failed")

    log.info("Backup service stopped")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else "cron"

    if command == "backup":
        result = run_backup()
        sys.exit(0 if result else 1)

    elif command == "restore":
        name = sys.argv[2] if len(sys.argv) > 2 else None
        success = run_restore(name)
        sys.exit(0 if success else 1)

    elif command == "restore-test":
        name = sys.argv[2] if len(sys.argv) > 2 else None
        success = run_restore_test(name)
        sys.exit(0 if success else 1)

    elif command == "list":
        snapshots = list_snapshots()
        if not snapshots:
            print("No snapshots found.")
        else:
            print(f"{'Name':<45} {'Size':>12} {'Date':>28} {'Location':>10}")
            print("-" * 100)
            for s in snapshots:
                size_mb = s["size"] / (1024 * 1024)
                print(f"{s['name']:<45} {size_mb:>10.1f}MB {s['last_modified']:>28} {s['location']:>10}")

    elif command == "status":
        sys.exit(0 if run_status() else 1)

    elif command == "cron":
        run_cron()

    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
