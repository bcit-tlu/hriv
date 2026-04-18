import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from jose import JWTError, jwt
from sqlalchemy import select
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
from ..models import AdminTask, User
from ..worker import enqueue_admin_task

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

_admin = require_role("admin")

_CHUNK_SIZE = 1024 * 1024  # 1 MiB streaming chunks
_DOWNLOAD_TOKEN_EXPIRE_SECONDS = 60


# ---------------------------------------------------------------------------
# Background admin tasks
# ---------------------------------------------------------------------------

_TASK_UPLOAD_CHUNK = 1024 * 1024  # 1 MiB


async def _create_task(
    db: AsyncSession,
    task_type: str,
    user: User,
    input_path: str | None = None,
) -> AdminTask:
    # Reject if a task of the same type is already pending or running
    existing = (
        await db.execute(
            select(AdminTask).where(
                AdminTask.task_type == task_type,
                AdminTask.status.in_(["pending", "running", "cancelling"]),
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
        status="pending",
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
    bg: BackgroundTasks,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Accept a tar.gz file and kick off a background filesystem import."""
    if not file.filename or not (
        file.filename.endswith(".tar.gz") or file.filename.endswith(".tgz")
    ):
        raise HTTPException(status_code=400, detail="Only .tar.gz / .tgz files are accepted")

    tasks_dir = _ensure_tasks_dir()
    input_path = os.path.join(tasks_dir, f"import-{uuid.uuid4().hex}.tar.gz")
    with open(input_path, "wb") as f:
        while True:
            chunk = await file.read(_TASK_UPLOAD_CHUNK)
            if not chunk:
                break
            f.write(chunk)

    try:
        task = await _create_task(db, "files_import", user, input_path=input_path)
    except Exception:
        try:
            os.unlink(input_path)
        except OSError:
            pass
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
    if task.status in ("pending", "running"):
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
