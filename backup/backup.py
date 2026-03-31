"""Corgi Disaster Recovery Backup Service.

Standalone service that snapshots the PostgreSQL database and image
filesystem on a cron schedule, uploads archives to Azure Blob Storage,
and can restore from any snapshot after a fresh redeployment.

Usage:
    python backup.py backup          # Run a one-shot backup now
    python backup.py restore          # Restore the latest snapshot
    python backup.py restore <name>   # Restore a specific snapshot
    python backup.py list             # List available snapshots
    python backup.py cron             # Start the cron scheduler (default)
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from azure.storage.blob import BlobServiceClient, ContainerClient
from croniter import croniter

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

LOG_FORMAT = "%(asctime)s [%(levelname)s] %(message)s"
logging.basicConfig(format=LOG_FORMAT, level=logging.INFO, stream=sys.stdout)
log = logging.getLogger("corgi-backup")


def _env(name: str, default: str | None = None, required: bool = False) -> str:
    value = os.environ.get(name, default)
    if required and not value:
        log.error("Required environment variable %s is not set", name)
        sys.exit(1)
    return value or ""


# Database
DATABASE_URL: str = _env("DATABASE_URL", "postgresql://corgi:corgi@db:5432/corgi")

# Filesystem
DATA_DIR: str = _env("DATA_DIR", "/data")

# Azure Blob Storage
AZURE_STORAGE_CONNECTION_STRING: str = _env("AZURE_STORAGE_CONNECTION_STRING", "")
AZURE_STORAGE_CONTAINER: str = _env("AZURE_STORAGE_CONTAINER", "")
AZURE_BLOB_PREFIX: str = _env("AZURE_BLOB_PREFIX", "corgi-backups")

# Schedule & retention
BACKUP_CRON_SCHEDULE: str = _env("BACKUP_CRON_SCHEDULE", "0 2 * * *")
BACKUP_RETENTION_COUNT: int = int(_env("BACKUP_RETENTION_COUNT", "30"))


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
        "user": parsed.username or "corgi",
        "password": parsed.password or "",
        "dbname": parsed.path.lstrip("/") or "corgi",
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

def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run_backup() -> Path | None:
    """Create a snapshot archive and upload it to S3.

    Returns the local path to the archive, or *None* on failure.
    """
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    snapshot_name = f"corgi-backup-{timestamp}"
    log.info("Starting backup: %s", snapshot_name)

    db = _parse_db_url(DATABASE_URL)
    pg = _pg_env(db)

    with tempfile.TemporaryDirectory(prefix="corgi-bak-") as tmpdir:
        work = Path(tmpdir) / snapshot_name
        work.mkdir()

        # 1. pg_dump ----------------------------------------------------------
        dump_path = work / "db.sql"
        log.info("Dumping database %s@%s:%s/%s …", db["user"], db["host"], db["port"], db["dbname"])
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
            return None
        log.info("Database dump complete (%s bytes)", dump_path.stat().st_size)

        # 2. Filesystem snapshot -----------------------------------------------
        data_src = Path(DATA_DIR)
        has_data = data_src.exists() and any(data_src.iterdir())
        if not has_data:
            log.warning("Data directory %s is empty or missing – skipping filesystem snapshot", DATA_DIR)

        # 3. Manifest ----------------------------------------------------------
        manifest = {
            "snapshot_name": snapshot_name,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "database_url_host": db["host"],
            "database_name": db["dbname"],
            "data_dir": DATA_DIR,
            "files": {},
        }

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
                    rel = "data/" + str(fpath.relative_to(data_src))
                    manifest["files"][rel] = {
                        "size": fpath.stat().st_size,
                        "sha256": _sha256(fpath),
                    }

        manifest_path = work / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2))

        # 4. Create tar.gz (stream filesystem data directly into archive) ----
        archive_name = f"{snapshot_name}.tar.gz"
        archive_path = Path(tmpdir) / archive_name
        log.info("Creating archive %s …", archive_name)
        with tarfile.open(str(archive_path), "w:gz") as tar:
            # Add db dump and manifest from the work directory
            tar.add(str(work), arcname=snapshot_name)
            # Stream filesystem data directly into the archive (avoids 2x disk copy)
            if has_data:
                log.info("Streaming filesystem data from %s into archive …", DATA_DIR)
                tar.add(str(data_src), arcname=f"{snapshot_name}/data")
        archive_size = archive_path.stat().st_size
        log.info("Archive created: %s (%s bytes)", archive_name, archive_size)

        # 5. Upload to Azure Blob Storage ------------------------------------
        if _azure_configured():
            blob_name = f"{AZURE_BLOB_PREFIX}/{archive_name}" if AZURE_BLOB_PREFIX else archive_name
            log.info("Uploading to azure://%s/%s …", AZURE_STORAGE_CONTAINER, blob_name)
            try:
                container = _blob_container_client()
                with open(archive_path, "rb") as data:
                    container.upload_blob(blob_name, data, overwrite=True)
                log.info("Upload complete")
            except Exception:
                log.exception("Azure Blob upload failed")
                return None

            # 6. Enforce retention policy --------------------------------------
            _enforce_retention(container)
        else:
            log.warning(
                "Azure Blob Storage not configured – archive saved locally at %s only. "
                "Set AZURE_STORAGE_CONNECTION_STRING and AZURE_STORAGE_CONTAINER to enable cloud storage.",
                archive_path,
            )
            # Copy to a persistent location so it survives tmpdir cleanup
            persistent = Path("/backups")
            persistent.mkdir(parents=True, exist_ok=True)
            final = persistent / archive_name
            shutil.copy2(str(archive_path), str(final))
            log.info("Local backup saved to %s", final)
            _enforce_local_retention()
            return final

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
                log.info("  Deleted %s", blob.name)
    except Exception:
        log.exception("Failed to enforce retention policy")


def _enforce_local_retention() -> None:
    """Delete old local snapshots beyond BACKUP_RETENTION_COUNT."""
    if BACKUP_RETENTION_COUNT <= 0:
        return

    local_dir = Path("/backups")
    if not local_dir.exists():
        return

    archives = sorted(local_dir.glob("corgi-backup-*.tar.gz"), reverse=True)
    if len(archives) > BACKUP_RETENTION_COUNT:
        to_delete = archives[BACKUP_RETENTION_COUNT:]
        log.info(
            "Local retention policy: keeping %d, deleting %d old snapshot(s)",
            BACKUP_RETENTION_COUNT,
            len(to_delete),
        )
        for f in to_delete:
            f.unlink()
            log.info("  Deleted %s", f.name)


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

def list_snapshots() -> list[dict]:
    """List available snapshots in Azure Blob Storage or locally."""
    if not _azure_configured():
        # List local backups
        local_dir = Path("/backups")
        if not local_dir.exists():
            log.info("No local backups found")
            return []
        snapshots = []
        for f in sorted(local_dir.glob("corgi-backup-*.tar.gz"), reverse=True):
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


# ---------------------------------------------------------------------------
# Restore
# ---------------------------------------------------------------------------

def run_restore(snapshot_name: str | None = None) -> bool:
    """Download and restore a snapshot.

    If *snapshot_name* is ``None``, the latest snapshot is used.
    Returns ``True`` on success.
    """
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
        with tempfile.TemporaryDirectory(prefix="corgi-restore-") as tmpdir:
            archive_path = Path(tmpdir) / target["name"]
            log.info("Downloading azure://%s/%s …", AZURE_STORAGE_CONTAINER, target["blob_name"])
            container = _blob_container_client()
            with open(archive_path, "wb") as f:
                stream = container.download_blob(target["blob_name"])
                stream.readinto(f)
            log.info("Download complete (%s bytes)", archive_path.stat().st_size)
            return _restore_from_archive(archive_path)
    else:
        # Local restore
        local_dir = Path("/backups")
        if snapshot_name:
            fname = snapshot_name if snapshot_name.endswith(".tar.gz") else f"{snapshot_name}.tar.gz"
            archive_path = local_dir / fname
        else:
            archives = sorted(local_dir.glob("corgi-backup-*.tar.gz"), reverse=True)
            if not archives:
                log.error("No local backups found in %s", local_dir)
                return False
            archive_path = archives[0]
            log.info("Using latest local snapshot: %s", archive_path.name)

        if not archive_path.exists():
            log.error("Snapshot file not found: %s", archive_path)
            return False
        return _restore_from_archive(archive_path)


def _restore_from_archive(archive_path: Path) -> bool:
    """Extract an archive and restore database + filesystem."""
    log.info("Restoring from %s …", archive_path.name)

    with tempfile.TemporaryDirectory(prefix="corgi-restore-") as tmpdir:
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
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text())
            log.info("Snapshot: %s (created %s)", manifest.get("snapshot_name", "?"), manifest.get("created_at", "?"))

        # 1. Restore database ---------------------------------------------------
        dump_path = snapshot_dir / "db.sql"
        if dump_path.exists():
            db = _parse_db_url(DATABASE_URL)
            pg = _pg_env(db)

            log.info("Restoring database …")

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
                return False
            log.info("Database restored successfully")
        else:
            log.warning("No db.sql found in snapshot – skipping database restore")

        # 2. Restore filesystem -------------------------------------------------
        data_archive = snapshot_dir / "data"
        if data_archive.exists() and data_archive.is_dir():
            data_dest = Path(DATA_DIR)
            log.info("Restoring filesystem data to %s …", DATA_DIR)

            # Clear existing data
            if data_dest.exists():
                for child in data_dest.iterdir():
                    if child.is_dir():
                        shutil.rmtree(str(child))
                    else:
                        child.unlink()

            # Copy restored data
            shutil.copytree(str(data_archive), str(data_dest), dirs_exist_ok=True)
            log.info("Filesystem data restored")
        else:
            log.warning("No data/ directory in snapshot – skipping filesystem restore")

    log.info("Restore completed successfully")
    return True


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

    log.info("Corgi Backup Service started")
    log.info("  Schedule : %s", BACKUP_CRON_SCHEDULE)
    log.info("  Retention: %d snapshots", BACKUP_RETENTION_COUNT)
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

    elif command == "cron":
        run_cron()

    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
