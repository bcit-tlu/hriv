import asyncio
import json
import logging
import fcntl
import os
import shutil
from datetime import datetime, timedelta, timezone
from io import BufferedWriter
from pathlib import Path
from typing import Annotated
import uuid

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from jose import JWTError, jwt
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..backup_access import (
    BackupRestoreNotConfiguredError,
    BackupSnapshotManifestError,
    BackupSnapshotNotFoundError,
    get_snapshot_manifest,
    list_snapshots as list_snapshot_blobs,
)
from ..admin_ops import (
    _ensure_tasks_dir,
    format_bytes,
    delete_files_import_archive,
    list_files_import_archives,
    run_file_restore,
    run_db_export,
    run_db_import,
    run_files_export,
    run_files_import,
    rerun_files_import_archive,
    run_rebuild_tiles,
)
from ..auth import auth_settings, require_role
from ..database import get_db
from ..maintenance import disable_maintenance_mode, enable_maintenance_mode, is_maintenance_mode
from ..models import ACTIVE_TASK_STATUSES, AdminTask, User
from ..schemas import (
    FileRestoreRequest,
    FilesImportArchiveOut,
    FilesImportRerunRequest,
    RebuildTilesRequest,
    UploadChunkResponse,
    UploadFinalizeRequest,
    UploadStatusResponse,
)
from ..worker import enqueue_admin_task

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

_admin = require_role("admin")

_CHUNK_SIZE = 1024 * 1024  # 1 MiB streaming chunks
_DOWNLOAD_TOKEN_EXPIRE_SECONDS = 60
_ACTIVE_STATUSES = frozenset(ACTIVE_TASK_STATUSES)
_EXPORT_TASK_TYPES = ("db_export", "files_export")

# Chunked file-system import upload tunables.  Chunks are client-sized; the
# server buffers and flushes to disk in _UPLOAD_FLUSH_SIZE pieces so memory
# stays bounded while still avoiding a thread-pool call per ASGI micro-chunk.
_UPLOAD_FLUSH_SIZE = 1024 * 1024  # 1 MiB
_UPLOAD_MAX_CHUNK_SIZE = 512 * 1024 * 1024  # 512 MiB safety cap per request


# ---------------------------------------------------------------------------
# Maintenance mode
# ---------------------------------------------------------------------------


@router.get("/maintenance")
async def get_maintenance(
    _user: Annotated[User, Depends(_admin)],
):
    """Return current maintenance-mode state (admin only)."""
    return {"maintenance": is_maintenance_mode()}


@router.put("/maintenance")
async def set_maintenance(
    _user: Annotated[User, Depends(_admin)],
    enabled: bool = Query(..., description="Enable or disable maintenance mode"),
):
    """Toggle maintenance mode (admin only)."""
    if enabled:
        enable_maintenance_mode()
    else:
        disable_maintenance_mode()
    return {"maintenance": is_maintenance_mode()}


# ---------------------------------------------------------------------------
# Background admin tasks
# ---------------------------------------------------------------------------

_TASK_UPLOAD_CHUNK = 1024 * 1024  # 1 MiB


async def _create_task(
    db: AsyncSession,
    task_type: str,
    user: User,
    input_path: str | None = None,
    status: str = "pending",
) -> AdminTask:
    # Reject if a task of the same type is already pending or running
    existing = (
        await db.execute(
            select(AdminTask).where(
                AdminTask.task_type == task_type,
                AdminTask.status.in_(_ACTIVE_STATUSES),
            )
        )
    ).scalars().first()
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail=(
                f"A {task_type.replace('_', ' ')} task is already "
                f"{existing.status} (task #{existing.id}). "
                "Please wait for it to finish or cancel it first."
            ),
        )

    task = AdminTask(
        task_type=task_type,
        status=status,
        created_by=user.id,
        input_path=input_path,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return task


async def _kick_off(
    task: AdminTask,
    bg: BackgroundTasks,
) -> None:
    """Enqueue the task via arq, falling back to BackgroundTasks."""
    enqueued = await enqueue_admin_task(task.id, task.task_type)
    if not enqueued:
        # Redis unavailable — run in-process
        runner = {
            "db_export": run_db_export,
            "db_import": run_db_import,
            "file_restore": run_file_restore,
            "files_export": run_files_export,
            "files_import": run_files_import,
            "rebuild_tiles": run_rebuild_tiles,
        }[task.task_type]
        bg.add_task(runner, task.id)


def _task_to_dict(task: AdminTask) -> dict:
    return {
        "id": task.id,
        "task_type": task.task_type,
        "status": task.status,
        "progress": task.progress,
        "log": task.log,
        "result_filename": task.result_filename,
        "error_message": task.error_message,
        "original_filename": getattr(task, "original_filename", None),
        "created_by": task.created_by,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
    }


@router.post("/tasks/db-export")
async def start_db_export(
    user: Annotated[User, Depends(_admin)],
    bg: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Kick off a background database export."""
    task = await _create_task(db, "db_export", user)
    await _kick_off(task, bg)
    return _task_to_dict(task)


@router.post("/tasks/db-import")
async def start_db_import(
    user: Annotated[User, Depends(_admin)],
    bg: BackgroundTasks,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Accept a JSON file and kick off a background database import."""
    if not file.filename or not file.filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="Only .json files are accepted")

    # Save uploaded file to staging area
    tasks_dir = _ensure_tasks_dir()
    input_path = os.path.join(tasks_dir, f"import-{uuid.uuid4().hex}.json")
    with open(input_path, "wb") as f:
        while True:
            chunk = await file.read(_TASK_UPLOAD_CHUNK)
            if not chunk:
                break
            f.write(chunk)

    try:
        task = await _create_task(db, "db_import", user, input_path=input_path)
    except Exception:
        try:
            os.unlink(input_path)
        except OSError as exc:
            logger.debug(
                "Failed to remove temporary db-import input file %s: %s",
                input_path,
                exc,
            )
        raise
    await _kick_off(task, bg)
    return _task_to_dict(task)


@router.post("/tasks/rebuild-tiles")
async def start_rebuild_tiles(
    user: Annotated[User, Depends(_admin)],
    bg: BackgroundTasks,
    request: RebuildTilesRequest = RebuildTilesRequest(),
    db: AsyncSession = Depends(get_db),
):
    """Kick off a background rebuild of missing or stale tile sets.

    Tiles are derived data that can always be regenerated from the preserved
    source images, so this is the operator-safe recovery path when a restore
    brings back the database (and source-image volume) but not the large tile
    volume, or when a pipeline change makes existing tiles stale. The rebuild
    skips tile sets that are already current (unless ``scope == "all"``), so it
    is safe to rerun.

    The parameters are persisted to a small JSON file referenced by the task's
    ``input_path`` (mirroring the db-import flow) and consumed by the runner.
    """
    tasks_dir = _ensure_tasks_dir()
    input_path = os.path.join(tasks_dir, f"rebuild-{uuid.uuid4().hex}.json")
    with open(input_path, "w", encoding="utf-8") as f:
        json.dump(
            {"scope": request.scope, "image_ids": request.image_ids},
            f,
        )

    try:
        task = await _create_task(
            db, "rebuild_tiles", user, input_path=input_path,
        )
    except Exception:
        # Roll back the staged params file if task creation failed. Failing to
        # remove it is non-fatal (the original error is re-raised), but record
        # it so an orphaned file is diagnosable.
        try:
            os.unlink(input_path)
        except OSError:
            logger.warning(
                "Failed to remove rebuild params file %s after task-creation error",
                input_path,
                exc_info=True,
            )
        raise
    await _kick_off(task, bg)
    return _task_to_dict(task)


@router.post("/tasks/files-export")
async def start_files_export(
    user: Annotated[User, Depends(_admin)],
    bg: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Kick off a background filesystem archive export."""
    task = await _create_task(db, "files_export", user)
    await _kick_off(task, bg)
    return _task_to_dict(task)


@router.post("/tasks/files-import")
async def start_files_import(
    user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
    filename: str = Query(
        ..., description="Original filename of the archive to upload",
    ),
):
    """Create a filesystem import task in ``uploading`` status.

    The archive file itself is uploaded separately. Small archives may still
    use ``PUT /admin/tasks/{task_id}/upload``; for multi-gigabyte archives
    the chunked flow (``PATCH /admin/tasks/{task_id}/upload`` with
    ``Upload-Offset`` / ``Upload-Length`` headers, then
    ``POST /admin/tasks/{task_id}/upload/finalize``) avoids a huge multipart
    spool and can resume after network errors. The two-step flow ensures the
    task record exists before the long upload begins, so timeouts or errors are
    visible in task history rather than vanishing silently.
    """
    if not (
        filename.endswith(".tar.gz") or filename.endswith(".tgz")
    ):
        raise HTTPException(status_code=400, detail="Only .tar.gz / .tgz files are accepted")

    tasks_dir = _ensure_tasks_dir()
    input_path = os.path.join(tasks_dir, f"import-{uuid.uuid4().hex}.tar.gz")

    task = await _create_task(
        db, "files_import", user, input_path=input_path, status="uploading",
    )
    task.original_filename = filename
    task.log = f"Awaiting file upload: {filename}\n"
    await db.commit()
    await db.refresh(task)
    return _task_to_dict(task)


def _safe_file_size(path: str | None) -> int:
    """Return *path*'s size, or 0 if it does not exist or is inaccessible."""
    if not path:
        return 0
    try:
        return os.path.getsize(path)
    except (OSError, ValueError):
        return 0


def _acquire_chunk_lock(lock_path: str) -> int:
    """Acquire an exclusive, non-blocking advisory lock on *lock_path*.

    Returns the file descriptor.  Raises *BlockingIOError* if the lock is
    already held by another process/thread.
    """
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        raise
    return fd


def _release_chunk_lock(fd: int, lock_path: str) -> None:
    """Unlink and release an advisory lock on *lock_path*.

    The lock file is removed while the descriptor still holds the lock so no
    other process can open the path between unlock and unlink.  The lock is
    released and the descriptor is closed once the directory entry is gone.
    """
    try:
        os.unlink(lock_path)
    except FileNotFoundError:
        # The lock path may already be gone (e.g. from a concurrent release or
        # task cleanup). The descriptor is still open, so the lock will still be
        # released and closed in the finally block below.
        pass
    except OSError as exc:
        logger.debug("Failed to remove chunk lock file %s: %s", lock_path, exc)
    finally:
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)


def _parse_upload_offset(request: Request) -> int | None:
    """Read the ``Upload-Offset`` header (Tus-style) as a non-negative int."""
    raw = request.headers.get("upload-offset")
    if raw is None:
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if value >= 0 else None


def _parse_upload_length(request: Request) -> int | None:
    """Read the optional ``Upload-Length`` header as a positive int."""
    raw = request.headers.get("upload-length")
    if raw is None:
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if value > 0 else None


def _parse_content_length(request: Request) -> int | None:
    """Read the HTTP ``Content-Length`` header as a non-negative int."""
    raw = request.headers.get("content-length")
    if raw is None:
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if value >= 0 else None


def _write_buffer_to_file(f: BufferedWriter, data: bytearray, start: int, length: int) -> None:
    """Synchronous helper: write *length* bytes from *data* to open file *f*."""
    f.write(memoryview(data)[start : start + length])


async def _append_request_body_to_file(
    request: Request,
    path: str,
    *,
    mode: str = "ab",
    max_bytes: int | None = None,
    cancel_event: asyncio.Event | None = None,
) -> int:
    """Stream the request body to *path* in bounded-memory chunks.

    The file is opened once with *mode* (``"ab"`` for chunked PATCH uploads,
    ``"wb"`` for single-shot PUT uploads) and all writes are delegated to the
    thread pool so the async event loop is not blocked by storage.  If
    *max_bytes* is set, only that many bytes are written; any additional bytes
    from the stream are consumed and discarded so the connection closes cleanly
    and the on-disk file cannot grow past the declared size.

    Returns the number of bytes written. Raises on stream or write errors so
    the caller can decide whether to retry/resync.
    """
    f: BufferedWriter = await asyncio.to_thread(open, path, mode)
    try:
        buffer = bytearray()
        bytes_received = 0
        async for data in request.stream():
            if cancel_event is not None and cancel_event.is_set():
                break
            if not data:
                continue
            if max_bytes is not None:
                allowed = max_bytes - bytes_received
                if allowed <= 0:
                    # At or past the declared limit; keep consuming the stream
                    # without writing or buffering so the connection closes.
                    continue
                if len(data) > allowed:
                    data = data[:allowed]
            buffer.extend(data)
            bytes_received += len(data)
            while len(buffer) >= _UPLOAD_FLUSH_SIZE:
                await asyncio.to_thread(
                    _write_buffer_to_file, f, buffer, 0, _UPLOAD_FLUSH_SIZE
                )
                del buffer[:_UPLOAD_FLUSH_SIZE]
        if buffer:
            await asyncio.to_thread(
                _write_buffer_to_file, f, buffer, 0, len(buffer)
            )
            buffer.clear()
    finally:
        await asyncio.to_thread(f.close)
    return bytes_received


async def _finalize_files_import_upload(
    db: AsyncSession,
    task: AdminTask,
    bytes_received: int,
    bg: BackgroundTasks,
) -> AdminTask:
    """Atomically transition an uploaded files_import task to ``pending``.

    Matches the guarded UPDATE pattern in ``upload_task_file`` so a concurrent
    cancel is detected rather than silently overwriting state.
    """
    size_mb = bytes_received / (1024 * 1024)
    log_line = f"Upload complete ({size_mb:.1f} MB). Queued for processing.\n"
    result = await db.execute(
        update(AdminTask)
        .where(AdminTask.id == task.id, AdminTask.status == "uploading")
        .values(
            status="pending",
            log=AdminTask.log + log_line,
        )
        .returning(AdminTask.id)
    )
    await db.commit()

    if result.scalar() is None:
        await db.refresh(task)
        if task.status not in ("pending", "running") and task.input_path:
            try:
                os.unlink(task.input_path)
            except OSError as cleanup_exc:
                logger.debug(
                    "Failed to remove input_path for task %d: %s",
                    task.id,
                    cleanup_exc,
                )
        raise HTTPException(
            status_code=409,
            detail=f"Task was {task.status} during finalize",
        )

    await db.refresh(task)
    await _kick_off(task, bg)
    await db.refresh(task)
    return task


@router.get("/tasks/{task_id}/upload", response_model=UploadStatusResponse)
async def get_upload_status(
    task_id: int,
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    """Return the current upload offset for resuming a chunked upload."""
    task = await db.get(AdminTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.task_type != "files_import" or task.status != "uploading":
        raise HTTPException(
            status_code=409,
            detail=f"Task is in '{task.status}' state, expected 'uploading'",
        )
    if not task.input_path:
        raise HTTPException(status_code=500, detail="Task missing input_path")

    return {
        "bytes_received": _safe_file_size(task.input_path),
        "status": task.status,
    }


@router.patch("/tasks/{task_id}/upload", response_model=UploadChunkResponse)
async def upload_task_chunk(
    task_id: int,
    request: Request,
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    """Append a raw-byte chunk to a chunked filesystem-import upload.

    The client sends the next contiguous slice with the ``Upload-Offset``
    header set to the current file size. If the offset does not match, the
    server returns 409 with ``bytes_received`` so the client can resync and
    resume without re-sending already-received data.

    The optional ``Upload-Length`` header lets the server update progress and
    auto-finalize when the final byte has been received. The body itself is
    the raw chunk bytes (``application/octet-stream``); multipart is not used,
    avoiding a potentially huge temporary spool file.
    """
    task = await db.get(AdminTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.task_type != "files_import" or task.status != "uploading":
        raise HTTPException(
            status_code=409,
            detail=f"Task is in '{task.status}' state, expected 'uploading'",
        )
    if not task.input_path:
        raise HTTPException(status_code=500, detail="Task missing input_path")

    offset = _parse_upload_offset(request)
    if offset is None:
        raise HTTPException(status_code=400, detail="Missing or invalid Upload-Offset header")

    content_length = _parse_content_length(request)
    if content_length is None:
        raise HTTPException(status_code=400, detail="Missing or invalid Content-Length header")
    if content_length > _UPLOAD_MAX_CHUNK_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"Chunk size {content_length} exceeds server limit of {_UPLOAD_MAX_CHUNK_SIZE}",
        )

    total = _parse_upload_length(request)

    # Serialize chunk writes per task so a retried request cannot overlap
    # with an in-flight write and corrupt the archive.
    lock_path = f"{task.input_path}.lock"
    lock_fd: int | None = None
    try:
        lock_fd = await asyncio.to_thread(_acquire_chunk_lock, lock_path)
    except BlockingIOError:
        current_size = _safe_file_size(task.input_path)
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Upload already in progress for this task",
                "bytes_received": current_size,
                "status": task.status,
            },
        )

    try:
        current_size = _safe_file_size(task.input_path)
        if offset != current_size:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Upload offset conflict",
                    "bytes_received": current_size,
                    "status": task.status,
                },
            )

        # Fail-fast if the remaining archive or this chunk will not fit on the data volume.
        tasks_dir = Path(_ensure_tasks_dir())
        free_bytes = shutil.disk_usage(tasks_dir).free
        size_to_check = (
            max(total - current_size, content_length)
            if total is not None
            else content_length
        )
        if size_to_check > free_bytes:
            detail = (
                f"Insufficient space to upload archive: required {size_to_check} bytes, "
                f"available {free_bytes} bytes in {tasks_dir}"
            )
            raise HTTPException(status_code=507, detail=detail)

        try:
            bytes_received = await _append_request_body_to_file(
                request, task.input_path, max_bytes=content_length
            )
        except Exception as exc:
            logger.exception("Chunked upload failed for task %d: %s", task_id, exc)
            if os.path.exists(task.input_path):
                try:
                    os.truncate(task.input_path, current_size)
                except OSError as truncate_exc:
                    logger.debug(
                        "Failed to truncate input_path for task %d after write error: %s",
                        task_id,
                        truncate_exc,
                    )
            raise HTTPException(
                status_code=500,
                detail=f"Chunk upload failed: {exc}",
            ) from exc

        if bytes_received != content_length:
            logger.warning(
                "Chunk size mismatch for task %d: expected %d bytes, received %d bytes",
                task_id,
                content_length,
                bytes_received,
            )
            if os.path.exists(task.input_path):
                try:
                    os.truncate(task.input_path, current_size)
                except OSError as truncate_exc:
                    logger.debug(
                        "Failed to truncate input_path for task %d: %s",
                        task_id,
                        truncate_exc,
                    )
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Chunk size mismatch",
                    "bytes_received": current_size,
                    "status": task.status,
                },
            )

        new_size = current_size + bytes_received

        # Keep the task row alive while a long chunked upload is in flight;
        # without touching ``updated_at`` a slow cross-environment upload can be
        # marked stale by another pod's startup reconciliation mid-transfer.
        if total is not None:
            progress = min(99, int(new_size / total * 100))
        else:
            progress = task.progress
        try:
            await db.execute(
                update(AdminTask)
                .where(AdminTask.id == task_id, AdminTask.status == "uploading")
                .values(progress=progress)
            )
            await db.commit()
        except Exception as exc:
            logger.warning(
                "Failed to update progress for task %d: %s", task_id, exc, exc_info=True
            )
            try:
                await db.rollback()
            except Exception as rollback_exc:
                logger.debug(
                    "Rollback after failed progress update for task %d: %s",
                    task_id,
                    rollback_exc,
                )

        try:
            await db.refresh(task)
        except Exception as exc:
            logger.debug("Failed to refresh task %d after chunk upload: %s", task_id, exc)

        return {
            "bytes_received": new_size,
            "status": task.status,
        }
    finally:
        if lock_fd is not None:
            await asyncio.to_thread(_release_chunk_lock, lock_fd, lock_path)


@router.post("/tasks/{task_id}/upload/finalize", response_model_exclude_none=True)
async def finalize_task_upload(
    task_id: int,
    request: UploadFinalizeRequest,
    _user: Annotated[User, Depends(_admin)],
    bg: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Finalize a chunked filesystem-import upload once all bytes are received.

    Returns the updated ``AdminTask`` (now ``pending`` and queued). If the
    on-disk size does not match ``total_bytes``, returns 409 with the current
    ``bytes_received`` so the client can resume.
    """
    task = await db.get(AdminTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.task_type != "files_import" or task.status != "uploading":
        raise HTTPException(
            status_code=409,
            detail=f"Task is in '{task.status}' state, expected 'uploading'",
        )
    if not task.input_path:
        raise HTTPException(status_code=500, detail="Task missing input_path")

    bytes_received = _safe_file_size(task.input_path)
    if bytes_received != request.total_bytes:
        raise HTTPException(
            status_code=409,
            detail={
                "message": f"Expected {request.total_bytes} bytes, received {bytes_received}",
                "bytes_received": bytes_received,
                "status": task.status,
            },
        )

    return _task_to_dict(await _finalize_files_import_upload(db, task, bytes_received, bg))


@router.get("/tasks/files-import/archives", response_model=list[FilesImportArchiveOut])
async def list_files_import_archives_endpoint(
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    """List retained filesystem-import archives available for rerun."""
    return await list_files_import_archives(db)


@router.post("/tasks/files-import/rerun")
async def rerun_files_import(
    user: Annotated[User, Depends(_admin)],
    bg: BackgroundTasks,
    request: FilesImportRerunRequest,
    db: AsyncSession = Depends(get_db),
):
    """Queue a new filesystem import using an existing retained archive."""
    try:
        task = await rerun_files_import_archive(db, user, request.archive_task_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await _kick_off(task, bg)
    return _task_to_dict(task)


@router.delete("/tasks/files-import/archives/{archive_task_id}")
async def delete_files_import_archive_endpoint(
    archive_task_id: int,
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    """Delete a retained filesystem-import archive from disk."""
    try:
        return await delete_files_import_archive(db, archive_task_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def _safe_admin_task_file(path: str | None) -> Path | None:
    """Resolve *path* and verify it is inside the admin-tasks directory.

    Returns the resolved ``Path`` when the file is safe to expose, or
    ``None`` when *path* is empty/``None`` or escapes the tasks directory.
    """
    if not path:
        return None
    try:
        resolved = Path(path).resolve()
        tasks_root = Path(_ensure_tasks_dir()).resolve()
        resolved.relative_to(tasks_root)  # raises ValueError if outside
        return resolved
    except (ValueError, OSError):
        return None


@router.get("/tasks/backup-archives")
async def list_export_archives(
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    """List all on-disk export result archives with their sizes.

    Only tasks whose ``result_path`` resolves to an existing file inside the
    admin-tasks directory are included.  Import archives are managed separately
    via ``/tasks/files-import/archives``.
    """
    result = await db.execute(
        select(AdminTask)
        .where(
            AdminTask.result_filename.isnot(None),
            AdminTask.task_type.in_(_EXPORT_TASK_TYPES),
        )
        .order_by(AdminTask.id.desc())
    )
    tasks = result.scalars().all()
    archives = []
    total_size = 0
    for task in tasks:
        safe = _safe_admin_task_file(task.result_path)
        if safe is None or not safe.is_file():
            continue
        size = safe.stat().st_size
        total_size += size
        archives.append(
            {
                "task_id": task.id,
                "task_type": task.task_type,
                "artifact_role": "result",
                "filename": task.result_filename,
                "size_bytes": size,
                "status": task.status,
                "created_at": task.created_at.isoformat() if task.created_at else None,
                "updated_at": task.updated_at.isoformat() if task.updated_at else None,
                "purgeable": task.status not in _ACTIVE_STATUSES,
            }
        )
    return {"archives": archives, "total_size_bytes": total_size}


@router.delete("/tasks/backup-archives/{task_id}/{artifact_role}")
async def purge_backup_archive(
    task_id: int,
    artifact_role: str,
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    """Delete an on-disk export archive and clear the DB reference.

    Only ``artifact_role="result"`` is currently supported (import archives
    are managed via ``DELETE /tasks/files-import/archives/{id}``).
    """
    if artifact_role != "result":
        raise HTTPException(
            status_code=400,
            detail=f"Unknown artifact_role '{artifact_role}'. Must be 'result'.",
        )
    task = await db.get(AdminTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.task_type not in _EXPORT_TASK_TYPES:
        raise HTTPException(
            status_code=404, detail="Task has no purgeable export archive"
        )
    if task.status in _ACTIVE_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot purge archive while task is {task.status}",
        )
    safe = _safe_admin_task_file(task.result_path)
    if safe is None:
        raise HTTPException(status_code=404, detail="Task has no purgeable export archive")
    if not safe.is_file():
        raise HTTPException(status_code=404, detail="Archive file not found on disk")
    size_bytes = safe.stat().st_size
    try:
        safe.unlink()
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete archive file: {exc}",
        ) from exc
    task.result_filename = None
    task.result_path = None
    await db.commit()
    return {"deleted": True, "task_id": task_id, "artifact_role": artifact_role, "size_bytes": size_bytes}


@router.put("/tasks/{task_id}/upload")
async def upload_task_file(
    task_id: int,
    request: Request,
    user: Annotated[User, Depends(_admin)],
    bg: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Upload the archive for a task currently in ``uploading`` status.

    Once the file has been fully streamed to disk the task transitions to
    ``pending`` and is enqueued for background processing via the arq
    worker (with an in-process ``BackgroundTasks`` fallback when Redis is
    unavailable).
    """
    content_type = request.headers.get("content-type", "").lower()
    if content_type.startswith("multipart/form-data"):
        raise HTTPException(
            status_code=415,
            detail=(
                "This endpoint expects raw file bytes. Send the archive "
                "body as application/octet-stream, not multipart/form-data."
            ),
        )
    task = await db.get(AdminTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.task_type != "files_import" or task.status != "uploading":
        raise HTTPException(
            status_code=409,
            detail=f"Task is in '{task.status}' state, expected 'uploading'",
        )
    if not task.input_path:
        raise HTTPException(status_code=500, detail="Task missing input_path")

    tasks_dir = Path(_ensure_tasks_dir())
    content_length = request.headers.get("content-length")
    declared_size: int | None = None
    if content_length:
        try:
            declared_size = int(content_length)
        except ValueError:
            declared_size = None
        if declared_size is not None:
            free_bytes = shutil.disk_usage(tasks_dir).free
            if declared_size > free_bytes:
                detail = (
                    "Insufficient space to upload archive: "
                    f"required {declared_size} bytes "
                    f"({format_bytes(declared_size)}), "
                    f"available {free_bytes} bytes "
                    f"({format_bytes(free_bytes)}) in {tasks_dir}"
                )
                await db.execute(
                    update(AdminTask)
                    .where(AdminTask.id == task_id, AdminTask.status == "uploading")
                    .values(
                        status="failed",
                        error_message=detail,
                        log=(task.log or "") + f"ERROR: {detail}\n",
                    )
                )
                await db.commit()
                await db.refresh(task)
                raise HTTPException(status_code=507, detail=detail)

    try:
        bytes_written = await _append_request_body_to_file(
            request, task.input_path, mode="wb", max_bytes=declared_size
        )
    except Exception as exc:
        reason = f"{type(exc).__name__}: {exc}"
        logger.exception("File upload failed for task %s", task_id)
        try:
            await db.execute(
                update(AdminTask)
                .where(AdminTask.id == task_id, AdminTask.status == "uploading")
                .values(
                    status="failed",
                    error_message=reason,
                    log=(task.log or "") + f"ERROR: {reason}\n",
                )
            )
            await db.commit()
            await db.refresh(task)
            if task.status not in ("pending", "running") and task.input_path:
                try:
                    os.unlink(task.input_path)
                except OSError as cleanup_exc:
                    logger.debug(
                        "Failed to remove input_path for task %d: %s",
                        task.id,
                        cleanup_exc,
                    )
        except Exception as db_exc:
            logger.warning(
                "Failed to record upload failure for task %s: %s", task_id, db_exc
            )
            try:
                await db.rollback()
            except Exception as rollback_exc:
                logger.debug(
                    "Failed to rollback after upload failure for task %d: %s",
                    task_id,
                    rollback_exc,
                )
            if task.input_path:
                try:
                    os.unlink(task.input_path)
                except OSError as cleanup_exc:
                    logger.debug(
                        "Failed to remove input_path for task %d during rollback cleanup: %s",
                        task_id,
                        cleanup_exc,
                    )
        raise HTTPException(status_code=500, detail=reason) from exc

    return _task_to_dict(await _finalize_files_import_upload(db, task, bytes_written, bg))


def _read_backup_version() -> str:
    """Resolve the deployed backup chart's version string.

    The backup chart publishes its ``Chart.AppVersion`` in a ConfigMap
    that the backend chart mounts as a volume; ``BACKUP_VERSION_FILE``
    points at the projected key.  Reading the file per-request means
    kubelet's ConfigMap-volume refresh (~60s) propagates new versions
    without the backend pod restarting — so head builds and rc tags
    that only change the backup chart show up in the admin footer on
    the next request without manual fleet bumps.

    Precedence:
        1. Contents of ``BACKUP_VERSION_FILE`` (backup chart ConfigMap).
        2. ``BACKUP_VERSION`` env var (legacy / local override).
        3. ``"dev"`` fallback for unset local builds.
    """
    file_path = os.environ.get("BACKUP_VERSION_FILE")
    if file_path:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                value = f.read().strip()
            if value:
                return value
        except OSError:
            # File missing / unreadable — fall through to env-var path.
            # Expected on local installs without the backup chart
            # deployed, or before the first kubelet volume refresh.
            pass
    return os.environ.get("BACKUP_VERSION") or "dev"


@router.get("/version")
async def get_version(
    _user: Annotated[User, Depends(_admin)],
) -> dict[str, str]:
    """Return deployed component versions.

    Backend: ``APP_VERSION`` env var, rendered at deploy time by the
    Helm chart from ``.Values.image.tag | default .Chart.AppVersion``
    (with the main-build ``-rc.<ts>.`` timestamp segment stripped —
    see the ``hriv-backend.displayVersion`` helper).  Sourcing from
    the chart rather than a build-time Dockerfile ``ARG`` keeps
    retag-promoted production images (see
    ``.github/workflows/release-retag.yaml``, which aliases a
    ``sha-<full>`` digest as ``vX.Y.Z``/``latest`` without rebuilding)
    reporting the clean ``<ver>`` release string while the main-build
    ``latest`` env reports ``<ver>-rc.<short>``.  Falls back to
    ``"dev"`` when the env var is unset (local ``docker compose`` or
    ad-hoc ``docker run``).

    Backup: resolved by :func:`_read_backup_version` — ConfigMap-mount
    file first, then ``BACKUP_VERSION`` env var, then ``"dev"``.  The
    backup service versions independently of backend, so its version
    is surfaced via the hriv-backup chart's ``version-configmap``
    (which itself uses the same display-version derivation from
    ``.Values.image.tag``).

    Admin-only: version strings leak information about the deployed
    image and are not surfaced to other roles.
    """
    return {
        "backend": os.environ.get("APP_VERSION") or "dev",
        "backup": _read_backup_version(),
    }


# ---------------------------------------------------------------------------
# Snapshot browsing / per-file restore
# ---------------------------------------------------------------------------


@router.get("/backups/snapshots")
async def list_backup_snapshots_endpoint(
    _user: Annotated[User, Depends(_admin)],
):
    """List available backup snapshots for the restore browser."""
    try:
        return await asyncio.to_thread(list_snapshot_blobs)
    except BackupRestoreNotConfiguredError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/backups/snapshots/{snapshot_name}/manifest")
async def get_backup_snapshot_manifest(
    snapshot_name: str,
    _user: Annotated[User, Depends(_admin)],
):
    """Return a snapshot manifest for browsing and per-file restore."""
    try:
        return await asyncio.to_thread(get_snapshot_manifest, snapshot_name)
    except BackupRestoreNotConfiguredError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except BackupSnapshotNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Snapshot {snapshot_name} not found") from exc
    except BackupSnapshotManifestError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/tasks/file-restore")
async def start_file_restore(
    user: Annotated[User, Depends(_admin)],
    bg: BackgroundTasks,
    request: FileRestoreRequest,
    db: AsyncSession = Depends(get_db),
):
    """Restore one file from a snapshot via the admin task queue."""
    try:
        manifest = await asyncio.to_thread(get_snapshot_manifest, request.snapshot_name)
    except BackupRestoreNotConfiguredError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except BackupSnapshotNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Snapshot {request.snapshot_name} not found") from exc
    except BackupSnapshotManifestError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    files = manifest.get("files")
    if not isinstance(files, dict) or request.member_path not in files:
        raise HTTPException(
            status_code=400,
            detail=f"{request.member_path} is not present in snapshot {request.snapshot_name}",
        )

    tasks_dir = _ensure_tasks_dir()
    input_path = os.path.join(tasks_dir, f"restore-{uuid.uuid4().hex}.json")
    with open(input_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "snapshot_name": request.snapshot_name,
                "member_path": request.member_path,
            },
            f,
        )

    try:
        task = await _create_task(db, "file_restore", user, input_path=input_path)
    except Exception:
        try:
            os.unlink(input_path)
        except OSError as exc:
            # Best-effort cleanup only; keep the original task-creation failure.
            logger.debug(
                "Failed to remove temporary restore input file %s: %s",
                input_path,
                exc,
            )
        raise
    await _kick_off(task, bg)
    return _task_to_dict(task)


@router.get("/tasks")
async def list_tasks(
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    """List recent admin tasks (newest first)."""
    result = await db.execute(
        select(AdminTask).order_by(AdminTask.id.desc()).limit(50)
    )
    tasks = result.scalars().all()
    return [_task_to_dict(t) for t in tasks]


@router.get("/tasks/{task_id}")
async def get_task(
    task_id: int,
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    """Get the status of a single admin task."""
    task = await db.get(AdminTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return _task_to_dict(task)


@router.post("/tasks/{task_id}/cancel")
async def cancel_task(
    task_id: int,
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    """Request cancellation of an in-flight admin task.

    * ``pending`` / ``running`` → transitions to ``cancelling``; the
      background runner observes the status change at its next progress
      checkpoint and aborts cleanly.
    * ``cancelling`` → force-transitions to ``cancelled``.  This handles
      the case where a previous cancel request was issued but the runner
      died (pod crash, rollout) before it could finalise cleanup, which
      would otherwise leave the concurrency guard in ``_create_task``
      permanently blocked.  The live ``_update_task`` helper also treats
      ``cancelled`` as a cancellation signal, so a still-alive runner
      will abort on its next checkpoint as well.
    """
    task = await db.get(AdminTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status == "uploading":
        # No background runner exists yet — transition directly to cancelled.
        # Clean up any partially-uploaded file.
        if task.input_path:
            try:
                os.unlink(task.input_path)
            except OSError as exc:
                logger.debug(
                    "Failed to remove partially-uploaded input file %s: %s",
                    task.input_path,
                    exc,
                )
        task.status = "cancelled"
        task.log = (task.log or "") + "Cancelled before upload completed.\n"
    elif task.status in ("pending", "running"):
        task.status = "cancelling"
        task.log = (task.log or "") + "Cancellation requested by admin.\n"
    elif task.status == "cancelling":
        task.status = "cancelled"
        task.log = (
            (task.log or "")
            + "Force-cancelled by admin (task was stuck in 'cancelling').\n"
        )
    elif task.status in ("cancelled", "completed", "failed"):
        pass
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel task in '{task.status}' state",
        )
    await db.commit()
    await db.refresh(task)
    return _task_to_dict(task)


@router.post("/tasks/{task_id}/download-token")
async def create_task_download_token(
    task_id: int,
    user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    """Create a short-lived signed JWT for downloading a task result.

    The token is valid for 60 seconds and allows a single browser-native
    download via ``GET /admin/tasks/{id}/download?token=<token>``.
    """
    task = await db.get(AdminTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status != "completed":
        raise HTTPException(status_code=400, detail="Task has not completed")
    if not task.result_path or not os.path.exists(task.result_path):
        raise HTTPException(status_code=404, detail="Result file not found")

    expire = datetime.now(timezone.utc) + timedelta(seconds=_DOWNLOAD_TOKEN_EXPIRE_SECONDS)
    payload = {
        "sub": str(user.id),
        "purpose": "task-download",
        "task_id": task_id,
        "exp": expire,
    }
    token = jwt.encode(
        payload, auth_settings.jwt_secret, algorithm=auth_settings.jwt_algorithm
    )
    return {"token": token}


@router.get("/tasks/{task_id}/download")
async def download_task_result(
    task_id: int,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Download the result file of a completed export task.

    Authentication is via a short-lived download token obtained from
    ``POST /admin/tasks/{id}/download-token``.  This allows the browser
    to perform a native download without buffering in JS memory.
    """
    # Validate the signed download token (JWT)
    try:
        payload = jwt.decode(
            token,
            auth_settings.jwt_secret,
            algorithms=[auth_settings.jwt_algorithm],
        )
    except JWTError:
        raise HTTPException(
            status_code=401, detail="Invalid or expired download token"
        )
    if payload.get("purpose") != "task-download":
        raise HTTPException(
            status_code=401, detail="Invalid or expired download token"
        )
    if payload.get("task_id") != task_id:
        raise HTTPException(
            status_code=401, detail="Token does not match this task"
        )
    user_id_str = payload.get("sub")
    if not user_id_str:
        raise HTTPException(
            status_code=401, detail="Invalid or expired download token"
        )
    user = await db.get(User, int(user_id_str))
    if user is None or user.role != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")

    task = await db.get(AdminTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status != "completed":
        raise HTTPException(status_code=400, detail="Task has not completed")
    if not task.result_path or not os.path.exists(task.result_path):
        raise HTTPException(status_code=404, detail="Result file not found")

    filename = task.result_filename or "download"
    media = (
        "application/gzip"
        if filename.endswith(".tar.gz")
        else "application/json"
    )

    def _stream():
        with open(task.result_path, "rb") as fh:
            while True:
                chunk = fh.read(_CHUNK_SIZE)
                if not chunk:
                    break
                yield chunk

    return StreamingResponse(
        _stream(),
        media_type=media,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
