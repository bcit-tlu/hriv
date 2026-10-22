"""Unit tests for ``scripts/purge_failed_source_images.py``.

The ops script lives outside ``app/`` (it is executed inside the backend
container via ``kubectl exec``), so it is loaded by file path — the same
approach ``test_migration_role_helpers.py`` uses for migration modules.
Database access is mocked via ``get_async_session``; filesystem operations
exercise real paths under ``tmp_path``.
"""

from __future__ import annotations

import asyncio
import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models import SourceImage


def _load_purge_script() -> ModuleType:
    path = (
        Path(__file__).resolve().parents[2]
        / "scripts"
        / "purge_failed_source_images.py"
    )
    spec = importlib.util.spec_from_file_location("purge_failed_source_images", path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


purge = _load_purge_script()


def _session_factory(session: MagicMock) -> MagicMock:
    """Match the ``get_async_session()()`` call shape used in app code."""
    factory = MagicMock()
    factory.return_value.__aenter__ = AsyncMock(return_value=session)
    factory.return_value.__aexit__ = AsyncMock(return_value=False)
    return factory


def _src(
    src_id: int,
    *,
    status: str = "failed",
    image_id: int | None = None,
    stored_path: str = "/data/source_images/x.jpg",
) -> SourceImage:
    return SourceImage(
        id=src_id,
        original_filename=f"img{src_id}.jpg",
        stored_path=stored_path,
        status=status,
        image_id=image_id,
        error_message="Tile generation failed.",
        created_at=datetime(2026, 7, 17, tzinfo=timezone.utc),
    )


# ── _contained ──────────────────────────────────────────────────────────


def test_contained_accepts_path_inside_root(tmp_path):
    inner = tmp_path / "a" / "b"
    inner.mkdir(parents=True)
    assert purge._contained(str(tmp_path), str(inner)) is True


def test_contained_rejects_path_outside_root(tmp_path):
    outside = tmp_path.parent / (tmp_path.name + "_other")
    outside.mkdir()
    assert purge._contained(str(tmp_path), str(outside)) is False


# ── _candidate_info / _remove_artifacts ─────────────────────────────────


@pytest.fixture
def managed_roots(tmp_path):
    """Point the script's settings at per-test managed roots."""
    tiles = tmp_path / "tiles"
    sources = tmp_path / "sources"
    tiles.mkdir()
    sources.mkdir()
    fake = SimpleNamespace(
        tiles_dir=str(tiles), source_images_dir=str(sources)
    )
    with patch.object(purge, "settings", fake):
        yield SimpleNamespace(tiles=tiles, sources=sources)


def test_remove_artifacts_deletes_tiles_dir_and_stored_file(managed_roots):
    tiles_dir = managed_roots.tiles / "42"
    tiles_dir.mkdir()
    (tiles_dir / "image.dzi").write_text("dzi")
    stored = managed_roots.sources / "abc.jpg"
    stored.write_bytes(b"data")
    info = {
        "tiles_dir": str(tiles_dir),
        "tiles_exists": True,
        "stored_path": str(stored),
        "stored_exists": True,
    }
    assert purge._remove_artifacts(info) == []
    assert not tiles_dir.exists()
    assert not stored.exists()


def test_remove_artifacts_refuses_outside_root_paths(managed_roots):
    outside_file = managed_roots.tiles.parent / "escape.jpg"
    outside_file.write_bytes(b"data")
    outside_dir = managed_roots.sources.parent / "escape_tiles"
    outside_dir.mkdir()
    info = {
        "tiles_dir": str(outside_dir),
        "tiles_exists": True,
        "stored_path": str(outside_file),
        "stored_exists": True,
    }
    problems = purge._remove_artifacts(info)
    assert len(problems) == 2
    assert outside_dir.exists() and outside_file.exists()


def test_remove_artifacts_reports_rmtree_failure(managed_roots):
    tiles_dir = managed_roots.tiles / "42"
    tiles_dir.mkdir()
    stored = managed_roots.sources / "abc.jpg"
    stored.write_bytes(b"data")
    info = {
        "tiles_dir": str(tiles_dir),
        "tiles_exists": True,
        "stored_path": str(stored),
        "stored_exists": True,
    }
    with patch.object(purge.shutil, "rmtree", side_effect=OSError("denied")):
        problems = purge._remove_artifacts(info)
    assert len(problems) == 1
    assert "tiles dir" in problems[0]
    # The stored-file removal still runs despite the earlier failure.
    assert not stored.exists()
    assert tiles_dir.exists()


# ── _find_candidates ────────────────────────────────────────────────────


async def test_find_candidates_filters_failed_unlinked_aged(managed_roots):
    session = MagicMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = [_src(1)]
    session.execute = AsyncMock(return_value=result)
    with patch.object(
        purge, "get_async_session", return_value=_session_factory(session)
    ):
        infos = await purge._find_candidates(30, None)

    assert [i["id"] for i in infos] == [1]
    stmt = session.execute.call_args[0][0]
    sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    assert "source_images.status = 'failed'" in sql
    assert "source_images.image_id IS NULL" in sql
    assert "source_images.created_at <" in sql


async def test_find_candidates_source_ids_narrowing(managed_roots):
    session = MagicMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    session.execute = AsyncMock(return_value=result)
    with patch.object(
        purge, "get_async_session", return_value=_session_factory(session)
    ):
        await purge._find_candidates(30, [617, 618])

    stmt = session.execute.call_args[0][0]
    sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    assert "617" in sql and "618" in sql


# ── _apply ──────────────────────────────────────────────────────────────


async def test_apply_deletes_row_and_commits(managed_roots):
    src = _src(1, stored_path=str(managed_roots.sources / "x.jpg"))
    session = MagicMock()
    session.get = AsyncMock(return_value=src)
    session.delete = AsyncMock()
    session.commit = AsyncMock()
    with (
        patch.object(
            purge, "get_async_session", return_value=_session_factory(session)
        ),
        patch.object(purge, "_remove_artifacts", return_value=[]),
    ):
        problems = await purge._apply([1])

    assert problems == []
    session.delete.assert_awaited_once_with(src)
    session.commit.assert_awaited_once()


async def test_apply_retains_row_when_artifact_removal_fails(managed_roots):
    src = _src(1, stored_path=str(managed_roots.sources / "x.jpg"))
    session = MagicMock()
    session.get = AsyncMock(return_value=src)
    session.delete = AsyncMock()
    session.commit = AsyncMock()
    with (
        patch.object(
            purge, "get_async_session", return_value=_session_factory(session)
        ),
        patch.object(
            purge,
            "_remove_artifacts",
            return_value=["failed to remove tiles dir /data/tiles/1: denied"],
        ),
    ):
        problems = await purge._apply([1])

    # A leftover tile tree is only discoverable through its row — the row
    # must be retained so the next dry run can find and retry it.
    assert problems == ["failed to remove tiles dir /data/tiles/1: denied"]
    session.delete.assert_not_called()
    session.commit.assert_awaited_once()


async def test_apply_skips_row_that_became_ineligible(managed_roots):
    linked = _src(1, image_id=99)
    completed = _src(2, status="completed")
    session = MagicMock()
    session.get = AsyncMock(side_effect=[linked, completed])
    session.delete = AsyncMock()
    session.commit = AsyncMock()
    with (
        patch.object(
            purge, "get_async_session", return_value=_session_factory(session)
        ),
        patch.object(purge, "_remove_artifacts") as remove,
    ):
        problems = await purge._apply([1, 2])

    assert problems == []
    remove.assert_not_called()
    session.delete.assert_not_called()


async def test_apply_skips_vanished_row(managed_roots):
    session = MagicMock()
    session.get = AsyncMock(return_value=None)
    session.delete = AsyncMock()
    session.commit = AsyncMock()
    with (
        patch.object(
            purge, "get_async_session", return_value=_session_factory(session)
        ),
        patch.object(purge, "_remove_artifacts") as remove,
    ):
        problems = await purge._apply([1])

    assert problems == []
    remove.assert_not_called()
    session.delete.assert_not_called()


# ── main() entry point ──────────────────────────────────────────────────


def test_main_dry_run_lists_candidates_without_deleting(
    managed_roots, capsys
):
    infos = [
        {
            "id": 1,
            "original_filename": "img1.jpg",
            "created_at": datetime(2026, 7, 17, tzinfo=timezone.utc),
            "error_message": "Tile generation failed.",
            "stored_path": "/data/source_images/x.jpg",
            "stored_exists": True,
            "stored_size": 1024,
            "tiles_dir": "/data/tiles/1",
            "tiles_exists": True,
            "tiles_size": 2048,
        }
    ]
    with (
        patch.object(purge, "_find_candidates", new=AsyncMock(return_value=infos)),
        patch.object(purge, "_apply", new=AsyncMock()) as apply_mock,
        patch.object(sys, "argv", ["-", "--older-than-days", "7"]),
    ):
        assert purge.main() == 0

    apply_mock.assert_not_called()
    out = capsys.readouterr().out
    assert "DRY RUN" in out and "src=1" in out and "--apply" in out


def test_main_apply_with_no_candidates_exits_clean(managed_roots, capsys):
    with (
        patch.object(purge, "_find_candidates", new=AsyncMock(return_value=[])),
        patch.object(purge, "_apply", new=AsyncMock()) as apply_mock,
        patch.object(sys, "argv", ["-", "--apply"]),
    ):
        assert purge.main() == 0

    apply_mock.assert_not_called()
    assert "Nothing to do." in capsys.readouterr().out


def test_main_uses_a_single_event_loop(managed_roots):
    """Find and apply must share one ``asyncio.run``.

    The shared SQLAlchemy engine binds pooled connections to the loop that
    first used them; a second ``asyncio.run`` would check out connections
    bound to the closed first loop and crash on the pool pre-ping.
    """
    infos = [
        {
            "id": 1,
            "original_filename": "img1.jpg",
            "created_at": datetime(2026, 7, 17, tzinfo=timezone.utc),
            "error_message": None,
            "stored_path": "/data/source_images/x.jpg",
            "stored_exists": False,
            "stored_size": 0,
            "tiles_dir": "/data/tiles/1",
            "tiles_exists": False,
            "tiles_size": 0,
        }
    ]
    real_run = asyncio.run
    with (
        patch.object(purge, "_find_candidates", new=AsyncMock(return_value=infos)),
        patch.object(purge, "_apply", new=AsyncMock(return_value=[])),
        patch.object(sys, "argv", ["-", "--apply"]),
        patch.object(asyncio, "run", wraps=real_run) as run_spy,
    ):
        assert purge.main() == 0

    assert run_spy.call_count == 1
