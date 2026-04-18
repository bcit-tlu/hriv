"""Tests for the background admin operations module."""

import json
import os
import tarfile
import tempfile
import threading
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.admin_ops import (
    TaskCancelled,
    _create_tar_file,
    _ensure_tasks_dir,
    _extract_and_restore,
    _iter_export_files,
    _parse_dt,
    _read_file,
    _update_task,
    _write_file,
    reconcile_stale_tasks,
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


def test_extract_and_restore_preserves_admin_tasks(tmp_path) -> None:
    """admin_tasks/ inside the data dir must survive a filesystem restore."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    tiles_dir = data_dir / "tiles"
    tiles_dir.mkdir()
    source_dir = data_dir / "source_images"
    source_dir.mkdir()
    (tiles_dir / "tile1.jpeg").write_text("tile data")
    (source_dir / "src1.tiff").write_text("source data")

    # Simulate an existing admin_tasks dir with a prior export result
    tasks_dir = data_dir / "admin_tasks"
    tasks_dir.mkdir()
    (tasks_dir / "prior-export.json").write_text('{"old": true}')

    archive = str(tmp_path / "test.tar.gz")
    with tarfile.open(archive, "w:gz") as tar:
        tar.add(str(data_dir), arcname="data")

    with tempfile.TemporaryDirectory() as tmpdir:
        result = _extract_and_restore(
            archive,
            tmpdir,
            str(data_dir),
            str(tiles_dir),
            str(source_dir),
        )

    assert result["tile_files"] >= 1
    # admin_tasks dir and its contents must still exist
    assert tasks_dir.exists()
    assert (tasks_dir / "prior-export.json").exists()
    assert (tasks_dir / "prior-export.json").read_text() == '{"old": true}'


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


# ── _create_tar_file tests ─────────────────────────────────


def test_create_tar_file_on_entry_reports_members(tmp_path) -> None:
    """on_entry callback receives every archive member name."""
    data_dir = tmp_path / "data"
    tiles = data_dir / "tiles"
    tiles.mkdir(parents=True)
    (tiles / "a.jpg").write_text("a")
    (tiles / "b.jpg").write_text("b")

    dest = str(tmp_path / "out.tar.gz")
    entries: list[tuple[str, int]] = []

    with patch("app.admin_ops._TASKS_DIR", str(data_dir / "admin_tasks")):
        _create_tar_file(
            str(data_dir), dest,
            on_entry=lambda name, size: entries.append((name, size)),
        )

    names = [n for n, _ in entries]
    assert any(n.endswith("a.jpg") for n in names)
    assert any(n.endswith("b.jpg") for n in names)
    # Directory entries should end with /
    assert any(n.endswith("/") for n in names)
    # File entries report their size; directory entries report 0.
    file_sizes = {n: s for n, s in entries if not n.endswith("/")}
    assert file_sizes and all(s >= 1 for s in file_sizes.values())
    dir_sizes = [s for n, s in entries if n.endswith("/")]
    assert dir_sizes and all(s == 0 for s in dir_sizes)


def test_create_tar_file_excludes_admin_tasks(tmp_path) -> None:
    """admin_tasks directory must be excluded from the archive."""
    data_dir = tmp_path / "data"
    tiles = data_dir / "tiles"
    tiles.mkdir(parents=True)
    (tiles / "tile.jpg").write_text("tile")
    tasks = data_dir / "admin_tasks"
    tasks.mkdir()
    (tasks / "old.json").write_text("stale")

    dest = str(tmp_path / "out.tar.gz")
    entries: list[str] = []

    with patch("app.admin_ops._TASKS_DIR", str(tasks)):
        _create_tar_file(
            str(data_dir), dest,
            on_entry=lambda name, _size: entries.append(name),
        )

    assert not any("admin_tasks" in e for e in entries)
    with tarfile.open(dest, "r:gz") as tar:
        assert not any("admin_tasks" in m for m in tar.getnames())


def test_create_tar_file_cancel_event_aborts(tmp_path) -> None:
    """Setting cancel_event stops archiving promptly."""
    data_dir = tmp_path / "data"
    sub = data_dir / "many"
    sub.mkdir(parents=True)
    for i in range(20):
        (sub / f"f{i}.txt").write_text(str(i))

    dest = str(tmp_path / "out.tar.gz")
    cancel = threading.Event()
    entries: list[str] = []

    def _on_entry(name: str, _size: int) -> None:
        entries.append(name)
        if len(entries) >= 3:
            cancel.set()

    with patch("app.admin_ops._TASKS_DIR", str(data_dir / "admin_tasks")):
        with pytest.raises(TaskCancelled):
            _create_tar_file(
                str(data_dir), dest,
                cancel_event=cancel, on_entry=_on_entry,
            )

    # Should have stopped well before processing all 20 files
    assert len(entries) < 20


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


async def test_update_task_check_cancelled_raises() -> None:
    session = AsyncMock()
    task = SimpleNamespace(
        status="cancelling", progress=50, log="",
        result_filename=None, result_path=None, error_message=None,
    )
    session.refresh = AsyncMock()

    with pytest.raises(TaskCancelled):
        await _update_task(
            session, task,
            log_line="next step",
            check_cancelled=True,
        )


async def test_update_task_check_cancelled_passes_when_running() -> None:
    session = AsyncMock()
    task = SimpleNamespace(
        status="running", progress=50, log="",
        result_filename=None, result_path=None, error_message=None,
    )
    session.refresh = AsyncMock()

    await _update_task(
        session, task,
        log_line="next step",
        progress=60,
        check_cancelled=True,
    )

    assert task.progress == 60
    assert "next step" in task.log


async def test_reconcile_stale_tasks_marks_stale_as_failed() -> None:
    """Stale in-flight tasks are updated to ``failed`` and ids are returned."""
    session = AsyncMock()
    exec_result = MagicMock()
    exec_result.all = MagicMock(return_value=[(2,), (5,)])
    session.execute = AsyncMock(return_value=exec_result)
    session.commit = AsyncMock()

    count = await reconcile_stale_tasks(session, stale_after_seconds=900)

    assert count == 2
    # The reconciler must issue an UPDATE and commit the transaction.
    assert session.execute.await_count == 1
    stmt = session.execute.await_args.args[0]
    compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    assert "UPDATE admin_tasks" in compiled
    assert "status='failed'" in compiled.replace(" ", "")
    assert "'pending'" in compiled and "'running'" in compiled and "'cancelling'" in compiled
    session.commit.assert_awaited_once()


async def test_reconcile_stale_tasks_no_stale_returns_zero() -> None:
    """When no tasks are stale the reconciler is a no-op counter-wise."""
    session = AsyncMock()
    exec_result = MagicMock()
    exec_result.all = MagicMock(return_value=[])
    session.execute = AsyncMock(return_value=exec_result)
    session.commit = AsyncMock()

    count = await reconcile_stale_tasks(session, stale_after_seconds=900)

    assert count == 0
    session.commit.assert_awaited_once()


async def test_update_task_check_cancelled_also_raises_on_cancelled_status() -> None:
    """A status of ``cancelled`` (force-cancel) also aborts a live runner.

    This guards against the race where an admin force-cancels a stuck
    task while its original runner is somehow still alive: on the next
    checkpoint the runner sees the terminal status and exits cleanly
    rather than overwriting it.
    """
    session = AsyncMock()
    task = SimpleNamespace(
        status="cancelled", progress=50, log="",
        result_filename=None, result_path=None, error_message=None,
    )
    session.refresh = AsyncMock()

    with pytest.raises(TaskCancelled):
        await _update_task(
            session, task,
            log_line="next step",
            check_cancelled=True,
        )


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
        oidc_subject=None, role="admin", program_id=None, last_access=None,
        metadata_={}, created_at=now, updated_at=now,
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


def test_iter_export_files_skips_admin_tasks(tmp_path) -> None:
    """``_iter_export_files`` reports sizes and omits ``admin_tasks``."""
    data_dir = tmp_path / "data"
    tiles = data_dir / "tiles"
    tiles.mkdir(parents=True)
    (tiles / "a.bin").write_bytes(b"0123456789")  # 10 bytes
    (tiles / "b.bin").write_bytes(b"xy")          # 2 bytes
    tasks = data_dir / "admin_tasks"
    tasks.mkdir()
    (tasks / "stale.tar.gz").write_bytes(b"A" * 1000)

    with patch("app.admin_ops._TASKS_DIR", str(tasks)):
        results = list(_iter_export_files(str(data_dir)))

    names = {os.path.basename(p): sz for p, sz in results}
    assert names == {"a.bin": 10, "b.bin": 2}


async def test_run_files_export_reports_byte_progress(tmp_path) -> None:
    """Progress advances between 20% and 95% as bytes are archived.

    Previously the bar jumped from 20 to 100 when the tar completed,
    leaving users staring at a stuck progress indicator during the slow
    archiving phase.  The new pre-walk + per-entry byte accounting
    should produce at least one intermediate progress update above 20
    and below 95.
    """
    data_dir = tmp_path / "data"
    tiles = data_dir / "tiles"
    tiles.mkdir(parents=True)
    # Write files large enough that the byte-based progress calculation
    # produces observable motion.
    for i in range(5):
        (tiles / f"blob{i}.bin").write_bytes(b"X" * 1024)

    task = SimpleNamespace(
        id=1, task_type="files_export", status="pending", progress=0, log="",
        result_filename=None, result_path=None, input_path=None, error_message=None,
    )

    progress_history: list[int] = []

    async def _commit_noop() -> None:
        progress_history.append(task.progress)

    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=task)
    mock_session.commit = AsyncMock(side_effect=_commit_noop)
    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    tasks_dir = str(tmp_path / "admin_tasks")

    with (
        patch("app.admin_ops.get_async_session", return_value=mock_session_factory),
        patch("app.admin_ops.settings") as mock_settings,
        patch("app.admin_ops._TASKS_DIR", tasks_dir),
        # Flush every tick so we capture several intermediate updates
        # before the archive finishes.
        patch("app.admin_ops._LOG_FLUSH_INTERVAL", 0.0),
    ):
        mock_settings.tiles_dir = str(tiles)
        await run_files_export(1)

    assert task.status == "completed"
    # We expect at least one progress sample strictly inside the
    # archiving band (20 < p <= 95) — proof that the bar actually moves
    # while the tar is being written, not just jumps from 20 → 100.
    mid_band = [p for p in progress_history if 20 < p <= 95]
    assert mid_band, f"expected intermediate progress; saw {progress_history}"
    assert 100 in progress_history


async def test_run_files_export_verbose_log(tmp_path) -> None:
    """Verbose archive entries appear in the task log."""
    data_dir = tmp_path / "data"
    tiles_dir = data_dir / "tiles"
    tiles_dir.mkdir(parents=True)
    (tiles_dir / "img.jpg").write_text("pixel")

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
        patch("app.admin_ops._LOG_FLUSH_INTERVAL", 0.05),
    ):
        mock_settings.tiles_dir = str(tiles_dir)
        await run_files_export(1)

    assert task.status == "completed"
    assert "adding" in task.log
    assert "img.jpg" in task.log


async def test_run_files_export_cancellation(tmp_path) -> None:
    """Cancelling during archive creation terminates promptly via cancel_event."""
    import time

    data_dir = tmp_path / "data"
    tiles_dir = data_dir / "tiles"
    tiles_dir.mkdir(parents=True)
    (tiles_dir / "f0.txt").write_text("0")

    task = SimpleNamespace(
        id=1, task_type="files_export", status="pending", progress=0, log="",
        result_filename=None, result_path=None, input_path=None, error_message=None,
    )

    refresh_count = 0

    async def _refresh(obj, attribute_names=None):
        nonlocal refresh_count
        refresh_count += 1
        # There are 3 check_cancelled=True calls before the archive
        # starts, so trigger cancellation later to exercise the
        # during-archiving _flush_and_poll path.
        if refresh_count >= 6:
            task.status = "cancelling"

    def _slow_tar(data_dir, dest, *, cancel_event=None, on_entry=None):
        """Simulate a long-running archive that blocks until cancelled."""
        import tarfile as _tf
        with _tf.open(dest, "w:gz"):
            pass
        if on_entry is not None:
            on_entry("data/probe", 0)
        if cancel_event is not None:
            while not cancel_event.is_set():
                time.sleep(0.01)
            raise TaskCancelled("Task cancelled by admin")

    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=task)
    mock_session.commit = AsyncMock()
    mock_session.refresh = AsyncMock(side_effect=_refresh)
    mock_session.rollback = AsyncMock()
    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    tasks_dir = str(tmp_path / "admin_tasks")

    with (
        patch("app.admin_ops.get_async_session", return_value=mock_session_factory),
        patch("app.admin_ops.settings") as mock_settings,
        patch("app.admin_ops._TASKS_DIR", tasks_dir),
        patch("app.admin_ops._LOG_FLUSH_INTERVAL", 0.05),
        patch("app.admin_ops._create_tar_file", side_effect=_slow_tar),
    ):
        mock_settings.tiles_dir = str(tiles_dir)
        await run_files_export(1)

    assert task.status == "cancelled"
    assert "cancelled" in task.log.lower()


async def test_run_files_export_force_cancelled_during_archive(tmp_path) -> None:
    """Force-cancel (``cancelled``) detected mid-archive also trips the tar thread.

    Mirrors ``test_run_files_export_cancellation`` but sets the status
    directly to ``cancelled`` — the force-cancel path added in this PR —
    to prove that ``_flush_and_poll`` honours it and doesn't hang
    waiting for a tar thread that will never finish.
    """
    import time

    data_dir = tmp_path / "data"
    tiles_dir = data_dir / "tiles"
    tiles_dir.mkdir(parents=True)
    (tiles_dir / "f0.txt").write_text("0")

    task = SimpleNamespace(
        id=1, task_type="files_export", status="pending", progress=0, log="",
        result_filename=None, result_path=None, input_path=None, error_message=None,
    )

    refresh_count = 0

    async def _refresh(obj, attribute_names=None):
        nonlocal refresh_count
        refresh_count += 1
        if refresh_count >= 6:
            task.status = "cancelled"  # force-cancel, not "cancelling"

    def _slow_tar(data_dir, dest, *, cancel_event=None, on_entry=None):
        import tarfile as _tf
        with _tf.open(dest, "w:gz"):
            pass
        if on_entry is not None:
            on_entry("data/probe", 0)
        if cancel_event is not None:
            while not cancel_event.is_set():
                time.sleep(0.01)
            raise TaskCancelled("Task cancelled by admin")

    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=task)
    mock_session.commit = AsyncMock()
    mock_session.refresh = AsyncMock(side_effect=_refresh)
    mock_session.rollback = AsyncMock()
    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    tasks_dir = str(tmp_path / "admin_tasks")

    with (
        patch("app.admin_ops.get_async_session", return_value=mock_session_factory),
        patch("app.admin_ops.settings") as mock_settings,
        patch("app.admin_ops._TASKS_DIR", tasks_dir),
        patch("app.admin_ops._LOG_FLUSH_INTERVAL", 0.05),
        patch("app.admin_ops._create_tar_file", side_effect=_slow_tar),
    ):
        mock_settings.tiles_dir = str(tiles_dir)
        await run_files_export(1)

    # The force-cancel propagates through TaskCancelled handling, which
    # sets the task to ``cancelled``; whichever terminal state wins the
    # race, the point is we exited promptly rather than hung.
    assert task.status == "cancelled"


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


def test_extract_and_restore_handles_cross_device_tmpdir(tmp_path, monkeypatch) -> None:
    """``tmpdir`` may live on a different filesystem than ``data_dir``
    (e.g. when /tmp is a tmpfs and data lives on a PVC). ``os.rename``
    would raise EXDEV; ``shutil.move`` must fall back to copy+delete.
    We simulate this by making ``os.rename`` refuse paths that cross the
    fake device boundary, and verify the import still succeeds."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "old.txt").write_text("old")
    tasks_sub = data_dir / "admin_tasks"
    tasks_sub.mkdir()
    (tasks_sub / "keep.txt").write_text("keep-me")

    staging_src = tmp_path / "src"
    (staging_src / "tiles").mkdir(parents=True)
    (staging_src / "tiles" / "t.jpg").write_text("tile")
    archive = tmp_path / "upload.tar.gz"
    with tarfile.open(str(archive), "w:gz") as tar:
        tar.add(str(staging_src), arcname="data")

    tmpdir = tmp_path / "tmp_other_fs"
    tmpdir.mkdir()

    real_rename = os.rename

    def _cross_device_rename(src: str, dst: str) -> None:
        # Simulate EXDEV whenever src and dst straddle the data_dir/tmpdir
        # boundary. Intra-directory renames (used inside shutil.copytree
        # and friends) still succeed.
        src_s, dst_s = str(src), str(dst)
        spans_tmp = (str(tmpdir) in src_s) ^ (str(tmpdir) in dst_s)
        if spans_tmp:
            raise OSError(18, "Invalid cross-device link")  # EXDEV
        real_rename(src_s, dst_s)

    # Patch ``os.rename`` at the module level so ``shutil.move``'s
    # internal rename attempt is also intercepted (``shutil`` imports
    # ``os`` directly, not through ``app.admin_ops``).
    monkeypatch.setattr(os, "rename", _cross_device_rename)

    result = _extract_and_restore(
        tmp_archive=str(archive),
        tmpdir=str(tmpdir),
        data_dir=str(data_dir),
        tiles_dir=str(data_dir / "tiles"),
        source_images_dir=str(data_dir / "source_images"),
    )

    # admin_tasks sheltering + data swap + restoration all survived EXDEV.
    assert (data_dir / "tiles" / "t.jpg").read_text() == "tile"
    assert (data_dir / "admin_tasks" / "keep.txt").read_text() == "keep-me"
    assert result["tile_files"] >= 1


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
