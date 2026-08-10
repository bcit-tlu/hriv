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
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

from azure.core.exceptions import ResourceNotFoundError
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


def _snapshot_stem(snapshot_name: str) -> str:
    return snapshot_name.removesuffix(".tar.gz")


def _manifest_sidecar_name(snapshot_name: str) -> str:
    return f"{_snapshot_stem(snapshot_name)}.manifest.json"


def _manifest_sidecar_path(archive_path: Path) -> Path:
    return archive_path.with_name(_manifest_sidecar_name(archive_path.name))


def _manifest_sidecar_blob_name(snapshot_name: str) -> str:
    prefix = f"{AZURE_BLOB_PREFIX}/" if AZURE_BLOB_PREFIX else ""
    return f"{prefix}{_manifest_sidecar_name(snapshot_name)}"


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
    tmp_path = path.with_name(f".{path.name}.tmp")
    tmp_path.write_bytes(payload)
    tmp_path.replace(path)


def _new_backup_state(snapshot_name: str) -> dict:
    def _blank_section() -> dict[str, object]:
        return {
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
        "schema_version": 2,
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
    payload = json.dumps(state, indent=2).encode()

    try:
        if _azure_configured():
            container = _blob_container_client()
            container.upload_blob(
                _backup_state_blob_name(),
                io.BytesIO(payload),
                overwrite=True,
            )
        else:
            _atomic_write_bytes(_backup_state_path(), payload)
    except Exception:
        log.exception("Failed to write backup observability state")


def _new_restore_state() -> dict:
    def _blank_section() -> dict[str, object]:
        return {
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
        "schema_version": 1,
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
    if not isinstance(previous_state, dict) or previous_state.get("schema_version") != 1:
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
    payload = json.dumps(state, indent=2).encode()

    try:
        if _azure_configured():
            container = _blob_container_client()
            container.upload_blob(
                _restore_state_blob_name(),
                io.BytesIO(payload),
                overwrite=True,
            )
        else:
            _atomic_write_bytes(_restore_state_path(), payload)
    except Exception:
        log.exception("Failed to write restore observability state")


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


def _write_last_success_marker(
    snapshot_name: str,
    *,
    created_at: datetime,
    archive_size: int | None,
) -> None:
    marker = {
        "snapshot_name": snapshot_name,
        "created_at": created_at.isoformat(),
        "archive_size": archive_size,
        "backup_mode": BACKUP_MODE,
        "tiles_excluded": _exclude_tiles(),
    }
    payload = json.dumps(marker, indent=2).encode()

    try:
        if _azure_configured():
            container = _blob_container_client()
            container.upload_blob(
                _last_success_marker_blob_name(),
                io.BytesIO(payload),
                overwrite=True,
            )
        else:
            _atomic_write_bytes(_last_success_marker_path(), payload)
    except Exception:
        log.exception("Failed to write last-success marker")


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
    if not isinstance(previous_state, dict) or previous_state.get("schema_version") != 2:
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

def _backup_sort_key(path: Path) -> str:
    """Extract the ``YYYYMMDD-HHMMSS`` timestamp from an
    ``hriv-backup-*.tar.gz`` filename so archives sort chronologically."""
    m = re.search(r"(\d{8}-\d{6})", path.name)
    return m.group(1) if m else path.name


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
    timestamp = created_at.strftime("%Y%m%d-%H%M%S")
    snapshot_name = f"hriv-backup-{timestamp}"
    log.info("Starting backup: %s", snapshot_name)
    backup_state = _new_backup_state(snapshot_name)
    _seed_last_success_history(backup_state, _read_backup_state())

    db = _parse_db_url(DATABASE_URL)
    pg = _pg_env(db)

    with tempfile.TemporaryDirectory(prefix="hriv-bak-") as tmpdir:
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
                blob_name = f"{AZURE_BLOB_PREFIX}/{archive_name}" if AZURE_BLOB_PREFIX else archive_name
                log.info("Uploading to azure://%s/%s …", AZURE_STORAGE_CONTAINER, blob_name)
                container = _blob_container_client()
                with open(archive_path, "rb") as data:
                    container.upload_blob(blob_name, data, overwrite=True)
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
                _write_last_success_marker(
                    snapshot_name,
                    created_at=created_at,
                    archive_size=archive_size,
                )
            else:
                log.warning(
                    "Azure Blob Storage not configured – archive saved locally at %s only. "
                    "Set AZURE_STORAGE_CONNECTION_STRING and AZURE_STORAGE_CONTAINER to enable cloud storage.",
                    archive_path,
                )
                # Copy to a persistent location so it survives tmpdir cleanup
                persistent = _local_backup_dir()
                persistent.mkdir(parents=True, exist_ok=True)
                final = persistent / archive_name
                shutil.copy2(str(archive_path), str(final))
                log.info("Local backup saved to %s", final)
                try:
                    _atomic_write_bytes(_manifest_sidecar_path(final), manifest_payload)
                    log.info("Local manifest sidecar saved to %s", _manifest_sidecar_path(final))
                except Exception:
                    log.exception("Local manifest sidecar write failed")
                _enforce_local_retention()
                archive_key = str(final)
                _write_last_success_marker(
                    snapshot_name,
                    created_at=created_at,
                    archive_size=final.stat().st_size,
                )
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

        _mark_attempt_finished(
            backup_state,
            "filesystem",
            started_at=filesystem_started_at,
            completed_at=datetime.now(timezone.utc),
            success=True,
            size_bytes=filesystem_size_bytes,
            archive_key=archive_key,
        )
        _attach_archive_key_to_success(backup_state, "database", archive_key)
        _write_backup_state(backup_state)

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

        blobs.sort(key=lambda b: b.last_modified, reverse=True)

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

    snapshots.sort(key=lambda s: s["name"], reverse=True)
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
        created_at = datetime.fromisoformat(str(marker["created_at"]))
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        age = now - created_at.astimezone(timezone.utc)
        stale_after = timedelta(hours=BACKUP_STALE_HOURS)
        stale = age > stale_after
        status_label = "STALE" if stale else "FRESH"
        if not stale and snapshot_count == 0:
            status_label = "NO_SNAPSHOTS"
        print(f"Status: {status_label}")
        print(f"Last successful backup: {created_at.isoformat()}")
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
            match = [s for s in snapshots if s["name"] == snapshot_name or s["name"] == f"{snapshot_name}.tar.gz"]
            if not match:
                log.error("Snapshot %s not found. Available: %s", snapshot_name, [s["name"] for s in snapshots])
                return False
            target = match[0]
        else:
            target = snapshots[0]
            log.info("Using latest snapshot: %s", target["name"])

        # Download ---------------------------------------------------------------
        with tempfile.TemporaryDirectory(prefix="hriv-restore-") as tmpdir:
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
            fname = snapshot_name if snapshot_name.endswith(".tar.gz") else f"{snapshot_name}.tar.gz"
            archive_path = local_dir / fname
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

    with tempfile.TemporaryDirectory(prefix="hriv-restore-") as tmpdir:
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
