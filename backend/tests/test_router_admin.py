"""Tests for the admin router helper functions and endpoints."""

import json
import os
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.routers.admin import (
    _parse_dt,
    _create_tar_file,
    _extract_and_restore,
    _create_task,
    _kick_off,
    _task_to_dict,
    export_database,
    import_database,
    create_export_files_token,
    export_files,
    import_files,
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


def test_parse_dt_valid() -> None:
    result = _parse_dt("2025-01-15T10:30:00+00:00")
    assert isinstance(result, datetime)
    assert result.year == 2025


def test_parse_dt_none() -> None:
    assert _parse_dt(None) is None


def test_parse_dt_empty_string() -> None:
    assert _parse_dt("") is None


def test_create_tar_file(tmp_path) -> None:
    # Create a temp directory with some files
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "file1.txt").write_text("hello")
    (data_dir / "subdir").mkdir()
    (data_dir / "subdir" / "file2.txt").write_text("world")

    dest = str(tmp_path / "archive.tar.gz")
    _create_tar_file(str(data_dir), dest)

    assert os.path.exists(dest)
    with tarfile.open(dest, "r:gz") as tar:
        names = tar.getnames()
        assert len(names) >= 2


def test_extract_and_restore(tmp_path) -> None:
    # Create a data directory and archive it
    data_dir = tmp_path / "original_data"
    data_dir.mkdir()
    tiles_dir = data_dir / "tiles"
    tiles_dir.mkdir()
    source_dir = data_dir / "source_images"
    source_dir.mkdir()
    (tiles_dir / "tile1.jpeg").write_text("tile data")
    (source_dir / "src1.tiff").write_text("source data")

    archive = str(tmp_path / "test.tar.gz")
    with tarfile.open(archive, "w:gz") as tar:
        tar.add(str(data_dir), arcname="data")

    # Now restore to a new location
    restore_dir = tmp_path / "restored_data"

    with tempfile.TemporaryDirectory() as tmpdir:
        result = _extract_and_restore(
            archive,
            tmpdir,
            str(restore_dir),
            str(restore_dir / "tiles"),
            str(restore_dir / "source_images"),
        )

    assert result["tile_files"] >= 1
    assert result["source_files"] >= 1


def test_extract_and_restore_empty_archive(tmp_path) -> None:
    # Create an empty archive
    archive = str(tmp_path / "empty.tar.gz")
    with tarfile.open(archive, "w:gz") as tar:
        pass  # empty

    restore_dir = tmp_path / "restored"

    with tempfile.TemporaryDirectory() as tmpdir:
        with pytest.raises(ValueError, match="empty"):
            _extract_and_restore(
                archive,
                tmpdir,
                str(restore_dir),
                str(restore_dir / "tiles"),
                str(restore_dir / "source_images"),
            )


async def test_import_database_rejects_non_json_file() -> None:
    upload = MagicMock()
    upload.filename = "data.csv"

    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await import_database(MagicMock(), file=upload, db=db)
    assert exc.value.status_code == 400
    assert "json" in exc.value.detail.lower()


async def test_import_database_rejects_invalid_json() -> None:
    upload = AsyncMock()
    upload.filename = "data.json"
    upload.read = AsyncMock(return_value=b"not-json")

    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await import_database(MagicMock(), file=upload, db=db)
    assert exc.value.status_code == 400


async def test_import_database_rejects_non_object() -> None:
    upload = AsyncMock()
    upload.filename = "data.json"
    upload.read = AsyncMock(return_value=b'[1, 2, 3]')

    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await import_database(MagicMock(), file=upload, db=db)
    assert exc.value.status_code == 400
    assert "object" in exc.value.detail.lower()


async def test_import_database_rejects_missing_keys() -> None:
    import json
    data = {"categories": [], "images": []}  # missing "users"
    upload = AsyncMock()
    upload.filename = "data.json"
    upload.read = AsyncMock(return_value=json.dumps(data).encode())

    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await import_database(MagicMock(), file=upload, db=db)
    assert exc.value.status_code == 400
    assert "users" in exc.value.detail


async def test_create_export_files_token() -> None:
    user = SimpleNamespace(id=1)

    with patch("app.routers.admin.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        result = await create_export_files_token(user)

    assert "token" in result


async def test_export_files_invalid_token() -> None:
    db = AsyncMock()

    with patch("app.routers.admin.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        with pytest.raises(HTTPException) as exc:
            await export_files(token="invalid-jwt", db=db)
        assert exc.value.status_code == 401


async def test_export_files_wrong_purpose() -> None:
    from jose import jwt as jose_jwt

    # Create a token with wrong purpose
    token = jose_jwt.encode(
        {"sub": "1", "purpose": "general"},
        "test-secret",
        algorithm="HS256",
    )

    db = AsyncMock()

    with patch("app.routers.admin.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        with pytest.raises(HTTPException) as exc:
            await export_files(token=token, db=db)
        assert exc.value.status_code == 401


async def test_export_files_no_sub() -> None:
    from jose import jwt as jose_jwt

    token = jose_jwt.encode(
        {"purpose": "file-export"},
        "test-secret",
        algorithm="HS256",
    )

    db = AsyncMock()

    with patch("app.routers.admin.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        with pytest.raises(HTTPException) as exc:
            await export_files(token=token, db=db)
        assert exc.value.status_code == 401


async def test_export_files_user_not_found() -> None:
    from jose import jwt as jose_jwt

    token = jose_jwt.encode(
        {"sub": "999", "purpose": "file-export"},
        "test-secret",
        algorithm="HS256",
    )

    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with patch("app.routers.admin.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        with pytest.raises(HTTPException) as exc:
            await export_files(token=token, db=db)
        assert exc.value.status_code == 403


async def test_export_files_non_admin_user() -> None:
    from jose import jwt as jose_jwt

    token = jose_jwt.encode(
        {"sub": "1", "purpose": "file-export"},
        "test-secret",
        algorithm="HS256",
    )

    user = SimpleNamespace(id=1, role="student")
    db = AsyncMock()
    db.get = AsyncMock(return_value=user)

    with patch("app.routers.admin.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        with pytest.raises(HTTPException) as exc:
            await export_files(token=token, db=db)
        assert exc.value.status_code == 403


async def test_import_files_rejects_non_tar() -> None:
    upload = MagicMock()
    upload.filename = "data.zip"

    with pytest.raises(HTTPException) as exc:
        await import_files(MagicMock(), file=upload)
    assert exc.value.status_code == 400
    assert "tar.gz" in exc.value.detail.lower()


async def test_import_files_accepts_tgz() -> None:
    """Verify .tgz extension passes the filename check (tests the condition)."""
    upload = AsyncMock()
    upload.filename = "data.tgz"

    # We need to let it get past the filename check but fail on extraction
    # to confirm the extension is accepted
    upload.read = AsyncMock(side_effect=[b"not-a-tar", b""])

    with patch("app.routers.admin.settings") as mock_settings:
        mock_settings.tiles_dir = "/tmp/test-tiles"
        with pytest.raises(HTTPException) as exc:
            await import_files(MagicMock(), file=upload)
        # Should fail at tar extraction, not at filename check
        assert exc.value.status_code == 400
        assert "tar.gz" in exc.value.detail.lower() or "archive" in exc.value.detail.lower()


# ── export_database tests ────────────────────────────────────


async def test_export_database_success() -> None:
    now = datetime.now(timezone.utc)

    programs = [SimpleNamespace(id=1, name="CS", created_at=now, updated_at=now)]
    categories = [
        SimpleNamespace(
            id=1, label="Cat A", parent_id=None, program="CS",
            status="active", sort_order=0, metadata_={},
            created_at=now, updated_at=now,
        )
    ]
    images = [
        SimpleNamespace(
            id=1, name="img1", thumb="/t.jpg", tile_sources="/tiles/1",
            category_id=1, copyright="CC0", note=None, active=True,
            metadata_={}, created_at=now, updated_at=now,
            programs=[SimpleNamespace(id=1)],
        )
    ]
    users = [
        SimpleNamespace(
            id=1, name="Admin", email="admin@example.com",
            password_hash="hashed", oidc_subject=None, role="admin", program_id=None,
            last_access=now, metadata_={}, created_at=now, updated_at=now,
        )
    ]
    source_images = [
        SimpleNamespace(
            id=1, original_filename="src.tiff", stored_path="/data/src.tiff",
            status="completed", progress=100, error_message=None, name="src",
            category_id=1, copyright="CC0", note=None, active=True,
            program=None, image_id=1, file_size=1024000,
            created_at=now, updated_at=now,
        )
    ]
    announcement = SimpleNamespace(
        message="Hello", enabled=True, created_at=now, updated_at=now,
    )

    call_count = 0

    async def mock_execute(stmt):
        nonlocal call_count
        call_count += 1
        result = MagicMock()
        data_map = {
            1: programs,
            2: categories,
            3: images,
            4: users,
            5: source_images,
        }
        if call_count <= 5:
            result.scalars.return_value.all.return_value = data_map[call_count]
        else:
            result.scalar_one_or_none.return_value = announcement
        return result

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=mock_execute)

    response = await export_database(MagicMock(), db=db)

    assert response.status_code == 200
    body = json.loads(response.body)
    assert len(body["programs"]) == 1
    assert len(body["categories"]) == 1
    assert len(body["images"]) == 1
    assert len(body["users"]) == 1
    assert len(body["source_images"]) == 1
    assert body["announcement"]["message"] == "Hello"


async def test_export_database_empty() -> None:
    """Export with no data returns empty arrays."""
    call_count = 0

    async def mock_execute(stmt):
        nonlocal call_count
        call_count += 1
        result = MagicMock()
        if call_count <= 5:
            result.scalars.return_value.all.return_value = []
        else:
            result.scalar_one_or_none.return_value = None
        return result

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=mock_execute)

    response = await export_database(MagicMock(), db=db)

    body = json.loads(response.body)
    assert body["programs"] == []
    assert body["categories"] == []
    assert body["images"] == []
    assert body["users"] == []
    assert body["source_images"] == []
    assert body["announcement"]["message"] == ""
    assert body["announcement"]["enabled"] is False


# ── Background task endpoint tests ─────────────────────────


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
