"""HRIV Disaster Recovery Backup Service.

Standalone service that publishes image-filesystem recovery archives on a cron
schedule and supports component-selective restore. Production binds source-image
archives to CNPG recovery timestamps; development retains logical database dumps.

Usage:
    python backup.py backup                    # Run a one-shot backup now
    python backup.py restore                    # Legacy combined restore
    python backup.py restore-filesystem [name]  # Restore source files only
    python backup.py restore-database [name]    # Restore a legacy logical dump only
    python backup.py restore-test               # Restore into the configured test target
    python backup.py list                       # List available snapshots
    python backup.py status                     # Show the last-success heartbeat
    python backup.py cron                       # Start the cron scheduler (default)
"""

from __future__ import annotations

import base64
import contextlib
import copy
import csv
import fcntl
import hashlib
import io
import json
import logging
import math
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
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

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


def _float_env(name: str, default: str) -> float:
    try:
        return float(_env(name, default))
    except ValueError:
        log.error("%s must be a number", name)
        sys.exit(1)


# Database
DATABASE_URL: str = _env("DATABASE_URL", "postgresql://hriv:hriv@db:5432/hriv")
CNPG_CLUSTER_NAME: str = _env("CNPG_CLUSTER_NAME", "pg-core")

# Filesystem
DATA_DIR: str = _env("DATA_DIR", "/data")

# Azure Blob Storage
AZURE_STORAGE_CONNECTION_STRING: str = _env("AZURE_STORAGE_CONNECTION_STRING", "")
AZURE_STORAGE_CONTAINER: str = _env("AZURE_STORAGE_CONTAINER", "")
AZURE_BLOB_PREFIX: str = _env("AZURE_BLOB_PREFIX", "hriv-backups")

# Schedule & retention
BACKUP_CRON_SCHEDULE: str = _env("BACKUP_CRON_SCHEDULE", "0 10 * * *")
BACKUP_TIMEZONE: str = _env("BACKUP_TIMEZONE", "UTC")
BACKUP_RETENTION_COUNT: int = int(_env("BACKUP_RETENTION_COUNT", "30"))
BACKUP_STALE_HOURS: int = int(_env("BACKUP_STALE_HOURS", "26"))
BACKUP_MUTATION_DRAIN_SECONDS: float = _float_env("BACKUP_MUTATION_DRAIN_SECONDS", "5")
BACKUP_INVENTORY_TIMEOUT_SECONDS: float = _float_env(
    "BACKUP_INVENTORY_TIMEOUT_SECONDS", "120"
)
BACKUP_WAL_FENCE_TIMEOUT_SECONDS: float = _float_env(
    "BACKUP_WAL_FENCE_TIMEOUT_SECONDS", "600"
)
BACKUP_WAL_FENCE_POLL_SECONDS: float = _float_env("BACKUP_WAL_FENCE_POLL_SECONDS", "5")
# Directory used to stage archives while they are being built. Defaults to a
# hidden directory on the /backups volume so the archive never occupies
# pod-local ephemeral storage.
BACKUP_STAGING_DIR: str = _env("BACKUP_STAGING_DIR", "")
RESTORE_TEST_DATABASE_URL: str = _env("RESTORE_TEST_DATABASE_URL", "")
RESTORE_TEST_DATA_DIR: str = _env("RESTORE_TEST_DATA_DIR", "")

# Operating mode: "development" backs up DB + source images + tiles.
# "production" binds source images to a CNPG recovery point; tiles are
# excluded and must be rebuilt from source images.
BACKUP_MODE: str = _env("BACKUP_MODE", "development").lower()
if BACKUP_MODE not in ("development", "production"):
    log.error("BACKUP_MODE must be 'development' or 'production', got %s", BACKUP_MODE)
    sys.exit(1)
if BACKUP_MUTATION_DRAIN_SECONDS < 0:
    log.error("BACKUP_MUTATION_DRAIN_SECONDS must not be negative")
    sys.exit(1)
if not math.isfinite(BACKUP_INVENTORY_TIMEOUT_SECONDS) or (
    BACKUP_INVENTORY_TIMEOUT_SECONDS <= 0
):
    log.error("BACKUP_INVENTORY_TIMEOUT_SECONDS must be finite and greater than zero")
    sys.exit(1)
if not math.isfinite(BACKUP_WAL_FENCE_TIMEOUT_SECONDS) or (
    BACKUP_WAL_FENCE_TIMEOUT_SECONDS <= 0
):
    log.error("BACKUP_WAL_FENCE_TIMEOUT_SECONDS must be finite and greater than zero")
    sys.exit(1)
if not math.isfinite(BACKUP_WAL_FENCE_POLL_SECONDS) or (
    BACKUP_WAL_FENCE_POLL_SECONDS <= 0
):
    log.error("BACKUP_WAL_FENCE_POLL_SECONDS must be finite and greater than zero")
    sys.exit(1)
if BACKUP_WAL_FENCE_POLL_SECONDS > BACKUP_WAL_FENCE_TIMEOUT_SECONDS:
    log.error(
        "BACKUP_WAL_FENCE_POLL_SECONDS must not exceed "
        "BACKUP_WAL_FENCE_TIMEOUT_SECONDS"
    )
    sys.exit(1)
try:
    _BACKUP_TZ = ZoneInfo(BACKUP_TIMEZONE)
except ZoneInfoNotFoundError:
    log.error("BACKUP_TIMEZONE is not a valid IANA timezone: %s", BACKUP_TIMEZONE)
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
    return tempfile.TemporaryDirectory(
        prefix=prefix, dir=str(root) if root is not None else None
    )


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


def _publication_journal_name(snapshot_name: str) -> str:
    return f".publication-{_snapshot_stem(snapshot_name)}.json"


def _publication_journal_blob_name(snapshot_name: str) -> str:
    prefix = f"{AZURE_BLOB_PREFIX}/" if AZURE_BLOB_PREFIX else ""
    return f"{prefix}{_publication_journal_name(snapshot_name)}"


def _publication_journal_path(snapshot_name: str) -> Path:
    return _local_backup_dir() / _publication_journal_name(snapshot_name)


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
RUN_LOCK_FILENAME = ".hriv-backup-run.lock"
BACKUP_STATE_SCHEMA_VERSION = 2
RESTORE_STATE_SCHEMA_VERSION = 1
RECOVERY_MANIFEST_SCHEMA_VERSION = 2
_STATE_LOCK_TIMEOUT_SECONDS = 30.0
_RUN_LOCK_TIMEOUT_SECONDS = 0.0
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


def _run_lock_path() -> Path:
    return _local_backup_dir() / RUN_LOCK_FILENAME


@contextlib.contextmanager
def _run_lock() -> Iterator[bool]:
    """Acquire the shared backup-run lock without waiting for another run."""
    path = _run_lock_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
    except OSError:
        log.exception("Failed to open backup run lock %s", path)
        yield False
        return

    acquired = False
    try:
        deadline = time.monotonic() + _RUN_LOCK_TIMEOUT_SECONDS
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
                break
            except OSError:
                if time.monotonic() >= deadline:
                    break
                time.sleep(_STATE_LOCK_POLL_SECONDS)
        yield acquired
    finally:
        if acquired:
            fcntl.flock(fd, fcntl.LOCK_UN)
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
) -> bool:
    """Merge ``incoming`` into the shared document and store the result."""
    try:
        if _azure_configured():
            container = _blob_container_client()
            for _ in range(_AZURE_CAS_ATTEMPTS):
                existing, etag, presence = _download_json_with_etag(
                    container, blob_name
                )
                if presence == "unknown":
                    continue
                payload = json.dumps(merge(existing, incoming), indent=2).encode()
                try:
                    if presence == "missing":
                        container.upload_blob(
                            blob_name, io.BytesIO(payload), overwrite=False
                        )
                    else:
                        container.upload_blob(
                            blob_name,
                            io.BytesIO(payload),
                            overwrite=True,
                            etag=etag,
                            match_condition=MatchConditions.IfNotModified,
                        )
                    return True
                except (ResourceExistsError, ResourceModifiedError):
                    # Another writer won the race; re-read and merge again.
                    continue
            log.warning(
                "Gave up updating %s after %d attempts", label, _AZURE_CAS_ATTEMPTS
            )
            return False

        with _state_lock() as locked:
            if not locked:
                log.warning("Skipping %s update; state lock unavailable", label)
                return False
            existing = _read_json_file(local_path)
            payload = json.dumps(merge(existing, incoming), indent=2).encode()
            _atomic_write_bytes(local_path, payload)
            return True
    except Exception:
        log.exception("Failed to write %s", label)
        return False


def _rollback_shared_json_if_owned(
    *,
    local_path: Path,
    blob_name: str,
    previous: dict | None,
    run_id: str,
    label: str,
) -> bool:
    """Restore a shared document only while its current revision belongs to this run."""
    try:
        if _azure_configured():
            container = _blob_container_client()
            current, etag, presence = _download_json_with_etag(container, blob_name)
            if (
                presence != "exists"
                or not isinstance(current, dict)
                or current.get("run_id") != run_id
                or not etag
            ):
                return False
            if previous is None:
                container.delete_blob(
                    blob_name,
                    etag=etag,
                    match_condition=MatchConditions.IfNotModified,
                )
            else:
                container.upload_blob(
                    blob_name,
                    io.BytesIO(json.dumps(previous, indent=2).encode()),
                    overwrite=True,
                    etag=etag,
                    match_condition=MatchConditions.IfNotModified,
                )
            return True

        with _state_lock() as locked:
            if not locked:
                return False
            current = _read_json_file(local_path)
            if not isinstance(current, dict) or current.get("run_id") != run_id:
                return False
            if previous is None:
                local_path.unlink(missing_ok=True)
            else:
                _atomic_write_bytes(local_path, json.dumps(previous, indent=2).encode())
            return True
    except (ResourceModifiedError, ResourceNotFoundError):
        return False
    except Exception:
        log.exception("Failed to roll back %s", label)
        return False


def _rollback_publication_documents(
    prior_state: dict | None, prior_marker: dict | None, run_id: str
) -> None:
    marker_restored = _rollback_shared_json_if_owned(
        local_path=_last_success_marker_path(),
        blob_name=_last_success_marker_blob_name(),
        previous=prior_marker,
        run_id=run_id,
        label="last-success marker",
    )
    state_restored = _rollback_shared_json_if_owned(
        local_path=_backup_state_path(),
        blob_name=_backup_state_blob_name(),
        previous=prior_state,
        run_id=run_id,
        label="backup state",
    )
    if not marker_restored or not state_restored:
        log.warning(
            "Publication rollback left newer or unavailable shared state untouched",
            extra={"event": "backup.publication_rollback_not_owned", "run_id": run_id},
        )


PUBLICATION_JOURNAL_SCHEMA_VERSION = 1
_PUBLICATION_STALE_HOURS = 24


def _write_publication_journal(journal: dict) -> None:
    payload = json.dumps(journal, indent=2).encode()
    if _azure_configured():
        _blob_container_client().upload_blob(
            _publication_journal_blob_name(journal["snapshot_name"]),
            io.BytesIO(payload),
            overwrite=journal.get("phase") != "candidate_ready",
        )
    else:
        _atomic_write_bytes(
            _publication_journal_path(journal["snapshot_name"]), payload
        )


def _delete_publication_journal(snapshot_name: str) -> None:
    if _azure_configured():
        _blob_container_client().delete_blob(
            _publication_journal_blob_name(snapshot_name)
        )
    else:
        _publication_journal_path(snapshot_name).unlink(missing_ok=True)


def _publication_journal(
    *,
    snapshot_name: str,
    run_id: str,
    prior_state: dict | None,
    prior_marker: dict | None,
    archive_name: str,
    sidecar_name: str,
    final_archive_name: str,
    final_sidecar_name: str,
) -> dict:
    return {
        "schema_version": PUBLICATION_JOURNAL_SCHEMA_VERSION,
        "snapshot_name": snapshot_name,
        "run_id": run_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "phase": "candidate_ready",
        "archive_name": archive_name,
        "sidecar_name": sidecar_name,
        "final_archive_name": final_archive_name,
        "final_sidecar_name": final_sidecar_name,
        "prior_backup_state": prior_state,
        "prior_last_success": prior_marker,
    }


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
    same_attempt = incoming.get("run_id") == existing.get("run_id") and bool(
        incoming.get("run_id")
    )

    if incoming_key[:2] >= existing_key[:2] or same_attempt:
        for field in attempt_fields:
            merged[field] = incoming.get(field)

    incoming_success = _success_sort_key(incoming)
    existing_success = _success_sort_key(existing)
    if incoming_success is not None and (
        existing_success is None or incoming_success >= existing_success or same_attempt
    ):
        for field in success_fields:
            merged[field] = incoming.get(field)

    return merged


def _state_sort_key(state: object) -> tuple[datetime, datetime, str]:
    if not isinstance(state, dict):
        return (_EPOCH, _EPOCH, "")
    return max(
        _attempt_sort_key(state.get(backup_type))
        for backup_type in ("database", "filesystem")
    )


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
                "failure_reason": section.get("failure_reason")
                or state.get("failure_reason"),
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
        candidates.extend(
            entry for entry in existing["attempts"] if isinstance(entry, dict)
        )
    candidates.extend(_attempt_history_entries(incoming))

    for entry in candidates:
        key = (str(entry.get("run_id") or ""), str(entry.get("backup_type") or ""))
        current = history.get(key)
        if current is None or _attempt_sort_key(entry) >= _attempt_sort_key(current):
            history[key] = entry

    ordered = sorted(history.values(), key=_attempt_sort_key, reverse=True)
    return ordered[:_MAX_ATTEMPT_HISTORY]


def _merge_overlap_rejection(existing: dict | None, incoming: dict) -> dict:
    if (
        isinstance(existing, dict)
        and existing.get("schema_version") == BACKUP_STATE_SCHEMA_VERSION
    ):
        merged = copy.deepcopy(existing)
    else:
        merged = _new_backup_state("", None)
        merged["run_id"] = None
        merged["snapshot_name"] = None
        merged["failure_reason"] = None
    merged["attempts"] = _merge_attempt_history(merged, incoming)
    merged["updated_at"] = incoming.get("updated_at")
    return merged


def _write_overlap_rejection(state: dict) -> bool:
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    return _commit_shared_json(
        local_path=_backup_state_path(),
        blob_name=_backup_state_blob_name(),
        incoming=state,
        merge=_merge_overlap_rejection,
        label="backup overlap rejection",
    )


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

    if _state_sort_key(incoming)[:2] >= _state_sort_key(existing)[:2]:
        for key in (
            "run_id",
            "snapshot_name",
            "backup_mode",
            "tiles_excluded",
            "storage_prefix",
        ):
            if key in incoming:
                merged[key] = incoming[key]
        merged["failure_reason"] = incoming.get("failure_reason")

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
    return (
        completed or created or _EPOCH,
        created or _EPOCH,
        str(marker.get("run_id") or ""),
    )


def _merge_marker_types(existing: object, incoming: object) -> dict:
    merged: dict[str, dict] = {}
    for source in (existing, incoming):
        if not isinstance(source, dict):
            continue
        for backup_type, entry in source.items():
            if not isinstance(entry, dict):
                continue
            current = merged.get(backup_type)
            if (
                current is None
                or _marker_sort_key(entry)[:2] >= _marker_sort_key(current)[:2]
            ):
                merged[backup_type] = copy.deepcopy(entry)
    return merged


def _merge_last_success_marker(existing: dict | None, incoming: dict) -> dict:
    """Keep the newest overall marker plus the newest marker for each type."""
    if not isinstance(existing, dict):
        merged = copy.deepcopy(incoming)
        merged["types"] = _merge_marker_types(None, incoming.get("types"))
        return merged

    if _marker_sort_key(incoming)[:2] >= _marker_sort_key(existing)[:2]:
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


def _write_backup_state(state: dict) -> bool:
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    return _commit_shared_json(
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
        if not isinstance(previous_purpose, dict) or not isinstance(
            current_purpose, dict
        ):
            continue
        for restore_type in ("database", "filesystem"):
            previous_section = previous_purpose.get(restore_type)
            current_section = current_purpose.get(restore_type)
            if not isinstance(previous_section, dict) or not isinstance(
                current_section, dict
            ):
                continue
            current_section.update(previous_section)


def _write_restore_state(state: dict) -> bool:
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    return _commit_shared_json(
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


def _attach_archive_key_to_success(
    state: dict, backup_type: str, archive_key: str
) -> None:
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
) -> bool:
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

    return _commit_shared_json(
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
        if not isinstance(previous_section, dict) or not isinstance(
            current_section, dict
        ):
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
            log.exception(
                "Failed to check whether snapshot %s already exists", snapshot_name
            )
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
        if tarinfo.name == tiles_arcname or tarinfo.name.startswith(
            tiles_arcname + "/"
        ):
            return None
        return tarinfo

    return _filter


_INCOMPLETE_NAMES = {"admin", "scratch", "maintenance", "staging", "incomplete"}
_INCOMPLETE_SUFFIXES = (".part", ".partial", ".tmp", ".uploading")
_AZURE_BLOCK_SIZE = 4 * 1024 * 1024
_MAX_LOGICAL_DUMP_BYTES = 16 * 1024 * 1024 * 1024


def _is_finalized_file(path: Path, root: Path) -> bool:
    """Return whether a data file is eligible for a recovery set."""
    relative = path.relative_to(root)
    if path.name == _MAINTENANCE_FILENAME or path.is_symlink():
        return False
    if any(part.lower().lstrip(".") in _INCOMPLETE_NAMES for part in relative.parts):
        return False
    return not path.name.lower().endswith(_INCOMPLETE_SUFFIXES)


def _inventory_data_files(data_src: Path) -> tuple[list[dict], list[dict]]:
    """Inventory finalized regular files while callers hold the mutation boundary."""
    root = data_src / "source_images" if BACKUP_MODE == "production" else data_src
    entries: list[dict] = []
    excluded: list[dict] = []
    if not root.exists():
        return entries, excluded
    for path in sorted(root.rglob("*")):
        try:
            is_file = path.is_file()
        except OSError as exc:
            raise RuntimeError(f"could not inventory {path}: {exc}") from exc
        if not is_file:
            continue
        rel = path.relative_to(data_src).as_posix()
        if not _is_finalized_file(path, data_src):
            excluded.append(
                {"path": f"data/{rel}", "reason": "incomplete_or_non_authoritative"}
            )
            continue
        stat = path.stat(follow_symlinks=False)
        entries.append(
            {
                "path": path,
                "archive_path": f"data/{rel}",
                "identity": (stat.st_dev, stat.st_ino),
                "size": stat.st_size,
                "mtime_ns": stat.st_mtime_ns,
                "mode": stat.st_mode,
            }
        )
    if BACKUP_MODE == "production" and data_src.exists():
        for child in sorted(data_src.iterdir()):
            if child.name not in ("source_images", _MAINTENANCE_FILENAME):
                excluded.append(
                    {
                        "path": f"data/{child.name}",
                        "reason": "non_authoritative_production_data",
                    }
                )
    return entries, excluded


_MAX_DB_INVENTORY_BYTES = 64 * 1024 * 1024
_MAX_DB_INVENTORY_ROWS = 1_000_000
_MAX_VALIDATION_VALUE_LENGTH = 512
_POSTGRES_LSN_RE = re.compile(r"^[0-9A-F]+/[0-9A-F]+$")
_WAL_FILE_RE = re.compile(r"^[0-9A-F]{24}$")
_ARCHIVED_WAL_FILE_RE = re.compile(r"^([0-9A-F]{24})(?:\.partial)?$")
_WAL_TIMELINE_PREFIX_RE = re.compile(r"^([0-9A-F]{8})")
_UTC_SQL_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
_UTC_TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$")


def _parse_utc_sql_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str) or not _UTC_TIMESTAMP_RE.fullmatch(value):
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(
            tzinfo=timezone.utc
        )
    except ValueError:
        return None


def _psql_command(db: dict[str, str], query: str) -> list[str]:
    return [
        "psql",
        "-h",
        db["host"],
        "-p",
        db["port"],
        "-U",
        db["user"],
        "-d",
        db["dbname"],
        "--no-psqlrc",
        "--quiet",
        "--set",
        "ON_ERROR_STOP=on",
        "-c",
        query,
    ]


def _query_source_image_rows(
    db: dict[str, str], output_path: Path
) -> tuple[datetime, str, list[dict]]:
    timeout_milliseconds = max(1, math.ceil(BACKUP_INVENTORY_TIMEOUT_SECONDS * 1000))
    query = (
        "BEGIN; "
        f"SET LOCAL lock_timeout = '{timeout_milliseconds}ms'; "
        f"SET LOCAL statement_timeout = '{timeout_milliseconds}ms'; "
        "LOCK TABLE public.source_images IN SHARE MODE; "
        "COPY (WITH boundary AS MATERIALIZED (SELECT "
        f"to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', '{_UTC_SQL_FORMAT}') AS target_time, "
        "pg_current_wal_lsn()::text AS target_lsn), "
        "inventory AS MATERIALIZED (SELECT id, stored_path, status "
        "FROM public.source_images) "
        "SELECT record_type, boundary_time, boundary_lsn, id, stored_path, status FROM ("
        "SELECT 0 AS position, 'boundary'::text AS record_type, target_time AS boundary_time, "
        "target_lsn AS boundary_lsn, NULL::text AS id, NULL::text AS stored_path, "
        "NULL::text AS status FROM boundary "
        "UNION ALL SELECT 1, 'source', NULL, NULL, id::text, stored_path, status FROM inventory"
        ") captured ORDER BY position, id) TO STDOUT WITH (FORMAT csv, HEADER true); "
        "COMMIT;"
    )
    with open(output_path, "wb") as output:
        try:
            result = subprocess.run(
                _psql_command(db, query),
                env=_pg_env(db),
                stdout=output,
                stderr=subprocess.PIPE,
                timeout=BACKUP_INVENTORY_TIMEOUT_SECONDS + 5,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(
                "source-image database inventory subprocess exceeded "
                f"{BACKUP_INVENTORY_TIMEOUT_SECONDS + 5:g} seconds"
            ) from exc
    if result.returncode != 0:
        stderr = (
            result.stderr.decode(errors="replace")
            if isinstance(result.stderr, bytes)
            else result.stderr
        )
        raise RuntimeError(
            f"source-image database inventory failed: {stderr or 'psql failed'}"
        )
    if output_path.stat().st_size > _MAX_DB_INVENTORY_BYTES:
        raise RuntimeError("source-image database inventory exceeds size limit")

    rows: list[dict] = []
    boundary: datetime | None = None
    boundary_lsn: str | None = None
    with open(output_path, newline="", encoding="utf-8") as source:
        reader = csv.DictReader(source, strict=True)
        if reader.fieldnames != [
            "record_type",
            "boundary_time",
            "boundary_lsn",
            "id",
            "stored_path",
            "status",
        ]:
            raise RuntimeError(
                "source-image database inventory has invalid CSV columns"
            )
        for row in reader:
            if None in row:
                raise RuntimeError("source-image database inventory has invalid CSV")
            if row.get("record_type") == "boundary":
                if boundary is not None:
                    raise RuntimeError(
                        "source-image database inventory has multiple boundaries"
                    )
                if row.get("id") or row.get("stored_path") or row.get("status"):
                    raise RuntimeError(
                        "source-image database inventory has an invalid boundary row"
                    )
                boundary = _parse_utc_sql_timestamp(row.get("boundary_time"))
                boundary_lsn = row.get("boundary_lsn")
                if boundary is None:
                    raise RuntimeError(
                        "source-image database inventory has invalid boundary time"
                    )
                if not boundary_lsn or not _POSTGRES_LSN_RE.fullmatch(boundary_lsn):
                    raise RuntimeError(
                        "source-image database inventory has invalid boundary LSN"
                    )
                continue
            if row.get("record_type") != "source":
                raise RuntimeError(
                    "source-image database inventory has an invalid record type"
                )
            if boundary is None or row.get("boundary_time") or row.get("boundary_lsn"):
                raise RuntimeError(
                    "source-image database inventory has an invalid source row"
                )
            if len(rows) >= _MAX_DB_INVENTORY_ROWS:
                raise RuntimeError("source-image database inventory exceeds row limit")
            if (
                not row.get("id")
                or row.get("stored_path") is None
                or not row.get("status")
            ):
                raise RuntimeError(
                    "source-image database inventory contains an invalid row"
                )
            rows.append(row)
    if boundary is None or boundary_lsn is None:
        raise RuntimeError("source-image database inventory has no boundary")
    return boundary, boundary_lsn, rows


def _run_psql_text(db: dict[str, str], query: str, label: str) -> str:
    result = subprocess.run(
        _psql_command(db, query),
        env=_pg_env(db),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"{label} failed: {result.stderr or 'psql failed'}")
    return result.stdout


def _single_csv_row(payload: str, columns: list[str], label: str) -> dict[str, str]:
    try:
        reader = csv.DictReader(io.StringIO(payload), strict=True)
        if reader.fieldnames != columns:
            raise RuntimeError(f"{label} has invalid CSV columns")
        rows = list(reader)
    except csv.Error as exc:
        raise RuntimeError(f"{label} has invalid CSV") from exc
    if len(rows) != 1 or None in rows[0]:
        raise RuntimeError(f"{label} must return exactly one row")
    return rows[0]


def _query_archive_timeout_seconds(db: dict[str, str]) -> int:
    payload = _run_psql_text(
        db,
        "COPY (SELECT setting AS archive_timeout_seconds FROM pg_settings "
        "WHERE name = 'archive_timeout') TO STDOUT WITH (FORMAT csv, HEADER true)",
        "PostgreSQL archive_timeout query",
    )
    row = _single_csv_row(
        payload,
        ["archive_timeout_seconds"],
        "PostgreSQL archive_timeout query",
    )
    raw_timeout = row["archive_timeout_seconds"]
    try:
        archive_timeout_seconds = int(raw_timeout)
    except ValueError as exc:
        raise RuntimeError(
            "PostgreSQL archive_timeout is not a finite integer"
        ) from exc
    if (
        archive_timeout_seconds <= 0
        or str(archive_timeout_seconds) != raw_timeout
        or archive_timeout_seconds >= BACKUP_WAL_FENCE_TIMEOUT_SECONDS
    ):
        raise RuntimeError(
            "PostgreSQL archive_timeout must be positive and strictly less than "
            "BACKUP_WAL_FENCE_TIMEOUT_SECONDS"
        )
    return archive_timeout_seconds


def _emit_wal_fence(db: dict[str, str]) -> tuple[str, datetime]:
    """Commit the sole production backup write, then identify its WAL file."""
    update_payload = _run_psql_text(
        db,
        "COPY (WITH fence AS (UPDATE public.backup_recovery_wal_fence "
        "SET generation = generation + 1, fenced_at = CURRENT_TIMESTAMP "
        "WHERE singleton RETURNING generation) SELECT generation FROM fence) "
        "TO STDOUT WITH (FORMAT csv, HEADER true)",
        "backup WAL fence transaction",
    )
    update_row = _single_csv_row(
        update_payload,
        ["generation"],
        "backup WAL fence transaction",
    )
    try:
        generation = int(update_row["generation"])
    except ValueError as exc:
        raise RuntimeError(
            "backup WAL fence transaction returned an invalid generation"
        ) from exc
    if generation <= 0 or str(generation) != update_row["generation"]:
        raise RuntimeError(
            "backup WAL fence transaction returned an invalid generation"
        )

    payload = _run_psql_text(
        db,
        "COPY (SELECT pg_walfile_name(pg_current_wal_lsn() - 1) AS wal_fence_file, "
        f"to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', '{_UTC_SQL_FORMAT}') "
        "AS wal_fence_committed_at) TO STDOUT WITH (FORMAT csv, HEADER true)",
        "backup WAL fence boundary query",
    )
    row = _single_csv_row(
        payload,
        ["wal_fence_file", "wal_fence_committed_at"],
        "backup WAL fence boundary query",
    )
    wal_file = row["wal_fence_file"]
    committed_at = _parse_utc_sql_timestamp(row["wal_fence_committed_at"])
    if not _WAL_FILE_RE.fullmatch(wal_file) or committed_at is None:
        raise RuntimeError("backup WAL fence boundary query returned invalid values")
    return wal_file, committed_at


def _query_last_archived_wal(
    db: dict[str, str],
) -> tuple[str | None, datetime | None, str | None]:
    payload = _run_psql_text(
        db,
        "COPY (SELECT last_archived_wal, "
        f"to_char(last_archived_time AT TIME ZONE 'UTC', '{_UTC_SQL_FORMAT}') "
        "AS last_archived_time FROM pg_stat_archiver) "
        "TO STDOUT WITH (FORMAT csv, HEADER true)",
        "backup WAL archive status query",
    )
    row = _single_csv_row(
        payload,
        ["last_archived_wal", "last_archived_time"],
        "backup WAL archive status query",
    )
    raw_wal_file = row["last_archived_wal"] or None
    if raw_wal_file is None:
        return None, None, None
    wal_match = _ARCHIVED_WAL_FILE_RE.fullmatch(raw_wal_file)
    if wal_match is None:
        return None, None, raw_wal_file
    archived_at = _parse_utc_sql_timestamp(row["last_archived_time"])
    if archived_at is None:
        raise RuntimeError(
            "backup WAL archive status query returned an invalid timestamp"
        )
    return wal_match.group(1), archived_at, raw_wal_file


def _wait_for_wal_fence_archive(db: dict[str, str], fence_file: str) -> datetime:
    deadline = time.monotonic() + BACKUP_WAL_FENCE_TIMEOUT_SECONDS
    fence_timeline = fence_file[:8]
    last_observed_timeline = "unknown"
    while True:
        archived_file, archived_at, raw_wal_file = _query_last_archived_wal(db)
        if raw_wal_file is not None:
            timeline_match = _WAL_TIMELINE_PREFIX_RE.match(raw_wal_file)
            if timeline_match is not None:
                last_observed_timeline = timeline_match.group(1)
        if archived_file is not None and archived_file[:8] == fence_timeline:
            if archived_file >= fence_file:
                assert archived_at is not None
                return archived_at
        if time.monotonic() >= deadline:
            raise RuntimeError(
                f"timed out waiting for archived WAL to reach fence {fence_file}; "
                f"expected timeline {fence_timeline}, last archive-status timeline "
                f"{last_observed_timeline}"
            )
        time.sleep(BACKUP_WAL_FENCE_POLL_SECONDS)


def _bounded_validation_row(row: dict, reason: str) -> dict:
    def bounded(value: object) -> str:
        return str(value)[:_MAX_VALIDATION_VALUE_LENGTH]

    return {
        "row_id": bounded(row.get("id", "")),
        "stored_path": bounded(row.get("stored_path", "")),
        "status": bounded(row.get("status", "")),
        "reason": reason,
    }


def _source_row_path(stored_path: str, data_src: Path) -> Path | None:
    source_root = (data_src / "source_images").resolve()
    raw = Path(stored_path)
    candidate = (
        raw
        if raw.is_absolute()
        else (
            data_src / raw
            if raw.parts and raw.parts[0] == "source_images"
            else source_root / raw
        )
    )
    try:
        resolved = candidate.resolve(strict=False)
        resolved.relative_to(source_root)
    except (OSError, ValueError):
        return None
    return resolved


def _match_production_inventory(
    rows: list[dict],
    filesystem_entries: list[dict],
    data_src: Path,
) -> tuple[list[dict], list[dict], list[dict], dict]:
    entries_by_path = {entry["path"].resolve(): entry for entry in filesystem_entries}
    included: list[dict] = []
    skipped: list[dict] = []
    matched_paths: set[Path] = set()
    referenced_paths: set[Path] = set()
    for row in rows:
        path = _source_row_path(row["stored_path"], data_src)
        if path is None:
            skipped.append(_bounded_validation_row(row, "unsafe_or_out_of_root"))
            continue
        entry = entries_by_path.get(path)
        if entry is not None:
            referenced_paths.add(path)
        if entry is None:
            skipped.append(_bounded_validation_row(row, "missing_source"))
            continue
        if path in matched_paths:
            skipped.append(_bounded_validation_row(row, "duplicate_source_reference"))
            continue
        matched_paths.add(path)
        included.append(entry)

    orphans = [
        {
            "path": entry["archive_path"][:_MAX_VALIDATION_VALUE_LENGTH],
            "reason": "no_database_row",
            "policy": "quarantined_by_policy",
        }
        for path, entry in entries_by_path.items()
        if path not in referenced_paths
    ]
    counts = {
        "database_row_count": len(rows),
        "included_row_count": len(included),
        "included_file_count": len(included),
        "missing_or_skipped_count": len(skipped),
        "orphan_count": len(orphans),
    }
    return included, skipped, orphans, counts


def _entry_matches(entry: dict, stat: os.stat_result) -> bool:
    return (
        entry["identity"] == (stat.st_dev, stat.st_ino)
        and entry["size"] == stat.st_size
        and entry["mtime_ns"] == stat.st_mtime_ns
    )


class _HashingReader:
    def __init__(self, stream, expected_size: int):
        self.stream = stream
        self.remaining = expected_size
        self.hash = hashlib.sha256()

    def read(self, size: int = -1) -> bytes:
        if size == 0 or self.remaining <= 0:
            return b""
        if size < 0 or size > self.remaining:
            size = self.remaining
        payload = self.stream.read(size)
        if not payload:
            raise RuntimeError(
                "inventoried file disappeared or was truncated while streaming"
            )
        self.remaining -= len(payload)
        self.hash.update(payload)
        return payload


class _StagedBlockWriter:
    """File-like Azure block-blob sink; staged data is invisible until commit."""

    def __init__(self, blob_client, block_size: int = _AZURE_BLOCK_SIZE):
        self.blob_client = blob_client
        self.block_size = block_size
        self.buffer = bytearray()
        self.block_ids: list[str] = []
        self.size = 0
        self.committed = False
        self.published = False

    def writable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.size

    def write(self, payload: bytes) -> int:
        self.buffer.extend(payload)
        self.size += len(payload)
        while len(self.buffer) >= self.block_size:
            self._stage(self.block_size)
        return len(payload)

    def flush(self) -> None:
        return None

    def _stage(self, size: int) -> None:
        payload = bytes(self.buffer[:size])
        del self.buffer[:size]
        block_id = base64.b64encode(f"{len(self.block_ids):08d}".encode()).decode()
        self.blob_client.stage_block(
            block_id=block_id, data=io.BytesIO(payload), length=len(payload)
        )
        self.block_ids.append(block_id)

    def commit(self) -> None:
        if not self.buffer and not self.block_ids:
            raise RuntimeError("cannot commit an empty Azure archive")
        if self.buffer:
            self._stage(len(self.buffer))
        self.blob_client.commit_block_list(
            self.block_ids,
            if_none_match="*",
            metadata={"hriv_publication_state": "candidate"},
        )
        self.committed = True

    def publish(self) -> None:
        self.blob_client.set_blob_metadata({"hriv_publication_state": "published"})
        self.published = True

    def discard_candidate(self) -> None:
        if self.committed and not self.published:
            self.blob_client.delete_blob()


def _add_streamed_file(tar: tarfile.TarFile, snapshot_name: str, entry: dict) -> dict:
    path = entry["path"]
    try:
        stream = open(path, "rb")
    except OSError as exc:
        raise RuntimeError(f"inventoried source file is missing: {path}") from exc
    with stream:
        if not _entry_matches(entry, os.fstat(stream.fileno())):
            raise RuntimeError(
                f"inventoried source file changed before streaming: {path}"
            )
        info = tarfile.TarInfo(f"{snapshot_name}/{entry['archive_path']}")
        info.size = entry["size"]
        info.mtime = entry["mtime_ns"] // 1_000_000_000
        info.mode = entry["mode"] & 0o777
        reader = _HashingReader(stream, entry["size"])
        tar.addfile(info, reader)
        if reader.remaining:
            raise RuntimeError(f"inventoried source file was truncated: {path}")
        try:
            path_stat = path.stat(follow_symlinks=False)
        except OSError as exc:
            raise RuntimeError(f"inventoried source file disappeared: {path}") from exc
        if not _entry_matches(entry, os.fstat(stream.fileno())) or not _entry_matches(
            entry, path_stat
        ):
            raise RuntimeError(
                f"inventoried source file changed while streaming: {path}"
            )
    return {"size": entry["size"], "sha256": reader.hash.hexdigest()}


def _add_bytes(tar: tarfile.TarFile, name: str, payload: bytes) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(payload)
    info.mtime = int(time.time())
    tar.addfile(info, io.BytesIO(payload))


def _run_backup_inner() -> Path | None:
    created_at = datetime.now(timezone.utc)
    snapshot_name = _new_snapshot_name(created_at)
    archive_name = f"{snapshot_name}.tar.gz"
    run_id = _new_run_id()
    log.info("Starting backup: %s (run %s)", snapshot_name, run_id)
    backup_state = _new_backup_state(snapshot_name, run_id)
    prior_backup_state = _read_backup_state()
    prior_success_marker = _read_last_success_marker()
    _seed_last_success_history(backup_state, prior_backup_state)
    db = _parse_db_url(DATABASE_URL)

    with _staging_tempdir(_STAGING_PREFIX) as tmpdir:
        dump_path: Path | None = None
        dump_size: int | None = None
        db_started_at = datetime.now(timezone.utc)
        _mark_attempt_started(backup_state, "database", started_at=db_started_at)
        _write_backup_state(backup_state)
        if BACKUP_MODE == "development":
            dump_path = Path(tmpdir) / "db.sql"
            result = subprocess.run(
                [
                    "pg_dump",
                    "-h",
                    db["host"],
                    "-p",
                    db["port"],
                    "-U",
                    db["user"],
                    "-d",
                    db["dbname"],
                    "--no-owner",
                    "--no-acl",
                    "-F",
                    "plain",
                    "-f",
                    str(dump_path),
                ],
                env=_pg_env(db),
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
            dump_size = dump_path.stat().st_size
            _mark_attempt_finished(
                backup_state,
                "database",
                started_at=db_started_at,
                completed_at=datetime.now(timezone.utc),
                success=True,
                size_bytes=dump_size,
            )
            _write_backup_state(backup_state)

        filesystem_started_at = datetime.now(timezone.utc)
        _mark_attempt_started(
            backup_state, "filesystem", started_at=filesystem_started_at
        )
        _write_backup_state(backup_state)
        writer = None
        local_candidate_archive: Path | None = None
        local_candidate_sidecar: Path | None = None
        journal: dict | None = None
        try:
            with _maintenance_scope():
                if BACKUP_MUTATION_DRAIN_SECONDS:
                    time.sleep(BACKUP_MUTATION_DRAIN_SECONDS)
                data_src = Path(DATA_DIR)
                missing_sources: list[dict] = []
                orphan_sources: list[dict] = []
                if BACKUP_MODE == "production":
                    archive_timeout_seconds = _query_archive_timeout_seconds(db)
                    captured_at, target_lsn, rows = _query_source_image_rows(
                        db, Path(tmpdir) / "source-images.csv"
                    )
                    inventory, excluded = _inventory_data_files(data_src)
                    inventory, missing_sources, orphan_sources, inventory_counts = (
                        _match_production_inventory(rows, inventory, data_src)
                    )
                    # This committed singleton-row update is the only production write.
                    # Maintenance remains enabled so new source mutations cannot begin
                    # until the snapshot boundary has been fenced into later WAL.
                    wal_fence_file, wal_fence_committed_at = _emit_wal_fence(db)
                else:
                    inventory, excluded = _inventory_data_files(data_src)
                    captured_at = datetime.now(timezone.utc)
                    target_lsn = None
                    archive_timeout_seconds = None
                    wal_fence_file = None
                    wal_fence_committed_at = None
                    inventory_counts = {
                        "database_row_count": 0,
                        "included_row_count": len(inventory),
                        "included_file_count": len(inventory),
                        "missing_or_skipped_count": 0,
                        "orphan_count": 0,
                    }

            wal_fence_archived_at = None
            if BACKUP_MODE == "production":
                wal_fence_archived_at = _wait_for_wal_fence_archive(db, wal_fence_file)

            target_time = captured_at.isoformat()
            if BACKUP_MODE == "production":
                database_archive_key = (
                    f"cnpg://{CNPG_CLUSTER_NAME}?target_time={target_time}"
                    f"&target_lsn={target_lsn}"
                )
                database_recovery = {
                    "provider": "cloudnative-pg",
                    "cluster": CNPG_CLUSTER_NAME,
                    "target_time": target_time,
                    "target_lsn": target_lsn,
                    "archive_timeout_seconds": archive_timeout_seconds,
                    "wal_fence_file": wal_fence_file,
                    "wal_fence_committed_at": wal_fence_committed_at.isoformat(),
                    "wal_fence_archived_at": wal_fence_archived_at.isoformat(),
                    "logical_dump_role": "not-included",
                }
            else:
                database_recovery = {
                    "provider": "logical-dump",
                    "cluster": None,
                    "target_time": target_time,
                    "logical_dump_role": "primary",
                }

            source_inventory = [
                entry
                for entry in inventory
                if entry["archive_path"].startswith("data/source_images/")
            ]
            source_image_files: dict[str, dict] = {}
            manifest = {
                "format_version": RECOVERY_MANIFEST_SCHEMA_VERSION,
                "schema_version": RECOVERY_MANIFEST_SCHEMA_VERSION,
                "recovery_set_id": snapshot_name,
                "snapshot_name": snapshot_name,
                "run_id": run_id,
                "capture_started_at": created_at.isoformat(),
                "capture_boundary_at": target_time,
                "capture_boundary_lsn": target_lsn,
                "completed_at": None,
                "database_url_host": db["host"],
                "database_name": db["dbname"],
                "database_recovery": database_recovery,
                "versions": {
                    "hriv": os.environ.get("HRIV_VERSION", "unknown"),
                    "backup": os.environ.get("BACKUP_VERSION")
                    or os.environ.get("APP_VERSION", "unknown"),
                    "archive_format": RECOVERY_MANIFEST_SCHEMA_VERSION,
                },
                "backup_mode": BACKUP_MODE,
                "tiles_excluded": _exclude_tiles(),
                "selection": (
                    "source_images"
                    if BACKUP_MODE == "production"
                    else "full_data_legacy"
                ),
                "source_images": {
                    "file_count": len(source_inventory),
                    "total_bytes": sum(entry["size"] for entry in source_inventory),
                    "files": source_image_files,
                    **inventory_counts,
                },
                "file_count": len(inventory),
                "total_bytes": sum(entry["size"] for entry in inventory),
                "files": {},
                "excluded_incomplete_artifacts": excluded,
                "validation": {
                    "missing_sources": missing_sources,
                    "orphan_sources": orphan_sources,
                    "excluded_incomplete_artifacts": excluded,
                    "accepted": True,
                    "database_reconciliation": "disabled",
                },
            }

            container = None
            writer = None
            local_candidate_archive: Path | None = None
            local_candidate_sidecar: Path | None = None
            archive_path = Path(tmpdir) / archive_name
            if _azure_configured():
                container = _blob_container_client()
                writer = _StagedBlockWriter(
                    container.get_blob_client(_archive_blob_name(archive_name))
                )
                tar_target = writer
                tar_mode = "w|gz"
            else:
                tar_target = str(archive_path)
                tar_mode = "w:gz"

            with tarfile.open(
                fileobj=tar_target if writer else None,
                name=None if writer else tar_target,
                mode=tar_mode,
            ) as tar:
                if dump_path is not None and dump_size is not None:
                    dump_stat = dump_path.stat()
                    dump_entry = {
                        "path": dump_path,
                        "archive_path": "db.sql",
                        "identity": (dump_stat.st_dev, dump_stat.st_ino),
                        "size": dump_size,
                        "mtime_ns": dump_stat.st_mtime_ns,
                        "mode": dump_stat.st_mode,
                    }
                    manifest["files"]["db.sql"] = _add_streamed_file(
                        tar, snapshot_name, dump_entry
                    )
                for entry in inventory:
                    file_metadata = _add_streamed_file(tar, snapshot_name, entry)
                    manifest["files"][entry["archive_path"]] = file_metadata
                    if entry["archive_path"].startswith("data/source_images/"):
                        source_image_files[entry["archive_path"]] = file_metadata
                manifest["completed_at"] = datetime.now(timezone.utc).isoformat()
                manifest_payload = json.dumps(manifest, indent=2).encode()
                _add_bytes(tar, f"{snapshot_name}/manifest.json", manifest_payload)

            if writer:
                writer.commit()
                archive_key = _archive_blob_name(archive_name)
                archive_size = writer.size
                container.upload_blob(
                    _manifest_sidecar_blob_name(snapshot_name),
                    io.BytesIO(manifest_payload),
                    overwrite=False,
                )
            else:
                persistent = _local_backup_dir()
                persistent.mkdir(parents=True, exist_ok=True)
                final = persistent / archive_name
                local_candidate_archive = (
                    persistent / f".{archive_name}.{run_id}.candidate"
                )
                local_candidate_sidecar = persistent / (
                    f".{_manifest_sidecar_name(snapshot_name)}.{run_id}.candidate"
                )
                try:
                    os.replace(str(archive_path), str(local_candidate_archive))
                except OSError:
                    shutil.move(str(archive_path), str(local_candidate_archive))
                archive_key = str(final)
                archive_size = local_candidate_archive.stat().st_size
                _atomic_write_bytes(local_candidate_sidecar, manifest_payload)
            journal = _publication_journal(
                snapshot_name=snapshot_name,
                run_id=run_id,
                prior_state=prior_backup_state,
                prior_marker=prior_success_marker,
                archive_name=(archive_key if writer else local_candidate_archive.name),
                sidecar_name=(
                    _manifest_sidecar_blob_name(snapshot_name)
                    if writer
                    else local_candidate_sidecar.name
                ),
                final_archive_name=(archive_key if writer else Path(archive_key).name),
                final_sidecar_name=(
                    _manifest_sidecar_blob_name(snapshot_name)
                    if writer
                    else _manifest_sidecar_path(Path(archive_key)).name
                ),
            )
            _write_publication_journal(journal)
        except Exception:
            if writer:
                try:
                    writer.discard_candidate()
                except Exception:
                    log.exception(
                        "Failed to remove committed, unpublished Azure candidate"
                    )
            if local_candidate_archive is not None:
                local_candidate_archive.unlink(missing_ok=True)
            if local_candidate_sidecar is not None:
                local_candidate_sidecar.unlink(missing_ok=True)
            if journal is not None:
                try:
                    _delete_publication_journal(snapshot_name)
                except Exception:
                    log.exception("Failed to remove rejected publication journal")
            log.exception(
                "Filesystem backup failed; archive was not published",
                extra={
                    "event": "backup.archive_rejected",
                    "staged_block_count": len(writer.block_ids) if writer else 0,
                },
            )
            failed_at = datetime.now(timezone.utc)
            _mark_attempt_finished(
                backup_state,
                "filesystem",
                started_at=filesystem_started_at,
                completed_at=failed_at,
                success=False,
                size_bytes=sum(
                    entry["size"] for entry in locals().get("inventory", [])
                ),
            )
            if (
                BACKUP_MODE == "production"
                and backup_state["database"].get("success") is not True
            ):
                _mark_attempt_finished(
                    backup_state,
                    "database",
                    started_at=db_started_at,
                    completed_at=failed_at,
                    success=False,
                    size_bytes=None,
                )
            _write_backup_state(backup_state)
            return None

        completed_at = datetime.now(timezone.utc)
        try:
            _mark_attempt_finished(
                backup_state,
                "filesystem",
                started_at=filesystem_started_at,
                completed_at=completed_at,
                success=True,
                size_bytes=manifest["total_bytes"],
                archive_key=archive_key,
            )
            if BACKUP_MODE == "production":
                _mark_attempt_finished(
                    backup_state,
                    "database",
                    started_at=db_started_at,
                    completed_at=completed_at,
                    success=True,
                    size_bytes=None,
                    archive_key=database_archive_key,
                )
            else:
                _attach_archive_key_to_success(backup_state, "database", archive_key)
            if not _write_backup_state(backup_state):
                raise RuntimeError("backup state could not be committed")
            journal["phase"] = "state_written"
            _write_publication_journal(journal)
            if not _write_last_success_marker(
                snapshot_name,
                created_at=created_at,
                completed_at=completed_at,
                archive_size=archive_size,
                run_id=run_id,
                state=backup_state,
            ):
                raise RuntimeError("backup success marker could not be committed")
            journal["phase"] = "marker_written"
            _write_publication_journal(journal)
            if _documents_owned_by_run(run_id) != (True, True):
                raise RuntimeError(
                    "backup state and success marker are not owned by this publication"
                )
            if writer:
                writer.publish()
            else:
                os.replace(
                    str(local_candidate_sidecar),
                    str(_manifest_sidecar_path(Path(archive_key))),
                )
                os.replace(str(local_candidate_archive), archive_key)
            _delete_publication_journal(snapshot_name)
        except Exception:
            _rollback_publication_documents(
                prior_backup_state, prior_success_marker, run_id
            )
            if writer:
                try:
                    writer.blob_client.delete_blob()
                except Exception:
                    log.exception("Failed to remove rejected Azure archive")
                try:
                    container.delete_blob(_manifest_sidecar_blob_name(snapshot_name))
                except ResourceNotFoundError:
                    pass
                except Exception:
                    log.exception("Failed to remove rejected Azure manifest sidecar")
            else:
                for path in (
                    local_candidate_archive,
                    local_candidate_sidecar,
                    Path(archive_key),
                    _manifest_sidecar_path(Path(archive_key)),
                ):
                    if path is not None:
                        path.unlink(missing_ok=True)
            try:
                _delete_publication_journal(snapshot_name)
            except ResourceNotFoundError:
                pass
            except Exception:
                log.exception("Failed to remove rejected publication journal")
            log.exception("Backup publication failed after archive validation")
            return None
        if writer:
            _enforce_retention(container)
        else:
            _enforce_local_retention()
        return Path(archive_key) if not _azure_configured() else Path(archive_name)


def run_backup() -> Path | None:
    """Run one backup while excluding overlapping scheduled or on-demand calls."""
    with _run_lock() as locked:
        if not locked:
            log.error(
                "Backup skipped because another backup run holds %s", _run_lock_path()
            )
            now = datetime.now(timezone.utc)
            state = _new_backup_state("overlap", _new_run_id())
            _seed_last_success_history(state, _read_backup_state())
            for backup_type in ("database", "filesystem"):
                _mark_attempt_started(state, backup_type, started_at=now)
                _mark_attempt_finished(
                    state,
                    backup_type,
                    started_at=now,
                    completed_at=now,
                    success=False,
                    size_bytes=None,
                )
            state["failure_reason"] = "overlapping_backup_run"
            if not _write_overlap_rejection(state):
                log.warning("Could not persist backup overlap rejection")
            log.warning(
                "Overlap rejection was appended without changing active publication ownership",
                extra={"event": "backup.overlap_rejected", "run_id": state["run_id"]},
            )
            return None
        _reconcile_publications(lock_held=True)
        return _run_backup_inner()


def _archive_is_selectable(blob) -> bool:
    metadata = getattr(blob, "metadata", None)
    if metadata is None or metadata == {}:
        return True
    return (
        isinstance(metadata, dict)
        and metadata.get("hriv_publication_state") == "published"
    )


def _documents_owned_by_run(run_id: str) -> tuple[bool, bool]:
    state = _read_backup_state()
    marker = _read_last_success_marker()
    return (
        isinstance(state, dict) and state.get("run_id") == run_id,
        isinstance(marker, dict) and marker.get("run_id") == run_id,
    )


def _reconcile_azure_publications(container: ContainerClient) -> None:
    prefix = f"{AZURE_BLOB_PREFIX}/" if AZURE_BLOB_PREFIX else ""
    try:
        blobs = list(
            container.list_blobs(name_starts_with=prefix, include=["metadata"])
        )
        names = {blob.name for blob in blobs}
        for blob in blobs:
            metadata = getattr(blob, "metadata", None)
            if not blob.name.endswith(".tar.gz") or not isinstance(metadata, dict):
                continue
            publication_state = metadata.get("hriv_publication_state")
            if publication_state not in ("candidate", "published"):
                continue
            snapshot_name = blob.name.rsplit("/", 1)[-1]
            journal_name = _publication_journal_blob_name(snapshot_name)
            if journal_name not in names:
                continue
            try:
                journal = json.loads(container.download_blob(journal_name).readall())
            except Exception:
                log.exception("Failed to read publication journal %s", journal_name)
                continue
            if (
                not isinstance(journal, dict)
                or journal.get("schema_version") != PUBLICATION_JOURNAL_SCHEMA_VERSION
                or journal.get("snapshot_name") != _snapshot_stem(snapshot_name)
            ):
                continue
            if publication_state == "published":
                container.delete_blob(journal_name)
                log.warning("Removed completed publication journal for %s", blob.name)
                continue
            run_id = str(journal.get("run_id") or "")
            sidecar_name = str(journal.get("sidecar_name") or "")
            state_owned, marker_owned = _documents_owned_by_run(run_id)
            if state_owned and marker_owned and sidecar_name in names:
                container.get_blob_client(blob.name).set_blob_metadata(
                    {"hriv_publication_state": "published"}
                )
                container.delete_blob(journal_name)
                log.warning("Completed interrupted publication for %s", blob.name)
                continue
            _rollback_publication_documents(
                journal.get("prior_backup_state"),
                journal.get("prior_last_success"),
                run_id,
            )
            for name in (blob.name, sidecar_name, journal_name):
                if not name:
                    continue
                try:
                    container.delete_blob(name)
                except ResourceNotFoundError:
                    pass
            log.warning("Rolled back interrupted publication for %s", blob.name)
    except Exception:
        log.exception("Failed to reconcile Azure backup publications")


def _reconcile_local_publications() -> None:
    root = _local_backup_dir()
    if not root.exists():
        return
    for journal_path in root.glob(".publication-*.json"):
        journal = _read_json_file(journal_path)
        if not isinstance(journal, dict):
            continue
        snapshot_name = str(journal.get("snapshot_name") or "")
        run_id = str(journal.get("run_id") or "")
        candidate_archive = root / Path(str(journal.get("archive_name") or "")).name
        candidate_sidecar = root / Path(str(journal.get("sidecar_name") or "")).name
        final_archive = (
            root
            / Path(
                str(journal.get("final_archive_name") or f"{snapshot_name}.tar.gz")
            ).name
        )
        final_sidecar = (
            root
            / Path(
                str(
                    journal.get("final_sidecar_name")
                    or _manifest_sidecar_path(final_archive).name
                )
            ).name
        )
        state_owned, marker_owned = _documents_owned_by_run(run_id)
        archive_exists = candidate_archive.is_file() or final_archive.is_file()
        sidecar_exists = candidate_sidecar.is_file() or final_sidecar.is_file()
        if state_owned and marker_owned and archive_exists and sidecar_exists:
            if not final_sidecar.is_file():
                os.replace(str(candidate_sidecar), str(final_sidecar))
            if not final_archive.is_file():
                os.replace(str(candidate_archive), str(final_archive))
            candidate_archive.unlink(missing_ok=True)
            candidate_sidecar.unlink(missing_ok=True)
            journal_path.unlink(missing_ok=True)
            log.warning("Completed interrupted local publication for %s", snapshot_name)
            continue
        _rollback_publication_documents(
            journal.get("prior_backup_state"),
            journal.get("prior_last_success"),
            run_id,
        )
        for artifact in (
            candidate_archive,
            candidate_sidecar,
            final_archive,
            final_sidecar,
        ):
            artifact.unlink(missing_ok=True)
        journal_path.unlink(missing_ok=True)
        log.warning("Rolled back interrupted local publication for %s", snapshot_name)


def _reconcile_publications(
    container: ContainerClient | None = None, *, lock_held: bool = False
) -> None:
    if not lock_held:
        with _run_lock() as locked:
            if not locked:
                return
            _reconcile_publications(container, lock_held=True)
        return
    try:
        if _azure_configured():
            _reconcile_azure_publications(container or _blob_container_client())
        else:
            _reconcile_local_publications()
    except Exception:
        log.exception("Failed to reconcile interrupted backup publications")


def _cleanup_stale_candidates(container: ContainerClient) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=_PUBLICATION_STALE_HOURS)
    prefix = f"{AZURE_BLOB_PREFIX}/" if AZURE_BLOB_PREFIX else ""
    try:
        blobs = list(
            container.list_blobs(name_starts_with=prefix, include=["metadata"])
        )
        names = {blob.name for blob in blobs}
        for blob in blobs:
            metadata = getattr(blob, "metadata", None)
            modified = getattr(blob, "last_modified", None)
            if (
                not blob.name.endswith(".tar.gz")
                or not isinstance(metadata, dict)
                or metadata.get("hriv_publication_state") != "candidate"
                or not isinstance(modified, datetime)
                or _publication_journal_blob_name(blob.name.rsplit("/", 1)[-1]) in names
            ):
                continue
            if modified.tzinfo is None:
                modified = modified.replace(tzinfo=timezone.utc)
            if modified.astimezone(timezone.utc) >= cutoff:
                continue
            container.delete_blob(blob.name)
            try:
                container.delete_blob(
                    _manifest_sidecar_blob_name(blob.name.rsplit("/", 1)[-1])
                )
            except ResourceNotFoundError:
                log.debug("Candidate sidecar already absent for %s", blob.name)
            log.warning("Deleted stale unpublished backup candidate %s", blob.name)
    except Exception:
        log.exception("Failed to clean stale unpublished backup candidates")


def _enforce_retention(container: ContainerClient) -> None:
    """Delete old snapshots beyond BACKUP_RETENTION_COUNT."""
    _reconcile_azure_publications(container)
    _cleanup_stale_candidates(container)
    if BACKUP_RETENTION_COUNT <= 0:
        return

    prefix = f"{AZURE_BLOB_PREFIX}/" if AZURE_BLOB_PREFIX else ""
    try:
        blobs = []
        for blob in container.list_blobs(name_starts_with=prefix, include=["metadata"]):
            if blob.name.endswith(".tar.gz") and _archive_is_selectable(blob):
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
                    container.delete_blob(
                        _manifest_sidecar_blob_name(blob.name.rsplit("/", 1)[-1])
                    )
                except ResourceNotFoundError:
                    # Sidecar manifest may already be gone; continue retention cleanup.
                    log.debug(
                        "Manifest sidecar already absent for %s; continuing", blob.name
                    )
                log.info("  Deleted %s", blob.name)
    except Exception:
        log.exception("Failed to enforce retention policy")


def _enforce_local_retention() -> None:
    """Delete old local snapshots beyond BACKUP_RETENTION_COUNT."""
    _reconcile_publications(lock_held=True)
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
                log.debug(
                    "Local manifest sidecar already absent for %s; continuing", f.name
                )
            log.info("  Deleted %s", f.name)


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------


def list_snapshots() -> list[dict]:
    """List available snapshots in Azure Blob Storage or locally."""
    _reconcile_publications()
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
            snapshots.append(
                {
                    "name": f.name,
                    "size": f.stat().st_size,
                    "last_modified": datetime.fromtimestamp(
                        f.stat().st_mtime, tz=timezone.utc
                    ).isoformat(),
                    "location": "local",
                }
            )
        return snapshots

    prefix = f"{AZURE_BLOB_PREFIX}/" if AZURE_BLOB_PREFIX else ""
    container = _blob_container_client()
    _cleanup_stale_candidates(container)

    snapshots = []
    for blob in container.list_blobs(name_starts_with=prefix, include=["metadata"]):
        if blob.name.endswith(".tar.gz") and _archive_is_selectable(blob):
            name = blob.name.rsplit("/", 1)[-1]
            snapshots.append(
                {
                    "name": name,
                    "blob_name": blob.name,
                    "size": blob.size,
                    "last_modified": blob.last_modified.isoformat(),
                    "location": "azure",
                }
            )

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
        completed_at = _parse_iso(marker.get("completed_at")) or _parse_iso(
            marker.get("created_at")
        )
        if completed_at is None:
            raise ValueError("marker has no usable timestamp")
        age = now - completed_at
        stale_after = timedelta(hours=BACKUP_STALE_HOURS)
        stale = age > stale_after
        marker_snapshot = str(marker.get("snapshot_name") or "")
        marker_available = any(
            _snapshot_stem(snapshot["name"]) == _snapshot_stem(marker_snapshot)
            for snapshot in snapshots
        )
        status_label = "STALE" if stale else "FRESH"
        if not stale and not marker_available:
            status_label = "MARKER_SNAPSHOT_MISSING"
        print(f"Status: {status_label}")
        print(f"Last successful backup: {completed_at.isoformat()}")
        print(f"Age: {_format_age(age)}")
        print(f"Backup mode: {marker.get('backup_mode', '?')}")
        print(f"Tiles excluded: {marker.get('tiles_excluded', '?')}")
        if stale or not marker_available:
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


class RestoreSafetyError(RuntimeError):
    keep_maintenance = True


@contextlib.contextmanager
def _maintenance_scope() -> Iterator[None]:
    already_enabled = _maintenance_flag_path().exists()
    keep_maintenance = False
    if not already_enabled:
        _set_maintenance(True)
    try:
        yield
    except BaseException as exc:
        keep_maintenance = bool(getattr(exc, "keep_maintenance", False))
        raise
    finally:
        if not already_enabled and not keep_maintenance:
            _set_maintenance(False)


# ---------------------------------------------------------------------------
# Restore
# ---------------------------------------------------------------------------


def _start_selected_restore_attempts(
    state: dict, purpose: str, components: str, archive_name: str
) -> dict[str, datetime]:
    started: dict[str, datetime] = {}
    for restore_type in ("database", "filesystem"):
        if components != "all" and components != restore_type:
            continue
        started[restore_type] = datetime.now(timezone.utc)
        _mark_restore_started(
            state,
            purpose,
            restore_type,
            started_at=started[restore_type],
            archive_name=archive_name,
        )
    _write_restore_state(state)
    return started


def _fail_incomplete_restore_attempts(
    state: dict,
    purpose: str,
    started: dict[str, datetime],
    archive_name: str,
) -> None:
    completed_at = datetime.now(timezone.utc)
    for restore_type, started_at in started.items():
        if _restore_section(state, purpose, restore_type).get("success") is True:
            continue
        _mark_restore_finished(
            state,
            purpose,
            restore_type,
            started_at=started_at,
            completed_at=completed_at,
            success=False,
            archive_name=archive_name,
        )
    _write_restore_state(state)


def _validate_components(components: str) -> str:
    if components not in ("all", "database", "filesystem"):
        raise ValueError("components must be one of: all, database, filesystem")
    return components


def run_restore(
    snapshot_name: str | None = None,
    *,
    purpose: str = "operator",
    database_url: str | None = None,
    data_dir: str | None = None,
    maintenance: bool = True,
    components: str = "all",
) -> bool:
    """Download and restore a snapshot.

    Operator restores run with maintenance mode enabled so the application is
    unavailable while tables and files are replaced. Restore tests target a
    separate database/data directory and therefore skip maintenance mode.
    """
    components = _validate_components(components)
    scope = _maintenance_scope() if maintenance else contextlib.nullcontext()
    with scope:
        return _run_restore_inner(
            snapshot_name,
            purpose=purpose,
            database_url=database_url,
            data_dir=data_dir,
            components=components,
        )


def run_restore_test(
    snapshot_name: str | None = None, *, components: str = "all"
) -> bool:
    """Restore a snapshot into the configured non-production test target."""
    components = _validate_components(components)
    if components in ("all", "database") and not RESTORE_TEST_DATABASE_URL:
        log.error(
            "RESTORE_TEST_DATABASE_URL must be set for the selected restore-test components",
            extra={"event": "restore.test_not_configured"},
        )
        return False
    if components in ("all", "filesystem") and not RESTORE_TEST_DATA_DIR:
        log.error(
            "RESTORE_TEST_DATA_DIR must be set for the selected restore-test components",
            extra={"event": "restore.test_not_configured"},
        )
        return False

    return run_restore(
        snapshot_name,
        purpose="test",
        database_url=(
            RESTORE_TEST_DATABASE_URL if components in ("all", "database") else ""
        ),
        data_dir=(RESTORE_TEST_DATA_DIR if components in ("all", "filesystem") else ""),
        maintenance=False,
        components=components,
    )


def _run_restore_inner(
    snapshot_name: str | None = None,
    *,
    purpose: str = "operator",
    database_url: str | None = None,
    data_dir: str | None = None,
    components: str = "all",
) -> bool:
    """Core restore logic (called inside the maintenance-flag guard)."""
    components = _validate_components(components)
    target_database_url = (
        (database_url or DATABASE_URL) if components in ("all", "database") else ""
    )
    target_data_dir = (
        (data_dir or DATA_DIR) if components in ("all", "filesystem") else ""
    )

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
                log.error(
                    "Snapshot %s not found. Available: %s", snapshot_name, available
                )
                return False
            target = next(s for s in snapshots if s["name"] == resolved)
        else:
            target = snapshots[0]
            log.info("Using latest snapshot: %s", target["name"])

        # Stream the archive; only bounded selected members are staged locally.
        log.info(
            "Streaming azure://%s/%s …", AZURE_STORAGE_CONTAINER, target["blob_name"]
        )
        stream = _blob_container_client().download_blob(target["blob_name"])
        return _restore_from_stream(
            _AzureChunkReader(stream),
            target["name"],
            purpose=purpose,
            database_url=target_database_url,
            data_dir=target_data_dir,
            components=components,
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
            components=components,
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

    prefixed = sorted(
        name for name in available if _snapshot_stem(name).startswith(stem)
    )
    if len(prefixed) == 1:
        return prefixed[0]
    if len(prefixed) > 1:
        log.error("Snapshot %s is ambiguous. Matches: %s", requested, prefixed)
    return None


class _AzureChunkReader:
    """Minimal sequential reader over StorageStreamDownloader chunks."""

    def __init__(self, downloader):
        self.chunks = iter(downloader.chunks())
        self.buffer = bytearray()
        self.eof = False

    def read(self, size: int = -1) -> bytes:
        if size < 0:
            payload = bytes(self.buffer) + b"".join(self.chunks)
            self.buffer.clear()
            self.eof = True
            return payload
        while len(self.buffer) < size and not self.eof:
            try:
                chunk = next(self.chunks)
            except StopIteration:
                self.eof = True
                continue
            if not chunk:
                self.eof = True
                continue
            self.buffer.extend(chunk)
        payload = bytes(self.buffer[:size])
        del self.buffer[:size]
        return payload


def _restore_database_dump(dump_path: Path, database_url: str) -> bool:
    db = _parse_db_url(database_url)
    pg = _pg_env(db)
    drop_sql = """
DO $$ DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;
END $$;
"""
    cleanup = subprocess.run(
        [
            "psql",
            "-h",
            db["host"],
            "-p",
            db["port"],
            "-U",
            db["user"],
            "-d",
            db["dbname"],
            "-c",
            drop_sql,
        ],
        env=pg,
        capture_output=True,
        text=True,
    )
    if cleanup.returncode != 0:
        log.warning("Table cleanup returned non-zero: %s", cleanup.stderr)
    result = subprocess.run(
        [
            "psql",
            "-h",
            db["host"],
            "-p",
            db["port"],
            "-U",
            db["user"],
            "-d",
            db["dbname"],
            "--set",
            "ON_ERROR_STOP=on",
            "-f",
            str(dump_path),
        ],
        env=pg,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        log.error("Database restore failed: %s", result.stderr)
    return result.returncode == 0


def _promote_streamed_filesystem(
    staged_data: Path, target_data_dir: str, run_id: str
) -> None:
    """Quarantine active target content, promote the restore, and roll back atomically."""
    destination = Path(target_data_dir)
    destination.mkdir(parents=True, exist_ok=True)
    quarantine = destination / f".restore-orphans-{run_id}"
    workspace = staged_data
    while workspace.parent != destination and workspace.parent != workspace:
        workspace = workspace.parent
    workspace_name = workspace.name
    moves: list[tuple[Path, Path]] = []

    def preserved(entry: Path) -> bool:
        return (
            entry.name == _MAINTENANCE_FILENAME
            or entry.name == workspace_name
            or entry.name.startswith(".restore-orphans-")
            or (_exclude_tiles() and entry.name == "tiles")
        )

    try:
        active_entries = [
            entry for entry in sorted(destination.iterdir()) if not preserved(entry)
        ]
        if active_entries:
            quarantine.mkdir(exist_ok=False)
        for target in active_entries:
            quarantined = quarantine / target.name
            os.replace(str(target), str(quarantined))
            moves.append((target, quarantined))
            log.warning("Quarantined unmatched restore target %s", target)
        for source in sorted(staged_data.iterdir()):
            if source.name == _MAINTENANCE_FILENAME or (
                _exclude_tiles() and source.name == "tiles"
            ):
                continue
            target = destination / source.name
            os.replace(str(source), str(target))
            moves.append((source, target))
    except Exception as promotion_error:
        try:
            for original, moved in reversed(moves):
                if moved.exists():
                    os.replace(str(moved), str(original))
            if quarantine.exists() and not any(quarantine.iterdir()):
                quarantine.rmdir()
        except Exception as rollback_error:
            raise RestoreSafetyError(
                "filesystem promotion failed and rollback could not restore the target"
            ) from rollback_error
        raise promotion_error


def _restore_from_stream(
    stream,
    archive_name: str,
    *,
    purpose: str,
    database_url: str,
    data_dir: str,
    components: str,
) -> bool:
    """Validate a sequential archive before promoting any selected component."""
    components = _validate_components(components)
    restore_state = _new_restore_state()
    _seed_restore_success_history(restore_state, _read_restore_state())
    restore_started = _start_selected_restore_attempts(
        restore_state, purpose, components, archive_name
    )
    database_committed = False
    if components in ("all", "filesystem"):
        target_data = Path(data_dir)
        target_data.mkdir(parents=True, exist_ok=True)
        workspace_context = tempfile.TemporaryDirectory(
            prefix=_RESTORE_PREFIX, dir=str(target_data)
        )
    else:
        workspace_context = _staging_tempdir(_RESTORE_PREFIX)

    try:
        with workspace_context as tmpdir:
            workspace = Path(tmpdir)
            staged_data = workspace / "data"
            dump_path = workspace / "db.sql"
            actual: dict[str, dict] = {}
            manifest = None
            root_name = None
            with tarfile.open(fileobj=stream, mode="r|gz") as tar:
                for member in tar:
                    _validate_tar_members([member])
                    parts = Path(member.name).parts
                    if not parts:
                        raise ValueError("archive member has no snapshot root")
                    if root_name is None:
                        root_name = parts[0]
                    if parts[0] != root_name:
                        raise ValueError("archive contains multiple snapshot roots")
                    rel = Path(*parts[1:]).as_posix() if len(parts) > 1 else ""
                    if member.isdir():
                        continue
                    selected = (
                        (rel == "db.sql" and components in ("all", "database"))
                        or (
                            rel.startswith("data/")
                            and components in ("all", "filesystem")
                        )
                        or rel == "manifest.json"
                    )
                    fileobj = tar.extractfile(member)
                    if fileobj is None:
                        raise ValueError(
                            f"could not read archive member: {member.name}"
                        )
                    if not selected:
                        while fileobj.read(1 << 20):
                            pass
                        continue
                    if rel == "manifest.json":
                        if member.size > 16 * 1024 * 1024:
                            raise ValueError("recovery manifest is unreasonably large")
                        manifest = json.loads(fileobj.read())
                        continue
                    if rel == "db.sql" and member.size > _MAX_LOGICAL_DUMP_BYTES:
                        raise ValueError(
                            "logical database dump exceeds restore spool limit"
                        )
                    destination = (
                        dump_path
                        if rel == "db.sql"
                        else staged_data / Path(rel).relative_to("data")
                    )
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    digest = hashlib.sha256()
                    size = 0
                    with open(destination, "xb") as output:
                        for chunk in iter(lambda: fileobj.read(1 << 20), b""):
                            output.write(chunk)
                            digest.update(chunk)
                            size += len(chunk)
                    actual[rel] = {"size": size, "sha256": digest.hexdigest()}

            manifest_version, expected_files = _validate_manifest_document(manifest)
            expected = {
                path: metadata
                for path, metadata in expected_files.items()
                if (path == "db.sql" and components in ("all", "database"))
                or (path.startswith("data/") and components in ("all", "filesystem"))
            }
            if expected != actual:
                raise ValueError(
                    "archive members do not match recovery manifest checksums"
                )
            if manifest_version is not None:
                data_files = {
                    path: value
                    for path, value in expected_files.items()
                    if path.startswith("data/")
                }
                if manifest.get("file_count") != len(data_files):
                    raise ValueError("recovery manifest file count mismatch")
                if manifest.get("total_bytes") != sum(
                    value.get("size", -1) for value in data_files.values()
                ):
                    raise ValueError("recovery manifest byte count mismatch")
                source_images = manifest.get("source_images")
                if isinstance(source_images, dict):
                    source_files = {
                        path: value
                        for path, value in expected_files.items()
                        if path.startswith("data/source_images/")
                    }
                    if source_images.get("files") != source_files:
                        raise ValueError(
                            "recovery manifest source-image index mismatch"
                        )
                    if source_images.get("file_count") != len(source_files):
                        raise ValueError(
                            "recovery manifest source-image count mismatch"
                        )
                    if source_images.get("total_bytes") != sum(
                        value.get("size", -1) for value in source_files.values()
                    ):
                        raise ValueError(
                            "recovery manifest source-image byte count mismatch"
                        )

            filesystem_manifest_selected = any(
                path.startswith("data/") for path in expected_files
            ) or (
                manifest_version == RECOVERY_MANIFEST_SCHEMA_VERSION
                and isinstance(manifest.get("source_images"), dict)
                and manifest["source_images"].get("file_count") == 0
            )
            if components in ("all", "filesystem") and filesystem_manifest_selected:
                (staged_data / "source_images").mkdir(parents=True, exist_ok=True)

            if components in ("all", "database") and isinstance(manifest, dict):
                recovery = manifest.get("database_recovery")
                if (
                    isinstance(recovery, dict)
                    and recovery.get("provider") == "cloudnative-pg"
                    and not dump_path.is_file()
                ):
                    log.error(
                        "Archive requires CloudNativePG recovery for cluster %s at %s; db.sql restore is unavailable",
                        recovery.get("cluster", "?"),
                        recovery.get("target_time", "?"),
                    )
                    _fail_incomplete_restore_attempts(
                        restore_state, purpose, restore_started, archive_name
                    )
                    return False

            database_selected = components in ("all", "database")
            filesystem_selected = components in ("all", "filesystem")
            if (database_selected and not dump_path.is_file()) or (
                filesystem_selected and not filesystem_manifest_selected
            ):
                log.error("Archive does not contain every selected restore component")
                _fail_incomplete_restore_attempts(
                    restore_state, purpose, restore_started, archive_name
                )
                return False

            selected_success: list[bool] = []
            if components in ("all", "database"):
                started = restore_started["database"]
                database_attempted = dump_path.is_file()
                success = database_attempted and _restore_database_dump(
                    dump_path, database_url
                )
                _mark_restore_finished(
                    restore_state,
                    purpose,
                    "database",
                    started_at=started,
                    completed_at=datetime.now(timezone.utc),
                    success=success,
                    archive_name=archive_name,
                )
                database_committed = success
                _write_restore_state(restore_state)
                if database_attempted and not success:
                    raise RestoreSafetyError(
                        "logical database restore may have changed the target before failing"
                    )
                selected_success.append(success)
            if components in ("all", "filesystem"):
                started = restore_started["filesystem"]
                success = filesystem_manifest_selected
                if success:
                    _promote_streamed_filesystem(
                        staged_data, data_dir, restore_state["run_id"]
                    )
                _mark_restore_finished(
                    restore_state,
                    purpose,
                    "filesystem",
                    started_at=started,
                    completed_at=datetime.now(timezone.utc),
                    success=success,
                    archive_name=archive_name,
                )
                selected_success.append(success)
            _write_restore_state(restore_state)
            overall_success = all(selected_success)
            if components == "all" and database_committed and not overall_success:
                raise RestoreSafetyError(
                    "database restore committed but filesystem restore did not complete"
                )
            return overall_success
    except RestoreSafetyError:
        _fail_incomplete_restore_attempts(
            restore_state, purpose, restore_started, archive_name
        )
        log.critical(
            "Streaming restore left a mixed or uncertain target", exc_info=True
        )
        raise
    except Exception as exc:
        _fail_incomplete_restore_attempts(
            restore_state, purpose, restore_started, archive_name
        )
        log.exception("Streaming restore validation failed")
        if components == "all" and database_committed:
            raise RestoreSafetyError(
                "database restore committed before filesystem restore failed"
            ) from exc
        return False


def _manifest_version(manifest: dict) -> object:
    return manifest.get("format_version", manifest.get("schema_version"))


def _validate_manifest_document(manifest: object) -> tuple[object, dict]:
    if not isinstance(manifest, dict):
        raise ValueError("archive is missing manifest.json")
    files = manifest.get("files")
    if not isinstance(files, dict):
        raise ValueError("recovery manifest files must be an object")
    for path, metadata in files.items():
        if (
            not isinstance(path, str)
            or not isinstance(metadata, dict)
            or not isinstance(metadata.get("size"), int)
            or metadata["size"] < 0
            or not isinstance(metadata.get("sha256"), str)
            or re.fullmatch(r"[0-9a-f]{64}", metadata["sha256"]) is None
        ):
            raise ValueError(f"invalid recovery manifest file entry: {path!r}")
    version = _manifest_version(manifest)
    if version is not None and version != RECOVERY_MANIFEST_SCHEMA_VERSION:
        raise ValueError(f"unsupported recovery manifest version: {version}")
    return version, files


def _validate_tar_members(members: list[tarfile.TarInfo]) -> None:
    for member in members:
        parts = Path(member.name).parts
        if not member.name or member.name.startswith("/") or ".." in parts:
            raise ValueError(f"unsafe archive path: {member.name}")
        if member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
            raise ValueError(f"unsafe archive member type: {member.name}")


def _validate_extracted_manifest(
    snapshot_dir: Path, manifest: dict | None, components: str
) -> tuple[object, dict]:
    manifest_version, files = _validate_manifest_document(manifest)
    prefixes = (
        ("data/",)
        if components == "filesystem"
        else (("db.sql",) if components == "database" else ("data/", "db.sql"))
    )
    expected_files = {
        rel: expected
        for rel, expected in files.items()
        if any(rel == prefix or rel.startswith(prefix) for prefix in prefixes)
    }
    actual_files = {
        path.relative_to(snapshot_dir).as_posix()
        for path in snapshot_dir.rglob("*")
        if path.is_file()
        and path.name != "manifest.json"
        and any(
            path.relative_to(snapshot_dir).as_posix() == prefix
            or path.relative_to(snapshot_dir).as_posix().startswith(prefix)
            for prefix in prefixes
        )
    }
    if set(expected_files) != actual_files:
        raise ValueError("archive members do not match recovery manifest")
    for rel, expected in expected_files.items():
        path = snapshot_dir / rel
        if (
            path.is_symlink()
            or path.stat().st_size != expected.get("size")
            or _sha256(path) != expected.get("sha256")
        ):
            raise ValueError(f"manifest checksum mismatch: {rel}")
    if manifest_version is not None:
        data_files = {
            rel: value for rel, value in files.items() if rel.startswith("data/")
        }
        if manifest.get("file_count") != len(data_files):
            raise ValueError("recovery manifest file count mismatch")
        if manifest.get("total_bytes") != sum(
            value.get("size", -1) for value in data_files.values()
        ):
            raise ValueError("recovery manifest byte count mismatch")
        source_images = manifest.get("source_images")
        if isinstance(source_images, dict):
            source_files = {
                rel: value
                for rel, value in files.items()
                if rel.startswith("data/source_images/")
            }
            if source_images.get("files") != source_files:
                raise ValueError("recovery manifest source-image index mismatch")
            if source_images.get("file_count") != len(source_files):
                raise ValueError("recovery manifest source-image count mismatch")
            if source_images.get("total_bytes") != sum(
                value.get("size", -1) for value in source_files.values()
            ):
                raise ValueError("recovery manifest source-image byte count mismatch")
    return manifest_version, files


def _restore_from_archive(
    archive_path: Path,
    *,
    purpose: str = "operator",
    database_url: str | None = None,
    data_dir: str | None = None,
    components: str = "all",
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

    components = _validate_components(components)
    restore_state = _new_restore_state()
    _seed_restore_success_history(restore_state, _read_restore_state())
    restore_started = _start_selected_restore_attempts(
        restore_state, purpose, components, archive_path.name
    )
    database_committed = False
    target_database_url = (
        (database_url or DATABASE_URL) if components in ("all", "database") else ""
    )
    target_data_dir = (
        (data_dir or DATA_DIR) if components in ("all", "filesystem") else ""
    )
    if components in ("all", "filesystem"):
        target_data = Path(target_data_dir)
        target_data.mkdir(parents=True, exist_ok=True)
        workspace_context = tempfile.TemporaryDirectory(
            prefix=_RESTORE_PREFIX, dir=str(target_data)
        )
    else:
        workspace_context = _staging_tempdir(_RESTORE_PREFIX)

    with workspace_context as tmpdir:
        # Extract ---------------------------------------------------------------
        log.info("Extracting archive …")
        try:
            with tarfile.open(str(archive_path), "r:gz") as tar:
                _validate_tar_members(tar.getmembers())
                tar.extractall(path=tmpdir)
        except Exception:
            _fail_incomplete_restore_attempts(
                restore_state, purpose, restore_started, archive_path.name
            )
            log.exception("Archive extraction validation failed")
            return False

        # Find the snapshot directory (first dir inside the archive)
        entries = list(Path(tmpdir).iterdir())
        if len(entries) == 1 and entries[0].is_dir():
            snapshot_dir = entries[0]
        else:
            snapshot_dir = Path(tmpdir)

        # Read manifest
        manifest_path = snapshot_dir / "manifest.json"
        archive_backup_mode = None
        manifest = None
        if manifest_path.exists():
            try:
                manifest = json.loads(manifest_path.read_text())
            except Exception:
                _fail_incomplete_restore_attempts(
                    restore_state, purpose, restore_started, archive_path.name
                )
                log.exception("Archive manifest parsing failed")
                return False
            archive_backup_mode = manifest.get("backup_mode")
            log.info(
                "Snapshot: %s (created %s)",
                manifest.get("snapshot_name", "?"),
                manifest.get("created_at", "?"),
            )
            if archive_backup_mode and archive_backup_mode != BACKUP_MODE:
                log.warning(
                    "Backup mode mismatch: archive was created in %r but current BACKUP_MODE is %r. "
                    "Tiles will be handled according to the current mode; rebuild tiles from source images if needed.",
                    archive_backup_mode,
                    BACKUP_MODE,
                )
        try:
            manifest_version, manifest_files = _validate_extracted_manifest(
                snapshot_dir, manifest, components
            )
        except (OSError, ValueError, TypeError):
            _fail_incomplete_restore_attempts(
                restore_state, purpose, restore_started, archive_path.name
            )
            log.exception("Archive recovery manifest validation failed")
            return False

        # 1. Restore database ---------------------------------------------------
        dump_path = snapshot_dir / "db.sql"
        recovery = (
            manifest.get("database_recovery") if isinstance(manifest, dict) else None
        )
        if (
            components in ("all", "database")
            and isinstance(recovery, dict)
            and recovery.get("provider") == "cloudnative-pg"
            and not dump_path.is_file()
        ):
            log.error(
                "Archive requires CloudNativePG recovery for cluster %s at %s; db.sql restore is unavailable",
                recovery.get("cluster", "?"),
                recovery.get("target_time", "?"),
            )
            _fail_incomplete_restore_attempts(
                restore_state, purpose, restore_started, archive_path.name
            )
            return False
        filesystem_manifest_selected = any(
            path.startswith("data/") for path in manifest_files
        ) or (
            manifest_version == RECOVERY_MANIFEST_SCHEMA_VERSION
            and isinstance(manifest.get("source_images"), dict)
            and manifest["source_images"].get("file_count") == 0
        )
        database_selected = components in ("all", "database")
        filesystem_selected = components in ("all", "filesystem")
        if (database_selected and not dump_path.is_file()) or (
            filesystem_selected and not filesystem_manifest_selected
        ):
            log.error("Archive does not contain every selected restore component")
            _fail_incomplete_restore_attempts(
                restore_state, purpose, restore_started, archive_path.name
            )
            return False
        if components in ("all", "database") and dump_path.exists():
            log.info("Restoring database …")
            database_started_at = restore_started["database"]
            database_success = _restore_database_dump(dump_path, target_database_url)
            _mark_restore_finished(
                restore_state,
                purpose,
                "database",
                started_at=database_started_at,
                completed_at=datetime.now(timezone.utc),
                success=database_success,
                archive_name=archive_path.name,
            )
            database_committed = database_success
            _write_restore_state(restore_state)
            if not database_success:
                _fail_incomplete_restore_attempts(
                    restore_state, purpose, restore_started, archive_path.name
                )
                raise RestoreSafetyError(
                    "logical database restore may have changed the target before failing"
                )
            log.info("Database restored successfully")
        elif components in ("all", "database"):
            log.warning("No db.sql found in snapshot – skipping database restore")
            _fail_incomplete_restore_attempts(
                restore_state, purpose, restore_started, archive_path.name
            )

        # 2. Restore filesystem -------------------------------------------------
        data_archive = snapshot_dir / "data"
        if components in ("all", "filesystem") and filesystem_manifest_selected:
            (data_archive / "source_images").mkdir(parents=True, exist_ok=True)
            filesystem_started_at = restore_started["filesystem"]
            log.info("Restoring filesystem data to %s …", target_data_dir)
            try:
                _promote_streamed_filesystem(
                    data_archive, target_data_dir, restore_state["run_id"]
                )
            except RestoreSafetyError:
                _fail_incomplete_restore_attempts(
                    restore_state, purpose, restore_started, archive_path.name
                )
                raise
            except Exception as exc:
                _fail_incomplete_restore_attempts(
                    restore_state, purpose, restore_started, archive_path.name
                )
                if components == "all" and database_committed:
                    raise RestoreSafetyError(
                        "database restore committed before filesystem promotion failed"
                    ) from exc
                return False
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
        elif components in ("all", "filesystem"):
            log.warning("No data/ selection in snapshot – skipping filesystem restore")
            _fail_incomplete_restore_attempts(
                restore_state, purpose, restore_started, archive_path.name
            )

    database_success = (
        _restore_section(restore_state, purpose, "database").get("success") is True
    )
    filesystem_success = (
        _restore_section(restore_state, purpose, "filesystem").get("success") is True
    )
    selected_results = []
    if components in ("all", "database"):
        selected_results.append(database_success)
    if components in ("all", "filesystem"):
        selected_results.append(filesystem_success)
    overall_success = all(selected_results)
    if components == "all" and database_committed and not filesystem_success:
        raise RestoreSafetyError(
            "database restore committed but filesystem restore did not complete"
        )
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
    log.info("  Schedule : %s (%s)", BACKUP_CRON_SCHEDULE, BACKUP_TIMEZONE)
    log.info("  Retention: %d snapshots", BACKUP_RETENTION_COUNT)
    log.info("  Mode     : %s", BACKUP_MODE)
    log.info(
        "  Azure container: %s",
        AZURE_STORAGE_CONTAINER or "(not configured – local only)",
    )
    log.info("  Data dir : %s", DATA_DIR)
    _reconcile_publications()

    cron = croniter(BACKUP_CRON_SCHEDULE, datetime.now(_BACKUP_TZ))

    while not _shutdown:
        next_run = cron.get_next(datetime)
        log.info(
            "Next backup scheduled for %s %s",
            next_run.strftime("%Y-%m-%d %H:%M:%S"),
            BACKUP_TIMEZONE,
        )

        # Sleep until the next run, checking for shutdown every 30s
        while not _shutdown:
            now = datetime.now(_BACKUP_TZ)
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

    elif command in ("restore", "restore-database", "restore-filesystem"):
        args = sys.argv[2:]
        components = command.removeprefix("restore-") if command != "restore" else "all"
        if "--components" in args:
            index = args.index("--components")
            try:
                components = args[index + 1]
            except IndexError:
                raise SystemExit("--components requires all, database, or filesystem")
            del args[index : index + 2]
        component_args = [arg for arg in args if arg.startswith("--components=")]
        if component_args:
            components = component_args[-1].split("=", 1)[1]
            args = [arg for arg in args if not arg.startswith("--components=")]
        data_dir = None
        if "--data-dir" in args:
            index = args.index("--data-dir")
            try:
                data_dir = args[index + 1]
            except IndexError:
                raise SystemExit("--data-dir requires a target path")
            del args[index : index + 2]
        data_dir_args = [arg for arg in args if arg.startswith("--data-dir=")]
        if data_dir_args:
            data_dir = data_dir_args[-1].split("=", 1)[1]
            args = [arg for arg in args if not arg.startswith("--data-dir=")]
        if len(args) > 1:
            raise SystemExit("restore accepts at most one snapshot name")
        kwargs = {"components": components}
        if data_dir is not None:
            kwargs["data_dir"] = data_dir
        success = run_restore(args[0] if args else None, **kwargs)
        sys.exit(0 if success else 1)

    elif command == "restore-test":
        args = sys.argv[2:]
        components = "all"
        if args and args[-1] in ("all", "database", "filesystem"):
            components = args.pop()
        success = run_restore_test(args[0] if args else None, components=components)
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
                print(
                    f"{s['name']:<45} {size_mb:>10.1f}MB {s['last_modified']:>28} {s['location']:>10}"
                )

    elif command == "status":
        sys.exit(0 if run_status() else 1)

    elif command == "cron":
        run_cron()

    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
