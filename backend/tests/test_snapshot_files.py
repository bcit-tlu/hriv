from unittest.mock import patch

import pytest

from app.admin_ops import _create_tar_file, _extract_and_restore
from app import admin_ops
from app.database import settings
from app.snapshot_files import snapshot_files


def test_snapshot_files_archive_round_trip(tmp_path, monkeypatch):
    data = tmp_path / "data"
    tiles = data / "tiles"
    for namespace in ("inuksuks", "collection_slots"):
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
    (tiles / "42" / "inuksuks").symlink_to(external, target_is_directory=True)
    assert list(snapshot_files(tiles)) == []


def test_snapshot_file_restore_rolls_back_with_other_entries(tmp_path, monkeypatch):
    data = tmp_path / "data"
    tiles = data / "tiles"
    directory = tiles / "42" / "inuksuks"
    directory.mkdir(parents=True)
    (directory / "1.jpg").write_bytes(b"before")
    monkeypatch.setattr(settings, "tiles_dir", str(tiles))
    archive = tmp_path / "archive.tar.gz"
    _create_tar_file(str(data), str(archive))
    (directory / "1.jpg").write_bytes(b"current")
    rename = admin_ops.os.rename

    def fail_snapshot(source, target):
        if "staging/data/tiles" in str(source):
            raise OSError("simulated swap failure")
        return rename(source, target)

    with patch("app.admin_ops.os.rename", side_effect=fail_snapshot), pytest.raises(OSError, match="simulated"):
        _extract_and_restore(str(archive), str(tmp_path / "staging"), str(data), str(tiles), str(data / "source_images"))
    assert (directory / "1.jpg").read_bytes() == b"current"
