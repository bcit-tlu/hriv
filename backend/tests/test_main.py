"""Tests for the main FastAPI application module."""

import os
import tempfile
from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def _fake_data_dir(tmp_path, monkeypatch):
    """Patch settings so app.main can import without needing /data."""
    tiles = tmp_path / "tiles"
    tiles.mkdir()
    source = tmp_path / "source_images"
    source.mkdir()

    from app.database import settings
    monkeypatch.setattr(settings, "tiles_dir", str(tiles))
    monkeypatch.setattr(settings, "source_images_dir", str(source))


async def test_health_endpoint() -> None:
    from app.main import health
    result = await health()
    assert result == {"status": "ok"}
