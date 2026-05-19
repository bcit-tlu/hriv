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
    _detect_openslide_pyramid,
    _detect_tiff_pyramid,
    _extract_tiff_resolution,
    _get_float_field,
    detect_pyramid_info,
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


# ── Pyramidal detection tests ────────────────────────────


def test_get_float_field_returns_value() -> None:
    """_get_float_field extracts a numeric field from a vips image."""
    img = MagicMock()
    img.get.return_value = "0.2525"
    result = _get_float_field(img, ["openslide.mpp-x"], "openslide.mpp-x")
    assert result == 0.2525


def test_get_float_field_missing_field() -> None:
    """_get_float_field returns None for a field not in the list."""
    img = MagicMock()
    result = _get_float_field(img, ["other-field"], "openslide.mpp-x")
    assert result is None


def test_get_float_field_non_numeric() -> None:
    """_get_float_field returns None for non-numeric values."""
    img = MagicMock()
    img.get.return_value = "not-a-number"
    result = _get_float_field(img, ["some-field"], "some-field")
    assert result is None


def test_detect_openslide_pyramid_svs() -> None:
    """SVS files with multiple levels are detected as pyramidal."""
    img = MagicMock()
    fields = [
        "openslide.level-count",
        "openslide.mpp-x",
        "openslide.mpp-y",
        "openslide.objective-power",
    ]
    img.get_fields.return_value = fields

    def get_side_effect(name):
        mapping = {
            "openslide.level-count": "4",
            "openslide.mpp-x": "0.2525",
            "openslide.mpp-y": "0.2525",
            "openslide.objective-power": "40",
        }
        return mapping.get(name)

    img.get.side_effect = get_side_effect

    result = _detect_openslide_pyramid("/path/to/scan.svs", img)
    assert result is not None
    assert result["is_pyramidal"] is True
    assert result["loader"] == "openslideload"
    assert result["level_count"] == 4
    assert result["mpp_x"] == 0.2525
    assert result["mpp_y"] == 0.2525
    assert result["objective_power"] == 40.0
    # scale = 1 / 0.2525 ≈ 3.9604
    assert result["measurement_scale"] == round(1.0 / 0.2525, 4)
    assert result["measurement_unit"] == "um"


def test_detect_openslide_pyramid_single_level() -> None:
    """A single-level OpenSlide image is not reported as pyramidal."""
    img = MagicMock()
    img.get_fields.return_value = ["openslide.level-count"]
    img.get.return_value = "1"

    result = _detect_openslide_pyramid("/path/to/flat.svs", img)
    assert result is None


def test_detect_openslide_pyramid_no_level_count() -> None:
    """An image without level-count field is not pyramidal."""
    img = MagicMock()
    img.get_fields.return_value = ["width", "height"]

    result = _detect_openslide_pyramid("/path/to/img.tiff", img)
    assert result is None


def test_detect_openslide_pyramid_aperio_mpp_fallback() -> None:
    """Aperio MPP is used when openslide.mpp-x is not available."""
    img = MagicMock()
    fields = [
        "openslide.level-count",
        "aperio.AppMag",
        "aperio.MPP",
    ]
    img.get_fields.return_value = fields

    def get_side_effect(name):
        mapping = {
            "openslide.level-count": "3",
            "aperio.AppMag": "20",
            "aperio.MPP": "0.5",
        }
        return mapping.get(name)

    img.get.side_effect = get_side_effect

    result = _detect_openslide_pyramid("/path/to/scan.svs", img)
    assert result is not None
    assert result["mpp_x"] == 0.5
    assert result["objective_power"] == 20.0
    assert result["measurement_scale"] == round(1.0 / 0.5, 4)
    assert result["measurement_unit"] == "um"


def test_detect_tiff_pyramid_subifd() -> None:
    """Pyramidal TIFF with SubIFDs is detected."""
    img = MagicMock()
    img.width = 4096
    img.height = 4096
    img.get_fields.return_value = []
    img.xres = 4000.0  # pixels/mm → 0.25 µm/px
    img.yres = 4000.0

    # Mock sub-IFD images at decreasing sizes
    sub0 = MagicMock()
    sub0.width = 2048
    sub0.height = 2048
    sub1 = MagicMock()
    sub1.width = 1024
    sub1.height = 1024

    def new_from_file_side_effect(path, **kwargs):
        subifd = kwargs.get("subifd")
        if subifd == 0:
            return sub0
        if subifd == 1:
            return sub1
        raise Exception("no more subifds")

    with patch("app.processing.pyvips.Image.new_from_file", side_effect=new_from_file_side_effect):
        result = _detect_tiff_pyramid("/path/to/pyramid.tiff", img)

    assert result is not None
    assert result["is_pyramidal"] is True
    assert result["loader"] == "tiffload"
    assert result["level_count"] == 3  # base + 2 subifds
    # xres=4000 px/mm → mpp = 1000/4000 = 0.25 µm/px
    assert result["mpp_x"] == 0.25
    assert result["measurement_scale"] == round(4000.0 / 1000.0, 4)
    assert result["measurement_unit"] == "um"


def test_detect_tiff_pyramid_multipage() -> None:
    """Multi-page pyramidal TIFF is detected."""
    img = MagicMock()
    img.width = 2048
    img.height = 2048
    img.xres = 0.0  # no valid resolution
    img.yres = 0.0
    fields = ["n-pages"]
    img.get_fields.return_value = fields
    img.get.return_value = "3"

    page1 = MagicMock()
    page1.width = 1024
    page1.height = 1024

    def new_from_file_side_effect(path, **kwargs):
        if kwargs.get("subifd") is not None:
            raise Exception("no subifds")
        if kwargs.get("page") == 1:
            return page1
        raise Exception("no more pages")

    with patch("app.processing.pyvips.Image.new_from_file", side_effect=new_from_file_side_effect):
        result = _detect_tiff_pyramid("/path/to/multipage.tiff", img)

    assert result is not None
    assert result["is_pyramidal"] is True
    assert result["level_count"] == 3
    # No measurement data since xres=0
    assert "measurement_scale" not in result


def test_detect_tiff_pyramid_not_pyramidal() -> None:
    """A flat TIFF (no subifds, single page) returns None."""
    img = MagicMock()
    img.width = 1024
    img.height = 768
    img.xres = 72.0
    img.yres = 72.0
    img.get_fields.return_value = []

    def new_from_file_side_effect(path, **kwargs):
        raise Exception("no subifds or pages")

    with patch("app.processing.pyvips.Image.new_from_file", side_effect=new_from_file_side_effect):
        result = _detect_tiff_pyramid("/path/to/flat.tiff", img)

    assert result is None


def test_extract_tiff_resolution_valid() -> None:
    """Resolution within microscopy range populates measurement fields."""
    img = MagicMock()
    img.xres = 2000.0  # pixels/mm → 0.5 µm/px
    img.yres = 2000.0
    fields: list[str] = []
    info: dict = {}

    _extract_tiff_resolution(img, fields, info)

    assert info["mpp_x"] == 0.5
    assert info["mpp_y"] == 0.5
    assert info["measurement_scale"] == 2.0  # 2000/1000
    assert info["measurement_unit"] == "um"


def test_extract_tiff_resolution_out_of_range() -> None:
    """Resolution outside microscopy range is not stored."""
    img = MagicMock()
    img.xres = 3.0  # pixels/mm → 333 µm/px (way too large for microscopy)
    img.yres = 3.0
    fields: list[str] = []
    info: dict = {}

    _extract_tiff_resolution(img, fields, info)

    assert "mpp_x" not in info
    assert "measurement_scale" not in info


def test_detect_pyramid_info_openslide_path() -> None:
    """detect_pyramid_info routes to openslide detector for SVS."""
    mock_img = MagicMock()
    mock_img.get_fields.return_value = ["vips-loader", "openslide.level-count"]

    def get_side_effect(name):
        if name == "vips-loader":
            return "openslideload"
        if name == "openslide.level-count":
            return "2"
        return None

    mock_img.get.side_effect = get_side_effect

    with patch("app.processing.pyvips.Image.new_from_file", return_value=mock_img):
        result = detect_pyramid_info("/path/to/scan.svs")

    assert result is not None
    assert result["loader"] == "openslideload"


def test_detect_pyramid_info_non_pyramidal() -> None:
    """detect_pyramid_info returns None for a plain JPEG."""
    mock_img = MagicMock()
    mock_img.get_fields.return_value = ["vips-loader"]
    mock_img.get.return_value = "jpegload"

    with patch("app.processing.pyvips.Image.new_from_file", return_value=mock_img):
        result = detect_pyramid_info("/path/to/photo.jpg")

    assert result is None


def test_detect_pyramid_info_file_error() -> None:
    """detect_pyramid_info returns None if the file cannot be opened."""
    with patch("app.processing.pyvips.Image.new_from_file", side_effect=Exception("file not found")):
        result = detect_pyramid_info("/nonexistent/path.tiff")

    assert result is None


async def test_process_source_image_with_pyramid_metadata() -> None:
    """Pyramidal images get measurement metadata auto-populated."""
    src = SimpleNamespace(
        id=10,
        original_filename="slide.svs",
        stored_path="/data/source_images/slide.svs",
        status="pending",
        progress=0,
        name="Slide",
        category_id=2,
        copyright=None,
        note=None,
        active=True,
        program=None,
        image_id=None,
        file_size=2147483648,
    )

    pyramid_info = {
        "is_pyramidal": True,
        "loader": "openslideload",
        "level_count": 4,
        "mpp_x": 0.2525,
        "mpp_y": 0.2525,
        "objective_power": 40.0,
        "measurement_scale": 3.9604,
        "measurement_unit": "um",
    }

    mock_session = AsyncMock()
    mock_session.get.return_value = src
    mock_session.add = MagicMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    captured_image = {}

    def capture_add(obj):
        if hasattr(obj, "metadata_"):
            captured_image["metadata"] = obj.metadata_

    mock_session.add.side_effect = capture_add

    # asyncio.to_thread is called for both detect_pyramid_info and generate_tiles.
    # Patch detect_pyramid_info so when to_thread calls it, it returns pyramid_info.
    # Patch generate_tiles so when to_thread calls it, it returns tile results.
    with patch("app.processing.async_session", return_value=mock_session):
        with patch("app.processing.generate_tiles", return_value=("image.dzi", "thumbnail.jpeg", 46000, 32914)):
            with patch("app.processing.detect_pyramid_info", return_value=pyramid_info):
                with patch("app.processing.asyncio.to_thread", side_effect=lambda fn, *a: fn(*a)):
                    with patch("app.processing.settings") as mock_settings:
                        mock_settings.tiles_dir = "/data/tiles"
                        await process_source_image(10)

    assert src.status == "completed"
    assert captured_image.get("metadata") is not None
    meta = captured_image["metadata"]
    assert meta["measurement_scale"] == 3.9604
    assert meta["measurement_unit"] == "um"
    assert meta["objective_power"] == 40.0
    assert meta["mpp_x"] == 0.2525
    assert meta["pyramid_detected"] is True
    assert meta["pyramid_level_count"] == 4
