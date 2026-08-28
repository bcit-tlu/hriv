"""Unit tests for the local docker-compose synthetic-media seed helpers."""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
import sys
import types

import pytest

# The helper tests mock tile generation and do not require libvips. Provide the
# minimal annotation surface before importing the module under test so these
# tests also run on developer machines without the native library installed.
if "pyvips" not in sys.modules:
    pyvips_stub = types.ModuleType("pyvips")
    pyvips_stub.Image = type("Image", (), {})
    pyvips_stub.GValue = type("GValue", (), {})
    sys.modules["pyvips"] = pyvips_stub

from app import seed_media


def test_copy_source_asset_copies_fixture_and_reports_size(tmp_path, monkeypatch):
    fixture = tmp_path / "fixture.jpeg"
    fixture.write_bytes(b"fixture-image")
    source_dir = tmp_path / "source_images"

    monkeypatch.setattr(seed_media, "SEED_ASSET_PATH", fixture)
    monkeypatch.setattr(seed_media.settings, "source_images_dir", str(source_dir))

    stored_path, file_size = seed_media._copy_source_asset()

    assert stored_path == source_dir / seed_media.SOURCE_FILENAME
    assert stored_path.read_bytes() == b"fixture-image"
    assert file_size == len(b"fixture-image")


def test_copy_source_asset_requires_fixture(tmp_path, monkeypatch):
    missing = tmp_path / "missing.jpeg"
    monkeypatch.setattr(seed_media, "SEED_ASSET_PATH", missing)

    with pytest.raises(FileNotFoundError, match="Seed media asset not found"):
        seed_media._copy_source_asset()


def test_regenerate_tiles_replaces_existing_directory_atomically(tmp_path, monkeypatch):
    source = tmp_path / "source.jpeg"
    source.write_bytes(b"source")
    tiles_root = tmp_path / "tiles"
    final_dir = tiles_root / "7"
    final_dir.mkdir(parents=True)
    (final_dir / "old.txt").write_text("old")

    def fake_generate_tiles(source_path: str, output_dir: str):
        assert source_path == str(source)
        output = Path(output_dir)
        (output / "image.dzi").write_text("dzi")
        return "image.dzi", "thumbnail.jpeg", 640, 480

    monkeypatch.setattr(seed_media.settings, "tiles_dir", str(tiles_root))
    monkeypatch.setattr(seed_media, "generate_tiles", fake_generate_tiles)

    result = seed_media._regenerate_tiles(source, 7)

    assert result == ("image.dzi", "thumbnail.jpeg", 640, 480)
    assert (final_dir / "image.dzi").read_text() == "dzi"
    assert not (final_dir / "old.txt").exists()
    assert not (tiles_root / ".7.tmp").exists()


def test_regenerate_tiles_cleans_temporary_directory_on_failure(tmp_path, monkeypatch):
    source = tmp_path / "source.jpeg"
    source.write_bytes(b"source")
    tiles_root = tmp_path / "tiles"

    def failing_generate_tiles(_source_path: str, output_dir: str):
        Path(output_dir, "partial.txt").write_text("partial")
        raise RuntimeError("tile generation failed")

    monkeypatch.setattr(seed_media.settings, "tiles_dir", str(tiles_root))
    monkeypatch.setattr(seed_media, "generate_tiles", failing_generate_tiles)

    with pytest.raises(RuntimeError, match="tile generation failed"):
        seed_media._regenerate_tiles(source, 8)

    assert not (tiles_root / ".8.tmp").exists()


class FakeResult:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class FakeSession:
    def __init__(self, source=None):
        self.source = source
        self.added = []
        self.execute = AsyncMock(return_value=FakeResult(source))
        self.flush = AsyncMock()

    def add(self, value):
        self.added.append(value)
        if isinstance(value, seed_media.SourceImage):
            value.id = 42


async def test_get_or_create_source_creates_seed_source(tmp_path):
    session = FakeSession()
    stored_path = tmp_path / seed_media.SOURCE_FILENAME

    source = await seed_media._get_or_create_source(session, 6, stored_path, 123)

    assert source in session.added
    assert source.original_filename == seed_media.SOURCE_FILENAME
    assert source.name == seed_media.IMAGE_NAME
    assert source.category_id == 6
    assert source.file_size == 123
    session.flush.assert_awaited_once()


async def test_get_or_create_source_updates_existing_seed_source(tmp_path):
    source = SimpleNamespace(
        original_filename=seed_media.SOURCE_FILENAME,
        stored_path="/old/source.jpeg",
        status="completed",
        progress=100,
        status_message="Completed",
        name="Old name",
        category_id=1,
        copyright="old",
        note="old",
        active=False,
        file_size=1,
    )
    session = FakeSession(source)
    stored_path = tmp_path / seed_media.SOURCE_FILENAME

    result = await seed_media._get_or_create_source(session, 6, stored_path, 456)

    assert result is source
    assert source.stored_path == str(stored_path)
    assert source.status == "processing"
    assert source.progress == 5
    assert source.status_message == "Preparing seeded image"
    assert source.name == seed_media.IMAGE_NAME
    assert source.category_id == 6
    assert source.file_size == 456
    assert session.added == []
    session.flush.assert_not_awaited()
