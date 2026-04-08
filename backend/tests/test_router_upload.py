"""Tests for the upload router endpoints."""

import sys
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

# Ensure pyvips can be imported even when libvips is not installed (CI)
if "pyvips" not in sys.modules:
    sys.modules["pyvips"] = MagicMock()
    sys.modules["pyvips.enums"] = MagicMock()

from app.routers.upload import _is_valid_image, list_source_images, get_source_image, upload_source_image


def test_is_valid_image_by_extension() -> None:
    assert _is_valid_image("photo.jpg", None) is True
    assert _is_valid_image("photo.jpeg", None) is True
    assert _is_valid_image("photo.png", None) is True
    assert _is_valid_image("photo.tif", None) is True
    assert _is_valid_image("photo.tiff", None) is True
    assert _is_valid_image("photo.bmp", None) is True
    assert _is_valid_image("photo.gif", None) is True
    assert _is_valid_image("photo.webp", None) is True
    assert _is_valid_image("photo.svs", None) is True
    assert _is_valid_image("photo.txt", None) is False
    assert _is_valid_image("photo.pdf", None) is False


def test_is_valid_image_by_content_type() -> None:
    assert _is_valid_image("noext", "image/png") is True
    assert _is_valid_image("noext", "image/jpeg") is True
    assert _is_valid_image("noext", "application/pdf") is False


def test_is_valid_image_case_insensitive_extension() -> None:
    assert _is_valid_image("photo.JPG", None) is True
    assert _is_valid_image("photo.PNG", None) is True
    assert _is_valid_image("photo.TIF", None) is True


async def test_list_source_images() -> None:
    now = datetime.now(timezone.utc)
    srcs = [
        SimpleNamespace(id=1, original_filename="a.tiff", status="completed",
                        created_at=now, updated_at=now),
        SimpleNamespace(id=2, original_filename="b.png", status="pending",
                        created_at=now, updated_at=now),
    ]
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = srcs

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    result = await list_source_images(MagicMock(), db)
    assert len(result) == 2


async def test_get_source_image_found() -> None:
    now = datetime.now(timezone.utc)
    src = SimpleNamespace(id=1, original_filename="a.tiff", status="completed",
                          created_at=now, updated_at=now)
    db = AsyncMock()
    db.get = AsyncMock(return_value=src)

    result = await get_source_image(1, MagicMock(), db)
    assert result.original_filename == "a.tiff"


async def test_get_source_image_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await get_source_image(999, MagicMock(), db)
    assert exc.value.status_code == 404


async def test_upload_source_image_no_filename() -> None:
    file = AsyncMock()
    file.filename = ""

    db = AsyncMock()
    bg = MagicMock()

    with pytest.raises(HTTPException) as exc:
        await upload_source_image(
            file=file, background_tasks=bg, _user=MagicMock(),
            db=db,
        )
    assert exc.value.status_code == 400
    assert "no file" in exc.value.detail.lower()


async def test_upload_source_image_invalid_type() -> None:
    file = AsyncMock()
    file.filename = "readme.txt"
    file.content_type = "text/plain"

    db = AsyncMock()
    bg = MagicMock()

    with pytest.raises(HTTPException) as exc:
        await upload_source_image(
            file=file, background_tasks=bg, _user=MagicMock(),
            db=db,
        )
    assert exc.value.status_code == 400
    assert "image" in exc.value.detail.lower()


async def test_upload_source_image_success(tmp_path) -> None:
    file = AsyncMock()
    file.filename = "test.png"
    file.content_type = "image/png"
    file.read = AsyncMock(side_effect=[b"fake-png-data", b""])

    src = SimpleNamespace(
        id=1, original_filename="test.png", stored_path="/tmp/test.png",
        status="pending", created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )

    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    bg = MagicMock()

    with patch("app.routers.upload.settings") as mock_settings:
        mock_settings.source_images_dir = str(tmp_path)
        result = await upload_source_image(
            file=file, background_tasks=bg, _user=MagicMock(),
            name="Test Image", category_id=1, copyright="CC0",
            note="A note", program_ids=[1, 2], active=True,
            db=db,
        )

    db.add.assert_called_once()
    db.commit.assert_awaited_once()
    bg.add_task.assert_called_once()
