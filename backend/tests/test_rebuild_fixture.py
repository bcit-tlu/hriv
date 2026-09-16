"""Tests for the deterministic tile-rebuild scale fixture (#1189)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app import rebuild_fixture
from app.rebuild_fixture import (
    FIXTURE_PREFIX,
    FIXTURE_TIFF_BYTES,
    IMAGE_ID_BASE,
    SOURCE_IMAGE_ID_BASE,
    build_fixture_spec,
    purge_fixture_files,
    write_fixture_files,
)


def test_build_fixture_spec_is_deterministic() -> None:
    first = build_fixture_spec(3)
    second = build_fixture_spec(3)

    assert first == second
    assert [item.source_image_id for item in first] == [
        SOURCE_IMAGE_ID_BASE,
        SOURCE_IMAGE_ID_BASE + 1,
        SOURCE_IMAGE_ID_BASE + 2,
    ]
    assert [item.image_id for item in first] == [
        IMAGE_ID_BASE,
        IMAGE_ID_BASE + 1,
        IMAGE_ID_BASE + 2,
    ]
    assert all(item.name.startswith(FIXTURE_PREFIX) for item in first)
    assert all(item.filename.startswith(FIXTURE_PREFIX) for item in first)


def test_build_fixture_spec_rejects_negative_count() -> None:
    with pytest.raises(ValueError):
        build_fixture_spec(-1)


def test_fixture_tiff_blob_is_a_valid_tiff() -> None:
    # II*\0 little-endian TIFF magic; pyvips reads it via new_from_file.
    assert FIXTURE_TIFF_BYTES[:4] == b"II*\x00"
    assert len(FIXTURE_TIFF_BYTES) < 4096


def test_fixture_tiff_blob_decodes_with_pyvips(tmp_path: Path) -> None:
    """When libvips is present (CI, runtime image), prove the embedded blob
    is genuinely decodable — not just magic-byte plausible."""
    import types
    from unittest.mock import MagicMock

    try:
        import pyvips
    except OSError as exc:
        pytest.skip(f"libvips unavailable: {exc}")
    # test_processing.py stubs sys.modules["pyvips"] when libvips is absent;
    # a stub import "succeeds" but cannot actually decode the blob.
    if not isinstance(pyvips, types.ModuleType) or isinstance(
        pyvips, MagicMock
    ):
        pytest.skip("pyvips is stubbed: libvips unavailable")
    path = tmp_path / "fixture.tif"
    path.write_bytes(FIXTURE_TIFF_BYTES)
    image = pyvips.Image.new_from_file(str(path), access="sequential")
    assert (image.width, image.height) == (256, 256)


def _tile_source_id_from_url(tile_sources: str) -> int | None:
    """Import the authoritative-source parser lazily.

    ``app.processing`` imports pyvips, which is absent from dev machines
    without libvips (CI and the runtime image always have it).
    """
    try:
        from app.processing import (
            _tile_source_id_from_url as parser,
        )
    except OSError as exc:  # libvips shared library missing
        pytest.skip(f"libvips unavailable: {exc}")
    return parser(tile_sources)


def test_fixture_tile_sources_embed_source_id() -> None:
    """The image's tile_sources URL must identify its fixture source as the
    authoritative source, or ``select_rebuild_targets`` skips the pair."""
    for item in build_fixture_spec(3):
        url = f"/api/tiles/{item.source_image_id}/image.dzi"
        assert _tile_source_id_from_url(url) == item.source_image_id


def test_write_and_purge_fixture_files(tmp_path: Path) -> None:
    spec = build_fixture_spec(4)
    fixture_dir = tmp_path / "rebuild-fixture"
    tiles_dir = tmp_path / "tiles"
    fixture_tiles = tiles_dir / str(SOURCE_IMAGE_ID_BASE)
    fixture_temp = tiles_dir / f".rebuild-{SOURCE_IMAGE_ID_BASE}-abc"
    preserved_tiles = tiles_dir / str(SOURCE_IMAGE_ID_BASE - 1)
    for path in (fixture_tiles, fixture_temp, preserved_tiles):
        path.mkdir(parents=True)
        (path / "marker").write_text("present")
    with (
        patch.object(
            rebuild_fixture,
            "fixture_source_dir",
            return_value=fixture_dir,
        ),
        patch.object(rebuild_fixture.settings, "tiles_dir", str(tiles_dir)),
    ):
        written = write_fixture_files(spec)
        assert written == fixture_dir
        for item in spec:
            path = fixture_dir / item.filename
            assert path.is_file()
            assert path.read_bytes() == FIXTURE_TIFF_BYTES

        # Rewriting an intact file is a no-op; same-size corruption is repaired.
        marker = fixture_dir / spec[0].filename
        marker.write_bytes(b"x" * len(FIXTURE_TIFF_BYTES))
        write_fixture_files(spec)
        assert marker.read_bytes() == FIXTURE_TIFF_BYTES

        purge_fixture_files()
        assert not fixture_dir.exists()
        assert not fixture_tiles.exists()
        assert not fixture_temp.exists()
        assert preserved_tiles.exists()
        # Purge is idempotent and must not touch the parent directory.
        purge_fixture_files()
        assert tmp_path.exists()


async def test_seed_rebuild_fixture_inserts_linked_pairs(tmp_path: Path) -> None:
    fixture_dir = tmp_path / "rebuild-fixture"
    added: list[object] = []
    session = AsyncMock()
    session.add = lambda obj: added.append(obj)

    spec = build_fixture_spec(2)
    with (
        patch.object(
            rebuild_fixture,
            "fixture_source_dir",
            return_value=fixture_dir,
        ),
        patch.object(
            rebuild_fixture,
            "purge_rebuild_fixture",
            new_callable=AsyncMock,
        ),
        patch.object(
            rebuild_fixture,
            "bump_browse_revision",
            new_callable=AsyncMock,
        ),
        patch(
            "app.rebuild_fixture.current_tile_settings_hash",
            return_value="settings-hash",
        ),
    ):
        result = await rebuild_fixture.seed_rebuild_fixture(session, 2)

    assert result == spec
    images = [obj for obj in added if type(obj).__name__ == "Image"]
    sources = [obj for obj in added if type(obj).__name__ == "SourceImage"]
    assert len(images) == len(sources) == 2
    for image, source, item in zip(images, sources, spec, strict=True):
        assert image.id == item.image_id
        assert source.id == item.source_image_id
        assert source.image_id == item.image_id
        assert source.status == "completed"
        assert source.tiles_generated_at is None
        assert image.tile_sources == f"/api/tiles/{source.id}/image.dzi"
        assert Path(source.stored_path).read_bytes() == FIXTURE_TIFF_BYTES


def test_resolve_database_url_requires_and_normalizes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The chart stores driverless postgresql:// URLs; the CLI needs asyncpg."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(SystemExit):
        rebuild_fixture._resolve_database_url()

    monkeypatch.setenv(
        "DATABASE_URL", "postgresql://hriv:secret@db:5432/hriv"
    )
    assert rebuild_fixture._resolve_database_url() == (
        "postgresql+asyncpg://hriv:secret@db:5432/hriv"
    )

    monkeypatch.setenv(
        "DATABASE_URL", "postgresql+asyncpg://hriv:secret@db:5432/hriv"
    )
    assert rebuild_fixture._resolve_database_url() == (
        "postgresql+asyncpg://hriv:secret@db:5432/hriv"
    )
