"""Tests for the image processing pipeline."""

import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

# Ensure pyvips can be imported even when libvips is not installed (CI)
if "pyvips" not in sys.modules:
    sys.modules["pyvips"] = MagicMock()
    sys.modules["pyvips.enums"] = MagicMock()

from app.processing import (
    ProgressTracker,
    _estimate_tile_count,
    generate_tiles,
    process_source_image,
    reconcile_stale_source_images,
)


# ── ProgressTracker tests ────────────────────────────────


def test_progress_tracker_initial_values() -> None:
    """ProgressTracker starts at 0 with empty message."""
    tracker = ProgressTracker()
    progress, message = tracker.get()
    assert progress == 0
    assert message == ""


def test_progress_tracker_set_and_get() -> None:
    """set() updates progress and message; get() returns them."""
    tracker = ProgressTracker()
    tracker.set(42, "Generating tiles")
    progress, message = tracker.get()
    assert progress == 42
    assert message == "Generating tiles"


def test_progress_tracker_empty_message_preserves_previous() -> None:
    """set() with empty message keeps the previous message."""
    tracker = ProgressTracker()
    tracker.set(10, "Loading")
    tracker.set(50)  # no message
    progress, message = tracker.get()
    assert progress == 50
    assert message == "Loading"


def test_progress_tracker_thread_safety() -> None:
    """Concurrent set/get calls don't corrupt state."""
    import threading

    tracker = ProgressTracker()
    errors: list[str] = []

    def writer() -> None:
        for i in range(200):
            tracker.set(i % 101, f"step-{i}")

    def reader() -> None:
        for _ in range(200):
            p, m = tracker.get()
            if not (0 <= p <= 200):
                errors.append(f"bad progress: {p}")
            if not isinstance(m, str):
                errors.append(f"bad message type: {type(m)}")

    threads = [threading.Thread(target=writer) for _ in range(3)]
    threads += [threading.Thread(target=reader) for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []


# ── _estimate_tile_count tests ───────────────────────────


def test_estimate_tile_count_1x1() -> None:
    """A 1x1 image has exactly 1 tile (the level-0 tile)."""
    assert _estimate_tile_count(1, 1) == 1


def test_estimate_tile_count_small_image() -> None:
    """An image smaller than tile_size produces 1 tile per level."""
    # 100x100 with default tile_size=254 -> each level is a single tile
    count = _estimate_tile_count(100, 100)
    assert count >= 1
    # 100x100 -> levels: 100x100, 50x50, 25x25, 13x13, 7x7, 4x4, 2x2, 1x1
    # each level has exactly 1 tile since all <= 254
    assert count == 8


def test_estimate_tile_count_large_image() -> None:
    """A 1024x768 image produces a reasonable number of tiles."""
    count = _estimate_tile_count(1024, 768)
    # Should have multiple tiles at the highest resolution level
    assert count > 10


def test_estimate_tile_count_custom_tile_size() -> None:
    """Custom tile_size changes the count."""
    default = _estimate_tile_count(1024, 1024)
    smaller_tiles = _estimate_tile_count(1024, 1024, tile_size=128)
    # Smaller tiles -> more tiles
    assert smaller_tiles > default


# ── generate_tiles tests ─────────────────────────────────


def test_generate_tiles_calls_pyvips(tmp_path) -> None:
    """generate_tiles invokes pyvips dzsave and thumbnail."""
    source_path = str(tmp_path / "input.tiff")
    output_dir = str(tmp_path / "output")

    mock_image = MagicMock()
    mock_image.width = 1024
    mock_image.height = 768

    with patch("app.processing.pyvips") as mock_pyvips:
        mock_pyvips.Image.new_from_file.return_value = mock_image
        mock_thumb = MagicMock()
        mock_pyvips.Image.thumbnail.return_value = mock_thumb

        dzi_rel, thumb_rel, width, height = generate_tiles(source_path, output_dir)

    assert dzi_rel == "image.dzi"
    assert thumb_rel == "thumbnail.jpeg"
    assert width == 1024
    assert height == 768
    mock_image.dzsave.assert_called_once()
    mock_pyvips.Image.thumbnail.assert_called_once_with(
        source_path, 256, height=256, crop="centre",
    )
    mock_thumb.jpegsave.assert_called_once()


async def test_process_source_image_not_found() -> None:
    """When source image is not found, processing returns early."""
    mock_session = AsyncMock()
    mock_session.get.return_value = None
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    with patch("app.processing.async_session", return_value=mock_session):
        await process_source_image(999)

    # Should have attempted to get and then returned
    mock_session.get.assert_awaited_once()


async def test_process_source_image_success() -> None:
    """Successful processing creates Image and updates SourceImage."""
    src = SimpleNamespace(
        id=1,
        original_filename="test.tiff",
        stored_path="/data/source_images/test.tiff",
        status="pending",
        progress=0,
        name="Test Image",
        category_id=5,
        copyright="CC",
        note="a note",
        active=True,
        program=None,
        image_id=None,
        file_size=5242880,
    )

    mock_session = AsyncMock()
    mock_session.get.return_value = src
    mock_session.add = MagicMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    with patch("app.processing.async_session", return_value=mock_session):
        with patch("app.processing.generate_tiles", return_value=("image.dzi", "thumbnail.jpeg", 1024, 768)):
            with patch("app.processing.asyncio.to_thread", side_effect=lambda fn, *a: fn(*a)):
                with patch("app.processing.settings") as mock_settings:
                    mock_settings.tiles_dir = "/data/tiles"
                    await process_source_image(1)

    assert src.status == "completed"


async def test_process_source_image_failure() -> None:
    """When tile generation fails, source image is marked as failed."""
    src = SimpleNamespace(
        id=2,
        original_filename="bad.tiff",
        stored_path="/data/source_images/bad.tiff",
        status="pending",
        progress=0,
        name=None,
        category_id=None,
        copyright=None,
        note=None,
        active=True,
        program=None,
        image_id=None,
    )

    call_count = 0

    mock_session = AsyncMock()

    def get_side_effect(model, id_val):
        nonlocal call_count
        call_count += 1
        return src

    mock_session.get = AsyncMock(side_effect=get_side_effect)
    mock_session.add = MagicMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    with patch("app.processing.async_session", return_value=mock_session):
        with patch("app.processing.asyncio.to_thread", side_effect=RuntimeError("VIPS error")):
            with patch("app.processing.settings") as mock_settings:
                mock_settings.tiles_dir = "/data/tiles"
                await process_source_image(2)

    assert src.status == "failed"
    assert src.error_message is not None


async def test_process_source_image_with_programs() -> None:
    """When source image has program JSON, programs are associated."""
    src = SimpleNamespace(
        id=3,
        original_filename="progs.tiff",
        stored_path="/data/source_images/progs.tiff",
        status="pending",
        progress=0,
        name="Prog Image",
        category_id=1,
        copyright=None,
        note=None,
        active=True,
        program="[10, 20]",
        image_id=None,
        file_size=10485760,
    )

    mock_img = SimpleNamespace(id=100, programs=[])

    mock_session = AsyncMock()
    mock_session.get.return_value = src
    mock_session.add = MagicMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    # Mock flush to set image id
    async def mock_flush():
        pass

    mock_session.flush = AsyncMock(side_effect=mock_flush)

    # Mock db.execute for program query
    mock_prog_result = MagicMock()
    mock_prog_result.scalars.return_value.all.return_value = [
        SimpleNamespace(id=10, name="Prog A"),
        SimpleNamespace(id=20, name="Prog B"),
    ]
    mock_session.execute = AsyncMock(return_value=mock_prog_result)
    mock_session.refresh = AsyncMock()

    with patch("app.processing.async_session", return_value=mock_session):
        with patch("app.processing.generate_tiles", return_value=("image.dzi", "thumbnail.jpeg", 2048, 1536)):
            with patch("app.processing.asyncio.to_thread", side_effect=lambda fn, *a: fn(*a)):
                with patch("app.processing.settings") as mock_settings:
                    mock_settings.tiles_dir = "/data/tiles"
                    with patch("app.processing.Image") as MockImage:
                        mock_img_instance = MagicMock()
                        mock_img_instance.id = 100
                        MockImage.return_value = mock_img_instance
                        await process_source_image(3)

    assert src.status == "completed"


# ── reconcile_stale_source_images tests ──────────────────


async def test_reconcile_stale_source_images_updates_stale() -> None:
    """Stale source images in processing/pending are marked failed."""
    mock_row = MagicMock()
    mock_row.__getitem__ = lambda self, i: 42  # id=42
    mock_result = MagicMock()
    mock_result.all.return_value = [mock_row]

    session = AsyncMock()
    session.execute = AsyncMock(return_value=mock_result)

    count = await reconcile_stale_source_images(session, stale_after_seconds=900)
    assert count == 1
    session.commit.assert_awaited_once()


async def test_reconcile_stale_source_images_no_stale() -> None:
    """When no source images are stale, nothing is updated."""
    mock_result = MagicMock()
    mock_result.all.return_value = []

    session = AsyncMock()
    session.execute = AsyncMock(return_value=mock_result)

    count = await reconcile_stale_source_images(session, stale_after_seconds=900)
    assert count == 0
    session.commit.assert_awaited_once()
