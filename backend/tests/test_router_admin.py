"""Tests for the admin router background task endpoints."""

import os
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import json
import pytest

from app.backup_access import (
    BackupRestoreNotConfiguredError,
    BackupSnapshotManifestError,
    BackupSnapshotNotFoundError,
)
from app.routers import admin as admin_router
from app.routers.admin import (
    _create_task,
    _kick_off,
    _safe_admin_task_file,
    _task_to_dict,
    list_backup_snapshots_endpoint,
    get_backup_snapshot_manifest,
    get_version,
    list_export_archives,
    purge_backup_archive,
    start_file_restore,
    start_db_export,
    start_db_import,
    start_files_export,
    start_files_import,
    list_files_import_archives_endpoint,
    rerun_files_import,
    delete_files_import_archive_endpoint,
    start_rebuild_tiles,
    upload_task_file,
    list_tasks,
    get_task,
    cancel_task,
    create_task_download_token,
    download_task_result,
)
from app.schemas import FileRestoreRequest, FilesImportRerunRequest, RebuildTilesRequest


def _make_admin_task(
    id=1,
    task_type="db_export",
    status="pending",
    progress=0,
    log="",
    result_filename=None,
    result_path=None,
    input_path=None,
    original_filename=None,
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
        original_filename=original_filename,
        error_message=error_message,
        created_by=created_by,
        created_at=now,
        updated_at=updated_at or now,
    )


_VERSION_ENV_KEYS = ("APP_VERSION", "BACKUP_VERSION", "BACKUP_VERSION_FILE")


def _version_env(**overrides: str) -> dict[str, str]:
    """Build an env dict with all version-related keys cleared, then applied.

    ``patch.dict(..., clear=True)`` would drop PATH / pytest config / etc.;
    instead we copy the current env, strip the three version-related
    keys, and layer in just the overrides the test wants so one test's
    env leaks can't silently flip another's precedence.
    """
    env = {k: v for k, v in os.environ.items() if k not in _VERSION_ENV_KEYS}
    env.update(overrides)
    return env


async def test_get_version_returns_env_values() -> None:
    """With no ConfigMap mount, env vars are the source of truth."""
    with patch.dict(
        os.environ,
        _version_env(APP_VERSION="1.2.3", BACKUP_VERSION="4.5.6"),
        clear=True,
    ):
        result = await get_version(_user=SimpleNamespace(id=1, role="admin"))
    assert result == {"backend": "1.2.3", "backup": "4.5.6"}


async def test_get_version_defaults_to_dev() -> None:
    """Unset env vars fall back to 'dev' so local builds still render."""
    with patch.dict(os.environ, _version_env(), clear=True):
        result = await get_version(_user=SimpleNamespace(id=1, role="admin"))
    assert result == {"backend": "dev", "backup": "dev"}


async def test_get_version_empty_env_falls_back_to_dev() -> None:
    """Empty string env vars (chart default for BACKUP_VERSION) → 'dev'."""
    with patch.dict(
        os.environ,
        _version_env(APP_VERSION="", BACKUP_VERSION=""),
        clear=True,
    ):
        result = await get_version(_user=SimpleNamespace(id=1, role="admin"))
    assert result == {"backend": "dev", "backup": "dev"}


async def test_get_version_reads_backup_from_configmap_mount(tmp_path) -> None:
    """ConfigMap mount wins over BACKUP_VERSION env var."""
    version_file = tmp_path / "version"
    version_file.write_text("0.3.1-head.abc1234\n")
    with patch.dict(
        os.environ,
        _version_env(
            APP_VERSION="0.6.0",
            BACKUP_VERSION="legacy-should-be-ignored",
            BACKUP_VERSION_FILE=str(version_file),
        ),
        clear=True,
    ):
        result = await get_version(_user=SimpleNamespace(id=1, role="admin"))
    # Trailing whitespace/newline from the ConfigMap projection is stripped
    # so the footer stays tidy.
    assert result == {"backend": "0.6.0", "backup": "0.3.1-head.abc1234"}


async def test_get_version_falls_back_to_env_when_mount_missing(tmp_path) -> None:
    """If BACKUP_VERSION_FILE points to a missing file, env var wins."""
    missing = tmp_path / "does-not-exist" / "version"
    with patch.dict(
        os.environ,
        _version_env(
            APP_VERSION="0.6.0",
            BACKUP_VERSION="0.3.0",
            BACKUP_VERSION_FILE=str(missing),
        ),
        clear=True,
    ):
        result = await get_version(_user=SimpleNamespace(id=1, role="admin"))
    assert result == {"backend": "0.6.0", "backup": "0.3.0"}


async def test_get_version_falls_back_to_env_when_mount_empty(tmp_path) -> None:
    """Empty ConfigMap key (blank file) falls through to env var."""
    version_file = tmp_path / "version"
    version_file.write_text("   \n")
    with patch.dict(
        os.environ,
        _version_env(
            APP_VERSION="0.6.0",
            BACKUP_VERSION="0.3.0",
            BACKUP_VERSION_FILE=str(version_file),
        ),
        clear=True,
    ):
        result = await get_version(_user=SimpleNamespace(id=1, role="admin"))
    assert result == {"backend": "0.6.0", "backup": "0.3.0"}


async def test_get_version_falls_back_to_dev_when_mount_and_env_missing(tmp_path) -> None:
    """Missing mount + unset env var → 'dev' (local dev fallback)."""
    missing = tmp_path / "version"
    with patch.dict(
        os.environ,
        _version_env(BACKUP_VERSION_FILE=str(missing)),
        clear=True,
    ):
        result = await get_version(_user=SimpleNamespace(id=1, role="admin"))
    assert result == {"backend": "dev", "backup": "dev"}


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


async def test_start_rebuild_tiles_creates_task(tmp_path) -> None:
    """The rebuild endpoint persists params and creates a pending task."""
    user = SimpleNamespace(id=1)
    bg = MagicMock()
    db = AsyncMock()

    mock_exec_result = MagicMock()
    mock_exec_result.scalars.return_value.first.return_value = None
    db.execute = AsyncMock(return_value=mock_exec_result)

    task = _make_admin_task(task_type="rebuild_tiles")

    async def mock_refresh(obj):
        for k, v in vars(task).items():
            setattr(obj, k, v)

    db.refresh = AsyncMock(side_effect=mock_refresh)

    tasks_dir = str(tmp_path / "admin_tasks")
    request = RebuildTilesRequest(scope="missing", image_ids=[7, 9])

    with (
        patch("app.admin_ops._TASKS_DIR", tasks_dir),
        patch("app.routers.admin.enqueue_admin_task", new_callable=AsyncMock, return_value=True),
    ):
        result = await start_rebuild_tiles(user, bg, request=request, db=db)

    assert result["task_type"] == "rebuild_tiles"
    assert result["status"] == "pending"

    # The params file was written with the requested scope and image_ids.
    param_files = [f for f in os.listdir(tasks_dir) if f.startswith("rebuild-")]
    assert len(param_files) == 1
    with open(os.path.join(tasks_dir, param_files[0])) as f:
        params = json.load(f)
    assert params == {"scope": "missing", "image_ids": [7, 9]}


async def test_start_file_restore_creates_task(tmp_path) -> None:
    user = SimpleNamespace(id=1)
    bg = MagicMock()
    db = AsyncMock()

    mock_exec_result = MagicMock()
    mock_exec_result.scalars.return_value.first.return_value = None
    db.execute = AsyncMock(return_value=mock_exec_result)

    task = _make_admin_task(task_type="file_restore")

    async def mock_refresh(obj):
        for k, v in vars(task).items():
            setattr(obj, k, v)

    db.refresh = AsyncMock(side_effect=mock_refresh)

    tasks_dir = str(tmp_path / "admin_tasks")
    request = FileRestoreRequest(
        snapshot_name="hriv-backup-20260102-020000",
        member_path="data/source_images/a.jpg",
    )

    manifest = {
        "snapshot_name": request.snapshot_name,
        "files": {
            request.member_path: {"size": 3, "sha256": "abc"},
        },
    }

    with (
        patch("app.admin_ops._TASKS_DIR", tasks_dir),
        patch("app.routers.admin.get_snapshot_manifest", return_value=manifest),
        patch("app.routers.admin.enqueue_admin_task", new_callable=AsyncMock, return_value=True),
    ):
        result = await start_file_restore(user, bg, request=request, db=db)

    assert result["task_type"] == "file_restore"
    assert result["status"] == "pending"

    param_files = [f for f in os.listdir(tasks_dir) if f.startswith("restore-")]
    assert len(param_files) == 1
    with open(os.path.join(tasks_dir, param_files[0])) as f:
        params = json.load(f)
    assert params == {
        "snapshot_name": request.snapshot_name,
        "member_path": request.member_path,
    }


async def test_list_backup_snapshots_disabled_returns_400() -> None:
    with patch(
        "app.routers.admin.list_snapshot_blobs",
        side_effect=BackupRestoreNotConfiguredError("backup restore is not configured"),
    ):
        with pytest.raises(HTTPException) as exc:
            await list_backup_snapshots_endpoint(MagicMock())
    assert exc.value.status_code == 400


async def test_get_backup_snapshot_manifest_not_configured_returns_400() -> None:
    with patch(
        "app.routers.admin.get_snapshot_manifest",
        side_effect=BackupRestoreNotConfiguredError("backup restore is not configured"),
    ):
        with pytest.raises(HTTPException) as exc:
            await get_backup_snapshot_manifest("hriv-backup-20260102-020000", MagicMock())
    assert exc.value.status_code == 400


async def test_get_backup_snapshot_manifest_invalid_manifest_returns_500() -> None:
    with patch(
        "app.routers.admin.get_snapshot_manifest",
        side_effect=BackupSnapshotManifestError("manifest.json could not be parsed"),
    ):
        with pytest.raises(HTTPException) as exc:
            await get_backup_snapshot_manifest("hriv-backup-20260102-020000", MagicMock())
    assert exc.value.status_code == 500
    assert exc.value.detail == "manifest.json could not be parsed"


async def test_get_backup_snapshot_manifest_missing_archive_returns_404() -> None:
    with patch(
        "app.routers.admin.get_snapshot_manifest",
        side_effect=BackupSnapshotNotFoundError("hriv-backup-20260102-020000"),
    ):
        with pytest.raises(HTTPException) as exc:
            await get_backup_snapshot_manifest("hriv-backup-20260102-020000", MagicMock())
    assert exc.value.status_code == 404
    assert exc.value.detail == "Snapshot hriv-backup-20260102-020000 not found"


def test_rebuild_tiles_request_defaults_and_validation() -> None:
    """The request model defaults to missing_stale and rejects bad scopes."""
    assert RebuildTilesRequest().scope == "missing_stale"
    assert RebuildTilesRequest().image_ids is None
    with pytest.raises(ValueError, match="scope must be one of"):
        RebuildTilesRequest(scope="nonsense")


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

    with pytest.raises(HTTPException) as exc:
        await start_files_import(user, db=AsyncMock(), filename="data.zip")
    assert exc.value.status_code == 400
    assert "tar.gz" in exc.value.detail.lower()


async def test_start_files_import_creates_uploading_task() -> None:
    """Valid filename → task with ``uploading`` status is returned."""
    user = SimpleNamespace(id=1)
    db = AsyncMock()

    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = None
    db.execute = AsyncMock(return_value=mock_result)

    task_template = _make_admin_task(task_type="files_import", status="uploading")

    async def mock_refresh(obj, *_args, **_kwargs):
        for k, v in vars(task_template).items():
            setattr(obj, k, v)

    db.refresh = AsyncMock(side_effect=mock_refresh)

    with patch("app.routers.admin._ensure_tasks_dir", return_value="/tmp/tasks"):
        result = await start_files_import(user, db=db, filename="backup.tar.gz")

    assert result["task_type"] == "files_import"
    assert result["status"] == "uploading"




async def test_list_files_import_archives_endpoint_response_model_validation() -> None:
    app = FastAPI()
    app.include_router(admin_router.router, prefix="/api")

    async def override_db():
        yield AsyncMock()

    app.dependency_overrides[admin_router._admin] = lambda: SimpleNamespace(id=1, role="admin")
    app.dependency_overrides[admin_router.get_db] = override_db

    archives = [
        {
            "archive_task_id": 7,
            "original_filename": "backup.tar.gz",
            "size_bytes": 123,
            "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
            "last_status": "completed",
        }
    ]

    with patch(
        "app.routers.admin.list_files_import_archives",
        new_callable=AsyncMock,
        return_value=archives,
    ):
        with TestClient(app) as client:
            response = client.get("/api/admin/tasks/files-import/archives")

    assert response.status_code == 200
    assert response.json() == [
        {
            "archive_task_id": 7,
            "original_filename": "backup.tar.gz",
            "size_bytes": 123,
            "created_at": "2026-01-01T00:00:00Z",
            "last_status": "completed",
        }
    ]


async def test_list_files_import_archives_endpoint() -> None:
    user = SimpleNamespace(id=1)
    archives = [
        {
            "archive_task_id": 7,
            "original_filename": "backup.tar.gz",
            "size_bytes": 123,
            "created_at": datetime.now(timezone.utc),
            "last_status": "completed",
        }
    ]

    with patch(
        "app.routers.admin.list_files_import_archives",
        new_callable=AsyncMock,
        return_value=archives,
    ):
        result = await list_files_import_archives_endpoint(user, db=AsyncMock())

    assert result == archives


async def test_rerun_files_import_creates_pending_task() -> None:
    user = SimpleNamespace(id=1)
    bg = MagicMock()
    db = AsyncMock()
    task = _make_admin_task(task_type="files_import", status="pending")

    with (
        patch(
            "app.routers.admin.rerun_files_import_archive",
            new_callable=AsyncMock,
            return_value=task,
        ),
        patch("app.routers.admin.enqueue_admin_task", new_callable=AsyncMock, return_value=True),
    ):
        result = await rerun_files_import(user, bg, FilesImportRerunRequest(archive_task_id=7), db=db)

    assert result["task_type"] == "files_import"
    assert result["status"] == "pending"


async def test_rerun_files_import_concurrency_guard_returns_409() -> None:
    user = SimpleNamespace(id=1)
    bg = MagicMock()
    db = AsyncMock()

    with patch(
        "app.routers.admin.rerun_files_import_archive",
        side_effect=HTTPException(status_code=409, detail="already running"),
    ):
        with pytest.raises(HTTPException) as exc:
            await rerun_files_import(user, bg, FilesImportRerunRequest(archive_task_id=7), db=db)
    assert exc.value.status_code == 409


async def test_rerun_files_import_traversal_rejected_returns_400() -> None:
    user = SimpleNamespace(id=1)
    bg = MagicMock()
    db = AsyncMock()

    with patch(
        "app.routers.admin.rerun_files_import_archive",
        side_effect=ValueError("Archive path is outside admin_tasks dir"),
    ):
        with pytest.raises(HTTPException) as exc:
            await rerun_files_import(user, bg, FilesImportRerunRequest(archive_task_id=7), db=db)

    assert exc.value.status_code == 400


async def test_delete_files_import_archive_endpoint_happy_path() -> None:
    with patch(
        "app.routers.admin.delete_files_import_archive",
        new_callable=AsyncMock,
        return_value={"archive_task_id": 7, "deleted": True, "path": "/data/admin_tasks/import-1.tar.gz"},
    ):
        result = await delete_files_import_archive_endpoint(7, MagicMock(), db=AsyncMock())

    assert result["deleted"] is True
    assert result["archive_task_id"] == 7


async def test_delete_files_import_archive_endpoint_missing_archive_returns_404() -> None:
    with patch(
        "app.routers.admin.delete_files_import_archive",
        side_effect=FileNotFoundError("Archive file not found"),
    ):
        with pytest.raises(HTTPException) as exc:
            await delete_files_import_archive_endpoint(7, MagicMock(), db=AsyncMock())

    assert exc.value.status_code == 404


async def test_delete_files_import_archive_endpoint_active_reference_returns_409() -> None:
    with patch(
        "app.routers.admin.delete_files_import_archive",
        side_effect=RuntimeError("Archive is currently in use by an active files import"),
    ):
        with pytest.raises(HTTPException) as exc:
            await delete_files_import_archive_endpoint(7, MagicMock(), db=AsyncMock())

    assert exc.value.status_code == 409


async def test_upload_task_file_not_found() -> None:
    """Upload to a non-existent task returns 404."""
    user = SimpleNamespace(id=1)
    bg = MagicMock()
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await upload_task_file(999, user, bg, file=MagicMock(), db=db)
    assert exc.value.status_code == 404


async def test_upload_task_file_wrong_status() -> None:
    """Upload to a task not in ``uploading`` status returns 409."""
    user = SimpleNamespace(id=1)
    bg = MagicMock()
    task = _make_admin_task(status="running", input_path="/tmp/x.tar.gz")
    db = AsyncMock()
    db.get = AsyncMock(return_value=task)

    with pytest.raises(HTTPException) as exc:
        await upload_task_file(1, user, bg, file=MagicMock(), db=db)
    assert exc.value.status_code == 409


async def test_upload_task_file_success(tmp_path) -> None:
    """Successful upload transitions to pending and kicks off."""
    input_path = str(tmp_path / "import.tar.gz")
    user = SimpleNamespace(id=1)
    bg = MagicMock()

    task = _make_admin_task(
        task_type="files_import",
        status="uploading",
        input_path=input_path,
        log="Awaiting file upload: backup.tar.gz\n",
    )
    db = AsyncMock()
    db.get = AsyncMock(return_value=task)

    # The atomic UPDATE returns a result whose scalar() yields the task id.
    update_result = MagicMock()
    update_result.scalar.return_value = task.id
    db.execute = AsyncMock(return_value=update_result)

    async def mock_refresh(obj, *_args, **_kwargs):
        # After the atomic UPDATE, refresh should show "pending"
        obj.status = "pending"
        obj.log = (obj.log or "") + "Upload complete (0.0 MB). Queued for processing.\n"

    db.refresh = AsyncMock(side_effect=mock_refresh)

    # Fake upload file that yields one small chunk
    upload = MagicMock()
    upload.read = AsyncMock(side_effect=[b"fake-data", b""])

    with patch("app.routers.admin.enqueue_admin_task", new_callable=AsyncMock, return_value=True):
        result = await upload_task_file(task.id, user, bg, file=upload, db=db)

    assert result["status"] == "pending"
    assert "Upload complete" in result["log"]
    assert os.path.exists(input_path)  # file was written
    os.unlink(input_path)  # clean up


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
    db.refresh = AsyncMock()

    result = await cancel_task(1, MagicMock(), db=db)
    assert result["status"] == "completed"


async def test_cancel_task_already_failed() -> None:
    task = _make_admin_task(status="failed")
    db = AsyncMock()
    db.get = AsyncMock(return_value=task)
    db.refresh = AsyncMock()

    result = await cancel_task(1, MagicMock(), db=db)
    assert result["status"] == "failed"


async def test_cancel_task_pending() -> None:
    task = _make_admin_task(status="pending")
    db = AsyncMock()
    db.get = AsyncMock(return_value=task)
    db.refresh = AsyncMock()

    result = await cancel_task(1, MagicMock(), db=db)
    assert result["status"] == "cancelling"


async def test_cancel_task_force_transitions_from_cancelling() -> None:
    """A task stuck in ``cancelling`` can be force-cancelled to ``cancelled``.

    This is the recovery path when the original runner died before it
    could observe the cancellation flag, which would otherwise block the
    concurrency guard in ``_create_task`` indefinitely.
    """
    task = _make_admin_task(status="cancelling", log="Cancellation requested by admin.\n")
    db = AsyncMock()
    db.get = AsyncMock(return_value=task)
    db.refresh = AsyncMock()

    result = await cancel_task(1, MagicMock(), db=db)
    assert result["status"] == "cancelled"
    assert "Force-cancelled by admin" in task.log


async def test_cancel_task_already_cancelled() -> None:
    """Cancelling a terminal task is a no-op."""
    task = _make_admin_task(status="cancelled")
    db = AsyncMock()
    db.get = AsyncMock(return_value=task)
    db.refresh = AsyncMock()

    result = await cancel_task(1, MagicMock(), db=db)
    assert result["status"] == "cancelled"


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


# ── _safe_admin_task_file ───────────────────────────────


def test_safe_admin_task_file_returns_none_for_empty() -> None:
    assert _safe_admin_task_file(None) is None
    assert _safe_admin_task_file("") is None


def test_safe_admin_task_file_rejects_path_outside_tasks_dir(tmp_path) -> None:
    tasks_dir = tmp_path / "admin_tasks"
    tasks_dir.mkdir()
    outside = str(tmp_path / "outside.json")
    with patch("app.routers.admin._ensure_tasks_dir", return_value=str(tasks_dir)):
        result = _safe_admin_task_file(outside)
    assert result is None


def test_safe_admin_task_file_accepts_path_inside_tasks_dir(tmp_path) -> None:
    tasks_dir = tmp_path / "admin_tasks"
    tasks_dir.mkdir()
    inside = tasks_dir / "export.json"
    inside.touch()
    with patch("app.routers.admin._ensure_tasks_dir", return_value=str(tasks_dir)):
        result = _safe_admin_task_file(str(inside))
    assert result == inside.resolve()


# ── list_export_archives ─────────────────────────────────


async def test_list_export_archives_empty() -> None:
    """Returns empty list and zero total when no tasks have on-disk result files."""
    db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = []
    db.execute = AsyncMock(return_value=mock_result)
    result = await list_export_archives(_user=MagicMock(), db=db)
    assert result == {"archives": [], "total_size_bytes": 0}


async def test_list_export_archives_includes_existing_file(tmp_path) -> None:
    """A task with an on-disk result file appears in the archive list."""
    filepath = tmp_path / "export.json"
    filepath.write_text("hello")
    task = _make_admin_task(
        task_type="db_export",
        status="completed",
        result_path=str(filepath),
        result_filename="export.json",
    )
    db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [task]
    db.execute = AsyncMock(return_value=mock_result)
    with patch("app.routers.admin._ensure_tasks_dir", return_value=str(tmp_path)):
        result = await list_export_archives(_user=MagicMock(), db=db)
    assert len(result["archives"]) == 1
    assert result["archives"][0]["filename"] == "export.json"
    assert result["archives"][0]["size_bytes"] == filepath.stat().st_size
    assert result["total_size_bytes"] == filepath.stat().st_size
    assert result["archives"][0]["purgeable"] is True


async def test_list_export_archives_skips_missing_files(tmp_path) -> None:
    """Tasks whose result files are missing on disk are silently omitted."""
    task = _make_admin_task(
        task_type="db_export",
        status="completed",
        result_path=str(tmp_path / "gone.json"),
        result_filename="gone.json",
    )
    db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [task]
    db.execute = AsyncMock(return_value=mock_result)
    with patch("app.routers.admin._ensure_tasks_dir", return_value=str(tmp_path)):
        result = await list_export_archives(_user=MagicMock(), db=db)
    assert result == {"archives": [], "total_size_bytes": 0}


async def test_list_export_archives_active_task_not_purgeable(tmp_path) -> None:
    """A task that is still running has purgeable=False."""
    filepath = tmp_path / "export.json"
    filepath.write_text("data")
    task = _make_admin_task(
        task_type="db_export",
        status="running",
        result_path=str(filepath),
        result_filename="export.json",
    )
    db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [task]
    db.execute = AsyncMock(return_value=mock_result)
    with patch("app.routers.admin._ensure_tasks_dir", return_value=str(tmp_path)):
        result = await list_export_archives(_user=MagicMock(), db=db)
    assert result["archives"][0]["purgeable"] is False


# ── purge_backup_archive ─────────────────────────────────


async def test_purge_backup_archive_success(tmp_path) -> None:
    """Archive file is deleted and DB columns are cleared."""
    filepath = tmp_path / "export.json"
    filepath.write_text('{"data": true}')
    task = _make_admin_task(
        task_type="db_export",
        status="completed",
        result_path=str(filepath),
        result_filename="export.json",
    )
    db = AsyncMock()
    db.get = AsyncMock(return_value=task)
    with patch("app.routers.admin._ensure_tasks_dir", return_value=str(tmp_path)):
        result = await purge_backup_archive(
            task_id=1, artifact_role="result", _user=MagicMock(), db=db
        )
    assert result["deleted"] is True
    assert result["task_id"] == 1
    assert result["artifact_role"] == "result"
    assert not filepath.exists()
    assert task.result_filename is None
    assert task.result_path is None
    db.commit.assert_awaited_once()


async def test_purge_backup_archive_unknown_role() -> None:
    """400 for an artifact_role other than 'result'."""
    db = AsyncMock()
    with pytest.raises(HTTPException) as exc:
        await purge_backup_archive(
            task_id=1, artifact_role="input", _user=MagicMock(), db=db
        )
    assert exc.value.status_code == 400


async def test_purge_backup_archive_task_not_found() -> None:
    """404 when the task does not exist."""
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)
    with pytest.raises(HTTPException) as exc:
        await purge_backup_archive(
            task_id=999, artifact_role="result", _user=MagicMock(), db=db
        )
    assert exc.value.status_code == 404


async def test_purge_backup_archive_non_export_task_rejected() -> None:
    """404 when the task is not an export task (never listed as an archive)."""
    task = _make_admin_task(task_type="rebuild_tiles", status="completed")
    db = AsyncMock()
    db.get = AsyncMock(return_value=task)
    with pytest.raises(HTTPException) as exc:
        await purge_backup_archive(
            task_id=1, artifact_role="result", _user=MagicMock(), db=db
        )
    assert exc.value.status_code == 404


async def test_purge_backup_archive_active_task_rejected() -> None:
    """409 when the task is still active."""
    task = _make_admin_task(task_type="db_export", status="running")
    db = AsyncMock()
    db.get = AsyncMock(return_value=task)
    with pytest.raises(HTTPException) as exc:
        await purge_backup_archive(
            task_id=1, artifact_role="result", _user=MagicMock(), db=db
        )
    assert exc.value.status_code == 409


async def test_purge_backup_archive_no_result_path(tmp_path) -> None:
    """404 when the task has no result_path set."""
    task = _make_admin_task(task_type="db_export", status="completed")
    db = AsyncMock()
    db.get = AsyncMock(return_value=task)
    with patch("app.routers.admin._ensure_tasks_dir", return_value=str(tmp_path)):
        with pytest.raises(HTTPException) as exc:
            await purge_backup_archive(
                task_id=1, artifact_role="result", _user=MagicMock(), db=db
            )
    assert exc.value.status_code == 404


async def test_purge_backup_archive_file_not_on_disk(tmp_path) -> None:
    """404 when the DB references a path that no longer exists on disk."""
    task = _make_admin_task(
        task_type="db_export",
        status="completed",
        result_path=str(tmp_path / "gone.json"),
        result_filename="gone.json",
    )
    db = AsyncMock()
    db.get = AsyncMock(return_value=task)
    with patch("app.routers.admin._ensure_tasks_dir", return_value=str(tmp_path)):
        with pytest.raises(HTTPException) as exc:
            await purge_backup_archive(
                task_id=1, artifact_role="result", _user=MagicMock(), db=db
            )
    assert exc.value.status_code == 404
