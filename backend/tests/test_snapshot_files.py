import errno
from pathlib import Path
from unittest.mock import patch

import pytest

from app.admin_ops import _create_tar_file, _extract_and_restore
from app import admin_ops
from app.database import settings
from app.snapshot_files import snapshot_files


def test_snapshot_files_archive_round_trip(tmp_path, monkeypatch):
    data = tmp_path / "data"
    tiles = data / "tiles"
    for namespace in ("markers", "collection_slots"):
        directory = tiles / "42" / namespace
        directory.mkdir(parents=True)
        (directory / "7.jpg").write_bytes(b"original JPEG")
        (directory / ".partial.jpg").write_bytes(b"partial")
    (tiles / "42" / "image.dzi").write_text("derived")
    (data / "source_images").mkdir()
    (data / "source_images" / "image.tiff").write_bytes(b"source")
    monkeypatch.setattr(settings, "tiles_dir", str(tiles))
    monkeypatch.setattr(settings, "source_images_dir", str(data / "source_images"))
    archive = tmp_path / "archive.tar.gz"
    _create_tar_file(str(data), str(archive))
    for path in snapshot_files(tiles):
        path.write_bytes(b"changed")
    (tiles / "42" / "image.dzi").write_text("keep current tiles")
    result = _extract_and_restore(str(archive), str(tmp_path / "staging"), str(data), str(tiles), str(data / "source_images"))
    assert result["source_files"] == 1
    assert [p.read_bytes() for p in snapshot_files(tiles)] == [b"original JPEG", b"original JPEG"]
    assert (tiles / "42" / "image.dzi").read_text() == "keep current tiles"


def test_snapshot_files_skip_symlinks_and_missing_directories(tmp_path):
    assert list(snapshot_files(tmp_path / "missing")) == []
    external = tmp_path / "external"
    external.mkdir()
    (external / "1.jpg").write_bytes(b"private")
    tiles = tmp_path / "tiles"
    (tiles / "42").mkdir(parents=True)
    (tiles / "42" / "markers").symlink_to(external, target_is_directory=True)
    assert list(snapshot_files(tiles)) == []


@pytest.mark.parametrize("failure_phase", ["copyfile", "replace"])
def test_snapshot_file_restore_rolls_back_with_other_entries(tmp_path, monkeypatch, failure_phase):
    data = tmp_path / "data"
    tiles = data / "tiles"
    for namespace, name in (("markers", "1.jpg"), ("collection_slots", "2.jpg")):
        directory = tiles / "42" / namespace
        directory.mkdir(parents=True)
        (directory / name).write_bytes(b"before")
    sources = data / "source_images"
    sources.mkdir()
    (sources / "image.tiff").write_bytes(b"before")
    monkeypatch.setattr(settings, "tiles_dir", str(tiles))
    monkeypatch.setattr(settings, "source_images_dir", str(sources))
    archive = tmp_path / "archive.tar.gz"
    _create_tar_file(str(data), str(archive))
    for path in snapshot_files(tiles):
        path.write_bytes(b"current")
    (sources / "image.tiff").write_bytes(b"current")
    promote = admin_ops.os.replace if failure_phase == "replace" else admin_ops.shutil.copyfile

    def fail_snapshot(source, target):
        if Path(target).name == "2.jpg":
            raise OSError("simulated swap failure")
        return promote(source, target)

    owner = admin_ops.os if failure_phase == "replace" else admin_ops.shutil
    with patch.object(owner, failure_phase, side_effect=fail_snapshot), pytest.raises(OSError, match="simulated"):
        _extract_and_restore(str(archive), str(tmp_path / "staging"), str(data), str(tiles), str(sources))
    assert [p.read_bytes() for p in snapshot_files(tiles)] == [b"current", b"current"]
    assert (sources / "image.tiff").read_bytes() == b"current"
    assert not list(tiles.rglob("*.bak-*"))
    assert not list(tiles.rglob(".restore-*"))


def test_snapshot_restore_stages_on_separate_tiles_filesystem(tmp_path, monkeypatch):
    data = tmp_path / "data"
    tiles = data / "tiles"
    for namespace in ("markers", "collection_slots"):
        directory = tiles / "42" / namespace
        directory.mkdir(parents=True)
        (directory / "7.jpg").write_bytes(b"original JPEG")
    (tiles / "42" / "image.dzi").write_text("generated")
    monkeypatch.setattr(settings, "tiles_dir", str(tiles))
    archive = tmp_path / "archive.tar.gz"
    _create_tar_file(str(data), str(archive))
    for path in snapshot_files(tiles):
        path.write_bytes(b"current")
    promotions = []

    def same_filesystem(move):
        def checked_move(source, target):
            source, target = Path(source), Path(target)
            if target.is_relative_to(tiles) and not source.is_relative_to(tiles):
                raise OSError(errno.EXDEV, "Invalid cross-device link")
            if target.name == "7.jpg":
                promotions.append((source, target))
            return move(source, target)
        return checked_move

    monkeypatch.setattr(admin_ops.os, "rename", same_filesystem(admin_ops.os.rename))
    monkeypatch.setattr(admin_ops.os, "replace", same_filesystem(admin_ops.os.replace))
    _extract_and_restore(str(archive), str(tmp_path / "staging"), str(data), str(tiles), str(data / "source_images"))
    assert [p.read_bytes() for p in snapshot_files(tiles)] == [b"original JPEG", b"original JPEG"]
    assert len(promotions) == 2
    assert all(source.parent.parent == target.parent for source, target in promotions)
    assert (tiles / "42" / "image.dzi").read_text() == "generated"
    assert not list(tiles.rglob("*.bak-*"))
    assert not list(tiles.rglob(".restore-*"))
