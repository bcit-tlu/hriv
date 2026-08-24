"""Background execution logic for admin import/export tasks.

Each ``run_*`` coroutine is designed to be called from an arq worker task
or from a FastAPI ``BackgroundTasks`` fallback.  They manage their own
database sessions and update the :class:`~app.models.AdminTask` record
with progress, log output, and results.
"""

import asyncio
import hashlib
import io
import json
import logging
import os
import queue
import shutil
import subprocess
import tarfile
import tempfile
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TypeVar

from opentelemetry import trace
from opentelemetry.trace import StatusCode
from sqlalchemy import func, insert, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTasks

from .backup_access import (
    BackupRestoreNotConfiguredError,
    BackupSnapshotCancelledError,
    restore_snapshot_file,
)
from .component_versions import get_app_version
from .browse_state import bump_browse_revision
from .database import get_async_session, settings
from .tile_order import INITIAL_SCOPE_REVISION
from .worker import TaskQueueUnavailableError, enqueue_admin_task
from .models import (
    ACTIVE_TASK_STATUSES,
    AdminTask,
    Announcement,
    Category,
    ChangelogEntry,
    Group,
    Image,
    Program,
    SourceImage,
    User,
)

logger = logging.getLogger(__name__)

_CHUNK_SIZE = 1024 * 1024  # 1 MiB

# Directory where background task outputs are stored.
_TASKS_DIR = os.environ.get(
    "ADMIN_TASKS_DIR",
    os.path.join(str(Path(settings.tiles_dir).parent), "admin_tasks"),
)
_IMPORT_STAGING_DIR = os.environ.get(
    "IMPORT_STAGING_DIR",
    os.path.join(str(Path(settings.data_dir)), ".import-staging"),
)
_IMPORT_STAGING_FREE_SPACE_FACTOR = float(
    os.environ.get("IMPORT_STAGING_FREE_SPACE_FACTOR", "1.25")
)
_IMPORT_STAGING_MIN_FREE_BYTES = int(
    os.environ.get("IMPORT_STAGING_MIN_FREE_BYTES", str(1024 * 1024 * 1024))
)
_IMPORT_STAGING_FREE_SPACE_CHECK_INTERVAL_BYTES = 512 * 1024 * 1024


# ── Retained import archive integrity ──────────────────────
#
# The SHA-256 of an import archive is recorded on its AdminTask the first
# time the archive is imported.  Reruns of a retained archive inherit the
# recorded checksum and verify the on-disk file still matches before any
# extraction, so corrupted or modified retained archives are rejected.

FILES_IMPORT_CHECKSUM_MISMATCH_MESSAGE = (
    "The retained archive no longer matches the originally uploaded file "
    "and cannot be reused. Please upload a new archive."
)


def compute_archive_sha256(path: str | Path) -> str:
    """Return the hex SHA-256 digest of *path*, read in chunks."""
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(_CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


# ── Filesystem export/import archive manifest ──────────────
#
# Every filesystem export embeds a small JSON manifest at the archive
# root (next to the ``data/`` payload) so future releases can evolve the
# archive layout safely.  Imports validate the manifest when present;
# archives created before manifests existed are accepted as legacy
# format-version 0 archives to keep previously retained archives usable.

FILES_EXPORT_MANIFEST_NAME = "hriv-manifest.json"
FILES_EXPORT_FORMAT_VERSION = 1
SUPPORTED_FILES_IMPORT_FORMAT_VERSIONS = frozenset({FILES_EXPORT_FORMAT_VERSION})


def build_files_export_manifest() -> dict[str, object]:
    """Build the manifest embedded at the root of filesystem exports."""
    return {
        "format_version": FILES_EXPORT_FORMAT_VERSION,
        "hriv_version": get_app_version(),
        "export_type": "filesystem",
        "created_at": datetime.now(timezone.utc)
        .isoformat()
        .replace("+00:00", "Z"),
    }


def _add_manifest_member(tar: tarfile.TarFile) -> int:
    """Append the export manifest as the first member of *tar*.

    Returns the manifest payload size in bytes.
    """
    payload = json.dumps(build_files_export_manifest(), indent=2).encode("utf-8")
    info = tarfile.TarInfo(FILES_EXPORT_MANIFEST_NAME)
    info.size = len(payload)
    info.mtime = int(datetime.now(timezone.utc).timestamp())
    tar.addfile(info, io.BytesIO(payload))
    return len(payload)


def _validate_files_import_manifest(staging_root: Path) -> int:
    """Validate the archive manifest extracted into *staging_root*.

    Returns the archive's ``format_version``, or ``0`` for legacy
    archives that predate manifests (still importable).  Raises
    :class:`ValueError` with an operator-facing message when the
    manifest is unreadable, is for a different export type, or declares
    an unsupported format version.  The manifest file is removed from
    the staging root after validation so it is never swapped into the
    data directory.
    """
    manifest_path = staging_root / FILES_EXPORT_MANIFEST_NAME
    if not manifest_path.exists() and not manifest_path.is_symlink():
        logger.warning(
            "Filesystem import archive has no manifest; treating as legacy format",
            extra={"event": "admin_task.files_import_legacy_archive"},
        )
        return 0
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise ValueError(
            f"Archive manifest ({FILES_EXPORT_MANIFEST_NAME}) must be a "
            "regular file"
        )
    try:
        raw = manifest_path.read_bytes().decode("utf-8", errors="replace")
    except OSError as exc:
        raise ValueError(
            f"Could not read archive manifest ({FILES_EXPORT_MANIFEST_NAME}) "
            f"from the staging directory: {exc}"
        ) from exc
    finally:
        try:
            manifest_path.unlink()
        except OSError:
            logger.warning("Failed to remove staged manifest", exc_info=True)
    try:
        manifest = json.loads(raw)
    except ValueError as exc:
        raise ValueError(
            f"Archive manifest ({FILES_EXPORT_MANIFEST_NAME}) is not valid JSON: {exc}"
        ) from exc
    if not isinstance(manifest, dict):
        raise ValueError(
            f"Archive manifest ({FILES_EXPORT_MANIFEST_NAME}) must be a JSON object"
        )
    export_type = manifest.get("export_type")
    if export_type != "filesystem":
        raise ValueError(
            "Archive manifest declares export_type "
            f"{export_type!r}; expected 'filesystem'. This archive is not a "
            "filesystem export."
        )
    format_version = manifest.get("format_version")
    if not isinstance(format_version, int) or isinstance(format_version, bool):
        raise ValueError(
            "Archive manifest has a missing or invalid format_version; "
            "expected an integer."
        )
    if format_version not in SUPPORTED_FILES_IMPORT_FORMAT_VERSIONS:
        supported = ", ".join(
            str(v) for v in sorted(SUPPORTED_FILES_IMPORT_FORMAT_VERSIONS)
        )
        raise ValueError(
            f"Archive format version {format_version} is not supported by this "
            f"release (supported: {supported}). The archive was created by "
            f"HRIV {manifest.get('hriv_version', 'unknown')}; upgrade this "
            "deployment or re-export from a compatible release."
        )
    return format_version


def _ensure_tasks_dir() -> str:
    os.makedirs(_TASKS_DIR, exist_ok=True)
    return _TASKS_DIR


def _ensure_import_staging_dir() -> str:
    os.makedirs(_IMPORT_STAGING_DIR, exist_ok=True)
    return _IMPORT_STAGING_DIR


def format_bytes(num_bytes: int) -> str:
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if num_bytes < 1024 or unit == "TiB":
            if unit == "B":
                return f"{num_bytes:.0f} {unit}"
            return f"{num_bytes:.1f} {unit}"
        num_bytes /= 1024
    return f"{num_bytes:.1f} TiB"


def _ensure_import_staging_free_space(staging_dir: Path) -> None:
    free_bytes = shutil.disk_usage(staging_dir).free
    if free_bytes < _IMPORT_STAGING_MIN_FREE_BYTES:
        raise ValueError(
            "Insufficient free space on data volume during filesystem import: "
            f"have {format_bytes(free_bytes)} free, "
            f"need at least {format_bytes(_IMPORT_STAGING_MIN_FREE_BYTES)}"
        )


def _ensure_import_staging_same_device(staging_dir: Path, data_dir: Path) -> None:
    """Fail fast if staging and data directories are on different filesystems.

    On-volume staging restores entries by atomically renaming them from the
    staging directory into ``data_dir`` (``_swap_imported_entries``). ``os.rename``
    only works within a single filesystem, so a misconfigured
    ``IMPORT_STAGING_DIR`` on a different volume would otherwise surface as a
    cryptic ``EXDEV`` ("Invalid cross-device link") failure part-way through the
    swap. Checking up front produces a clear, actionable error instead.
    """
    if os.stat(staging_dir).st_dev != os.stat(data_dir).st_dev:
        raise ValueError(
            "Filesystem import staging directory must be on the same volume as "
            f"the data directory: staging '{staging_dir}' and data '{data_dir}' "
            "are on different filesystems, so restored entries cannot be "
            "atomically moved into place (os.rename fails with EXDEV / "
            "cross-device link). Set IMPORT_STAGING_DIR to a path on the data "
            "volume."
        )


def _remove_path(path: Path) -> None:
    if not path.exists() and not path.is_symlink():
        return
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink()


def _unique_sibling_path(path: Path, suffix: str) -> Path:
    timestamp = int(datetime.now(timezone.utc).timestamp())
    candidate = path.with_name(f"{path.name}{suffix}-{timestamp}")
    counter = 0
    while candidate.exists():
        counter += 1
        candidate = path.with_name(f"{path.name}{suffix}-{timestamp}-{counter}")
    return candidate


class _CountingReader:
    def __init__(
        self,
        fileobj,
        *,
        on_bytes: Callable[[int], None] | None = None,
        cancel_event: threading.Event | None = None,
    ) -> None:
        self._fileobj = fileobj
        self._on_bytes = on_bytes
        self._cancel_event = cancel_event

    def read(self, size: int = -1):
        if self._cancel_event is not None and self._cancel_event.is_set():
            return b""
        chunk = self._fileobj.read(size)
        if chunk and self._on_bytes is not None:
            self._on_bytes(len(chunk))
        return chunk

    def close(self) -> None:
        self._fileobj.close()


def _extract_archive_stream(
    tmp_archive: str,
    staging_dir: Path,
    *,
    cancel_event: threading.Event | None = None,
    on_progress: Callable[[str, int, int], None] | None = None,
) -> int:
    archive_size = os.path.getsize(tmp_archive)
    if on_progress is not None:
        on_progress("extract", 0, archive_size)

    compressed_read = 0
    last_free_space_check = 0

    def _on_bytes(count: int) -> None:
        nonlocal compressed_read, last_free_space_check
        compressed_read += count
        if on_progress is not None:
            on_progress("extract", compressed_read, archive_size)
        if compressed_read - last_free_space_check >= (
            _IMPORT_STAGING_FREE_SPACE_CHECK_INTERVAL_BYTES
        ):
            last_free_space_check = compressed_read
            _ensure_import_staging_free_space(staging_dir)

    pigz_path = shutil.which("pigz")
    member_count = 0
    if pigz_path is not None:
        proc = subprocess.Popen(
            [pigz_path, "-dc"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        feeder_exc: list[BaseException | None] = [None]
        feeder_done = threading.Event()

        def _feed_archive() -> None:
            try:
                assert proc.stdin is not None
                with open(tmp_archive, "rb") as archive_fh:
                    while True:
                        if cancel_event is not None and cancel_event.is_set():
                            break
                        chunk = archive_fh.read(_CHUNK_SIZE)
                        if not chunk:
                            break
                        proc.stdin.write(chunk)
                        _on_bytes(len(chunk))
                    try:
                        proc.stdin.close()
                    except OSError:
                        # Best-effort close; the pipe may already be gone during cancellation or shutdown.
                        pass
            except (KeyboardInterrupt, SystemExit, GeneratorExit):
                try:
                    if proc.stdin is not None and not proc.stdin.closed:
                        proc.stdin.close()
                except OSError:
                    # Best-effort close; the pipe may already be gone.
                    pass
                raise
            except Exception as exc:
                feeder_exc[0] = exc
                try:
                    if proc.stdin is not None and not proc.stdin.closed:
                        proc.stdin.close()
                except OSError:
                    # Best-effort close; the pipe may already be broken.
                    pass
            finally:
                feeder_done.set()

        feeder = threading.Thread(target=_feed_archive, daemon=True)
        feeder.start()
        try:
            assert proc.stdout is not None
            with tarfile.open(fileobj=proc.stdout, mode="r|") as tar:
                for member in tar:
                    if cancel_event is not None and cancel_event.is_set():
                        raise TaskCancelled("Task cancelled by admin")
                    tar.extract(member, path=str(staging_dir), filter="data")
                    member_count += 1
            if feeder_exc[0] is not None:
                raise feeder_exc[0]
            returncode = proc.wait()
            if returncode != 0:
                stderr = (
                    proc.stderr.read().decode("utf-8", errors="replace").strip()
                    if proc.stderr is not None
                    else ""
                )
                raise RuntimeError(
                    f"pigz failed with exit code {returncode}"
                    + (f": {stderr}" if stderr else "")
                )
        except Exception as exc:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
            if feeder_exc[0] is not None:
                raise feeder_exc[0] from exc
            raise
        except (KeyboardInterrupt, SystemExit, GeneratorExit):
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
            raise
        finally:
            feeder_done.wait(timeout=5)
            feeder.join(timeout=5)
            if proc.stdout is not None:
                proc.stdout.close()
            if proc.stderr is not None:
                proc.stderr.close()
    else:
        reader = _CountingReader(
            open(tmp_archive, "rb"),
            on_bytes=_on_bytes,
            cancel_event=cancel_event,
        )
        try:
            with tarfile.open(fileobj=reader, mode="r|gz") as tar:
                for member in tar:
                    if cancel_event is not None and cancel_event.is_set():
                        raise TaskCancelled("Task cancelled by admin")
                    tar.extract(member, path=str(staging_dir), filter="data")
                    member_count += 1
        except Exception as exc:
            if cancel_event is not None and cancel_event.is_set():
                raise TaskCancelled("Task cancelled by admin") from exc
            raise
        finally:
            reader.close()

    return member_count



def _swap_imported_entries(
    extracted_dir: Path,
    data_dir: Path,
    tiles_dir: str,
    source_images_dir: str,
    *,
    cancel_event: threading.Event | None = None,
) -> dict[str, int]:
    tasks_basename = os.path.basename(_TASKS_DIR)
    staging_basename = os.path.basename(_IMPORT_STAGING_DIR)
    tiles_basename = os.path.basename(os.path.normpath(settings.tiles_dir))
    moved: list[tuple[Path, Path | None]] = []

    def _check_cancel() -> None:
        if cancel_event is not None and cancel_event.is_set():
            raise TaskCancelled("Task cancelled by admin")

    try:
        for entry in sorted(extracted_dir.iterdir(), key=lambda p: p.name):
            _check_cancel()
            if entry.name in {tasks_basename, staging_basename, tiles_basename}:
                continue
            target = data_dir / entry.name
            backup = (
                _unique_sibling_path(target, ".bak")
                if target.exists() or target.is_symlink()
                else None
            )
            if backup is not None:
                os.rename(str(target), str(backup))
            try:
                os.rename(str(entry), str(target))
            except Exception:
                if target.exists() or target.is_symlink():
                    _remove_path(target)
                if backup is not None and backup.exists():
                    try:
                        os.rename(str(backup), str(target))
                    except OSError:
                        logger.debug(
                            "Failed to restore backup path %s to %s during rollback",
                            backup,
                            target,
                            exc_info=True,
                        )
                raise
            moved.append((target, backup))
    except Exception:
        for target, backup in reversed(moved):
            try:
                if target.exists() or target.is_symlink():
                    _remove_path(target)
            except OSError:
                logger.debug(
                    "Failed to remove partially restored path %s during rollback",
                    target,
                    exc_info=True,
                )
            if backup is not None and backup.exists():
                try:
                    os.rename(str(backup), str(target))
                except OSError:
                    logger.debug(
                        "Failed to restore backup path %s to %s during rollback",
                        backup,
                        target,
                        exc_info=True,
                    )
        raise

    for _target, backup in reversed(moved):
        if backup is not None and backup.exists():
            try:
                _remove_path(backup)
            except OSError:
                logger.warning(
                    "Filesystem import left backup path behind after success: %s",
                    backup,
                    extra={"event": "admin_task.files_import_backup_orphaned"},
                    exc_info=True,
                )

    tiles_path = Path(tiles_dir)
    source_path = Path(source_images_dir)
    tiles_count = 0
    source_count = 0
    if tiles_path.exists():
        tiles_count = sum(1 for f in tiles_path.rglob("*") if f.is_file())
    if source_path.exists():
        source_count = sum(1 for f in source_path.rglob("*") if f.is_file())

    return {"tile_files": tiles_count, "source_files": source_count}


# Threshold (seconds) after which an in-flight admin task with no
# ``updated_at`` progress is considered abandoned and eligible for the
# startup reconciler to mark as ``failed``.  Every task runner writes to
# ``updated_at`` at least every few seconds via ``_update_task`` (see the
# verbose archive poller in ``run_files_export`` for example), so 15 min
# is generously large.  Configurable via env for clusters with unusually
# long individual checkpoints.
_STALE_TASK_THRESHOLD_SECONDS = int(
    os.environ.get("ADMIN_TASK_STALE_SECONDS", "900")
)


# ── Helpers ────────────────────────────────────────────────


class TaskCancelled(Exception):
    """Raised when an admin task detects a cancellation request."""


async def reconcile_stale_tasks(
    session: AsyncSession,
    stale_after_seconds: int = _STALE_TASK_THRESHOLD_SECONDS,
) -> int:
    """Mark orphaned in-flight admin tasks as ``failed``.

    A task is considered stale when its status is still ``pending``,
    ``running`` or ``cancelling`` but its ``updated_at`` timestamp is
    older than *stale_after_seconds*.  This runs on backend startup so
    tasks whose runner process died (pod crash, OOM kill, rollout) are
    cleared up instead of blocking the ``_create_task`` concurrency
    guard indefinitely.

    The threshold guards against multi-replica deployments: a freshly
    starting pod will not clobber a task actively running on a sibling
    pod because that sibling pod is writing progress to ``updated_at``.

    Returns the number of rows updated.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=stale_after_seconds)
    stmt = (
        update(AdminTask)
        .where(
            AdminTask.status.in_(ACTIVE_TASK_STATUSES),
            AdminTask.updated_at < cutoff,
        )
        .values(
            status="failed",
            error_message=(
                "Task marked as failed on backend startup — no progress "
                f"update for more than {stale_after_seconds}s; the runner "
                "likely crashed before it could finalise the task."
            ),
            # Core-level ``update()`` skips SQLAlchemy's ``onupdate``
            # hooks on ``updated_at``; set it explicitly so the row
            # reflects the reconciliation time rather than the moment
            # the original runner last wrote progress.
            updated_at=func.now(),
        )
        .returning(AdminTask.id)
    )
    result = await session.execute(stmt)
    ids = [row[0] for row in result.all()]
    await session.commit()
    if ids:
        logger.warning(
            "Reconciled %d stale admin task(s) to 'failed' on startup",
            len(ids),
            extra={
                "event": "admin_task.reconciled_stale",
                "task_ids": ids,
                "stale_after_seconds": stale_after_seconds,
            },
        )
    _cleanup_stale_export_staging_files(stale_after_seconds)
    return len(ids)


def _cleanup_stale_export_staging_files(stale_after_seconds: int) -> None:
    """Delete abandoned filesystem-export staging archives.

    Export archives are staged in the tasks dir under a hidden
    ``.export-staging-`` prefix before the final rename; a runner that
    dies mid-archive (pod crash, eviction) leaves the partial file
    behind on the data volume.  A live export keeps its staging file's
    mtime fresh as tar appends, so only files older than
    *stale_after_seconds* are removed.
    """
    cutoff = time.time() - stale_after_seconds
    try:
        entries = os.listdir(_TASKS_DIR)
    except OSError:
        return
    for name in entries:
        if not name.startswith(".export-staging-"):
            continue
        path = os.path.join(_TASKS_DIR, name)
        try:
            if os.path.getmtime(path) < cutoff:
                os.unlink(path)
                logger.warning(
                    "Removed abandoned export staging file",
                    extra={
                        "event": "admin_task.export_staging_cleanup",
                        "path": path,
                    },
                )
        except OSError:
            continue


async def _update_task(
    session: AsyncSession,
    task: AdminTask,
    *,
    status: str | None = None,
    progress: int | None = None,
    log_line: str | None = None,
    result_filename: str | None = None,
    result_path: str | None = None,
    error_message: str | None = None,
    check_cancelled: bool = False,
) -> None:
    """Persist incremental updates to an AdminTask record.

    When *check_cancelled* is ``True`` the helper re-reads the task from
    the database before applying changes.  If the status has been set to
    ``cancelling`` (by the cancel endpoint) a :class:`TaskCancelled`
    exception is raised so the caller can abort cleanly.
    """
    if check_cancelled:
        await session.refresh(task, attribute_names=["status"])
        if task.status in ("cancelling", "cancelled"):
            raise TaskCancelled("Task cancelled by admin")

    if status is not None:
        task.status = status
    if progress is not None:
        task.progress = progress
    if log_line is not None:
        task.log = (task.log or "") + log_line + "\n"
    if result_filename is not None:
        task.result_filename = result_filename
    if result_path is not None:
        task.result_path = result_path
    if error_message is not None:
        task.error_message = error_message
    await session.commit()


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value)


def _extract_files_import_original_filename(task: AdminTask) -> str | None:
    if task.original_filename:
        return task.original_filename
    prefix = "Awaiting file upload: "
    for line in (task.log or "").splitlines():
        if line.startswith(prefix):
            filename = line[len(prefix) :].strip()
            return filename or None
    return None


def _validate_retained_files_import_archive_path(input_path: str) -> Path:
    tasks_dir = Path(_ensure_tasks_dir()).resolve()
    archive_path = Path(input_path).resolve()
    try:
        archive_path.relative_to(tasks_dir)
    except ValueError as exc:
        raise ValueError("Archive path is outside admin_tasks dir") from exc
    if not archive_path.is_file():
        raise FileNotFoundError("Archive file not found")
    return archive_path


async def _create_rerun_files_import_task(
    session: AsyncSession,
    user: User,
    *,
    input_path: str,
    original_filename: str | None,
    input_checksum: str | None,
) -> AdminTask:
    existing = (
        await session.execute(
            select(AdminTask).where(
                AdminTask.task_type == "files_import",
                AdminTask.status.in_(ACTIVE_TASK_STATUSES),
            )
        )
    ).scalars().first()
    if existing is not None:
        raise RuntimeError(
            "A files import task is already "
            f"{existing.status} (task #{existing.id}). Please wait for it to "
            "finish or cancel it first."
        )

    task = AdminTask(
        task_type="files_import",
        status="pending",
        created_by=user.id,
        input_path=input_path,
        original_filename=original_filename,
        input_checksum=input_checksum,
    )
    session.add(task)
    await session.commit()
    await session.refresh(task)
    return task


async def list_files_import_archives(session: AsyncSession) -> list[dict[str, object]]:
    result = await session.execute(
        select(AdminTask)
        .where(
            AdminTask.task_type == "files_import",
            AdminTask.input_path.is_not(None),
        )
        .order_by(AdminTask.id.desc())
    )
    archives: list[dict[str, object]] = []
    for task in result.scalars():
        if not task.input_path:
            continue
        try:
            archive_path = _validate_retained_files_import_archive_path(task.input_path)
        except (FileNotFoundError, ValueError):
            continue
        archives.append(
            {
                "archive_task_id": task.id,
                "original_filename": _extract_files_import_original_filename(task)
                or archive_path.name,
                "size_bytes": archive_path.stat().st_size,
                "created_at": task.created_at,
                "last_status": task.status,
            }
        )
    return archives


async def rerun_files_import_archive(
    session: AsyncSession,
    user: User,
    archive_task_id: int,
) -> AdminTask:
    archive_task = await session.get(AdminTask, archive_task_id)
    if archive_task is None or archive_task.task_type != "files_import":
        raise LookupError("Archive task not found")
    if not archive_task.input_path:
        raise FileNotFoundError("Archive file not found")

    archive_path = _validate_retained_files_import_archive_path(archive_task.input_path)
    task = await _create_rerun_files_import_task(
        session,
        user,
        input_path=str(archive_path),
        original_filename=_extract_files_import_original_filename(archive_task),
        input_checksum=archive_task.input_checksum,
    )
    task.log = (
        (task.log or "")
        + f"Re-running retained archive from task #{archive_task_id}.\n"
    )
    await session.commit()
    await session.refresh(task)
    return task


def files_import_archive_retention_policy() -> dict[str, int]:
    """Return the active retention policy for retained import archives."""
    return {
        "retention_count": settings.files_import_archive_retention_count,
        "retention_days": settings.files_import_archive_retention_days,
    }


async def enforce_files_import_archive_retention(
    session: AsyncSession,
) -> list[int]:
    """Delete retained import archives that fall outside the retention policy.

    Keeps only the newest ``files_import_archive_retention_count`` distinct
    archives and/or deletes archives older than
    ``files_import_archive_retention_days``. A value of ``0`` disables that
    dimension. Deletion goes through :func:`delete_files_import_archive`, so
    archives referenced by an active files import are never removed.

    Returns the archive task ids whose files were deleted.
    """
    count_limit = settings.files_import_archive_retention_count
    max_age_days = settings.files_import_archive_retention_days
    if count_limit <= 0 and max_age_days <= 0:
        return []

    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=max_age_days)
        if max_age_days > 0
        else None
    )

    # list_files_import_archives is newest-first; reruns share the same
    # input_path, so dedupe by on-disk file before counting.
    seen_paths: set[str] = set()
    deleted: list[int] = []
    kept = 0
    for archive in await list_files_import_archives(session):
        archive_task_id = archive["archive_task_id"]
        assert isinstance(archive_task_id, int)
        task = await session.get(AdminTask, archive_task_id)
        if task is None or not task.input_path or task.input_path in seen_paths:
            continue
        seen_paths.add(task.input_path)

        over_count = count_limit > 0 and kept >= count_limit
        created_at = archive["created_at"]
        assert isinstance(created_at, datetime)
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        too_old = cutoff is not None and created_at < cutoff
        if not (over_count or too_old):
            kept += 1
            continue

        try:
            await delete_files_import_archive(session, archive_task_id)
        except (LookupError, FileNotFoundError, ValueError, RuntimeError, OSError):
            # In use by an active import, already gone, or not deletable —
            # keep it and move on.
            kept += 1
            continue
        deleted.append(archive_task_id)
        logger.info(
            "Deleted retained files-import archive per retention policy",
            extra={
                "event": "admin_task.files_import_archive_retention_deleted",
                "archive_task_id": archive_task_id,
                "retention_count": count_limit,
                "retention_days": max_age_days,
            },
        )
    return deleted


async def delete_files_import_archive(
    session: AsyncSession,
    archive_task_id: int,
) -> dict[str, object]:
    archive_task = await session.get(AdminTask, archive_task_id)
    if archive_task is None or archive_task.task_type != "files_import":
        raise LookupError("Archive task not found")
    if not archive_task.input_path:
        raise FileNotFoundError("Archive file not found")

    archive_path = _validate_retained_files_import_archive_path(archive_task.input_path)
    active_result = await session.execute(
        select(AdminTask.id)
        .where(
            AdminTask.task_type == "files_import",
            AdminTask.input_path == archive_task.input_path,
            AdminTask.status.in_(ACTIVE_TASK_STATUSES),
        )
    )
    if active_result.scalars().first() is not None:
        raise RuntimeError("Archive is currently in use by an active files import")

    os.unlink(archive_path)
    return {
        "archive_task_id": archive_task_id,
        "deleted": True,
        "path": str(archive_path),
    }


# ── Database Export ────────────────────────────────────────


async def run_db_export(task_id: int) -> None:
    """Export all database tables to a JSON file in the background."""
    async with get_async_session()() as session:
        task = await session.get(AdminTask, task_id)
        if task is None:
            logger.error("AdminTask %d not found", task_id)
            return

        filepath: str | None = None
        try:
            await _update_task(
                session, task,
                status="running", progress=0,
                log_line="Starting database export…",
                check_cancelled=True,
            )

            # Programs
            await _update_task(session, task, log_line="Exporting programs…", progress=10, check_cancelled=True)
            result = await session.execute(select(Program).order_by(Program.id))
            programs = result.scalars().all()

            # Groups
            await _update_task(session, task, log_line="Exporting groups…", progress=15, check_cancelled=True)
            result = await session.execute(select(Group).order_by(Group.id))
            groups = result.scalars().unique().all()

            # Categories
            await _update_task(session, task, log_line="Exporting categories…", progress=20, check_cancelled=True)
            result = await session.execute(select(Category).order_by(Category.id))
            categories = result.scalars().all()

            # Images
            await _update_task(session, task, log_line="Exporting images…", progress=40, check_cancelled=True)
            result = await session.execute(select(Image).order_by(Image.id))
            images = result.scalars().all()

            # Users
            await _update_task(session, task, log_line="Exporting users…", progress=55, check_cancelled=True)
            result = await session.execute(select(User).order_by(User.id))
            users = result.scalars().all()

            # Source images
            await _update_task(session, task, log_line="Exporting source images…", progress=65, check_cancelled=True)
            result = await session.execute(select(SourceImage).order_by(SourceImage.id))
            source_images = result.scalars().all()

            # Changelog entries
            await _update_task(session, task, log_line="Exporting changelog entries…", progress=70, check_cancelled=True)
            result = await session.execute(select(ChangelogEntry).order_by(ChangelogEntry.id))
            changelog_entries = result.scalars().all()

            # Announcement
            await _update_task(session, task, log_line="Exporting announcement…", progress=75, check_cancelled=True)
            result = await session.execute(
                select(Announcement).where(Announcement.id == 1)
            )
            ann = result.scalar_one_or_none()

            def dt(v: datetime | None) -> str | None:
                return v.isoformat() if v else None

            dump = {
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "programs": [
                    {
                        "id": p.id,
                        "name": p.name,
                        "oidc_group": p.oidc_group,
                        "created_at": dt(p.created_at),
                        "updated_at": dt(p.updated_at),
                    }
                    for p in programs
                ],
                "groups": [
                    {
                        "id": g.id,
                        "name": g.name,
                        "description": g.description,
                        "created_by_user_id": g.created_by_user_id,
                        "member_ids": [m.id for m in g.members],
                        "instructor_ids": [i.id for i in g.instructors],
                        "created_at": dt(g.created_at),
                        "updated_at": dt(g.updated_at),
                    }
                    for g in groups
                ],
                "categories": [
                    {
                        "id": c.id,
                        "label": c.label,
                        "parent_id": c.parent_id,
                        "program_ids": [p.id for p in c.programs],
                        "group_ids": [g.id for g in c.groups],
                        "status": c.status,
                        "sort_order": c.sort_order,
                        "metadata": c.metadata_,
                        "created_at": dt(c.created_at),
                        "updated_at": dt(c.updated_at),
                    }
                    for c in categories
                ],
                "images": [
                    {
                        "id": i.id,
                        "name": i.name,
                        "thumb": i.thumb,
                        "tile_sources": i.tile_sources,
                        "category_id": i.category_id,
                        "copyright": i.copyright,
                        "note": i.note,
                        "active": i.active,
                        "sort_order": i.sort_order,
                        "metadata": i.metadata_,
                        "created_at": dt(i.created_at),
                        "updated_at": dt(i.updated_at),
                    }
                    for i in images
                ],
                "users": [
                    {
                        "id": u.id,
                        "name": u.name,
                        "email": u.email,
                        # oidc_subject and password_hash are intentionally
                        # excluded — oidc_subject is PII (Azure AD object
                        # ID) and password_hash is a credential artifact.
                        # OIDC linkage is re-established automatically on
                        # next login via email-based matching (see
                        # routers/oidc.py callback).  Older exports that
                        # still contain these fields are accepted on import
                        # (the import path uses .get() with a None default).
                        "role": u.role,
                        "program_ids": [p.id for p in u.programs],
                        "last_access": dt(u.last_access),
                        "metadata": u.metadata_,
                        "created_at": dt(u.created_at),
                        "updated_at": dt(u.updated_at),
                    }
                    for u in users
                ],
                "source_images": [
                    {
                        "id": s.id,
                        "original_filename": s.original_filename,
                        "stored_path": s.stored_path,
                        "status": s.status,
                        "progress": s.progress,
                        "error_message": s.error_message,
                        "name": s.name,
                        "category_id": s.category_id,
                        "copyright": s.copyright,
                        "note": s.note,
                        "active": s.active,
                        "image_id": s.image_id,
                        "file_size": s.file_size,
                        "source_checksum": s.source_checksum,
                        "tile_settings_hash": s.tile_settings_hash,
                        "tiles_generated_at": dt(s.tiles_generated_at),
                        "created_at": dt(s.created_at),
                        "updated_at": dt(s.updated_at),
                    }
                    for s in source_images
                ],
                "changelog_entries": [
                    {
                        "id": entry.id,
                        "title": entry.title,
                        "body": entry.body,
                        "published_at": dt(entry.published_at),
                        "created_at": dt(entry.created_at),
                        "updated_at": dt(entry.updated_at),
                    }
                    for entry in changelog_entries
                ],
                "announcement": {
                    "message": ann.message if ann else "",
                    "enabled": ann.enabled if ann else False,
                    "created_at": dt(ann.created_at) if ann else None,
                    "updated_at": dt(ann.updated_at) if ann else None,
                },
            }

            # Write JSON to file
            await _update_task(session, task, log_line="Writing JSON file…", progress=85, check_cancelled=True)
            tasks_dir = _ensure_tasks_dir()
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            filename = f"hriv-export-{timestamp}.json"
            filepath = os.path.join(tasks_dir, filename)
            content = json.dumps(dump, indent=2)
            await asyncio.to_thread(_write_file, filepath, content)

            summary = (
                f"Exported {len(dump['programs'])} programs, "
                f"{len(dump['groups'])} groups, "
                f"{len(dump['categories'])} categories, "
                f"{len(dump['images'])} images, "
                f"{len(dump['users'])} users, "
                f"{len(dump['source_images'])} source images, "
                f"{len(dump['changelog_entries'])} changelog entries."
            )
            await _update_task(
                session, task,
                status="completed", progress=100,
                log_line=f"Export complete. {summary}",
                result_filename=filename,
                result_path=filepath,
                check_cancelled=True,
            )
            logger.info(
                "Background DB export completed",
                extra={"event": "admin_task.db_export_done", "task_id": task_id},
            )

        except TaskCancelled:
            logger.info(
                "Background DB export cancelled",
                extra={"event": "admin_task.db_export_cancelled", "task_id": task_id},
            )
            # Clean up result file if it was already written
            if filepath and os.path.exists(filepath):
                try:
                    os.unlink(filepath)
                except OSError:
                    pass
            await session.refresh(task)
            await _update_task(
                session, task,
                status="cancelled",
                log_line="Task cancelled.",
            )

        except Exception as exc:
            span = trace.get_current_span()
            span.record_exception(exc)
            span.set_status(StatusCode.ERROR, str(exc))
            logger.exception(
                "Background DB export failed",
                extra={"event": "admin_task.db_export_failed", "task_id": task_id},
            )
            await session.rollback()
            await session.refresh(task)
            await _update_task(
                session, task,
                status="failed", progress=0,
                log_line=f"ERROR: {exc}",
                error_message=str(exc),
            )


def _write_file(path: str, content: str) -> None:
    with open(path, "w") as f:
        f.write(content)


# ── Database Import ────────────────────────────────────────


async def run_db_import(task_id: int) -> None:
    """Import a previously exported JSON dump in the background.

    Uses two separate database sessions:
    - ``status_session``: for AdminTask progress updates (committed freely)
    - ``data_session``: for the actual import data (committed only once at the end)
    This ensures the import is atomic — a mid-import failure rolls back all data
    changes without losing task status visibility.
    """
    session_factory = get_async_session()

    # Status session — used only for AdminTask updates, committed freely
    async with session_factory() as status_session:
        task = await status_session.get(AdminTask, task_id)
        if task is None:
            logger.error("AdminTask %d not found", task_id)
            return

        input_path = task.input_path

        # Data session — used for all import DML, committed once at the end
        async with session_factory() as data_session:
            try:
                await _update_task(
                    status_session, task,
                    status="running", progress=0,
                    log_line="Starting database import…",
                    check_cancelled=True,
                )

                # Read and validate JSON
                await _update_task(status_session, task, log_line="Reading JSON file…", progress=5, check_cancelled=True)
                raw = await asyncio.to_thread(_read_file, input_path)
                dump = json.loads(raw)

                if not isinstance(dump, dict):
                    raise ValueError("Expected a JSON object")
                for key in ("categories", "images", "users"):
                    if key not in dump:
                        raise ValueError(f"Missing required key: {key}")

                # Clear existing data in dependency order
                await _update_task(status_session, task, log_line="Clearing existing data…", progress=10)

                # Detach this task's created_by FK *via status_session*
                # before deleting users.  DELETE FROM users cascades
                # ON DELETE SET NULL to admin_tasks.created_by, which would
                # lock THIS task's row inside data_session.  Because both
                # sessions run in the same coroutine, status_session could
                # never acquire the same row lock to commit progress
                # updates — a self-deadlock.  By NULLing only the current
                # task's created_by through status_session (which commits
                # immediately), the FK reference is gone before
                # data_session touches users.  Other tasks' created_by
                # values are left intact — they will be SET NULL by the
                # CASCADE inside data_session (and restored on rollback).
                await status_session.execute(
                    text("UPDATE admin_tasks SET created_by = NULL WHERE id = :tid"),
                    {"tid": task_id},
                )
                await status_session.commit()

                await data_session.execute(text("DELETE FROM source_images"))
                await data_session.execute(text("DELETE FROM images"))
                await data_session.execute(text("DELETE FROM category_groups"))
                await data_session.execute(text("DELETE FROM category_programs"))
                await data_session.execute(text("DELETE FROM categories"))
                await data_session.execute(text("DELETE FROM group_members"))
                await data_session.execute(text("DELETE FROM group_instructors"))
                await data_session.execute(text("DELETE FROM groups"))
                await data_session.execute(text("DELETE FROM user_programs"))
                await data_session.execute(text("DELETE FROM users"))
                await data_session.execute(text("DELETE FROM changelog_entries"))
                await data_session.execute(text("DELETE FROM announcements"))
                await data_session.execute(text("DELETE FROM programs"))
                # The restore rewrites category/image sort_order wholesale, so
                # invalidate every tile-order revision: clients holding a
                # pre-restore revision must get a 409 from PUT /api/tile-order
                # instead of silently overwriting the restored order.
                await data_session.execute(
                    text(
                        "UPDATE tile_order_revisions "
                        "SET revision = revision + 1, updated_at = now()"
                    )
                )

                # Import programs
                await _update_task(status_session, task, log_line="Importing programs…", progress=15, check_cancelled=True)
                for p in dump.get("programs", []):
                    program = Program(
                        id=p["id"],
                        name=p["name"],
                        oidc_group=p.get("oidc_group"),
                        created_at=_parse_dt(p.get("created_at")),
                        updated_at=_parse_dt(p.get("updated_at")),
                    )
                    data_session.add(program)
                await data_session.flush()

                # Import users
                await _update_task(status_session, task, log_line="Importing users…", progress=25)
                for u in dump["users"]:
                    user = User(
                        id=u["id"],
                        name=u["name"],
                        email=u["email"].lower(),
                        password_hash=u.get("password_hash"),
                        oidc_subject=u.get("oidc_subject"),
                        role=u.get("role", "student"),
                        last_access=_parse_dt(u.get("last_access")),
                        metadata_=u.get("metadata", {}),
                        created_at=_parse_dt(u.get("created_at")),
                        updated_at=_parse_dt(u.get("updated_at")),
                    )
                    # M2M program associations (new format: program_ids list;
                    # old format: scalar program_id — auto-upgrade)
                    prog_ids = u.get("program_ids", [])
                    if not prog_ids and u.get("program_id") is not None:
                        prog_ids = [u["program_id"]]
                    if prog_ids:
                        progs = (await data_session.execute(
                            select(Program).where(Program.id.in_(prog_ids))
                        )).scalars().all()
                        user.programs = list(progs)
                    data_session.add(user)
                await data_session.flush()

                # Import groups (after users: members/instructors/creator are users)
                await _update_task(status_session, task, log_line="Importing groups…", progress=30)
                for g in dump.get("groups", []):
                    group = Group(
                        id=g["id"],
                        name=g["name"],
                        description=g.get("description"),
                        created_by_user_id=g.get("created_by_user_id"),
                        created_at=_parse_dt(g.get("created_at")),
                        updated_at=_parse_dt(g.get("updated_at")),
                    )
                    member_ids = g.get("member_ids", [])
                    if member_ids:
                        members = (await data_session.execute(
                            select(User).where(User.id.in_(member_ids))
                        )).scalars().all()
                        group.members = list(members)
                    instructor_ids = g.get("instructor_ids", [])
                    if instructor_ids:
                        instructors = (await data_session.execute(
                            select(User).where(User.id.in_(instructor_ids))
                        )).scalars().all()
                        group.instructors = list(instructors)
                    data_session.add(group)
                await data_session.flush()

                # Import categories (topologically sorted)
                await _update_task(status_session, task, log_line="Importing categories…", progress=35)
                inserted_ids: set[int] = set()
                remaining = list(dump["categories"])
                while remaining:
                    progress_made = False
                    next_remaining = []
                    for c in remaining:
                        pid = c.get("parent_id")
                        if pid is None or pid in inserted_ids:
                            cat = Category(
                                id=c["id"],
                                label=c["label"],
                                parent_id=pid,
                                status=c.get("status", "active"),
                                sort_order=c.get("sort_order", 0),
                                metadata_=c.get("metadata", {}),
                                created_at=_parse_dt(c.get("created_at")),
                                updated_at=_parse_dt(c.get("updated_at")),
                            )
                            # M2M program associations (new format:
                            # program_ids list; old format: program string)
                            prog_ids = c.get("program_ids", [])
                            if not prog_ids and c.get("program"):
                                # Backward compat: resolve old string name
                                name_result = await data_session.execute(
                                    select(Program).where(
                                        Program.name == c["program"]
                                    )
                                )
                                found = name_result.scalars().first()
                                if found:
                                    prog_ids = [found.id]
                            if prog_ids:
                                progs = (await data_session.execute(
                                    select(Program).where(
                                        Program.id.in_(prog_ids)
                                    )
                                )).scalars().all()
                                cat.programs = list(progs)
                            group_ids = c.get("group_ids", [])
                            if group_ids:
                                grps = (await data_session.execute(
                                    select(Group).where(
                                        Group.id.in_(group_ids)
                                    )
                                )).scalars().all()
                                cat.groups = list(grps)
                            data_session.add(cat)
                            inserted_ids.add(c["id"])
                            progress_made = True
                        else:
                            next_remaining.append(c)
                    if not progress_made:
                        raise ValueError("Circular or broken parent_id references in categories")
                    remaining = next_remaining
                    await data_session.flush()

                await data_session.flush()

                # Import images
                await _update_task(status_session, task, log_line="Importing images…", progress=50, check_cancelled=True)
                for i in dump["images"]:
                    img = Image(
                        id=i["id"],
                        name=i.get("name") or i.get("label", ""),
                        thumb=i["thumb"],
                        tile_sources=i["tile_sources"],
                        category_id=i.get("category_id"),
                        copyright=i.get("copyright"),
                        note=i.get("note") or i.get("origin"),
                        active=i.get("active", True),
                        sort_order=i.get("sort_order", 0),
                        metadata_=i.get("metadata", {}),
                        created_at=_parse_dt(i.get("created_at")),
                        updated_at=_parse_dt(i.get("updated_at")),
                    )
                    data_session.add(img)
                await data_session.flush()

                # Drop revision rows for scopes that no longer exist after the
                # restore. The ID sequence is reset to the restored MAX(id), so
                # a later category could be assigned an ID that still has a
                # leftover revision row (benign for CAS, but avoid the orphan).
                await data_session.execute(
                    text(
                        "DELETE FROM tile_order_revisions WHERE scope_key <> 0 "
                        "AND scope_key NOT IN (SELECT id FROM categories)"
                    )
                )
                # Revision rows are created lazily, so the wholesale bump above
                # misses scopes that have never been written through
                # PUT /api/tile-order (clients read the implicit
                # INITIAL_SCOPE_REVISION for those). Materialize every restored
                # scope one revision higher so an implicit pre-restore revision
                # can never pass the CAS check.
                await data_session.execute(
                    text(
                        "INSERT INTO tile_order_revisions (scope_key, revision) "
                        "SELECT s.scope_key, CAST(:rev AS INTEGER) FROM "
                        "(SELECT 0 AS scope_key UNION SELECT id FROM categories) s "
                        "ON CONFLICT (scope_key) DO NOTHING"
                    ),
                    {"rev": INITIAL_SCOPE_REVISION + 1},
                )

                # Import source images
                await _update_task(status_session, task, log_line="Importing source images…", progress=65)
                for s in dump.get("source_images", []):
                    src = SourceImage(
                        id=s["id"],
                        original_filename=s["original_filename"],
                        stored_path=s["stored_path"],
                        status=s.get("status", "pending"),
                        progress=s.get("progress", 0),
                        error_message=s.get("error_message"),
                        name=s.get("name"),
                        category_id=s.get("category_id"),
                        copyright=s.get("copyright"),
                        note=s.get("note"),
                        active=s.get("active", True),
                        image_id=s.get("image_id"),
                        file_size=s.get("file_size"),
                        source_checksum=s.get("source_checksum"),
                        tile_settings_hash=s.get("tile_settings_hash"),
                        tiles_generated_at=_parse_dt(s.get("tiles_generated_at")),
                        created_at=_parse_dt(s.get("created_at")),
                        updated_at=_parse_dt(s.get("updated_at")),
                    )
                    data_session.add(src)
                await data_session.flush()

                # Import changelog entries
                await _update_task(status_session, task, log_line="Importing changelog entries…", progress=70)
                for entry in dump.get("changelog_entries", []):
                    changelog_entry = ChangelogEntry(
                        id=entry["id"],
                        title=entry["title"],
                        body=entry["body"],
                        published_at=_parse_dt(entry.get("published_at")),
                        created_at=_parse_dt(entry.get("created_at")),
                        updated_at=_parse_dt(entry.get("updated_at")),
                    )
                    data_session.add(changelog_entry)
                await data_session.flush()

                # Import announcement
                await _update_task(status_session, task, log_line="Importing announcement…", progress=75, check_cancelled=True)
                ann_data = dump.get("announcement")
                if ann_data:
                    ann = Announcement(
                        id=1,
                        message=ann_data.get("message", ""),
                        enabled=ann_data.get("enabled", False),
                        created_at=_parse_dt(ann_data.get("created_at")),
                        updated_at=_parse_dt(ann_data.get("updated_at")),
                    )
                    data_session.add(ann)
                else:
                    data_session.add(Announcement(id=1, message="", enabled=False))
                await data_session.flush()

                # Reset sequences
                await _update_task(status_session, task, log_line="Resetting sequences…", progress=85)
                for tbl in ("programs", "groups", "categories", "images", "users", "announcements", "changelog_entries", "source_images"):
                    await data_session.execute(
                        text(
                            f"SELECT setval('{tbl}_id_seq', "
                            f"GREATEST(COALESCE((SELECT MAX(id) FROM {tbl}), 1), 1), "
                            f"EXISTS(SELECT 1 FROM {tbl}))"
                        )
                    )

                # Single atomic commit for all data changes
                await bump_browse_revision(data_session)
                await data_session.commit()

                summary = (
                    f"Imported {len(dump.get('programs', []))} programs, "
                    f"{len(dump.get('groups', []))} groups, "
                    f"{len(dump['categories'])} categories, "
                    f"{len(dump['images'])} images, "
                    f"{len(dump['users'])} users, "
                    f"{len(dump.get('source_images', []))} source images, "
                    f"{len(dump.get('changelog_entries', []))} changelog entries."
                )
                # Do NOT check_cancelled here — data_session.commit() already
                # succeeded so the import data is permanently persisted.
                # Marking the task "cancelled" at this point would be
                # misleading ("All changes rolled back" when they weren't).
                await _update_task(
                    status_session, task,
                    status="completed", progress=100,
                    log_line=f"Import complete. {summary}",
                )
                logger.info(
                    "Background DB import completed",
                    extra={"event": "admin_task.db_import_done", "task_id": task_id},
                )

            except TaskCancelled:
                await data_session.rollback()
                logger.info(
                    "Background DB import cancelled",
                    extra={"event": "admin_task.db_import_cancelled", "task_id": task_id},
                )
                await status_session.refresh(task)
                await _update_task(
                    status_session, task,
                    status="cancelled",
                    log_line="Task cancelled. Data changes rolled back.",
                )

            except Exception as exc:
                span = trace.get_current_span()
                span.record_exception(exc)
                span.set_status(StatusCode.ERROR, str(exc))
                await data_session.rollback()
                logger.exception(
                    "Background DB import failed",
                    extra={"event": "admin_task.db_import_failed", "task_id": task_id},
                )
                # Refresh task from status_session (not affected by data rollback)
                await status_session.refresh(task)
                await _update_task(
                    status_session, task,
                    status="failed", progress=0,
                    log_line=f"ERROR: {exc}",
                    error_message=str(exc),
                )
            finally:
                # Clean up the uploaded input file
                if input_path:
                    try:
                        os.unlink(input_path)
                    except OSError:
                        pass


def _read_file(path: str | None) -> str:
    if not path:
        raise ValueError("No input file path specified")
    with open(path, "r") as f:
        return f.read()


# ── Tile Rebuild (issue #735) ──────────────────────────────


async def run_rebuild_tiles(task_id: int) -> None:
    """Rebuild missing or stale tile sets from preserved source images.

    The rebuild parameters (``scope`` and optional ``image_ids``) are read from
    the small JSON file referenced by ``AdminTask.input_path``. Each source
    image is regenerated independently and committed as it completes, so the
    operation is safe to rerun: a rerun simply skips tile sets that are already
    current (unless ``scope == "all"``). A per-image failure is logged and the
    batch continues; the task only ends in ``failed`` for a fatal setup error
    (e.g. unreadable parameters), never because an individual image failed.
    """
    # Imported lazily so the heavy pyvips import in ``processing`` is not paid
    # at module import time (and so tests can patch ``app.processing`` symbols).
    from . import processing

    async with get_async_session()() as session:
        task = await session.get(AdminTask, task_id)
        if task is None:
            logger.error("AdminTask %d not found", task_id)
            return

        input_path = task.input_path
        failures = 0
        rebuilt = 0
        current_source_id: int | None = None
        try:
            await _update_task(
                session, task,
                status="running", progress=0,
                log_line="Starting tile rebuild…",
                check_cancelled=True,
            )

            # Parse rebuild parameters (best-effort: default to missing+stale).
            scope = processing.REBUILD_SCOPE_MISSING_STALE
            image_ids: list[int] | None = None
            if input_path and os.path.exists(input_path):
                raw = await asyncio.to_thread(_read_file, input_path)
                params = json.loads(raw)
                if not isinstance(params, dict):
                    raise ValueError("Expected a JSON object for rebuild parameters")
                scope = params.get("scope", scope)
                ids = params.get("image_ids")
                # Preserve an explicit (possibly empty) list so it narrows the
                # population; only a missing/null value means "all images".
                if ids is not None:
                    image_ids = [int(i) for i in ids]
            if scope not in processing.REBUILD_SCOPES:
                raise ValueError(f"Unknown rebuild scope: {scope!r}")

            await _update_task(
                session, task,
                log_line=(
                    f"Scope: {scope}"
                    + (
                        f"; image_ids: {image_ids}"
                        if image_ids is not None
                        else ""
                    )
                ),
                progress=5,
            )

            targets = await processing.select_rebuild_targets(
                session, scope=scope, image_ids=image_ids,
            )
            total = len(targets)

            if total == 0:
                await _update_task(
                    session, task,
                    status="completed", progress=100,
                    log_line="Nothing to rebuild — all targeted tile sets are current.",
                )
                logger.info(
                    "Tile rebuild found nothing to do",
                    extra={"event": "admin_task.rebuild_tiles_noop", "task_id": task_id},
                )
                return

            await _update_task(
                session, task,
                log_line=f"Rebuilding {total} tile set(s)…",
                progress=10,
            )

            # Capture target ids up front: a per-image ``session.rollback()``
            # expires *every* ORM object in the session's identity map (this
            # happens regardless of ``expire_on_commit``), so we must not depend
            # on the original ``SourceImage`` instances surviving across
            # iterations — accessing an expired attribute under AsyncSession
            # would raise ``MissingGreenlet``. Re-fetching by id each iteration
            # keeps per-image isolation intact and also handles a source image
            # that is deleted while the batch is running.
            target_ids = [src.id for src in targets]

            for index, src_id in enumerate(target_ids):
                current_source_id = src_id
                # Observe cancellation requests between images so a long batch
                # can be stopped without corrupting an in-flight regeneration.
                await _update_task(
                    session, task,
                    log_line=f"[{index + 1}/{total}] Rebuilding source #{src_id}…",
                    check_cancelled=True,
                )
                try:
                    src = await session.get(SourceImage, src_id)
                    if src is None:
                        failures += 1
                        await _update_task(
                            session, task,
                            log_line=(
                                f"[{index + 1}/{total}] Skipped source #{src_id}: "
                                "no longer exists."
                            ),
                        )
                    else:
                        await processing.rebuild_source_image_tiles(session, src)
                        rebuilt += 1
                        await _update_task(
                            session, task,
                            log_line=f"[{index + 1}/{total}] Rebuilt source #{src_id}.",
                        )
                except TaskCancelled:
                    raise
                except Exception as exc:  # noqa: BLE001 — per-image isolation
                    failures += 1
                    # The per-image commit never ran, so roll back any partial
                    # session state before continuing to the next image.
                    await session.rollback()
                    refreshed = await session.get(AdminTask, task_id)
                    if refreshed is not None:
                        task = refreshed
                    logger.warning(
                        "Tile rebuild failed for one source image",
                        extra={
                            "event": "admin_task.rebuild_tiles_image_failed",
                            "task_id": task_id,
                            "source_image_id": src_id,
                        },
                    )
                    await _update_task(
                        session, task,
                        log_line=(
                            f"[{index + 1}/{total}] ERROR rebuilding source "
                            f"#{src_id}: {exc}"
                        ),
                    )

                # Progress spans the 10–100 % band across the batch.
                progress = 10 + int((index + 1) / total * 90)
                await _update_task(session, task, progress=progress)
                current_source_id = None

            summary = (
                f"Rebuilt {rebuilt} of {total} tile set(s); {failures} failed."
            )
            await _update_task(
                session, task,
                status="completed", progress=100,
                log_line=f"Tile rebuild complete. {summary}",
            )
            logger.info(
                "Background tile rebuild completed",
                extra={
                    "event": "admin_task.rebuild_tiles_done",
                    "task_id": task_id,
                    "rebuilt": rebuilt,
                    "failed": failures,
                    "total": total,
                },
            )

        except TaskCancelled:
            logger.info(
                "Background tile rebuild cancelled",
                extra={"event": "admin_task.rebuild_tiles_cancelled", "task_id": task_id},
            )
            await session.rollback()
            refreshed = await session.get(AdminTask, task_id)
            if refreshed is not None:
                task = refreshed
            await _update_task(
                session, task,
                status="cancelled",
                log_line=(
                    f"Task cancelled. Rebuilt {rebuilt} tile set(s) before "
                    "cancellation; already-completed rebuilds are retained."
                ),
            )

        except asyncio.CancelledError as exc:
            span = trace.get_current_span()
            span.record_exception(exc)
            span.set_status(StatusCode.ERROR, "Background tile rebuild interrupted")
            logger.exception(
                "Background tile rebuild interrupted",
                extra={
                    "event": "admin_task.rebuild_tiles_interrupted",
                    "task_id": task_id,
                    "source_image_id": current_source_id,
                },
            )
            await session.rollback()
            refreshed = await session.get(AdminTask, task_id)
            if refreshed is not None:
                task = refreshed
            detail = (
                "Worker interrupted while processing source "
                f"#{current_source_id}."
                if current_source_id is not None
                else "Worker interrupted during tile rebuild."
            )
            await _update_task(
                session, task,
                status="failed",
                log_line=(
                    f"ERROR: {detail} Rebuilt {rebuilt} tile set(s) before "
                    "interruption; rerun the task to continue."
                ),
                error_message=detail,
            )
            raise

        except Exception as exc:
            span = trace.get_current_span()
            span.record_exception(exc)
            span.set_status(StatusCode.ERROR, str(exc))
            logger.exception(
                "Background tile rebuild failed",
                extra={"event": "admin_task.rebuild_tiles_failed", "task_id": task_id},
            )
            await session.rollback()
            refreshed = await session.get(AdminTask, task_id)
            if refreshed is not None:
                task = refreshed
            await _update_task(
                session, task,
                status="failed", progress=0,
                log_line=f"ERROR: {exc}",
                error_message=str(exc),
            )
        finally:
            # Clean up the small parameters file once the task is terminal. A
            # cleanup failure is non-fatal — the task result is unaffected — but
            # is logged so an orphaned file can be diagnosed.
            if input_path and os.path.exists(input_path):
                try:
                    os.unlink(input_path)
                except OSError:
                    logger.debug(
                        "Failed to remove rebuild params file %s",
                        input_path,
                        exc_info=True,
                    )


async def _queue_rebuild_tiles_after_import(
    import_task: AdminTask,
    bg: BackgroundTasks | None = None,
) -> str:
    """Queue a ``rebuild_tiles`` task after a successful filesystem import.

    This makes the import-to-tile-generation flow end-to-end. The rebuild is
    idempotent: it skips already-current tiles unless ``scope == "all"``, so it
    is safe to re-run manually.
    """
    # Always write the rebuild params file under the canonical admin_tasks
    # directory so the location is predictable and independent of the import
    # archive path. The worker deletes the file after it consumes it.
    tasks_dir = _ensure_tasks_dir()
    params_path = os.path.join(
        tasks_dir,
        f"rebuild-after-import-{uuid.uuid4().hex}.json",
    )
    try:
        with open(params_path, "w", encoding="utf-8") as f:
            json.dump({"scope": "missing_stale", "image_ids": None}, f)
    except Exception:
        logger.warning(
            "Failed to write rebuild params file %s",
            params_path,
            exc_info=True,
        )
        return (
            "Could not queue automatic tile rebuild (failed to write params). "
            "Run Rebuild Tiles manually if needed."
        )

    async with get_async_session()() as rebuild_session:
        try:
            existing_result = await rebuild_session.execute(
                select(AdminTask).where(
                    AdminTask.task_type == "rebuild_tiles",
                    AdminTask.status.in_(ACTIVE_TASK_STATUSES),
                )
            )
            existing = existing_result.scalars().first()
        except Exception:
            logger.warning("Failed to check for active rebuild task", exc_info=True)
            existing = None

        if isinstance(existing, AdminTask):
            try:
                os.unlink(params_path)
            except OSError:
                logger.debug(
                    "Could not remove rebuild params file %s", params_path, exc_info=True
                )
            return (
                f"A rebuild-tiles task is already active (#{existing.id}). "
                "The automatic rebuild was skipped; run Rebuild Tiles manually after it completes if needed."
            )

        try:
            result = await rebuild_session.execute(
                insert(AdminTask).values(
                    task_type="rebuild_tiles",
                    status="pending",
                    input_path=params_path,
                    created_by=getattr(import_task, "created_by", None),
                    log="Queued for automatic rebuild after filesystem import.\n",
                ).returning(AdminTask.id)
            )
            # Read the RETURNING value before committing. SQLAlchemy buffers the
            # result, but consuming it here is clearer and keeps the
            # inserted_primary_key fallback for dialects that don't support RETURNING.
            task_id = result.scalar()
            if task_id is None:
                try:
                    task_id = result.inserted_primary_key[0]
                except Exception:
                    logger.warning("Rebuild task id not set after insert")
                    try:
                        os.unlink(params_path)
                    except OSError:
                        logger.debug(
                            "Could not remove rebuild params file %s", params_path, exc_info=True
                        )
                    return "Could not queue automatic tile rebuild (task id missing)."
            await rebuild_session.commit()
        except Exception:
            logger.warning("Failed to create rebuild task", exc_info=True)
            try:
                os.unlink(params_path)
            except OSError:
                logger.debug(
                    "Could not remove rebuild params file %s", params_path, exc_info=True
                )
            return (
                "Could not queue automatic tile rebuild. "
                "Run Rebuild Tiles manually if needed."
            )

        try:
            enqueue_result = await enqueue_admin_task(task_id, "rebuild_tiles")
        except TaskQueueUnavailableError as exc:
            logger.warning(
                "Failed to enqueue rebuild task %d: %s",
                task_id,
                exc,
            )
            enqueue_result = None
        except Exception:
            logger.warning("Failed to enqueue rebuild task %d", task_id, exc_info=True)
            enqueue_result = None

        if enqueue_result is not None and enqueue_result.queued:
            return (
                f"Tile rebuild task #{task_id} was queued automatically. "
                "Run Rebuild Tiles manually if you need to re-run it."
            )

        # In local mode, schedule the rebuild in-process when a BackgroundTasks
        # object is available. Required mode has no local fallback and records
        # the automatic rebuild task as failed below.
        if bg is not None and settings.task_execution_mode == "local":
            bg.add_task(run_rebuild_tiles, task_id)
            return (
                f"Tile rebuild task #{task_id} was scheduled to run automatically. "
                "Run Rebuild Tiles manually if you need to re-run it."
            )

        try:
            await rebuild_session.execute(
                update(AdminTask)
                .where(AdminTask.id == task_id)
                .values(
                    status="failed",
                    error_message=(
                        "Could not enqueue automatic tile rebuild; "
                        "run Rebuild Tiles manually."
                    ),
                    updated_at=func.now(),
                )
            )
            await rebuild_session.commit()
        except Exception:
            logger.warning("Failed to mark rebuild task %d as failed", task_id, exc_info=True)
        try:
            os.unlink(params_path)
        except OSError:
            logger.debug(
                "Could not remove rebuild params file %s", params_path, exc_info=True
            )
        return (
            "Could not queue automatic tile rebuild. "
            "Run Rebuild Tiles manually if needed."
        )


# ── Filesystem Export ──────────────────────────────────────


def _iter_export_entries(
    data_dir: str,
    *,
    cancel_event: threading.Event | None = None,
) -> Iterator[tuple[str, str, int, bool]]:
    """Yield archive entries for the filesystem export.

    The traversal excludes the generated tile tree under ``tiles/`` and
    the ``admin_tasks/`` directory so the UI export stays source-only and
    does not duplicate prior export artefacts.

    Each yielded tuple is ``(arcname, absolute_path, size_bytes, is_dir)``.
    ``size_bytes`` is ``0`` for directory entries.  If *cancel_event* is set
    while walking, :class:`TaskCancelled` is raised promptly.
    """
    tasks_basename = os.path.basename(_TASKS_DIR)
    staging_basename = os.path.basename(_IMPORT_STAGING_DIR)
    tiles_basename = os.path.basename(os.path.normpath(settings.tiles_dir))

    def _check_cancel() -> None:
        if cancel_event is not None and cancel_event.is_set():
            raise TaskCancelled("Task cancelled by admin")

    for dirpath, dirnames, filenames in os.walk(data_dir):
        _check_cancel()

        rel = os.path.relpath(dirpath, data_dir)
        top = rel.split(os.sep)[0]
        if rel != "." and top in (tasks_basename, staging_basename, tiles_basename):
            dirnames.clear()
            continue

        # Prune admin_tasks, staging, and tiles from child dirs so os.walk skips them.
        for excluded in (tasks_basename, staging_basename, tiles_basename):
            if excluded in dirnames:
                dirnames.remove(excluded)

        arcname = os.path.join("data", rel) if rel != "." else "data"
        yield arcname, dirpath, 0, True

        for fname in filenames:
            _check_cancel()
            fpath = os.path.join(dirpath, fname)
            arc_fpath = os.path.join(arcname, fname)
            try:
                size = os.path.getsize(fpath)
            except OSError:
                # Symlink to missing target, race with deletion, etc.
                # Skip silently — the archive will either include a
                # zero-byte entry or skip it on its own.
                size = 0
            yield arc_fpath, fpath, size, False


def _iter_export_files(data_dir: str) -> Iterator[tuple[str, int]]:
    """Yield ``(absolute_path, size_bytes)`` for exported files only."""
    for _arcname, path, size, is_dir in _iter_export_entries(data_dir):
        if not is_dir:
            yield path, size


def _scan_export_files(
    data_dir: str,
    *,
    cancel_event: threading.Event | None = None,
) -> tuple[int, int]:
    """Count the exportable files and their total size in bytes."""
    file_count = 0
    total_bytes = 0
    for _arcname, _path, size, is_dir in _iter_export_entries(
        data_dir,
        cancel_event=cancel_event,
    ):
        if not is_dir:
            file_count += 1
            total_bytes += size
    return file_count, total_bytes


def _create_tar_file(
    data_dir: str,
    dest: str,
    *,
    cancel_event: threading.Event | None = None,
    on_entry: Callable[[str, int], None] | None = None,
) -> None:
    """Write a tar.gz archive of *data_dir* to *dest*.

    The ``admin_tasks`` subdirectory is excluded so that previously
    generated export artefacts (JSON dumps, tar.gz archives) do not
    bloat successive filesystem exports, and the generated ``tiles``
    tree is excluded so exports stay source-only (tiles are rebuilt
    from source images on import via the Rebuild Tiles task).

    If *cancel_event* is set while walking the tree, :class:`TaskCancelled`
    is raised so the caller can abort promptly.  *on_entry* is called
    as ``on_entry(arcname, size_bytes)`` for every entry added, giving
    callers both a streaming activity feed and byte counts suitable for
    progress estimation.  ``size_bytes`` is ``0`` for directory entries.
    """
    pigz_path = shutil.which("pigz")
    if pigz_path is None:
        with tarfile.open(dest, mode="w:gz") as tar:
            manifest_size = _add_manifest_member(tar)
            if on_entry is not None:
                on_entry(FILES_EXPORT_MANIFEST_NAME, manifest_size)
            for arcname, path, size, is_dir in _iter_export_entries(
                data_dir,
                cancel_event=cancel_event,
            ):
                if is_dir:
                    tar.add(path, arcname=arcname, recursive=False)
                    if on_entry is not None:
                        on_entry(arcname + "/", 0)
                else:
                    tar.add(path, arcname=arcname)
                    if on_entry is not None:
                        on_entry(arcname, size)
        return

    archive_fh = open(dest, "wb")
    try:
        pigz_args = [pigz_path, "-c"]
        pigz_threads = settings.export_pigz_threads
        if isinstance(pigz_threads, int) and pigz_threads > 0:
            pigz_args.extend(["-p", str(pigz_threads)])
        proc = subprocess.Popen(
            pigz_args,
            stdin=subprocess.PIPE,
            stdout=archive_fh,
            stderr=subprocess.PIPE,
        )
    except Exception:
        archive_fh.close()
        try:
            os.unlink(dest)
        except OSError:
            logger.debug("Failed to remove incomplete archive %s", dest, exc_info=True)
        raise
    success = False
    try:
        assert proc.stdin is not None
        with tarfile.open(fileobj=proc.stdin, mode="w|") as tar:
            manifest_size = _add_manifest_member(tar)
            if on_entry is not None:
                on_entry(FILES_EXPORT_MANIFEST_NAME, manifest_size)
            for arcname, path, size, is_dir in _iter_export_entries(
                data_dir,
                cancel_event=cancel_event,
            ):
                if is_dir:
                    tar.add(path, arcname=arcname, recursive=False)
                    if on_entry is not None:
                        on_entry(arcname + "/", 0)
                else:
                    tar.add(path, arcname=arcname)
                    if on_entry is not None:
                        on_entry(arcname, size)

        proc.stdin.close()
        returncode = proc.wait()
        if returncode != 0:
            stderr = proc.stderr.read().decode("utf-8", errors="replace").strip() if proc.stderr is not None else ""
            raise RuntimeError(
                f"pigz failed with exit code {returncode}"
                + (f": {stderr}" if stderr else "")
            )
        success = True
    except Exception:
        if proc.stdin is not None and not proc.stdin.closed:
            proc.stdin.close()
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        raise
    finally:
        if proc.stderr is not None:
            proc.stderr.close()
        archive_fh.close()
        if not success:
            try:
                os.unlink(dest)
            except OSError:
                pass


_LOG_FLUSH_INTERVAL = 2  # seconds between verbose-log DB flushes

_T = TypeVar("_T")


async def _run_with_cancel_poll(
    worker_task: "asyncio.Task[_T]",
    poll_task: "asyncio.Task[None]",
    *,
    cancel_event: threading.Event,
    grace_timeout_log: str,
    shutdown_grace: float = 5.0,
    return_result_on_cancel: bool = False,
) -> _T:
    """Run a cancellable worker future alongside a status cancel-poller.

    Whichever finishes first wins. If the worker finishes first, the poller
    is cancelled and the worker's result is returned. If the poller raises
    (e.g. a DB error), the worker is signalled via *cancel_event*, given
    *shutdown_grace* seconds to settle, and the poller's exception is
    re-raised. If the poller returns normally (cancellation detected), the
    worker is given the same grace period; a worker that finished in time
    either has its result returned (``return_result_on_cancel=True``) or its
    exceptions propagated before ``TaskCancelled`` is raised.
    """
    try:
        done, _pending = await asyncio.wait(
            [worker_task, poll_task], return_when=asyncio.FIRST_COMPLETED,
        )
        if worker_task in done:
            # The poller may have finished in the same wait cycle; retrieve
            # its exception (if any) so it is not silently dropped.
            if poll_task in done and not poll_task.cancelled():
                stray_poll_exc = poll_task.exception()
                if stray_poll_exc is not None:
                    logger.warning(
                        "Cancel poller failed while the worker was finishing",
                        exc_info=stray_poll_exc,
                    )
            else:
                poll_task.cancel()
            return worker_task.result()
        poll_exc = poll_task.exception() if poll_task.done() else None
        if poll_exc is not None:
            cancel_event.set()  # stop the worker thread
            # Plain asyncio.wait does not cancel the task on timeout (unlike
            # wait_for), so a slow worker is left to be cancelled explicitly.
            await asyncio.wait([worker_task], timeout=shutdown_grace)
            if worker_task.done() and not worker_task.cancelled():
                worker_exc = worker_task.exception()
                if worker_exc is not None:
                    logger.warning(
                        "Worker failed while shutting down after a cancel-"
                        "poller error",
                        exc_info=worker_exc,
                    )
            elif not worker_task.done():
                logger.debug(grace_timeout_log)
                worker_task.cancel()
            raise poll_exc
        # Poll returned normally → cancellation detected. The poller sets
        # the event itself, but set it here too so the worker is guaranteed
        # to be signalled, then wait briefly for it to notice.
        cancel_event.set()
        await asyncio.wait([worker_task], timeout=shutdown_grace)
        if worker_task.done() and not worker_task.cancelled():
            if return_result_on_cancel:
                return worker_task.result()
            worker_task.result()  # propagate worker exceptions
        elif not worker_task.done():
            logger.debug(grace_timeout_log)
            worker_task.cancel()
        raise TaskCancelled("Task cancelled by admin")
    finally:
        if not worker_task.done():
            worker_task.cancel()
        if not poll_task.done():
            poll_task.cancel()
        # The poller shares the caller's AsyncSession; make sure it has fully
        # stopped before the caller resumes issuing its own queries.
        await asyncio.gather(poll_task, return_exceptions=True)


async def run_files_export(task_id: int) -> None:
    """Create a tar.gz archive of the data directory in the background."""
    async with get_async_session()() as session:
        task = await session.get(AdminTask, task_id)
        if task is None:
            logger.error("AdminTask %d not found", task_id)
            return

        filepath: str | None = None
        tmp_name: str | None = None
        try:
            await _update_task(
                session, task,
                status="running", progress=0,
                log_line="Starting filesystem export…",
                check_cancelled=True,
            )

            data_dir = Path(settings.tiles_dir).parent  # /data

            if not data_dir.exists() or not any(data_dir.iterdir()):
                raise ValueError("Data directory is empty or missing — nothing to export")

            await _update_task(
                session, task, progress=10,
                log_line=f"Archiving data directory: {data_dir}",
                check_cancelled=True,
            )

            tasks_dir = _ensure_tasks_dir()
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            filename = f"hriv-files-{timestamp}.tar.gz"
            filepath = os.path.join(tasks_dir, filename)

            # Stage the archive inside the tasks dir on the data volume:
            # the export walk excludes _TASKS_DIR, so the archive never
            # includes itself, and staging on the PVC keeps the (multi-GB)
            # archive off the pod's bounded ephemeral storage.  The hidden
            # prefix keeps partial archives out of retained-artifact
            # listings until the final rename.
            tmp = tempfile.NamedTemporaryFile(
                suffix=".tar.gz",
                prefix=".export-staging-",
                dir=tasks_dir,
                delete=False,
            )
            tmp.close()
            tmp_name = tmp.name

            cancel_event = threading.Event()

            async def _poll_cancel_only() -> None:
                while True:
                    await asyncio.sleep(_LOG_FLUSH_INTERVAL)
                    await session.refresh(task, attribute_names=["status"])
                    if task.status in ("cancelling", "cancelled"):
                        cancel_event.set()
                        return

            # Scan the export tree first so the UI can report the total
            # source-only payload size before archiving begins.  The scan
            # runs in a worker thread and watches the same cancellation
            # event as the tar writer so a cancel request during the scan
            # is observed promptly instead of waiting for the archive
            # stage to start.
            await _update_task(
                session,
                task,
                progress=15,
                log_line=(
                    "Scanning source files (generated tiles and admin_tasks "
                    "are excluded)…"
                ),
                check_cancelled=True,
            )
            scan_task = asyncio.ensure_future(
                asyncio.to_thread(
                    _scan_export_files,
                    str(data_dir),
                    cancel_event=cancel_event,
                )
            )
            scan_poll_task = asyncio.ensure_future(_poll_cancel_only())
            file_count, total_bytes = await _run_with_cancel_poll(
                scan_task,
                scan_poll_task,
                cancel_event=cancel_event,
                grace_timeout_log=(
                    "Filesystem export scan did not finish within the "
                    "shutdown grace period; cancelling task"
                ),
                return_result_on_cancel=True,
            )

            total_mb = total_bytes / (1024 * 1024)
            await _update_task(
                session,
                task,
                progress=20,
                log_line=(
                    f"Scan complete: {file_count} source file(s), {total_mb:.1f} MB "
                    "to archive. Creating tar.gz archive…"
                ),
                check_cancelled=True,
            )

            # -- verbose archive with cancellation support --
            entry_queue: queue.Queue[tuple[str, int]] = queue.Queue()
            bytes_added = 0

            def _on_entry(arcname: str, size_bytes: int) -> None:
                entry_queue.put((arcname, size_bytes))

            # Progress is mapped across 20% → 95% during archiving;
            # the final 5% is reserved for the post-archive finalise
            # step (move to tasks_dir + commit).  If ``total_bytes`` is
            # zero (empty export) we hold progress at 20 to avoid a
            # divide-by-zero and let the completion step jump to 100.
            _ARCHIVE_PROGRESS_START = 20
            _ARCHIVE_PROGRESS_END = 95

            async def _flush_and_poll() -> None:
                """Flush queued entry names / progress and check for cancellation."""
                nonlocal bytes_added
                while True:
                    await asyncio.sleep(_LOG_FLUSH_INTERVAL)
                    entries: list[tuple[str, int]] = []
                    while not entry_queue.empty():
                        try:
                            entries.append(entry_queue.get_nowait())
                        except queue.Empty:
                            break
                    progress_update: int | None = None
                    if entries:
                        bytes_added += sum(sz for _name, sz in entries)
                        if total_bytes > 0:
                            span = _ARCHIVE_PROGRESS_END - _ARCHIVE_PROGRESS_START
                            progress_update = min(
                                _ARCHIVE_PROGRESS_END,
                                _ARCHIVE_PROGRESS_START + int(
                                    span * bytes_added / total_bytes
                                ),
                            )
                        batch = "\n".join(f"  adding {name}" for name, _ in entries)
                        await _update_task(
                            session, task,
                            log_line=batch,
                            progress=progress_update,
                        )
                    # Check DB for cancellation request.  Both
                    # ``cancelling`` (normal path) and ``cancelled``
                    # (force-cancel when a previous cancel got stuck)
                    # must trip the tar thread's cancel_event; otherwise
                    # the archive continues to completion and this poll
                    # loop spins forever waiting for it.
                    await session.refresh(task, attribute_names=["status"])
                    if task.status in ("cancelling", "cancelled"):
                        cancel_event.set()
                        return

            tar_task = asyncio.ensure_future(
                asyncio.to_thread(
                    _create_tar_file, str(data_dir), tmp_name,
                    cancel_event=cancel_event, on_entry=_on_entry,
                )
            )
            poll_task = asyncio.ensure_future(_flush_and_poll())

            try:
                await _run_with_cancel_poll(
                    tar_task,
                    poll_task,
                    cancel_event=cancel_event,
                    grace_timeout_log=(
                        "Timed out waiting for the filesystem export archive "
                        "to settle after cancel"
                    ),
                )
            finally:
                # Flush any remaining queued entries
                remaining: list[tuple[str, int]] = []
                while not entry_queue.empty():
                    try:
                        remaining.append(entry_queue.get_nowait())
                    except queue.Empty:
                        break
                if remaining:
                    batch = "\n".join(
                        f"  adding {name}" for name, _size in remaining
                    )
                    await _update_task(session, task, log_line=batch)

            try:
                shutil.move(tmp_name, filepath)
                tmp_name = None  # moved successfully; no temp to clean up
            except Exception:
                # Clean up temp file on failure before re-raising
                try:
                    os.unlink(tmp_name)
                except OSError:
                    pass
                tmp_name = None
                raise

            file_size = os.path.getsize(filepath)
            size_mb = file_size / (1024 * 1024)

            await _update_task(
                session, task,
                status="completed", progress=100,
                log_line=f"Export complete. Archive size: {size_mb:.1f} MB",
                result_filename=filename,
                result_path=filepath,
                check_cancelled=True,
            )
            logger.info(
                "Background files export completed",
                extra={
                    "event": "admin_task.files_export_done",
                    "task_id": task_id,
                    "size_bytes": file_size,
                },
            )

        except TaskCancelled:
            logger.info(
                "Background files export cancelled",
                extra={"event": "admin_task.files_export_cancelled", "task_id": task_id},
            )
            # Clean up temp file and/or result file
            for path in (tmp_name, filepath):
                if path:
                    try:
                        os.unlink(path)
                    except OSError:
                        pass
            await session.refresh(task)
            await _update_task(
                session, task,
                status="cancelled",
                log_line="Task cancelled.",
            )

        except Exception as exc:
            span = trace.get_current_span()
            span.record_exception(exc)
            span.set_status(StatusCode.ERROR, str(exc))
            logger.exception(
                "Background files export failed",
                extra={"event": "admin_task.files_export_failed", "task_id": task_id},
            )
            # Clean up temp file if it wasn't already handled
            if tmp_name:
                try:
                    os.unlink(tmp_name)
                except OSError:
                    pass
            await session.rollback()
            await session.refresh(task)
            await _update_task(
                session, task,
                status="failed", progress=0,
                log_line=f"ERROR: {exc}",
                error_message=str(exc),
            )


# ── Filesystem Import ──────────────────────────────────────


def _extract_and_restore(
    tmp_archive: str,
    tmpdir: str,
    data_dir: str,
    tiles_dir: str,
    source_images_dir: str,
    *,
    cancel_event: threading.Event | None = None,
    on_progress: Callable[[str, int, int], None] | None = None,
) -> dict[str, int]:
    """Extract archive, stage on the data volume, and atomically swap entries.

    Parameters
    ----------
    cancel_event
        If set during processing, :class:`TaskCancelled` is raised so
        the caller can abort cleanly.
    on_progress
        Called as ``on_progress(phase, current, total)`` where *phase*
        is ``"extract"`` (streaming archive bytes) or ``"finalize"``
        (entry-level swap). During ``"extract"`` *current* is the number
        of compressed bytes consumed so far and *total* is the archive
        size on disk. During ``"finalize"`` *current* and *total* are zero.
    """

    def _check_cancel() -> None:
        if cancel_event is not None and cancel_event.is_set():
            raise TaskCancelled("Task cancelled by admin")

    staging_root = Path(tmpdir)
    staging_root.mkdir(parents=True, exist_ok=True)
    extracted_member_count = _extract_archive_stream(
        tmp_archive,
        staging_root,
        cancel_event=cancel_event,
        on_progress=on_progress,
    )
    if extracted_member_count == 0:
        raise ValueError("Archive is empty")

    format_version = _validate_files_import_manifest(staging_root)

    extracted_dir = staging_root / "data"
    if not extracted_dir.exists():
        entries = list(staging_root.iterdir())
        extracted_dir = (
            entries[0]
            if len(entries) == 1 and entries[0].is_dir()
            else staging_root
        )

    if not extracted_dir.is_dir() or not any(extracted_dir.iterdir()):
        raise ValueError("Archive contains no data entries to restore")

    _check_cancel()
    if on_progress:
        on_progress("finalize", 0, 0)

    result = _swap_imported_entries(
        extracted_dir,
        Path(data_dir),
        tiles_dir,
        source_images_dir,
        cancel_event=cancel_event,
    )
    result["manifest_format_version"] = format_version
    return result


async def run_files_import(
    task_id: int,
    bg: BackgroundTasks | None = None,
) -> None:
    """Extract a tar.gz archive over the data directory in the background.

    Progress is mapped into three phases so the admin UI can show a
    meaningful progress bar for long-running imports:

    * **preflight** (0 %–5 %): validate the uploaded archive and staging space.
    * **extract** (15 %–85 %): stream archive bytes into a staging dir on
      the data volume.
    * **finalize** (85 %–100 %): swap restored entries + count files.

    Cancellation is supported throughout via ``threading.Event`` (the
    extraction thread) and DB polling (the progress coroutine), following
    the same pattern used by :func:`run_files_export`.
    """
    _EXTRACT_START = 15
    _EXTRACT_END = 85
    _FINALIZE = 90

    async with get_async_session()() as session:
        task = await session.get(AdminTask, task_id)
        if task is None:
            logger.error("AdminTask %d not found", task_id)
            return

        input_path = task.input_path
        try:
            await _update_task(
                session, task,
                status="running", progress=0,
                log_line="Starting filesystem import…",
                check_cancelled=True,
            )

            if not input_path or not os.path.exists(input_path):
                raise ValueError("Uploaded archive file not found")

            archive_size = os.path.getsize(input_path)
            archive_mb = archive_size / (1024 * 1024)
            staging_root = Path(_ensure_import_staging_dir())
            _ensure_import_staging_same_device(
                staging_root, Path(settings.data_dir)
            )
            free_bytes = shutil.disk_usage(staging_root).free
            required_bytes = int(archive_size * _IMPORT_STAGING_FREE_SPACE_FACTOR)
            if free_bytes < required_bytes:
                raise ValueError(
                    "Insufficient free space on data volume for on-volume staging: "
                    f"need at least ~{format_bytes(required_bytes)} free before "
                    "staging and extraction, "
                    f"have {format_bytes(free_bytes)}"
                )

            await _update_task(
                session, task, progress=2,
                log_line="Computing archive SHA-256 for integrity verification…",
                check_cancelled=True,
            )
            checksum = await asyncio.to_thread(
                compute_archive_sha256, input_path
            )
            if task.input_checksum:
                if checksum != task.input_checksum:
                    raise ValueError(FILES_IMPORT_CHECKSUM_MISMATCH_MESSAGE)
                checksum_note = (
                    "Archive integrity verified: SHA-256 matches the "
                    "original upload."
                )
            else:
                task.input_checksum = checksum
                # Backfill tasks sharing this retained archive (e.g. the
                # pre-checksum task a rerun was launched from) so future
                # reruns from any of them verify against this baseline.
                await session.execute(
                    update(AdminTask)
                    .where(
                        AdminTask.task_type == "files_import",
                        AdminTask.input_path == input_path,
                        AdminTask.input_checksum.is_(None),
                    )
                    .values(input_checksum=checksum)
                )
                checksum_note = f"Archive SHA-256 recorded: {checksum}."
            await _update_task(
                session, task, progress=3,
                log_line=checksum_note,
                check_cancelled=True,
            )

            await _update_task(
                session, task, progress=5,
                log_line=(
                    f"Archive size: {archive_mb:.1f} MB. "
                    f"Staging needs at least ~{format_bytes(required_bytes)} free "
                    "(archive size plus margin); "
                    "streaming archive bytes to on-volume staging…"
                ),
                check_cancelled=True,
            )

            # -- threaded extraction with async progress polling --
            cancel_event = threading.Event()
            progress_queue: queue.Queue[tuple[str, int, int]] = queue.Queue()

            def _on_progress(phase: str, current: int, total: int) -> None:
                progress_queue.put((phase, current, total))

            last_phase = ""

            async def _poll_progress() -> None:
                nonlocal last_phase
                while True:
                    await asyncio.sleep(_LOG_FLUSH_INTERVAL)
                    entries: list[tuple[str, int, int]] = []
                    while not progress_queue.empty():
                        try:
                            entries.append(progress_queue.get_nowait())
                        except queue.Empty:
                            break

                    if entries:
                        phase, current, total = entries[-1]

                        if phase == "extract":
                            if last_phase != "extract":
                                await _update_task(
                                    session, task,
                                    log_line="Streaming archive to staging…",
                                    progress=_EXTRACT_START,
                                )
                                last_phase = "extract"
                            elif total > 0:
                                span = _EXTRACT_END - _EXTRACT_START
                                pct = _EXTRACT_START + int(span * current / total)
                                await _update_task(
                                    session, task,
                                    progress=min(pct, _EXTRACT_END),
                                    log_line=(
                                        f"  read {format_bytes(current)} / "
                                        f"{format_bytes(total)} archive bytes"
                                    ),
                                )
                        elif phase == "finalize" and last_phase != "finalize":
                            await _update_task(
                                session, task,
                                log_line="Swapping restored entries…",
                                progress=_FINALIZE,
                            )
                            last_phase = "finalize"

                    await session.refresh(task, attribute_names=["status"])
                    if task.status in ("cancelling", "cancelled"):
                        cancel_event.set()
                        return

            with tempfile.TemporaryDirectory(
                prefix="hriv-import-",
                dir=_ensure_import_staging_dir(),
            ) as tmpdir:
                extract_future = asyncio.ensure_future(
                    asyncio.to_thread(
                        _extract_and_restore,
                        input_path, tmpdir, str(Path(settings.data_dir)),
                        settings.tiles_dir, settings.source_images_dir,
                        cancel_event=cancel_event,
                        on_progress=_on_progress,
                    )
                )
                poll_future = asyncio.ensure_future(_poll_progress())

                try:
                    restored = await _run_with_cancel_poll(
                        extract_future,
                        poll_future,
                        cancel_event=cancel_event,
                        grace_timeout_log=(
                            "Timed out waiting for filesystem import "
                            "to settle after cancel"
                        ),
                        shutdown_grace=120,
                        return_result_on_cancel=True,
                    )
                finally:
                    remaining: list[tuple[str, int, int]] = []
                    while not progress_queue.empty():
                        try:
                            remaining.append(progress_queue.get_nowait())
                        except queue.Empty:
                            break
                    if remaining:
                        phase, current, total = remaining[-1]
                        if phase == "extract" and total > 0:
                            await _update_task(
                                session, task,
                                log_line=(
                                    f"  read {format_bytes(current)} / "
                                    f"{format_bytes(total)} archive bytes"
                                ),
                            )

            try:
                rebuild_log = await _queue_rebuild_tiles_after_import(task, bg)
            except Exception:
                logger.exception(
                    "Failed to queue automatic tile rebuild after import",
                )
                rebuild_log = (
                    "Could not queue automatic tile rebuild. "
                    "Run Rebuild Tiles manually if needed."
                )
            manifest_version = restored.get("manifest_format_version", 0)
            manifest_note = (
                f"Archive manifest format v{manifest_version} validated. "
                if manifest_version > 0
                else "Legacy archive (no manifest); imported as format v0. "
            )
            summary = (
                f"Restored {restored['source_files']} source file(s). "
                f"{manifest_note}{rebuild_log}"
            )
            await _update_task(
                session, task,
                status="completed", progress=100,
                log_line=f"Import complete. {summary}",
            )
            try:
                pruned = await enforce_files_import_archive_retention(session)
                if pruned:
                    await _update_task(
                        session, task,
                        log_line=(
                            "Retention policy removed "
                            f"{len(pruned)} older retained archive(s)."
                        ),
                    )
            except Exception:
                logger.exception(
                    "Retention enforcement after files import failed",
                )
            logger.info(
                "Background files import completed",
                extra={
                    "event": "admin_task.files_import_done",
                    "task_id": task_id,
                    "restored": restored,
                },
            )
        except TaskCancelled:
            logger.info(
                "Background files import cancelled",
                extra={"event": "admin_task.files_import_cancelled", "task_id": task_id},
            )
            await session.rollback()
            refreshed = await session.get(AdminTask, task_id)
            if refreshed is not None:
                task = refreshed
            await _update_task(
                session,
                task,
                status="cancelled",
                log_line="Task cancelled.",
            )
        except Exception as exc:
            span = trace.get_current_span()
            span.record_exception(exc)
            span.set_status(StatusCode.ERROR, str(exc))
            logger.exception(
                "Background files import failed",
                extra={"event": "admin_task.files_import_failed", "task_id": task_id},
            )
            await session.rollback()
            refreshed = await session.get(AdminTask, task_id)
            if refreshed is not None:
                task = refreshed
            await _update_task(
                session,
                task,
                status="failed", progress=0,
                log_line=f"ERROR: {exc}",
                error_message=str(exc),
            )
async def run_file_restore(task_id: int) -> None:
    """Restore a single file from a backup snapshot in the background."""
    async with get_async_session()() as session:
        task = await session.get(AdminTask, task_id)
        if task is None:
            logger.error("AdminTask %d not found", task_id)
            return

        input_path = task.input_path
        try:
            await _update_task(
                session, task,
                status="running", progress=0,
                log_line="Starting snapshot file restore…",
                check_cancelled=True,
            )

            if not input_path or not os.path.exists(input_path):
                raise ValueError("Restore request file not found")

            raw = await asyncio.to_thread(_read_file, input_path)
            params = json.loads(raw)
            if not isinstance(params, dict):
                raise ValueError("Restore request must be a JSON object")

            snapshot_name = params.get("snapshot_name")
            member_path = params.get("member_path")
            if not isinstance(snapshot_name, str) or not snapshot_name.strip():
                raise ValueError("Restore request is missing snapshot_name")
            if not isinstance(member_path, str) or not member_path.strip():
                raise ValueError("Restore request is missing member_path")

            cached_entry = params.get("manifest_entry")
            if not isinstance(cached_entry, dict):
                # Older restore requests predate the cached entry; the
                # restore falls back to fetching the manifest itself.
                cached_entry = None

            await _update_task(
                session,
                task,
                progress=10,
                log_line=(
                    f"Restoring {member_path} from snapshot {snapshot_name}…"
                ),
                check_cancelled=True,
            )

            cancel_event = threading.Event()

            async def _poll_cancel_only() -> None:
                while True:
                    await asyncio.sleep(_LOG_FLUSH_INTERVAL)
                    await session.refresh(task, attribute_names=["status"])
                    if task.status in ("cancelling", "cancelled"):
                        cancel_event.set()
                        return

            restore_future = asyncio.ensure_future(
                asyncio.to_thread(
                    restore_snapshot_file,
                    snapshot_name,
                    member_path,
                    cancel_event=cancel_event,
                    manifest_entry=cached_entry,
                )
            )
            poll_future = asyncio.ensure_future(_poll_cancel_only())

            try:
                restored = await _run_with_cancel_poll(
                    restore_future,
                    poll_future,
                    cancel_event=cancel_event,
                    grace_timeout_log=(
                        "File restore did not finish within the "
                        "shutdown grace period; cancelling task"
                    ),
                    return_result_on_cancel=True,
                )
            except BackupSnapshotCancelledError as exc:
                raise TaskCancelled(str(exc)) from exc

            await _update_task(
                session,
                task,
                status="completed",
                progress=100,
                log_line=(
                    f"Restored {restored['member_path']} from {restored['snapshot_name']}. "
                    "If this is a source image, run Rebuild Tiles if its tiles are stale."
                ),
            )
            logger.info(
                "Background file restore completed",
                extra={
                    "event": "admin_task.file_restore_done",
                    "task_id": task_id,
                    "snapshot_name": snapshot_name,
                    "member_path": member_path,
                },
            )

        except TaskCancelled:
            logger.info(
                "Background file restore cancelled",
                extra={"event": "admin_task.file_restore_cancelled", "task_id": task_id},
            )
            await session.refresh(task)
            await _update_task(
                session, task,
                status="cancelled",
                log_line="Task cancelled.",
            )

        except BackupRestoreNotConfiguredError as exc:
            logger.error(
                "Background file restore failed — backup restore is not configured",
                extra={"event": "admin_task.file_restore_not_configured", "task_id": task_id},
            )
            await session.refresh(task)
            await _update_task(
                session, task,
                status="failed",
                progress=0,
                log_line=f"ERROR: {exc}",
                error_message=str(exc),
            )

        except Exception as exc:
            span = trace.get_current_span()
            span.record_exception(exc)
            span.set_status(StatusCode.ERROR, str(exc))
            logger.exception(
                "Background file restore failed",
                extra={"event": "admin_task.file_restore_failed", "task_id": task_id},
            )
            await session.rollback()
            await session.refresh(task)
            await _update_task(
                session, task,
                status="failed", progress=0,
                log_line=f"ERROR: {exc}",
                error_message=str(exc),
            )
        finally:
            if input_path:
                try:
                    os.unlink(input_path)
                except OSError:
                    logger.debug(
                        "Ignoring cleanup failure while deleting restore input file",
                        extra={
                            "event": "admin_task.file_restore_cleanup_failed",
                            "task_id": task_id,
                            "input_path": input_path,
                        },
                        exc_info=True,
                    )
