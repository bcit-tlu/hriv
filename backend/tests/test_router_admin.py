"""Tests for the admin router background task endpoints."""

import os
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.routers.admin import (
    _create_task,
    _kick_off,
    _task_to_dict,
    start_db_export,
    start_db_import,
    start_files_export,
    start_files_import,
    list_tasks,
    get_task,
    cancel_task,
    create_task_download_token,
    download_task_result,
)


def _make_admin_task(
    id=1,
    task_type="db_export",
    status="pending",
    progress=0,
    log="",
    result_filename=None,
    result_path=None,
    input_path=None,
    error_message=None,
    created_by=1,
    created_at=None,
    updated_at=None,
):
    now = created_at or datetime.now(timezone.utc)
    return SimpleNamespace(
        id=id,
        task_type=task_type,
        status=status,
        progress=progress,
        log=log,
        result_filename=result_filename,
        result_path=result_path,
        input_path=input_path,
        error_message=error_message,
        created_by=created_by,
        created_at=now,
        updated_at=updated_at or now,
    )


def test_task_to_dict() -> None:
    now = datetime.now(timezone.utc)
    task = _make_admin_task(created_at=now, updated_at=now)
    d = _task_to_dict(task)
    assert d["id"] == 1
    assert d["task_type"] == "db_export"
    assert d["status"] == "pending"
    assert d["progress"] == 0
    assert d["created_at"] == now.isoformat()


async def test_create_task() -> None:
    db = AsyncMock()
    user = SimpleNamespace(id=42)

    # No existing task of the same type
    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = None
    db.execute = AsyncMock(return_value=mock_result)

    # Mock refresh to set the id
    async def mock_refresh(obj):
        obj.id = 1
        obj.task_type = "db_export"
        obj.status = "pending"
        obj.progress = 0
        obj.log = ""
        obj.result_filename = None
        obj.error_message = None
        obj.created_by = 42
        obj.created_at = datetime.now(timezone.utc)
        obj.updated_at = datetime.now(timezone.utc)

    db.refresh = AsyncMock(side_effect=mock_refresh)

    task = await _create_task(db, "db_export", user)
    db.add.assert_called_once()
    db.commit.assert_awaited_once()
    assert task.task_type == "db_export"
    assert task.created_by == 42


async def test_create_task_rejects_concurrent() -> None:
    """_create_task returns 409 if a task of the same type is already active."""
    db = AsyncMock()
    user = SimpleNamespace(id=42)

    existing = _make_admin_task(id=7, task_type="db_import", status="running")
    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = existing
    db.execute = AsyncMock(return_value=mock_result)

    with pytest.raises(HTTPException) as exc:
        await _create_task(db, "db_import", user)
    assert exc.value.status_code == 409
    assert "already running" in exc.value.detail
    assert "#7" in exc.value.detail


async def test_kick_off_redis_available() -> None:
    task = _make_admin_task(task_type="db_export")
    bg = MagicMock()

    with patch("app.routers.admin.enqueue_admin_task", new_callable=AsyncMock, return_value=True):
        await _kick_off(task, bg)

    # Should NOT add to BackgroundTasks when Redis is available
    bg.add_task.assert_not_called()


async def test_kick_off_redis_unavailable() -> None:
    task = _make_admin_task(task_type="db_export")
    bg = MagicMock()

    with patch("app.routers.admin.enqueue_admin_task", new_callable=AsyncMock, return_value=False):
        await _kick_off(task, bg)

    # Falls back to BackgroundTasks
    bg.add_task.assert_called_once()


async def test_start_db_export() -> None:
    user = SimpleNamespace(id=1)
    bg = MagicMock()
    db = AsyncMock()

    # No existing task of the same type (concurrency check)
    mock_exec_result = MagicMock()
    mock_exec_result.scalars.return_value.first.return_value = None
    db.execute = AsyncMock(return_value=mock_exec_result)

    task = _make_admin_task()

    async def mock_refresh(obj):
        for k, v in vars(task).items():
            setattr(obj, k, v)

    db.refresh = AsyncMock(side_effect=mock_refresh)

    with patch("app.routers.admin.enqueue_admin_task", new_callable=AsyncMock, return_value=True):
        result = await start_db_export(user, bg, db=db)

    assert result["task_type"] == "db_export"
    assert result["status"] == "pending"


async def test_start_db_import_rejects_non_json() -> None:
    user = SimpleNamespace(id=1)
    bg = MagicMock()

    upload = MagicMock()
    upload.filename = "data.csv"

    with pytest.raises(HTTPException) as exc:
        await start_db_import(user, bg, file=upload, db=AsyncMock())
    assert exc.value.status_code == 400
    assert "json" in exc.value.detail.lower()


async def test_start_files_import_rejects_non_tar() -> None:
    user = SimpleNamespace(id=1)
    bg = MagicMock()

    upload = MagicMock()
    upload.filename = "data.zip"

    with pytest.raises(HTTPException) as exc:
        await start_files_import(user, bg, file=upload, db=AsyncMock())
    assert exc.value.status_code == 400
    assert "tar.gz" in exc.value.detail.lower()


async def test_list_tasks() -> None:
    task1 = _make_admin_task(id=1)
    task2 = _make_admin_task(id=2, task_type="files_export")

    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [task2, task1]

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    result = await list_tasks(MagicMock(), db=db)
    assert len(result) == 2
    assert result[0]["id"] == 2
    assert result[1]["id"] == 1


async def test_get_task_found() -> None:
    task = _make_admin_task(id=5)

    db = AsyncMock()
    db.get = AsyncMock(return_value=task)

    result = await get_task(5, MagicMock(), db=db)
    assert result["id"] == 5


async def test_get_task_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await get_task(999, MagicMock(), db=db)
    assert exc.value.status_code == 404


async def test_cancel_task_success() -> None:
    task = _make_admin_task(status="running")
    db = AsyncMock()
    db.get = AsyncMock(return_value=task)
    db.refresh = AsyncMock()

    result = await cancel_task(1, MagicMock(), db=db)
    assert result["status"] == "cancelling"
    assert "Cancellation requested" in (task.log or "")


async def test_cancel_task_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await cancel_task(999, MagicMock(), db=db)
    assert exc.value.status_code == 404


async def test_cancel_task_already_completed() -> None:
    task = _make_admin_task(status="completed")
    db = AsyncMock()
    db.get = AsyncMock(return_value=task)

    with pytest.raises(HTTPException) as exc:
        await cancel_task(1, MagicMock(), db=db)
    assert exc.value.status_code == 400


async def test_cancel_task_pending() -> None:
    task = _make_admin_task(status="pending")
    db = AsyncMock()
    db.get = AsyncMock(return_value=task)
    db.refresh = AsyncMock()

    result = await cancel_task(1, MagicMock(), db=db)
    assert result["status"] == "cancelling"


async def test_create_task_download_token_success(tmp_path) -> None:
    filepath = tmp_path / "export.json"
    filepath.write_text('{"data": true}')
    task = _make_admin_task(
        status="completed",
        result_path=str(filepath),
        result_filename="export.json",
    )
    user = SimpleNamespace(id=1, role="admin")
    db = AsyncMock()
    db.get = AsyncMock(return_value=task)

    with patch("app.routers.admin.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        result = await create_task_download_token(1, user, db=db)

    assert "token" in result


async def test_create_task_download_token_not_completed() -> None:
    task = _make_admin_task(status="running")
    user = SimpleNamespace(id=1, role="admin")
    db = AsyncMock()
    db.get = AsyncMock(return_value=task)

    with pytest.raises(HTTPException) as exc:
        await create_task_download_token(1, user, db=db)
    assert exc.value.status_code == 400


def _make_download_token(task_id: int, user_id: int = 1) -> str:
    """Create a valid task-download JWT for testing."""
    from jose import jwt as jose_jwt

    return jose_jwt.encode(
        {"sub": str(user_id), "purpose": "task-download", "task_id": task_id},
        "test-secret",
        algorithm="HS256",
    )


async def test_download_task_invalid_token() -> None:
    db = AsyncMock()

    with patch("app.routers.admin.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        with pytest.raises(HTTPException) as exc:
            await download_task_result(1, token="invalid-jwt", db=db)
        assert exc.value.status_code == 401


async def test_download_task_wrong_purpose() -> None:
    from jose import jwt as jose_jwt

    token = jose_jwt.encode(
        {"sub": "1", "purpose": "general", "task_id": 1},
        "test-secret",
        algorithm="HS256",
    )
    db = AsyncMock()

    with patch("app.routers.admin.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        with pytest.raises(HTTPException) as exc:
            await download_task_result(1, token=token, db=db)
        assert exc.value.status_code == 401


async def test_download_task_wrong_task_id() -> None:
    token = _make_download_token(task_id=99)
    db = AsyncMock()

    with patch("app.routers.admin.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        with pytest.raises(HTTPException) as exc:
            await download_task_result(1, token=token, db=db)
        assert exc.value.status_code == 401


async def test_download_task_not_found() -> None:
    token = _make_download_token(task_id=999)
    admin_user = SimpleNamespace(id=1, role="admin")
    db = AsyncMock()
    db.get = AsyncMock(side_effect=lambda model, id_: admin_user if model.__name__ == "User" else None)

    with patch("app.routers.admin.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        with pytest.raises(HTTPException) as exc:
            await download_task_result(999, token=token, db=db)
        assert exc.value.status_code == 404


async def test_download_task_not_completed() -> None:
    task = _make_admin_task(status="running")
    admin_user = SimpleNamespace(id=1, role="admin")
    token = _make_download_token(task_id=1)

    db = AsyncMock()
    call_count = 0

    async def _get(model, id_):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return admin_user  # User lookup
        return task  # AdminTask lookup

    db.get = AsyncMock(side_effect=_get)

    with patch("app.routers.admin.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        with pytest.raises(HTTPException) as exc:
            await download_task_result(1, token=token, db=db)
        assert exc.value.status_code == 400


async def test_download_task_result_file_missing() -> None:
    task = _make_admin_task(
        status="completed",
        result_path="/nonexistent/file.json",
        result_filename="export.json",
    )
    admin_user = SimpleNamespace(id=1, role="admin")
    token = _make_download_token(task_id=1)

    db = AsyncMock()
    call_count = 0

    async def _get(model, id_):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return admin_user
        return task

    db.get = AsyncMock(side_effect=_get)

    with patch("app.routers.admin.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        with pytest.raises(HTTPException) as exc:
            await download_task_result(1, token=token, db=db)
        assert exc.value.status_code == 404


async def test_download_task_success(tmp_path) -> None:
    filepath = tmp_path / "export.json"
    filepath.write_text('{"test": true}')

    task = _make_admin_task(
        status="completed",
        result_path=str(filepath),
        result_filename="export.json",
    )
    admin_user = SimpleNamespace(id=1, role="admin")
    token = _make_download_token(task_id=1)

    db = AsyncMock()
    call_count = 0

    async def _get(model, id_):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return admin_user
        return task

    db.get = AsyncMock(side_effect=_get)

    with patch("app.routers.admin.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        response = await download_task_result(1, token=token, db=db)
    assert response.media_type == "application/json"
    assert "export.json" in response.headers.get("content-disposition", "")


async def test_download_task_tar_gz(tmp_path) -> None:
    filepath = tmp_path / "export.tar.gz"
    filepath.write_bytes(b"\x00" * 100)

    task = _make_admin_task(
        status="completed",
        result_path=str(filepath),
        result_filename="hriv-files.tar.gz",
    )
    admin_user = SimpleNamespace(id=1, role="admin")
    token = _make_download_token(task_id=1)

    db = AsyncMock()
    call_count = 0

    async def _get(model, id_):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return admin_user
        return task

    db.get = AsyncMock(side_effect=_get)

    with patch("app.routers.admin.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        response = await download_task_result(1, token=token, db=db)
    assert response.media_type == "application/gzip"
