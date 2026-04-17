"""Tests for the background admin operations module."""

import json
import os
import tarfile
import tempfile
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.admin_ops import (
    _ensure_tasks_dir,
    _extract_and_restore,
    _parse_dt,
    _read_file,
    _update_task,
    _write_file,
    run_db_export,
    run_db_import,
    run_files_export,
    run_files_import,
)


# ── Helper unit tests ──────────────────────────────────────


def test_parse_dt_valid() -> None:
    result = _parse_dt("2025-01-15T10:30:00+00:00")
    assert isinstance(result, datetime)
    assert result.year == 2025


def test_parse_dt_none() -> None:
    assert _parse_dt(None) is None


def test_parse_dt_empty() -> None:
    assert _parse_dt("") is None


def test_write_and_read_file(tmp_path) -> None:
    path = str(tmp_path / "test.txt")
    _write_file(path, "hello world")
    assert _read_file(path) == "hello world"


def test_read_file_no_path() -> None:
    with pytest.raises(ValueError, match="No input file"):
        _read_file(None)


def test_read_file_empty_path() -> None:
    with pytest.raises(ValueError, match="No input file"):
        _read_file("")


def test_ensure_tasks_dir(tmp_path) -> None:
    tasks_dir = str(tmp_path / "admin_tasks")
    with patch("app.admin_ops._TASKS_DIR", tasks_dir):
        result = _ensure_tasks_dir()
    assert result == tasks_dir
    assert os.path.isdir(tasks_dir)


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
    archive = str(tmp_path / "empty.tar.gz")
    with tarfile.open(archive, "w:gz") as tar:
        pass

    with tempfile.TemporaryDirectory() as tmpdir:
        with pytest.raises(ValueError, match="empty"):
            _extract_and_restore(
                archive,
                tmpdir,
                str(tmp_path / "data"),
                str(tmp_path / "tiles"),
                str(tmp_path / "sources"),
            )


# ── _update_task tests ─────────────────────────────────────


async def test_update_task_status() -> None:
    session = AsyncMock()
    task = SimpleNamespace(status="pending", progress=0, log="", result_filename=None, result_path=None, error_message=None)

    await _update_task(session, task, status="running", progress=10, log_line="Starting")

    assert task.status == "running"
    assert task.progress == 10
    assert "Starting\n" in task.log
    session.commit.assert_awaited_once()


async def test_update_task_appends_log() -> None:
    session = AsyncMock()
    task = SimpleNamespace(status="running", progress=0, log="line1\n", result_filename=None, result_path=None, error_message=None)

    await _update_task(session, task, log_line="line2")

    assert task.log == "line1\nline2\n"


async def test_update_task_sets_result() -> None:
    session = AsyncMock()
    task = SimpleNamespace(status="running", progress=0, log="", result_filename=None, result_path=None, error_message=None)

    await _update_task(
        session, task,
        status="completed",
        result_filename="export.json",
        result_path="/tmp/export.json",
    )

    assert task.status == "completed"
    assert task.result_filename == "export.json"
    assert task.result_path == "/tmp/export.json"


# ── run_db_export tests ────────────────────────────────────


async def test_run_db_export_task_not_found() -> None:
    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=None)
    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    with patch("app.admin_ops.get_async_session", return_value=mock_session_factory):
        await run_db_export(999)

    # Should not raise — just logs and returns


async def test_run_db_export_success(tmp_path) -> None:
    now = datetime.now(timezone.utc)
    task = SimpleNamespace(
        id=1, task_type="db_export", status="pending", progress=0, log="",
        result_filename=None, result_path=None, input_path=None, error_message=None,
    )

    programs = [SimpleNamespace(id=1, name="CS", created_at=now, updated_at=now)]
    categories = []
    images = []
    users = [SimpleNamespace(
        id=1, name="Admin", email="admin@test.com", password_hash="hash",
        role="admin", program_id=None, last_access=None, metadata_={},
        created_at=now, updated_at=now,
    )]
    source_images = []
    announcement = SimpleNamespace(message="", enabled=False, created_at=now, updated_at=now)

    call_count = 0

    async def mock_execute(stmt):
        nonlocal call_count
        call_count += 1
        result = MagicMock()
        data_map = {1: programs, 2: categories, 3: images, 4: users, 5: source_images}
        if call_count <= 5:
            result.scalars.return_value.all.return_value = data_map[call_count]
        else:
            result.scalar_one_or_none.return_value = announcement
        return result

    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=task)
    mock_session.execute = AsyncMock(side_effect=mock_execute)
    mock_session.commit = AsyncMock()
    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    tasks_dir = str(tmp_path / "admin_tasks")

    with (
        patch("app.admin_ops.get_async_session", return_value=mock_session_factory),
        patch("app.admin_ops._TASKS_DIR", tasks_dir),
    ):
        await run_db_export(1)

    assert task.status == "completed"
    assert task.progress == 100
    assert task.result_filename is not None
    assert task.result_filename.endswith(".json")
    assert "Export complete" in task.log


# ── run_db_import tests ────────────────────────────────────


async def test_run_db_import_task_not_found() -> None:
    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=None)
    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    with patch("app.admin_ops.get_async_session", return_value=mock_session_factory):
        await run_db_import(999)


async def test_run_db_import_invalid_json(tmp_path) -> None:
    input_file = tmp_path / "bad.json"
    input_file.write_text("not json")

    task = SimpleNamespace(
        id=1, task_type="db_import", status="pending", progress=0, log="",
        result_filename=None, result_path=None, input_path=str(input_file),
        error_message=None,
    )

    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=task)
    mock_session.commit = AsyncMock()
    mock_session.rollback = AsyncMock()
    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    with patch("app.admin_ops.get_async_session", return_value=mock_session_factory):
        await run_db_import(1)

    assert task.status == "failed"
    assert task.error_message is not None


async def test_run_db_import_missing_keys(tmp_path) -> None:
    input_file = tmp_path / "partial.json"
    input_file.write_text(json.dumps({"categories": [], "images": []}))

    task = SimpleNamespace(
        id=1, task_type="db_import", status="pending", progress=0, log="",
        result_filename=None, result_path=None, input_path=str(input_file),
        error_message=None,
    )

    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=task)
    mock_session.commit = AsyncMock()
    mock_session.rollback = AsyncMock()
    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    with patch("app.admin_ops.get_async_session", return_value=mock_session_factory):
        await run_db_import(1)

    assert task.status == "failed"
    assert "users" in (task.error_message or "")


# ── run_files_export tests ─────────────────────────────────


async def test_run_files_export_task_not_found() -> None:
    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=None)
    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    with patch("app.admin_ops.get_async_session", return_value=mock_session_factory):
        await run_files_export(999)


async def test_run_files_export_empty_data_dir(tmp_path) -> None:
    data_dir = tmp_path / "data"
    # Don't create it — simulate missing

    task = SimpleNamespace(
        id=1, task_type="files_export", status="pending", progress=0, log="",
        result_filename=None, result_path=None, input_path=None, error_message=None,
    )

    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=task)
    mock_session.commit = AsyncMock()
    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("app.admin_ops.get_async_session", return_value=mock_session_factory),
        patch("app.admin_ops.settings") as mock_settings,
    ):
        mock_settings.tiles_dir = str(data_dir / "tiles")
        await run_files_export(1)

    assert task.status == "failed"
    assert "empty or missing" in (task.error_message or "")


async def test_run_files_export_success(tmp_path) -> None:
    data_dir = tmp_path / "data"
    tiles_dir = data_dir / "tiles"
    tiles_dir.mkdir(parents=True)
    (tiles_dir / "tile.jpg").write_text("data")

    task = SimpleNamespace(
        id=1, task_type="files_export", status="pending", progress=0, log="",
        result_filename=None, result_path=None, input_path=None, error_message=None,
    )

    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=task)
    mock_session.commit = AsyncMock()
    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    tasks_dir = str(tmp_path / "admin_tasks")

    with (
        patch("app.admin_ops.get_async_session", return_value=mock_session_factory),
        patch("app.admin_ops.settings") as mock_settings,
        patch("app.admin_ops._TASKS_DIR", tasks_dir),
    ):
        mock_settings.tiles_dir = str(tiles_dir)
        await run_files_export(1)

    assert task.status == "completed"
    assert task.progress == 100
    assert task.result_filename is not None
    assert task.result_filename.endswith(".tar.gz")


# ── run_files_import tests ─────────────────────────────────


async def test_run_files_import_task_not_found() -> None:
    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=None)
    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    with patch("app.admin_ops.get_async_session", return_value=mock_session_factory):
        await run_files_import(999)


async def test_run_files_import_missing_archive() -> None:
    task = SimpleNamespace(
        id=1, task_type="files_import", status="pending", progress=0, log="",
        result_filename=None, result_path=None, input_path="/nonexistent/file.tar.gz",
        error_message=None,
    )

    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=task)
    mock_session.commit = AsyncMock()
    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    with patch("app.admin_ops.get_async_session", return_value=mock_session_factory):
        await run_files_import(1)

    assert task.status == "failed"
    assert "not found" in (task.error_message or "")


async def test_run_files_import_success(tmp_path) -> None:
    # Create a valid archive
    data_dir = tmp_path / "orig"
    tiles_dir = data_dir / "tiles"
    tiles_dir.mkdir(parents=True)
    source_dir = data_dir / "source_images"
    source_dir.mkdir()
    (tiles_dir / "t.jpg").write_text("tile")
    (source_dir / "s.tiff").write_text("src")

    archive = str(tmp_path / "upload.tar.gz")
    with tarfile.open(archive, "w:gz") as tar:
        tar.add(str(data_dir), arcname="data")

    restore_dir = tmp_path / "restored"

    task = SimpleNamespace(
        id=1, task_type="files_import", status="pending", progress=0, log="",
        result_filename=None, result_path=None, input_path=archive,
        error_message=None,
    )

    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=task)
    mock_session.commit = AsyncMock()
    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("app.admin_ops.get_async_session", return_value=mock_session_factory),
        patch("app.admin_ops.settings") as mock_settings,
    ):
        mock_settings.tiles_dir = str(restore_dir / "tiles")
        mock_settings.source_images_dir = str(restore_dir / "source_images")
        await run_files_import(1)

    assert task.status == "completed"
    assert task.progress == 100
    assert "Restored" in task.log
