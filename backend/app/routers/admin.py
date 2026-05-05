import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from jose import JWTError, jwt
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..admin_ops import (
    _ensure_tasks_dir,
    run_db_export,
    run_db_import,
    run_files_export,
    run_files_import,
)
from ..auth import auth_settings, require_role
from ..database import get_db
from ..maintenance import disable_maintenance_mode, enable_maintenance_mode, is_maintenance_mode
from ..models import AdminTask, User
from ..worker import enqueue_admin_task

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

_admin = require_role("admin")

_CHUNK_SIZE = 1024 * 1024  # 1 MiB streaming chunks
_DOWNLOAD_TOKEN_EXPIRE_SECONDS = 60


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
                AdminTask.status.in_(["uploading", "pending", "running", "cancelling"]),
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
            "files_export": run_files_export,
            "files_import": run_files_import,
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
        except OSError:
            pass
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

    The archive file itself is uploaded separately via
    ``PUT /admin/tasks/{task_id}/upload``.  This two-step flow lets the
    frontend show upload progress (via XHR) and ensures the task record
    exists before the potentially long upload begins — so that timeouts
    or network errors during upload are visible in the task history
    rather than vanishing silently.
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
    task.log = f"Awaiting file upload: {filename}\n"
    await db.commit()
    await db.refresh(task)
    return _task_to_dict(task)


@router.put("/tasks/{task_id}/upload")
async def upload_task_file(
    task_id: int,
    user: Annotated[User, Depends(_admin)],
    bg: BackgroundTasks,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload the archive for a task currently in ``uploading`` status.

    Once the file has been fully streamed to disk the task transitions to
    ``pending`` and is enqueued for background processing via the arq
    worker (with an in-process ``BackgroundTasks`` fallback when Redis is
    unavailable).
    """
    task = await db.get(AdminTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status != "uploading":
        raise HTTPException(
            status_code=409,
            detail=f"Task is in '{task.status}' state, expected 'uploading'",
        )
    if not task.input_path:
        raise HTTPException(status_code=500, detail="Task missing input_path")

    bytes_written = 0
    try:
        with open(task.input_path, "wb") as f:
            while True:
                chunk = await file.read(_TASK_UPLOAD_CHUNK)
                if not chunk:
                    break
                f.write(chunk)
                bytes_written += len(chunk)
    except Exception:
        try:
            os.unlink(task.input_path)
        except OSError:
            pass
        task.status = "failed"
        task.error_message = "File upload failed"
        task.log = (task.log or "") + "ERROR: File upload failed.\n"
        await db.commit()
        raise HTTPException(status_code=500, detail="File upload failed")

    size_mb = bytes_written / (1024 * 1024)

    # Atomic uploading→pending transition.  If cancel_task changed the
    # status between the upload and this UPDATE, the WHERE clause won't
    # match and we detect the race without a TOCTOU window.
    log_line = f"Upload complete ({size_mb:.1f} MB). Queued for processing.\n"
    result = await db.execute(
        update(AdminTask)
        .where(AdminTask.id == task_id, AdminTask.status == "uploading")
        .values(
            status="pending",
            log=AdminTask.log + log_line,
        )
        .returning(AdminTask.id)
    )
    await db.commit()

    if result.scalar() is None:
        # Status changed during upload (e.g. cancelled) — clean up file.
        try:
            os.unlink(task.input_path)
        except OSError:
            pass
        await db.refresh(task)
        raise HTTPException(
            status_code=409,
            detail=f"Task was {task.status} during upload",
        )

    await db.refresh(task)
    await _kick_off(task, bg)
    await db.refresh(task)
    return _task_to_dict(task)


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
            except OSError:
                pass
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
