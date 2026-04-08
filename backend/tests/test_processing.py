"""Tests for the image processing pipeline."""

import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

# Ensure pyvips can be imported even when libvips is not installed (CI)
if "pyvips" not in sys.modules:
    sys.modules["pyvips"] = MagicMock()
    sys.modules["pyvips.enums"] = MagicMock()

from app.processing import generate_tiles, process_source_image


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

        dzi_rel, thumb_rel = generate_tiles(source_path, output_dir)

    assert dzi_rel == "image.dzi"
    assert thumb_rel == "thumbnail.jpeg"
    mock_image.dzsave.assert_called_once()
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
        name="Test Image",
        category_id=5,
        copyright="CC",
        note="a note",
        active=True,
        program=None,
        image_id=None,
    )

    mock_session = AsyncMock()
    mock_session.get.return_value = src
    mock_session.add = MagicMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)

    with patch("app.processing.async_session", return_value=mock_session):
        with patch("app.processing.generate_tiles", return_value=("image.dzi", "thumbnail.jpeg")):
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
        name="Prog Image",
        category_id=1,
        copyright=None,
        note=None,
        active=True,
        program="[10, 20]",
        image_id=None,
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
        with patch("app.processing.generate_tiles", return_value=("image.dzi", "thumbnail.jpeg")):
            with patch("app.processing.asyncio.to_thread", side_effect=lambda fn, *a: fn(*a)):
                with patch("app.processing.settings") as mock_settings:
                    mock_settings.tiles_dir = "/data/tiles"
                    with patch("app.processing.Image") as MockImage:
                        mock_img_instance = MagicMock()
                        mock_img_instance.id = 100
                        MockImage.return_value = mock_img_instance
                        await process_source_image(3)

    assert src.status == "completed"
