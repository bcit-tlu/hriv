"""Tests for the background admin operations module."""

import builtins
import gzip
import io
import json
import os
import tarfile
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models import AdminTask

from app.admin_ops import (
    TaskCancelled,
    _create_tar_file,
    _ensure_import_staging_same_device,
    _ensure_tasks_dir,
    _extract_archive_stream,
    _extract_and_restore,
    _iter_export_files,
    _parse_dt,
    _read_file,
    _update_task,
    _write_file,
    delete_files_import_archive,
    list_files_import_archives,
    reconcile_stale_tasks,
    run_db_export,
    run_db_import,
    run_file_restore,
    run_files_export,
    run_files_import,
    rerun_files_import_archive,
    run_rebuild_tiles,
    _validate_retained_files_import_archive_path,
    _swap_imported_entries,
    _queue_rebuild_tiles_after_import,
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


def test_extract_and_restore_preserves_side_dirs_and_swaps_source_images(tmp_path) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    tiles_dir = data_dir / "tiles"
    tiles_dir.mkdir()
    (tiles_dir / "tile1.jpeg").write_text("tile")
    source_dir = data_dir / "source_images"
    source_dir.mkdir()
    (source_dir / "old.tiff").write_text("old")
    tasks_dir = data_dir / "admin_tasks"
    tasks_dir.mkdir()
    (tasks_dir / "keep.json").write_text("keep")

    payload_dir = tmp_path / "payload"
    payload_source = payload_dir / "source_images"
    payload_source.mkdir(parents=True)
    (payload_source / "new.tiff").write_text("new")
    archive = str(tmp_path / "test.tar.gz")
    with tarfile.open(archive, "w:gz") as tar:
        tar.add(str(payload_dir), arcname="data")

    with tempfile.TemporaryDirectory() as tmpdir:
        result = _extract_and_restore(
            archive,
            tmpdir,
            str(data_dir),
            str(tiles_dir),
            str(source_dir),
        )

    assert (source_dir / "new.tiff").read_text() == "new"
    assert not (source_dir / "old.tiff").exists()
    assert (tiles_dir / "tile1.jpeg").read_text() == "tile"
    assert tasks_dir.exists()
    assert (tasks_dir / "keep.json").read_text() == "keep"
    assert result["source_files"] >= 1


def test_extract_and_restore_rolls_back_on_entry_failure(tmp_path, monkeypatch) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    tiles_dir = data_dir / "tiles"
    tiles_dir.mkdir()
    (tiles_dir / "tile1.jpeg").write_text("tile")
    source_dir = data_dir / "source_images"
    source_dir.mkdir()
    (source_dir / "old.tiff").write_text("old")
    tasks_dir = data_dir / "admin_tasks"
    tasks_dir.mkdir()
    (tasks_dir / "keep.json").write_text("keep")

    payload_dir = tmp_path / "payload"
    (payload_dir / "source_images").mkdir(parents=True)
    (payload_dir / "source_images" / "new.tiff").write_text("new")
    (payload_dir / "zzz-bad").mkdir()
    (payload_dir / "zzz-bad" / "oops.txt").write_text("oops")
    archive = str(tmp_path / "test.tar.gz")
    with tarfile.open(archive, "w:gz") as tar:
        tar.add(str(payload_dir), arcname="data")

    real_rename = os.rename

    def _rename_with_failure(src: str, dst: str) -> None:
        if Path(dst).name == "zzz-bad":
            raise OSError(5, "simulated failure")
        real_rename(src, dst)

    monkeypatch.setattr(os, "rename", _rename_with_failure)

    with tempfile.TemporaryDirectory() as tmpdir, pytest.raises(OSError, match="simulated failure"):
        _extract_and_restore(
            archive,
            tmpdir,
            str(data_dir),
            str(tiles_dir),
            str(source_dir),
        )

    assert (source_dir / "old.tiff").read_text() == "old"
    assert not (source_dir / "new.tiff").exists()
    assert (tiles_dir / "tile1.jpeg").read_text() == "tile"
    assert (tasks_dir / "keep.json").read_text() == "keep"


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


def test_extract_archive_stream_uses_pigz_when_available(tmp_path, monkeypatch) -> None:
    source_dir = tmp_path / "payload"
    (source_dir / "source_images").mkdir(parents=True)
    (source_dir / "source_images" / "a.txt").write_text("a")
    tar_bytes = _tar_bytes_from_tree(source_dir)

    archive = tmp_path / "archive.tar.gz"
    with tarfile.open(str(archive), "w:gz") as tar:
        tar.add(str(source_dir), arcname="data")

    staging = tmp_path / "staging"
    staging.mkdir()
    fake_proc = _FakeImportPigzProcess(io.BytesIO(tar_bytes))
    monkeypatch.setattr("app.admin_ops.shutil.which", lambda _: "/usr/bin/pigz")
    monkeypatch.setattr("app.admin_ops.subprocess.Popen", lambda *args, **kwargs: fake_proc)

    member_count = _extract_archive_stream(str(archive), staging)

    assert member_count >= 1
    assert (staging / "data" / "source_images" / "a.txt").read_text() == "a"
    assert fake_proc.stdin.getvalue()


def test_extract_archive_stream_falls_back_without_pigz(tmp_path, monkeypatch) -> None:
    source_dir = tmp_path / "payload"
    (source_dir / "source_images").mkdir(parents=True)
    (source_dir / "source_images" / "a.txt").write_text("a")
    archive = tmp_path / "archive.tar.gz"
    with tarfile.open(str(archive), "w:gz") as tar:
        tar.add(str(source_dir), arcname="data")

    staging = tmp_path / "staging"
    staging.mkdir()
    monkeypatch.setattr("app.admin_ops.shutil.which", lambda _: None)

    member_count = _extract_archive_stream(str(archive), staging)

    assert member_count >= 1
    assert (staging / "data" / "source_images" / "a.txt").read_text() == "a"


def test_extract_archive_stream_falls_back_without_pigz_cancelled(
    tmp_path, monkeypatch
) -> None:
    archive = tmp_path / "archive.tar.gz"
    archive.write_bytes(b"placeholder")

    staging = tmp_path / "staging"
    staging.mkdir()
    cancel_event = threading.Event()

    class _FakeTar:
        def __init__(self):
            self._yielded = False

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def __iter__(self):
            return self

        def __next__(self):
            if not self._yielded:
                self._yielded = True
                return SimpleNamespace(name="data/source_images/a.txt")
            raise tarfile.ReadError("unexpected end of data")

        def extract(self, member, path, filter=None):
            cancel_event.set()

    monkeypatch.setattr("app.admin_ops.shutil.which", lambda _: None)
    monkeypatch.setattr("app.admin_ops.tarfile.open", lambda *args, **kwargs: _FakeTar())

    with pytest.raises(TaskCancelled):
        _extract_archive_stream(str(archive), staging, cancel_event=cancel_event)
# ── _create_tar_file tests ─────────────────────────────────


class _FakePigzStdin:
    def __init__(self):
        self._buffer = bytearray()
        self.closed = False

    def write(self, data):
        self._buffer.extend(data)
        return len(data)

    def flush(self):
        return None

    def close(self):
        self.closed = True

    def tell(self):
        return len(self._buffer)

    def getvalue(self):
        return bytes(self._buffer)


class _FakePigzProcess:
    def __init__(self, stdout):
        self.stdin = _FakePigzStdin()
        self.stdout = stdout
        self.stderr = io.BytesIO()
        self.returncode = None
        self._terminated = False
        self._killed = False

    def poll(self):
        return self.returncode

    def wait(self, timeout=None):
        if self.returncode is not None:
            return self.returncode
        if self._terminated:
            self.returncode = 1
            return self.returncode
        if self._killed:
            self.returncode = -9
            return self.returncode
        self.stdout.write(gzip.compress(self.stdin.getvalue()))
        self.stdout.flush()
        self.returncode = 0
        return self.returncode

    def terminate(self):
        self._terminated = True

    def kill(self):
        self._killed = True




class _FakeImportPigzProcess:
    def __init__(self, stdout):
        self.stdin = _FakePigzStdin()
        self.stdout = stdout
        self.stderr = io.BytesIO()
        self.returncode = None
        self._terminated = False
        self._killed = False

    def poll(self):
        return self.returncode

    def wait(self, timeout=None):
        if self.returncode is not None:
            return self.returncode
        if self._terminated:
            self.returncode = 1
            return self.returncode
        if self._killed:
            self.returncode = -9
            return self.returncode
        self.returncode = 0
        return self.returncode

    def terminate(self):
        self._terminated = True

    def kill(self):
        self._killed = True


def _tar_bytes_from_tree(path, arcname="data"):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as tar:
        tar.add(str(path), arcname=arcname)
    return buffer.getvalue()
def _make_source_only_tree(tmp_path):
    data_dir = tmp_path / "data"
    source_dir = data_dir / "source_images"
    source_dir.mkdir(parents=True)
    nested_dir = source_dir / "nested"
    nested_dir.mkdir()
    (source_dir / "source.jpg").write_text("data")
    (nested_dir / "nested.txt").write_text("nested")
    tiles_dir = data_dir / "tiles"
    tiles_dir.mkdir()
    (tiles_dir / "tile.jpg").write_text("derived")
    tasks_dir = data_dir / "admin_tasks"
    tasks_dir.mkdir()
    (tasks_dir / "old.tar.gz").write_text("old")
    return data_dir, tiles_dir, tasks_dir


def _normalize_archive_names(names):
    return {name.rstrip("/") for name in names}


def _assert_source_only_archive(path):
    with tarfile.open(path, "r:gz") as tar:
        names = tar.getnames()
    normalized = _normalize_archive_names(names)
    assert "data" in normalized
    assert "data/source_images" in normalized
    assert "data/source_images/nested" in normalized
    assert "data/source_images/source.jpg" in normalized
    assert "data/source_images/nested/nested.txt" in normalized
    assert not any("tiles" in name for name in normalized)
    assert not any("admin_tasks" in name for name in normalized)


def _assert_callback_matches_archive(entries, path):
    with tarfile.open(path, "r:gz") as tar:
        names = tar.getnames()
    assert _normalize_archive_names(name for name, _size in entries) == _normalize_archive_names(names)


def test_create_tar_file_on_entry_reports_members(tmp_path) -> None:
    """on_entry callback receives every archive member name."""
    data_dir = tmp_path / "data"
    source = data_dir / "source_images"
    source.mkdir(parents=True)
    tiles = data_dir / "tiles"
    tiles.mkdir()
    tasks = data_dir / "admin_tasks"
    tasks.mkdir()
    (source / "a.jpg").write_text("a")
    (tiles / "tile.jpg").write_text("tile")
    (tasks / "old.json").write_text("stale")

    dest = str(tmp_path / "out.tar.gz")
    entries: list[tuple[str, int]] = []

    with patch("app.admin_ops._TASKS_DIR", str(tasks)):
        _create_tar_file(
            str(data_dir), dest,
            on_entry=lambda name, size: entries.append((name, size)),
        )

    names = [n for n, _ in entries]
    assert any("source_images" in n and n.endswith("a.jpg") for n in names)
    assert not any("/tiles/" in n or n.endswith("tiles/") for n in names)
    assert not any("admin_tasks" in n for n in names)
    # Directory entries should end with /
    assert any(n.endswith("/") for n in names)
    # File entries report their size; directory entries report 0.
    file_sizes = {n: s for n, s in entries if not n.endswith("/")}
    assert file_sizes and all(s >= 1 for s in file_sizes.values())
    dir_sizes = [s for n, s in entries if n.endswith("/")]
    assert dir_sizes and all(s == 0 for s in dir_sizes)


def test_create_tar_file_excludes_admin_tasks_and_tiles(tmp_path) -> None:
    """admin_tasks and generated tiles must be excluded from the archive."""
    data_dir = tmp_path / "data"
    source = data_dir / "source_images"
    source.mkdir(parents=True)
    tiles = data_dir / "tiles"
    tiles.mkdir()
    (tiles / "tile.jpg").write_text("tile")
    (source / "src.tiff").write_text("source")
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
    assert not any("/tiles/" in e or e.endswith("tiles/") for e in entries)
    with tarfile.open(dest, "r:gz") as tar:
        assert not any("admin_tasks" in m for m in tar.getnames())
        assert not any("/tiles/" in m or m.endswith("tiles") for m in tar.getnames())


def test_create_tar_file_uses_pigz_when_available(tmp_path) -> None:
    data_dir, tiles_dir, tasks_dir = _make_source_only_tree(tmp_path)
    dest = str(tmp_path / "pigz.tar.gz")
    entries: list[tuple[str, int]] = []
    processes: list[_FakePigzProcess] = []

    def _fake_popen(*_args, **kwargs):
        proc = _FakePigzProcess(kwargs["stdout"])
        processes.append(proc)
        return proc

    with (
        patch("app.admin_ops._TASKS_DIR", str(tasks_dir)),
        patch("app.admin_ops.settings") as mock_settings,
        patch("app.admin_ops.shutil.which", return_value="/usr/bin/pigz"),
        patch("app.admin_ops.subprocess.Popen", side_effect=_fake_popen) as mock_popen,
    ):
        mock_settings.tiles_dir = str(tiles_dir)
        mock_settings.export_pigz_threads = 2
        _create_tar_file(
            str(data_dir), dest,
            on_entry=lambda name, size: entries.append((name, size)),
        )

    mock_popen.assert_called_once()
    assert mock_popen.call_args.args[0] == ["/usr/bin/pigz", "-c", "-p", "2"]
    assert processes and processes[0].returncode == 0
    assert os.path.exists(dest)
    _assert_source_only_archive(dest)
    _assert_callback_matches_archive(entries, dest)


def test_create_tar_file_omits_pigz_thread_cap_when_zero(tmp_path) -> None:
    data_dir, tiles_dir, tasks_dir = _make_source_only_tree(tmp_path)
    dest = str(tmp_path / "pigz-zero.tar.gz")

    def _fake_popen(*_args, **kwargs):
        return _FakePigzProcess(kwargs["stdout"])

    with (
        patch("app.admin_ops._TASKS_DIR", str(tasks_dir)),
        patch("app.admin_ops.settings") as mock_settings,
        patch("app.admin_ops.shutil.which", return_value="/usr/bin/pigz"),
        patch("app.admin_ops.subprocess.Popen", side_effect=_fake_popen) as mock_popen,
    ):
        mock_settings.tiles_dir = str(tiles_dir)
        mock_settings.export_pigz_threads = 0
        _create_tar_file(str(data_dir), dest)

    mock_popen.assert_called_once()
    assert mock_popen.call_args.args[0] == ["/usr/bin/pigz", "-c"]
    assert os.path.exists(dest)


def test_create_tar_file_falls_back_without_pigz(tmp_path) -> None:
    data_dir, tiles_dir, tasks_dir = _make_source_only_tree(tmp_path)
    dest = str(tmp_path / "fallback.tar.gz")
    entries: list[tuple[str, int]] = []

    with (
        patch("app.admin_ops._TASKS_DIR", str(tasks_dir)),
        patch("app.admin_ops.settings") as mock_settings,
        patch("app.admin_ops.shutil.which", return_value=None),
        patch("app.admin_ops.subprocess.Popen") as mock_popen,
    ):
        mock_settings.tiles_dir = str(tiles_dir)
        _create_tar_file(
            str(data_dir), dest,
            on_entry=lambda name, size: entries.append((name, size)),
        )

    mock_popen.assert_not_called()
    assert os.path.exists(dest)
    _assert_source_only_archive(dest)
    _assert_callback_matches_archive(entries, dest)


def test_create_tar_file_cleans_up_when_popen_fails(tmp_path) -> None:
    data_dir, tiles_dir, tasks_dir = _make_source_only_tree(tmp_path)
    dest = str(tmp_path / "broken.tar.gz")
    real_open = builtins.open

    class _TrackedFile:
        def __init__(self, wrapped):
            self._wrapped = wrapped
            self.closed_called = False

        def close(self):
            self.closed_called = True
            return self._wrapped.close()

        def __getattr__(self, name):
            return getattr(self._wrapped, name)

    tracked_files = []

    def _open(path, mode="r", *args, **kwargs):
        fh = real_open(path, mode, *args, **kwargs)
        if path == dest and mode == "wb":
            tracked = _TrackedFile(fh)
            tracked_files.append(tracked)
            return tracked
        return fh

    with (
        patch("app.admin_ops._TASKS_DIR", str(tasks_dir)),
        patch("app.admin_ops.settings") as mock_settings,
        patch("app.admin_ops.shutil.which", return_value="/usr/bin/pigz"),
        patch("app.admin_ops.subprocess.Popen", side_effect=OSError("pigz missing")),
        patch("builtins.open", side_effect=_open),
    ):
        mock_settings.tiles_dir = str(tiles_dir)
        with pytest.raises(OSError):
            _create_tar_file(str(data_dir), dest)

    assert not os.path.exists(dest)
    assert tracked_files and tracked_files[0].closed_called


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

    programs = [
        SimpleNamespace(
            id=1, name="CS", oidc_group=None,
            created_at=now, updated_at=now,
        ),
        SimpleNamespace(
            id=2, name="Biology", oidc_group=None,
            created_at=now, updated_at=now,
        ),
    ]
    categories = []
    images = []
    users = [SimpleNamespace(
        id=1, name="Admin", email="admin@test.com", password_hash="hash",
        oidc_subject=None, role="admin", programs=[], last_access=None,
        metadata_={}, created_at=now, updated_at=now,
    )]
    source_images = []
    changelog_entries = [
        SimpleNamespace(
            id=1,
            title="Release 1",
            body="Body text",
            published_at=now,
            created_at=now,
            updated_at=now,
        )
    ]
    announcement = SimpleNamespace(message="", enabled=False, created_at=now, updated_at=now)

    groups = []
    call_count = 0

    async def mock_execute(stmt):
        nonlocal call_count
        call_count += 1
        result = MagicMock()
        data_map = {
            1: programs, 2: groups, 3: categories, 4: images,
            5: users, 6: source_images, 7: changelog_entries,
        }
        if call_count <= 7:
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

    # Verify PII/credential fields are excluded from the export
    export_path = os.path.join(tasks_dir, task.result_filename)
    with open(export_path) as f:
        dump = json.load(f)
    for user_entry in dump["users"]:
        assert "oidc_subject" not in user_entry, "oidc_subject is PII and must not appear in exports"
        assert "password_hash" not in user_entry, "password_hash must not appear in exports"
    # Ensure non-sensitive fields are still present
    assert dump["users"][0]["email"] == "admin@test.com"
    assert dump["users"][0]["role"] == "admin"
    # Programs survive the export round-trip.
    by_id = {p["id"]: p for p in dump["programs"]}
    assert set(by_id) == {1, 2}
    assert "parent_program_id" not in by_id[1]
    assert dump["changelog_entries"] == [
        {
            "id": 1,
            "title": "Release 1",
            "body": "Body text",
            "published_at": now.isoformat(),
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }
    ]


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


def _make_import_task(input_path: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=1,
        task_type="db_import",
        status="pending",
        progress=0,
        log="",
        result_filename=None,
        result_path=None,
        input_path=input_path,
        error_message=None,
    )


def _make_import_session(task: SimpleNamespace | None) -> tuple[AsyncMock, MagicMock]:
    """Build a mock session + session-factory pair for run_db_import.

    The same session instance is returned for both ``status_session`` and
    ``data_session`` because ``MagicMock.return_value`` is cached — any
    ``add``/``flush``/``commit``/``rollback`` call made by the importer can
    therefore be asserted against a single object.

    ``execute`` returns a :class:`MagicMock` whose ``scalars().all()`` is
    an empty list so the image→program lookup path inside the importer
    resolves to an empty program set.  Individual tests can override this
    via ``mock_session.execute.side_effect``.
    """
    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=task)
    mock_session.refresh = AsyncMock()
    mock_session.flush = AsyncMock()
    mock_session.commit = AsyncMock()
    mock_session.rollback = AsyncMock()

    exec_result = MagicMock()
    exec_result.scalars.return_value.all.return_value = []
    mock_session.execute = AsyncMock(return_value=exec_result)

    # add() is not awaited in the importer — use a sync MagicMock so it
    # records calls without returning a coroutine.
    mock_session.add = MagicMock()

    factory = MagicMock()
    factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    factory.return_value.__aexit__ = AsyncMock(return_value=False)
    return mock_session, factory


def _full_dump() -> dict:
    return {
        "programs": [
            {"id": 2, "name": "P2"},
            {"id": 1, "name": "P1"},
        ],
        "users": [
            {
                "id": 1,
                "name": "Alice",
                "email": "alice@example.com",
                "role": "admin",
                "program_id": 1,
                "last_access": "2025-01-01T00:00:00+00:00",
            },
            {
                "id": 2,
                "name": "Bob",
                "email": "bob@example.com",
                "password_hash": "hashed",
                "oidc_subject": "sub-2",
            },
        ],
        "categories": [
            # Intentionally out-of-order: child appears before parent.
            {"id": 3, "label": "grandchild", "parent_id": 2},
            {"id": 2, "label": "child", "parent_id": 1},
            {"id": 1, "label": "root", "parent_id": None, "sort_order": 0},
        ],
        "images": [
            {
                "id": 1,
                "name": "img1",
                "thumb": "/t",
                "tile_sources": "/ts",
                "category_id": 1,
                "active": True,
                "program_ids": [1, 2],
            },
            {
                # Uses legacy keys (`label`, `origin`) to cover the
                # fallback branches.
                "id": 2,
                "label": "img2",
                "thumb": "/t2",
                "tile_sources": "/ts2",
                "origin": "somewhere",
            },
        ],
        "source_images": [
            {
                "id": 1,
                "original_filename": "o.tiff",
                "stored_path": "/s",
                "status": "completed",
                "progress": 100,
                "image_id": 1,
            }
        ],
        "changelog_entries": [
            {
                "id": 1,
                "title": "Release 1",
                "body": "Body text",
                "published_at": "2025-01-02T00:00:00+00:00",
                "created_at": "2025-01-02T00:00:00+00:00",
                "updated_at": "2025-01-03T00:00:00+00:00",
            }
        ],
        "announcement": {"message": "hello", "enabled": True},
    }


async def test_run_db_import_happy_path(tmp_path) -> None:
    """Full import drives all flush/commit calls and marks the task completed."""
    input_file = tmp_path / "dump.json"
    input_file.write_text(json.dumps(_full_dump()))
    task = _make_import_task(str(input_file))

    mock_session, factory = _make_import_session(task)

    with patch("app.admin_ops.get_async_session", return_value=factory):
        await run_db_import(1)

    assert task.status == "completed"
    assert task.progress == 100
    assert "Imported" in (task.log or "")
    # Exactly one atomic data-session commit + a handful of status commits.
    assert mock_session.commit.await_count >= 2
    add_calls = [c.args[0] for c in mock_session.add.call_args_list]
    assert any(type(obj).__name__ == "ChangelogEntry" for obj in add_calls)
    # The importer unlinks the uploaded file on the `finally` branch.
    assert not input_file.exists()


async def test_run_db_import_without_optional_sections(tmp_path) -> None:
    """`programs`, `source_images`, `changelog_entries`, and `announcement` are optional."""
    dump = {
        "users": [{"id": 1, "name": "U", "email": "u@e.com"}],
        "categories": [{"id": 1, "label": "root", "parent_id": None}],
        "images": [
            {
                "id": 1,
                "name": "img",
                "thumb": "/t",
                "tile_sources": "/ts",
            }
        ],
    }
    input_file = tmp_path / "minimal.json"
    input_file.write_text(json.dumps(dump))
    task = _make_import_task(str(input_file))

    mock_session, factory = _make_import_session(task)

    with patch("app.admin_ops.get_async_session", return_value=factory):
        await run_db_import(1)

    assert task.status == "completed"
    # When `announcement` is absent the importer still inserts a default
    # empty row so the singleton exists.
    add_calls = [c.args[0] for c in mock_session.add.call_args_list]
    assert any(type(obj).__name__ == "Announcement" for obj in add_calls)


async def test_run_db_import_circular_categories(tmp_path) -> None:
    """Category rows that can't be topologically sorted surface a clear error."""
    dump = {
        "programs": [],
        "users": [{"id": 1, "name": "U", "email": "u@e.com"}],
        # Two categories whose parents refer only to each other — no root.
        "categories": [
            {"id": 1, "label": "a", "parent_id": 2},
            {"id": 2, "label": "b", "parent_id": 1},
        ],
        "images": [],
    }
    input_file = tmp_path / "circular.json"
    input_file.write_text(json.dumps(dump))
    task = _make_import_task(str(input_file))

    mock_session, factory = _make_import_session(task)

    with patch("app.admin_ops.get_async_session", return_value=factory):
        await run_db_import(1)

    assert task.status == "failed"
    assert "Circular" in (task.error_message or "")
    mock_session.rollback.assert_awaited()


async def test_run_db_import_non_dict_payload(tmp_path) -> None:
    """A JSON array (not an object) at the top level is rejected."""
    input_file = tmp_path / "array.json"
    input_file.write_text(json.dumps([1, 2, 3]))
    task = _make_import_task(str(input_file))

    mock_session, factory = _make_import_session(task)

    with patch("app.admin_ops.get_async_session", return_value=factory):
        await run_db_import(1)

    assert task.status == "failed"
    assert "JSON object" in (task.error_message or "")


async def test_run_db_import_cancelled_midway(tmp_path) -> None:
    """A cancel flipped on status_session.refresh aborts and rolls back."""
    input_file = tmp_path / "cancel.json"
    input_file.write_text(json.dumps(_full_dump()))
    task = _make_import_task(str(input_file))

    mock_session, factory = _make_import_session(task)

    # The importer calls `session.refresh` from every `_update_task` with
    # `check_cancelled=True`.  Flip the task status to "cancelling" on the
    # second call so we enter the import mid-flight before aborting.
    refresh_calls = {"count": 0}

    async def refresh_side_effect(_task, **_kwargs):
        refresh_calls["count"] += 1
        if refresh_calls["count"] == 2:
            _task.status = "cancelling"

    mock_session.refresh.side_effect = refresh_side_effect

    with patch("app.admin_ops.get_async_session", return_value=factory):
        await run_db_import(1)

    assert task.status == "cancelled"
    mock_session.rollback.assert_awaited()
    assert "rolled back" in (task.log or "")


async def test_run_db_import_data_session_failure(tmp_path) -> None:
    """A data-session exception is caught, rolled back, and surfaced on the task."""
    input_file = tmp_path / "dump.json"
    input_file.write_text(json.dumps(_full_dump()))
    task = _make_import_task(str(input_file))

    mock_session, factory = _make_import_session(task)

    # Explode on the first DELETE so the importer enters the generic
    # `except Exception` branch.
    call = {"count": 0}

    async def execute_side_effect(stmt, *args, **kwargs):
        call["count"] += 1
        if call["count"] >= 2:  # let the initial UPDATE admin_tasks succeed
            raise RuntimeError("simulated data-session failure")
        result = MagicMock()
        result.scalars.return_value.all.return_value = []
        return result

    mock_session.execute.side_effect = execute_side_effect

    with patch("app.admin_ops.get_async_session", return_value=factory):
        await run_db_import(1)

    assert task.status == "failed"
    assert "simulated data-session failure" in (task.error_message or "")
    mock_session.rollback.assert_awaited()
    # Even on failure the uploaded input file is cleaned up.
    assert not input_file.exists()


async def test_run_db_import_unlink_missing_input(tmp_path) -> None:
    """The `finally` clean-up swallows OSError when the input file is gone."""
    input_file = tmp_path / "dump.json"
    input_file.write_text(json.dumps(_full_dump()))
    task = _make_import_task(str(input_file))

    mock_session, factory = _make_import_session(task)

    # Pre-delete the input file so the happy-path still runs but the
    # finally `os.unlink` hits ENOENT.
    with patch("app.admin_ops.get_async_session", return_value=factory):
        # Read the JSON into memory via the real _read_file, then delete
        # the file after the reader is dispatched but before `finally`.
        original_read = __import__("app.admin_ops", fromlist=["_read_file"])._read_file

        def read_then_delete(path):
            data = original_read(path)
            os.unlink(path)
            return data

        with patch("app.admin_ops._read_file", side_effect=read_then_delete):
            await run_db_import(1)

    assert task.status == "completed"
    assert not input_file.exists()


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
        mock_settings.export_pigz_threads = 2
        await run_files_export(1)

    assert task.status == "failed"
    assert "empty or missing" in (task.error_message or "")


async def test_run_files_export_success(tmp_path) -> None:
    data_dir = tmp_path / "data"
    source_dir = data_dir / "source_images"
    source_dir.mkdir(parents=True)
    tiles_dir = data_dir / "tiles"
    tiles_dir.mkdir()
    (source_dir / "source.jpg").write_text("data")
    (tiles_dir / "tile.jpg").write_text("derived")

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
        mock_settings.export_pigz_threads = 2
        await run_files_export(1)

    assert task.status == "completed"
    assert task.progress == 100
    assert task.result_filename is not None
    assert task.result_filename.endswith(".tar.gz")
    assert "Scan complete" in task.log
    assert "source file(s)" in task.log
    with tarfile.open(os.path.join(tasks_dir, task.result_filename), "r:gz") as tar:
        names = tar.getnames()
        assert any("source_images" in name for name in names)
        assert not any("/tiles/" in name or name.endswith("/tiles") for name in names)


def test_iter_export_files_skips_admin_tasks_and_tiles(tmp_path) -> None:
    """``_iter_export_files`` reports sizes and omits tiles/admin_tasks."""
    data_dir = tmp_path / "data"
    source = data_dir / "source_images"
    source.mkdir(parents=True)
    tiles = data_dir / "tiles"
    tiles.mkdir()
    (source / "a.bin").write_bytes(b"0123456789")  # 10 bytes
    (tiles / "b.bin").write_bytes(b"xy")          # excluded
    tasks = data_dir / "admin_tasks"
    tasks.mkdir()
    (tasks / "stale.tar.gz").write_bytes(b"A" * 1000)

    with patch("app.admin_ops._TASKS_DIR", str(tasks)):
        results = list(_iter_export_files(str(data_dir)))

    names = {os.path.basename(p): sz for p, sz in results}
    assert names == {"a.bin": 10}


async def test_run_files_export_reports_byte_progress(tmp_path) -> None:
    """Progress advances between 20% and 95% as bytes are archived.

    The scan phase establishes the payload size up front, then the
    per-entry byte accounting should produce at least one intermediate
    progress update above 20 and below 95.
    """
    data_dir = tmp_path / "data"
    source = data_dir / "source_images"
    source.mkdir(parents=True)
    # Write files large enough that the byte-based progress calculation
    # produces observable motion.
    for i in range(5):
        (source / f"blob{i}.bin").write_bytes(b"X" * 1024)

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
        mock_settings.tiles_dir = str(data_dir / "tiles")
        mock_settings.export_pigz_threads = 2
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
    source_dir = data_dir / "source_images"
    source_dir.mkdir(parents=True)
    tiles_dir = data_dir / "tiles"
    tiles_dir.mkdir()
    (source_dir / "img.jpg").write_text("pixel")
    (tiles_dir / "derived.jpg").write_text("derived")

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
        mock_settings.export_pigz_threads = 2
        await run_files_export(1)

    assert task.status == "completed"
    assert "adding" in task.log
    assert "img.jpg" in task.log


async def test_run_files_export_cancellation(tmp_path) -> None:
    """Cancelling during archive creation terminates promptly via cancel_event."""
    import time

    data_dir = tmp_path / "data"
    source_dir = data_dir / "source_images"
    source_dir.mkdir(parents=True)
    (source_dir / "f0.txt").write_text("0")

    task = SimpleNamespace(
        id=1, task_type="files_export", status="pending", progress=0, log="",
        result_filename=None, result_path=None, input_path=None, error_message=None,
    )

    refresh_count = 0

    async def _refresh(obj, attribute_names=None):
        nonlocal refresh_count
        refresh_count += 1
        # Trigger cancellation after the export has entered the archive
        # phase so this test exercises the tar-thread cancellation path.
        if refresh_count >= 4:
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
        mock_settings.tiles_dir = str(data_dir / "tiles")
        mock_settings.export_pigz_threads = 2
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
    source_dir = data_dir / "source_images"
    source_dir.mkdir(parents=True)
    (source_dir / "f0.txt").write_text("0")

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
        mock_settings.tiles_dir = str(data_dir / "tiles")
        await run_files_export(1)

    # The force-cancel propagates through TaskCancelled handling, which
    # sets the task to ``cancelled``; whichever terminal state wins the
    # race, the point is we exited promptly rather than hung.
    assert task.status == "cancelled"


async def test_run_files_export_cancelled_during_scan(tmp_path) -> None:
    """Cancelling during the scan phase stops before tar creation starts."""
    import time

    data_dir = tmp_path / "data"
    source_dir = data_dir / "source_images"
    source_dir.mkdir(parents=True)
    (source_dir / "scan.dat").write_text("scan")

    task = SimpleNamespace(
        id=1, task_type="files_export", status="pending", progress=0, log="",
        result_filename=None, result_path=None, input_path=None, error_message=None,
    )

    refresh_count = 0

    async def _refresh(obj, attribute_names=None):
        nonlocal refresh_count
        refresh_count += 1
        if refresh_count >= 4:
            task.status = "cancelling"

    def _slow_scan(data_dir, *, cancel_event=None):
        while cancel_event is not None and not cancel_event.is_set():
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
        patch("app.admin_ops._scan_export_files", side_effect=_slow_scan),
        patch("app.admin_ops._create_tar_file") as mock_tar,
    ):
        mock_settings.tiles_dir = str(data_dir / "tiles")
        await run_files_export(1)

    assert task.status == "cancelled"
    mock_tar.assert_not_called()
    assert "Scanning source files" in task.log


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


async def test_run_files_import_uses_import_staging_dir_and_preserves_data(tmp_path) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    tiles_dir = data_dir / "tiles"
    tiles_dir.mkdir()
    (tiles_dir / "tile1.jpeg").write_text("tile")
    source_dir = data_dir / "source_images"
    source_dir.mkdir()
    (source_dir / "old.tiff").write_text("old")
    tasks_dir = data_dir / "admin_tasks"
    tasks_dir.mkdir()
    (tasks_dir / "keep.json").write_text("keep")

    payload_dir = tmp_path / "payload"
    payload_source = payload_dir / "source_images"
    payload_source.mkdir(parents=True)
    (payload_source / "new.tiff").write_text("new")
    archive = str(tmp_path / "upload.tar.gz")
    with tarfile.open(archive, "w:gz") as tar:
        tar.add(str(payload_dir), arcname="data")

    task = SimpleNamespace(
        id=1, task_type="files_import", status="pending", progress=0, log="",
        result_filename=None, result_path=None, input_path=archive,
        error_message=None,
    )

    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=task)
    mock_session.commit = AsyncMock()
    exec_result = MagicMock()
    exec_result.scalar.return_value = 99
    exec_result.scalars.return_value.first.return_value = None
    mock_session.execute.return_value = exec_result
    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    captured_tmpdir: dict[str, str | None] = {}
    real_tempdir = tempfile.TemporaryDirectory

    def _recording_tempdir(*args, **kwargs):
        captured_tmpdir["dir"] = kwargs.get("dir")
        return real_tempdir(*args, **kwargs)

    with (
        patch("app.admin_ops.get_async_session", return_value=mock_session_factory),
        patch("app.admin_ops.settings") as mock_settings,
        patch("app.admin_ops._IMPORT_STAGING_DIR", str(data_dir / ".import-staging")),
        patch("app.admin_ops.tempfile.TemporaryDirectory", side_effect=_recording_tempdir),
        patch("app.admin_ops.enqueue_admin_task", new_callable=AsyncMock, return_value=True),
        patch("app.admin_ops._ensure_tasks_dir", return_value=str(tasks_dir)),
    ):
        mock_settings.data_dir = str(data_dir)
        mock_settings.tiles_dir = str(tiles_dir)
        mock_settings.source_images_dir = str(source_dir)
        await run_files_import(1)

    assert captured_tmpdir["dir"] == str(data_dir / ".import-staging")
    assert task.status == "completed"
    assert task.progress == 100
    assert "Tile rebuild task #99" in task.log
    assert (source_dir / "new.tiff").read_text() == "new"
    assert not (source_dir / "old.tiff").exists()
    assert (tiles_dir / "tile1.jpeg").read_text() == "tile"
    assert (tasks_dir / "keep.json").read_text() == "keep"


async def test_run_files_import_rejects_insufficient_staging_space(tmp_path) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    source_dir = data_dir / "source_images"
    source_dir.mkdir()
    archive = tmp_path / "upload.tar.gz"
    with tarfile.open(str(archive), "w:gz") as tar:
        tar.add(str(source_dir), arcname="data/source_images")

    task = SimpleNamespace(
        id=1, task_type="files_import", status="pending", progress=0, log="",
        result_filename=None, result_path=None, input_path=str(archive),
        error_message=None,
    )

    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=task)
    mock_session.commit = AsyncMock()
    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    staging_root = data_dir / ".import-staging"

    def _disk_usage(path):
        assert Path(path) == staging_root
        return SimpleNamespace(total=100, used=99, free=1)

    with (
        patch("app.admin_ops.get_async_session", return_value=mock_session_factory),
        patch("app.admin_ops.settings") as mock_settings,
        patch("app.admin_ops._IMPORT_STAGING_DIR", str(staging_root)),
        patch("app.admin_ops._IMPORT_STAGING_FREE_SPACE_FACTOR", 1.25),
        patch("app.admin_ops.shutil.disk_usage", side_effect=_disk_usage),
    ):
        mock_settings.data_dir = str(data_dir)
        mock_settings.tiles_dir = str(data_dir / "tiles")
        mock_settings.source_images_dir = str(source_dir)
        await run_files_import(1)

    assert task.status == "failed"
    assert "on-volume staging" in (task.error_message or "")


def test_ensure_import_staging_same_device_allows_same_filesystem(tmp_path) -> None:
    staging_dir = tmp_path / "data" / ".import-staging"
    staging_dir.mkdir(parents=True)
    data_dir = tmp_path / "data"

    # Both paths live on the same tmp filesystem, so this must not raise.
    _ensure_import_staging_same_device(staging_dir, data_dir)


def test_ensure_import_staging_same_device_rejects_cross_device(tmp_path) -> None:
    staging_dir = tmp_path / "data" / ".import-staging"
    staging_dir.mkdir(parents=True)
    data_dir = tmp_path / "data"

    def _stat(path, *args, **kwargs):
        if Path(path) == staging_dir:
            return SimpleNamespace(st_dev=1)
        return SimpleNamespace(st_dev=2)

    with patch("app.admin_ops.os.stat", side_effect=_stat):
        with pytest.raises(ValueError, match="same volume"):
            _ensure_import_staging_same_device(staging_dir, data_dir)


async def test_run_files_import_rejects_cross_device_staging(tmp_path) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    source_dir = data_dir / "source_images"
    source_dir.mkdir()
    archive = tmp_path / "upload.tar.gz"
    with tarfile.open(str(archive), "w:gz") as tar:
        tar.add(str(source_dir), arcname="data/source_images")

    task = SimpleNamespace(
        id=1, task_type="files_import", status="pending", progress=0, log="",
        result_filename=None, result_path=None, input_path=str(archive),
        error_message=None,
    )

    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=task)
    mock_session.commit = AsyncMock()
    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    staging_root = data_dir / ".import-staging"

    with (
        patch("app.admin_ops.get_async_session", return_value=mock_session_factory),
        patch("app.admin_ops.settings") as mock_settings,
        patch("app.admin_ops._IMPORT_STAGING_DIR", str(staging_root)),
        patch(
            "app.admin_ops._ensure_import_staging_same_device",
            side_effect=ValueError(
                "Filesystem import staging directory must be on the same volume "
                "as the data directory"
            ),
        ),
    ):
        mock_settings.data_dir = str(data_dir)
        mock_settings.tiles_dir = str(data_dir / "tiles")
        mock_settings.source_images_dir = str(source_dir)
        await run_files_import(1)

    assert task.status == "failed"
    assert "same volume" in (task.error_message or "")


async def test_run_files_import_trips_runtime_free_space_floor_and_cleans_up(
    tmp_path,
) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    tiles_dir = data_dir / "tiles"
    tiles_dir.mkdir()
    source_dir = data_dir / "source_images"
    source_dir.mkdir()
    (source_dir / "old.tiff").write_text("old")

    archive_source = tmp_path / "payload"
    archive_source_source_images = archive_source / "source_images"
    archive_source_source_images.mkdir(parents=True)
    (archive_source_source_images / "new.tiff").write_text("new")
    archive = tmp_path / "upload.tar.gz"
    with tarfile.open(str(archive), "w:gz") as tar:
        tar.add(str(archive_source), arcname="data")

    task = SimpleNamespace(
        id=1,
        task_type="files_import",
        status="pending",
        progress=0,
        log="",
        result_filename=None,
        result_path=None,
        input_path=str(archive),
        error_message=None,
    )

    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=task)
    mock_session.commit = AsyncMock()
    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(
        return_value=mock_session
    )
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    staging_root = data_dir / ".import-staging"
    staging_root.mkdir()
    disk_usages = iter(
        [
            SimpleNamespace(total=10, used=1, free=2 * 1024 * 1024 * 1024),
            SimpleNamespace(total=10, used=9, free=512 * 1024 * 1024),
        ]
    )

    def _disk_usage(path):
        assert Path(path).is_relative_to(staging_root)
        return next(disk_usages)

    with (
        patch("app.admin_ops.get_async_session", return_value=mock_session_factory),
        patch("app.admin_ops.settings") as mock_settings,
        patch("app.admin_ops._IMPORT_STAGING_DIR", str(staging_root)),
        patch("app.admin_ops._IMPORT_STAGING_FREE_SPACE_CHECK_INTERVAL_BYTES", 1),
        patch("app.admin_ops.shutil.which", return_value=None),
        patch("app.admin_ops.shutil.disk_usage", side_effect=_disk_usage),
        patch("app.admin_ops._swap_imported_entries") as mock_swap,
    ):
        mock_settings.data_dir = str(data_dir)
        mock_settings.tiles_dir = str(tiles_dir)
        mock_settings.source_images_dir = str(source_dir)
        await run_files_import(1)

    assert task.status == "failed"
    assert "during filesystem import" in (task.error_message or "")
    assert "1.0 GiB" in (task.error_message or "")
    assert (source_dir / "old.tiff").read_text() == "old"
    assert not (source_dir / "new.tiff").exists()
    assert list(staging_root.iterdir()) == []
    mock_swap.assert_not_called()


def test_swap_imported_entries_keeps_success_on_backup_cleanup_failure(
    tmp_path, monkeypatch
) -> None:
    extracted_dir = tmp_path / "staging" / "data"
    extracted_source = extracted_dir / "source_images"
    extracted_source.mkdir(parents=True)
    (extracted_source / "new.tiff").write_text("new")

    data_dir = tmp_path / "data"
    data_source = data_dir / "source_images"
    data_source.mkdir(parents=True)
    (data_source / "old.tiff").write_text("old")
    tiles_dir = data_dir / "tiles"
    tiles_dir.mkdir()

    from app import admin_ops as admin_ops_module

    real_remove_path = admin_ops_module._remove_path

    def _remove_path_with_cleanup_failure(path: Path) -> None:
        if path.name.startswith("source_images.bak"):
            raise OSError("simulated cleanup failure")
        real_remove_path(path)

    monkeypatch.setattr("app.admin_ops._remove_path", _remove_path_with_cleanup_failure)

    result = _swap_imported_entries(
        extracted_dir,
        data_dir,
        str(tiles_dir),
        str(data_source),
    )

    assert result["source_files"] == 1
    assert (data_source / "new.tiff").read_text() == "new"
    assert not (data_source / "old.tiff").exists()


async def test_list_files_import_archives_returns_retained_uploads(tmp_path) -> None:
    tasks_dir = tmp_path / "admin_tasks"
    tasks_dir.mkdir()
    archive = tasks_dir / "import-1.tar.gz"
    archive.write_bytes(b"archive-bytes")

    task = SimpleNamespace(
        id=7,
        task_type="files_import",
        status="completed",
        progress=100,
        log="Awaiting file upload: archive.tar.gz\n",
        result_filename=None,
        result_path=None,
        input_path=str(archive),
        original_filename="archive.tar.gz",
        error_message=None,
        created_by=1,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )

    result = MagicMock()
    result.scalars.return_value = [task]
    session = AsyncMock()
    session.execute = AsyncMock(return_value=result)

    with patch("app.admin_ops._TASKS_DIR", str(tasks_dir)):
        archives = await list_files_import_archives(session)

    assert archives == [
        {
            "archive_task_id": 7,
            "original_filename": "archive.tar.gz",
            "size_bytes": archive.stat().st_size,
            "created_at": task.created_at,
            "last_status": "completed",
        }
    ]


async def test_rerun_files_import_archive_reuses_retained_file(tmp_path) -> None:
    tasks_dir = tmp_path / "admin_tasks"
    tasks_dir.mkdir()
    archive = tasks_dir / "import-1.tar.gz"
    archive.write_bytes(b"archive-bytes")

    archive_task = SimpleNamespace(
        id=7,
        task_type="files_import",
        status="completed",
        progress=100,
        log="Awaiting file upload: archive.tar.gz\n",
        result_filename=None,
        result_path=None,
        input_path=str(archive),
        original_filename="archive.tar.gz",
        error_message=None,
        created_by=1,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )

    session = AsyncMock()
    session.get = AsyncMock(return_value=archive_task)
    existing_result = MagicMock()
    existing_result.scalars.return_value.first.return_value = None
    session.execute = AsyncMock(return_value=existing_result)
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "id", 8) or None)

    with patch("app.admin_ops._TASKS_DIR", str(tasks_dir)):
        result = await rerun_files_import_archive(session, SimpleNamespace(id=9), 7)

    assert result.id == 8
    assert result.task_type == "files_import"
    assert result.status == "pending"
    assert result.input_path == str(archive)
    assert result.original_filename == "archive.tar.gz"
    assert "Re-running retained archive" in result.log
    session.add.assert_called_once()
    session.commit.assert_awaited()


async def test_delete_files_import_archive_removes_retained_file(tmp_path) -> None:
    tasks_dir = tmp_path / "admin_tasks"
    tasks_dir.mkdir()
    archive = tasks_dir / "import-1.tar.gz"
    archive.write_bytes(b"archive-bytes")

    archive_task = SimpleNamespace(
        id=7,
        task_type="files_import",
        status="completed",
        progress=100,
        log="Awaiting file upload: archive.tar.gz\n",
        result_filename=None,
        result_path=None,
        input_path=str(archive),
        original_filename="archive.tar.gz",
        error_message=None,
        created_by=1,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )

    active_result = MagicMock()
    active_result.scalars.return_value.first.return_value = None
    session = AsyncMock()
    session.get = AsyncMock(return_value=archive_task)
    session.execute = AsyncMock(return_value=active_result)

    with patch("app.admin_ops._TASKS_DIR", str(tasks_dir)):
        result = await delete_files_import_archive(session, 7)

    assert result["deleted"] is True
    assert result["archive_task_id"] == 7
    assert not archive.exists()


def test_validate_retained_files_import_archive_path_rejects_traversal(tmp_path) -> None:
    tasks_dir = tmp_path / "admin_tasks"
    tasks_dir.mkdir()
    with patch("app.admin_ops._TASKS_DIR", str(tasks_dir)):
        with pytest.raises(ValueError, match="outside admin_tasks dir"):
            _validate_retained_files_import_archive_path(str(tmp_path / "escape.tar.gz"))

async def test_run_file_restore_success(tmp_path) -> None:
    request_file = tmp_path / "restore.json"
    request_file.write_text(
        json.dumps(
            {
                "snapshot_name": "hriv-backup-20260102-020000",
                "member_path": "data/source_images/a.jpg",
            }
        )
    )
    task = SimpleNamespace(
        id=1,
        task_type="file_restore",
        status="pending",
        progress=0,
        log="",
        result_filename=None,
        result_path=None,
        input_path=str(request_file),
        error_message=None,
    )

    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=task)
    mock_session.commit = AsyncMock()
    mock_session.refresh = AsyncMock()
    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("app.admin_ops.get_async_session", return_value=mock_session_factory),
        patch(
            "app.admin_ops.restore_snapshot_file",
            return_value={
                "snapshot_name": "hriv-backup-20260102-020000",
                "member_path": "data/source_images/a.jpg",
                "destination": "/data/source_images/a.jpg",
                "size": 3,
                "sha256": "abc",
            },
        ),
    ):
        await run_file_restore(1)

    assert task.status == "completed"
    assert task.progress == 100
    assert "Rebuild Tiles" in task.log
    assert not request_file.exists()


async def test_run_db_import_with_groups(tmp_path) -> None:
    """Groups and category group_ids are imported without error."""
    dump = {
        "users": [
            {"id": 1, "name": "Ins", "email": "ins@e.com", "role": "instructor"},
            {"id": 2, "name": "Stu", "email": "stu@e.com", "role": "student"},
        ],
        "groups": [
            {
                "id": 1,
                "name": "G1",
                "description": "d",
                "created_by_user_id": 1,
                "member_ids": [2],
                "instructor_ids": [1],
            }
        ],
        "categories": [
            {"id": 1, "label": "root", "parent_id": None, "group_ids": [1]},
        ],
        "images": [],
    }
    input_file = tmp_path / "groups.json"
    input_file.write_text(json.dumps(dump))
    task = _make_import_task(str(input_file))

    mock_session, factory = _make_import_session(task)

    with patch("app.admin_ops.get_async_session", return_value=factory):
        await run_db_import(1)

    assert task.status == "completed"
    add_calls = [c.args[0] for c in mock_session.add.call_args_list]
    assert any(type(obj).__name__ == "Group" for obj in add_calls)


async def test_run_db_export_includes_groups(tmp_path) -> None:
    """A group with members/instructors round-trips into the export dump."""
    now = datetime.now(timezone.utc)
    task = SimpleNamespace(
        id=1, task_type="db_export", status="pending", progress=0, log="",
        result_filename=None, result_path=None, input_path=None, error_message=None,
    )
    group = SimpleNamespace(
        id=1, name="G1", description="desc", created_by_user_id=1,
        members=[SimpleNamespace(id=2)],
        instructors=[SimpleNamespace(id=1)],
        created_at=now, updated_at=now,
    )
    changelog_entry = SimpleNamespace(
        id=1,
        title="Release 1",
        body="Body text",
        published_at=now,
        created_at=now,
        updated_at=now,
    )
    announcement = SimpleNamespace(message="", enabled=False, created_at=now, updated_at=now)
    call_count = 0

    async def mock_execute(stmt):
        nonlocal call_count
        call_count += 1
        result = MagicMock()
        data_map = {1: [], 2: [group], 3: [], 4: [], 5: [], 6: [], 7: [changelog_entry]}
        if call_count <= 7:
            rows = data_map[call_count]
            result.scalars.return_value.all.return_value = rows
            result.scalars.return_value.unique.return_value.all.return_value = rows
        else:
            result.scalar_one_or_none.return_value = announcement
        return result

    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=task)
    mock_session.execute = AsyncMock(side_effect=mock_execute)
    mock_session.commit = AsyncMock()
    factory = MagicMock()
    factory.return_value.__aenter__ = AsyncMock(return_value=mock_session)
    factory.return_value.__aexit__ = AsyncMock(return_value=False)

    tasks_dir = str(tmp_path / "admin_tasks")
    with (
        patch("app.admin_ops.get_async_session", return_value=factory),
        patch("app.admin_ops._TASKS_DIR", tasks_dir),
    ):
        await run_db_export(1)

    assert task.status == "completed"
    export_path = os.path.join(tasks_dir, task.result_filename)
    with open(export_path) as f:
        dump = json.load(f)
    assert dump["groups"][0]["member_ids"] == [2]
    assert dump["groups"][0]["instructor_ids"] == [1]
    assert dump["changelog_entries"][0]["title"] == "Release 1"


# ── run_rebuild_tiles tests (issue #735) ───────────────────


def _rebuild_task(input_path=None):
    return SimpleNamespace(
        id=1, task_type="rebuild_tiles", status="pending", progress=0, log="",
        result_filename=None, result_path=None, input_path=input_path,
        error_message=None,
    )


def _rebuild_factory(task):
    """Single-session factory mock for run_rebuild_tiles tests."""
    session = AsyncMock()
    session.get = AsyncMock(return_value=task)
    session.refresh = AsyncMock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    factory = MagicMock()
    factory.return_value.__aenter__ = AsyncMock(return_value=session)
    factory.return_value.__aexit__ = AsyncMock(return_value=False)
    return session, factory


async def test_run_rebuild_tiles_task_not_found() -> None:
    """A missing task id logs and returns without raising."""
    session, factory = _rebuild_factory(None)
    with patch("app.admin_ops.get_async_session", return_value=factory):
        await run_rebuild_tiles(999)


async def test_run_rebuild_tiles_noop_when_nothing_selected() -> None:
    """When no tile sets need rebuilding the task completes with a no-op log."""
    task = _rebuild_task()
    session, factory = _rebuild_factory(task)

    with (
        patch("app.admin_ops.get_async_session", return_value=factory),
        patch("app.processing.select_rebuild_targets", AsyncMock(return_value=[])),
        patch("app.processing.rebuild_source_image_tiles", AsyncMock()) as mock_rebuild,
    ):
        await run_rebuild_tiles(1)

    assert task.status == "completed"
    assert task.progress == 100
    assert "Nothing to rebuild" in task.log
    mock_rebuild.assert_not_awaited()


async def test_run_rebuild_tiles_reports_per_image_failures() -> None:
    """A failing image is logged but does not abort the batch.

    The runner re-fetches each ``SourceImage`` by id every iteration so a
    per-image ``session.rollback()`` (which expires the identity map) cannot
    break later images — verified here by asserting one ``session.get`` per
    target source id.
    """
    task = _rebuild_task()
    session, factory = _rebuild_factory(task)
    targets = [
        SimpleNamespace(id=1, image_id=10),
        SimpleNamespace(id=2, image_id=20),
        SimpleNamespace(id=3, image_id=30),
    ]
    source_get_ids: list[int] = []

    def get_side_effect(model, ident):
        # AdminTask lookups return the task; SourceImage lookups return a
        # fresh ORM-like object, mirroring a real re-fetch after rollback.
        if getattr(model, "__name__", "") == "SourceImage":
            source_get_ids.append(ident)
            return SimpleNamespace(id=ident, image_id=ident * 10)
        return task

    session.get = AsyncMock(side_effect=get_side_effect)
    # Source #2 fails; #1 and #3 succeed.
    rebuild_mock = AsyncMock(side_effect=[None, RuntimeError("vips boom"), None])

    with (
        patch("app.admin_ops.get_async_session", return_value=factory),
        patch(
            "app.processing.select_rebuild_targets",
            AsyncMock(return_value=targets),
        ),
        patch("app.processing.rebuild_source_image_tiles", rebuild_mock),
    ):
        await run_rebuild_tiles(1)

    assert task.status == "completed"
    assert task.progress == 100
    assert "Rebuilt 2 of 3 tile set(s); 1 failed." in task.log
    assert "ERROR rebuilding source #2" in task.log
    assert rebuild_mock.await_count == 3
    # Each source is re-fetched exactly once, even after the failure rollback.
    assert source_get_ids == [1, 2, 3]


async def test_run_rebuild_tiles_skips_source_deleted_mid_batch() -> None:
    """A source that vanishes mid-batch is skipped, not rebuilt."""
    task = _rebuild_task()
    session, factory = _rebuild_factory(task)
    targets = [SimpleNamespace(id=1, image_id=10), SimpleNamespace(id=2, image_id=20)]

    def get_side_effect(model, ident):
        if getattr(model, "__name__", "") == "SourceImage":
            # Source #2 was deleted after selection.
            return None if ident == 2 else SimpleNamespace(id=ident, image_id=ident * 10)
        return task

    session.get = AsyncMock(side_effect=get_side_effect)
    rebuild_mock = AsyncMock(return_value=None)

    with (
        patch("app.admin_ops.get_async_session", return_value=factory),
        patch(
            "app.processing.select_rebuild_targets",
            AsyncMock(return_value=targets),
        ),
        patch("app.processing.rebuild_source_image_tiles", rebuild_mock),
    ):
        await run_rebuild_tiles(1)

    assert task.status == "completed"
    assert "Rebuilt 1 of 2 tile set(s); 1 failed." in task.log
    assert "Skipped source #2: no longer exists." in task.log
    assert rebuild_mock.await_count == 1


async def test_run_rebuild_tiles_logs_explicit_empty_image_ids() -> None:
    """An explicit empty image_ids list is shown in the log (not omitted)."""
    task = _rebuild_task(input_path="/tmp/rebuild-params.json")
    session, factory = _rebuild_factory(task)

    with (
        patch("app.admin_ops.get_async_session", return_value=factory),
        patch("app.admin_ops.os.path.exists", return_value=True),
        patch(
            "app.admin_ops._read_file",
            return_value='{"scope": "missing_stale", "image_ids": []}',
        ),
        patch("app.admin_ops.os.unlink"),
        patch("app.processing.select_rebuild_targets", AsyncMock(return_value=[])),
    ):
        await run_rebuild_tiles(1)

    assert task.status == "completed"
    assert "image_ids: []" in task.log


async def test_run_rebuild_tiles_invalid_scope_fails_task() -> None:
    """An invalid scope in the params file fails the task fatally."""
    task = _rebuild_task(input_path="/tmp/rebuild-params.json")
    session, factory = _rebuild_factory(task)

    with (
        patch("app.admin_ops.get_async_session", return_value=factory),
        patch("app.admin_ops.os.path.exists", return_value=True),
        patch("app.admin_ops._read_file", return_value='{"scope": "bogus"}'),
        patch("app.admin_ops.os.unlink"),
    ):
        await run_rebuild_tiles(1)

    assert task.status == "failed"
    assert "Unknown rebuild scope" in (task.error_message or "")


# ── _queue_rebuild_tiles_after_import tests ────────────────


def _queue_session_factory(existing=None, insert_id=99, raise_on_insert=False):
    """Factory mock for _queue_rebuild_tiles_after_import tests."""
    session = AsyncMock()
    exec_result = MagicMock()
    exec_result.scalar.return_value = insert_id
    exec_result.scalars.return_value.first.return_value = existing

    call_count = 0

    async def _execute(stmt):
        nonlocal call_count
        call_count += 1
        if raise_on_insert and call_count == 2:
            raise RuntimeError("insert failed")
        return exec_result

    session.execute = AsyncMock(side_effect=_execute)
    session.commit = AsyncMock()
    session_factory = MagicMock()
    session_factory.return_value.__aenter__ = AsyncMock(return_value=session)
    session_factory.return_value.__aexit__ = AsyncMock(return_value=False)
    return session, session_factory


async def test_queue_rebuild_tiles_after_import_skips_active_and_cleans_params(tmp_path) -> None:
    """When a rebuild task is already active, the params file is cleaned up."""
    import_task = SimpleNamespace(
        input_path=str(tmp_path / "import.tar.gz"),
        created_by=1,
    )
    existing = AdminTask(
        id=77,
        task_type="rebuild_tiles",
        status="running",
    )
    _, session_factory = _queue_session_factory(existing=existing)

    with (
        patch("app.admin_ops.get_async_session", return_value=session_factory),
        patch("app.admin_ops.enqueue_admin_task", new_callable=AsyncMock) as mock_enqueue,
        patch("app.admin_ops._ensure_tasks_dir", return_value=str(tmp_path)),
    ):
        message = await _queue_rebuild_tiles_after_import(import_task)

    assert "already active (#77)" in message
    assert not any(tmp_path.glob("rebuild-after-import-*.json"))
    mock_enqueue.assert_not_awaited()


async def test_queue_rebuild_tiles_after_import_marks_failed_on_enqueue_error(tmp_path) -> None:
    """When enqueue fails, the pending task is marked failed and params are removed."""
    import_task = SimpleNamespace(
        input_path=str(tmp_path / "import.tar.gz"),
        created_by=1,
    )
    session, session_factory = _queue_session_factory(insert_id=99)

    with (
        patch("app.admin_ops.get_async_session", return_value=session_factory),
        patch("app.admin_ops.enqueue_admin_task", new_callable=AsyncMock, return_value=False),
        patch("app.admin_ops._ensure_tasks_dir", return_value=str(tmp_path)),
    ):
        message = await _queue_rebuild_tiles_after_import(import_task)

    assert "Could not queue automatic tile rebuild" in message
    assert not any(tmp_path.glob("rebuild-after-import-*.json"))
    assert session.execute.await_count == 3  # select, insert, update
    session.commit.assert_awaited()


async def test_queue_rebuild_tiles_after_import_queues_on_success(tmp_path) -> None:
    """A new rebuild task is created and enqueued when Redis is available."""
    import_task = SimpleNamespace(
        input_path=str(tmp_path / "import.tar.gz"),
        created_by=1,
    )
    session, session_factory = _queue_session_factory(insert_id=99)

    with (
        patch("app.admin_ops.get_async_session", return_value=session_factory),
        patch("app.admin_ops.enqueue_admin_task", new_callable=AsyncMock, return_value=True),
        patch("app.admin_ops._ensure_tasks_dir", return_value=str(tmp_path)),
    ):
        message = await _queue_rebuild_tiles_after_import(import_task)

    assert "Tile rebuild task #99 was queued automatically" in message
    params_files = list(tmp_path.glob("rebuild-after-import-*.json"))
    assert len(params_files) == 1
    with open(params_files[0], "r", encoding="utf-8") as f:
        assert json.load(f)["scope"] == "missing"
    assert session.execute.await_count == 2  # select, insert


async def test_queue_rebuild_tiles_after_import_falls_back_to_background_tasks(tmp_path) -> None:
    """When Redis is unavailable and a BackgroundTasks object is available,
    the rebuild is scheduled to run in-process after the import completes."""
    import_task = SimpleNamespace(
        input_path=str(tmp_path / "import.tar.gz"),
        created_by=1,
    )
    session, session_factory = _queue_session_factory(insert_id=99)
    bg = MagicMock()

    with (
        patch("app.admin_ops.get_async_session", return_value=session_factory),
        patch("app.admin_ops.enqueue_admin_task", new_callable=AsyncMock, return_value=False),
        patch("app.admin_ops._ensure_tasks_dir", return_value=str(tmp_path)),
    ):
        message = await _queue_rebuild_tiles_after_import(import_task, bg)

    assert "Tile rebuild task #99 was scheduled to run automatically" in message
    assert session.execute.await_count == 2  # select, insert
    bg.add_task.assert_called_once_with(run_rebuild_tiles, 99)
    # Params file is left for the in-process runner to consume and delete.
    params_files = list(tmp_path.glob("rebuild-after-import-*.json"))
    assert len(params_files) == 1
