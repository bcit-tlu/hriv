"""Tests for the deterministic tile-rebuild scale fixture (#1189)."""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

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


async def test_archive_lock_serializes_fixture_mutations(tmp_path: Path) -> None:
    fixture_dir = tmp_path / "rebuild-fixture"
    with patch.object(
        rebuild_fixture,
        "fixture_source_dir",
        return_value=fixture_dir,
    ):
        first = await rebuild_fixture.acquire_rebuild_fixture_archive_lock()
        blocked = asyncio.create_task(
            rebuild_fixture.acquire_rebuild_fixture_archive_lock()
        )
        await asyncio.sleep(0.05)
        assert not blocked.done()

        await rebuild_fixture.release_rebuild_fixture_archive_lock(first)
        second = await asyncio.wait_for(blocked, timeout=1)
        await rebuild_fixture.release_rebuild_fixture_archive_lock(second)


def test_write_and_purge_fixture_files(tmp_path: Path) -> None:
    spec = build_fixture_spec(4)
    fixture_dir = tmp_path / "rebuild-fixture"
    tiles_dir = tmp_path / "tiles"
    fixture_tiles = tiles_dir / str(SOURCE_IMAGE_ID_BASE)
    fixture_temp = tiles_dir / f".rebuild-{SOURCE_IMAGE_ID_BASE}-abc"
    fixture_retained = tiles_dir / f"{SOURCE_IMAGE_ID_BASE}.old-abc"
    preserved_tiles = tiles_dir / str(SOURCE_IMAGE_ID_BASE - 1)
    preserved_high_tiles = tiles_dir / str(SOURCE_IMAGE_ID_BASE + 1)
    for path in (
        fixture_tiles,
        fixture_temp,
        fixture_retained,
        preserved_tiles,
        preserved_high_tiles,
    ):
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

        purge_fixture_files({SOURCE_IMAGE_ID_BASE})
        assert not fixture_dir.exists()
        assert not fixture_tiles.exists()
        assert not fixture_temp.exists()
        assert not fixture_retained.exists()
        assert preserved_tiles.exists()
        assert preserved_high_tiles.exists()
        # Purge is idempotent and must not touch the parent directory.
        purge_fixture_files({SOURCE_IMAGE_ID_BASE})
        assert tmp_path.exists()


async def test_purge_uses_exact_marker_link_and_path(tmp_path: Path) -> None:
    fixture_dir = tmp_path / "rebuild-fixture"
    fixture_image = SimpleNamespace(
        id=IMAGE_ID_BASE,
        metadata_={"rebuild_fixture": True},
    )
    real_high_image = SimpleNamespace(
        id=IMAGE_ID_BASE + 1,
        metadata_={},
    )
    fixture_source = SimpleNamespace(
        id=SOURCE_IMAGE_ID_BASE,
        image_id=IMAGE_ID_BASE,
        stored_path=str(fixture_dir / "TRF-00000.tif"),
    )
    outside_source = SimpleNamespace(
        id=SOURCE_IMAGE_ID_BASE + 1,
        image_id=IMAGE_ID_BASE + 1,
        stored_path=str(tmp_path / "real-TRF-study.tif"),
    )

    def rows_result(rows: list[object]) -> MagicMock:
        result = MagicMock()
        result.scalars.return_value.all.return_value = rows
        return result

    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=[
            rows_result([fixture_image, real_high_image]),
            rows_result([fixture_source, outside_source]),
            MagicMock(),
            MagicMock(),
        ]
    )
    with (
        patch.object(
            rebuild_fixture,
            "fixture_source_dir",
            return_value=fixture_dir,
        ),
        patch.object(
            rebuild_fixture,
            "bump_browse_revision",
            new_callable=AsyncMock,
        ) as bump_revision,
    ):
        source_ids = await rebuild_fixture.purge_rebuild_fixture(session)

    assert source_ids == {SOURCE_IMAGE_ID_BASE}
    assert session.execute.await_count == 4
    bump_revision.assert_awaited_once_with(session)
    session.commit.assert_awaited_once()


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
            return_value=set(),
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


async def test_seed_zero_leaves_no_active_fixture_directory(
    tmp_path: Path,
) -> None:
    fixture_dir = tmp_path / "rebuild-fixture"
    session = AsyncMock()
    with (
        patch.object(
            rebuild_fixture,
            "fixture_source_dir",
            return_value=fixture_dir,
        ),
        patch.object(
            rebuild_fixture.settings,
            "tiles_dir",
            str(tmp_path / "tiles"),
        ),
        patch.object(
            rebuild_fixture,
            "purge_rebuild_fixture",
            new_callable=AsyncMock,
            return_value=set(),
        ),
        patch.object(
            rebuild_fixture,
            "bump_browse_revision",
            new_callable=AsyncMock,
        ),
    ):
        result = await rebuild_fixture.seed_rebuild_fixture(session, 0)

    assert result == []
    assert not fixture_dir.exists()


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
