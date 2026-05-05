"""Tests for the maintenance-mode flag module."""

from pathlib import Path
from unittest.mock import patch

from app.maintenance import (
    MAINTENANCE_FILENAME,
    _flag_path,
    disable_maintenance_mode,
    enable_maintenance_mode,
    is_maintenance_mode,
)


def test_flag_path_derives_from_source_images_dir() -> None:
    with patch("app.maintenance.settings") as mock_settings:
        mock_settings.source_images_dir = "/data/source_images"
        result = _flag_path()
        assert result == Path("/data") / MAINTENANCE_FILENAME


def test_is_maintenance_mode_false_when_no_flag(tmp_path: Path) -> None:
    with patch("app.maintenance.settings") as mock_settings:
        mock_settings.source_images_dir = str(tmp_path / "source_images")
        assert is_maintenance_mode() is False


def test_enable_creates_flag(tmp_path: Path) -> None:
    with patch("app.maintenance.settings") as mock_settings:
        mock_settings.source_images_dir = str(tmp_path / "source_images")
        enable_maintenance_mode()
        assert (tmp_path / MAINTENANCE_FILENAME).exists()
        assert is_maintenance_mode() is True


def test_disable_removes_flag(tmp_path: Path) -> None:
    with patch("app.maintenance.settings") as mock_settings:
        mock_settings.source_images_dir = str(tmp_path / "source_images")
        enable_maintenance_mode()
        assert is_maintenance_mode() is True
        disable_maintenance_mode()
        assert is_maintenance_mode() is False
        assert not (tmp_path / MAINTENANCE_FILENAME).exists()


def test_disable_is_idempotent(tmp_path: Path) -> None:
    with patch("app.maintenance.settings") as mock_settings:
        mock_settings.source_images_dir = str(tmp_path / "source_images")
        disable_maintenance_mode()
        assert is_maintenance_mode() is False
