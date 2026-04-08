"""Tests for the bulk_import router helper functions and endpoints."""

import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

# Ensure pyvips can be imported even when libvips is not installed (CI)
if "pyvips" not in sys.modules:
    sys.modules["pyvips"] = MagicMock()
    sys.modules["pyvips.enums"] = MagicMock()

from app.routers.bulk_import import _is_image_filename, list_bulk_import_jobs, get_bulk_import_job


def test_is_image_filename_valid() -> None:
    assert _is_image_filename("photo.jpg") is True
    assert _is_image_filename("photo.jpeg") is True
    assert _is_image_filename("photo.png") is True
    assert _is_image_filename("photo.tif") is True
    assert _is_image_filename("photo.tiff") is True
    assert _is_image_filename("photo.bmp") is True
    assert _is_image_filename("photo.gif") is True
    assert _is_image_filename("photo.webp") is True
    assert _is_image_filename("photo.svs") is True


def test_is_image_filename_invalid() -> None:
    assert _is_image_filename("document.pdf") is False
    assert _is_image_filename("readme.txt") is False
    assert _is_image_filename("archive.zip") is False
    assert _is_image_filename("script.py") is False


def test_is_image_filename_case_insensitive() -> None:
    assert _is_image_filename("PHOTO.JPG") is True
    assert _is_image_filename("Photo.PNG") is True
    assert _is_image_filename("image.TIF") is True


async def test_list_bulk_import_jobs() -> None:
    jobs = [
        SimpleNamespace(id=1, status="completed", total_count=5),
        SimpleNamespace(id=2, status="pending", total_count=3),
    ]
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = jobs

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    result = await list_bulk_import_jobs(MagicMock(), db)
    assert len(result) == 2


async def test_get_bulk_import_job_found() -> None:
    job = SimpleNamespace(id=1, status="completed", total_count=5)
    db = AsyncMock()
    db.get = AsyncMock(return_value=job)

    result = await get_bulk_import_job(1, MagicMock(), db)
    assert result.status == "completed"


async def test_get_bulk_import_job_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await get_bulk_import_job(999, MagicMock(), db)
    assert exc.value.status_code == 404
