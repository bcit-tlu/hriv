"""Tests for the main FastAPI application module."""

import os
import sys
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest


@pytest.fixture(autouse=True)
def _fake_data_dir(tmp_path, monkeypatch):
    """Patch settings so app.main can import without needing /data."""
    tiles = tmp_path / "tiles"
    tiles.mkdir()
    source = tmp_path / "source_images"
    source.mkdir()

    from app.database import settings
    from app import admin_ops

    monkeypatch.setattr(settings, "tiles_dir", str(tiles))
    monkeypatch.setattr(settings, "source_images_dir", str(source))
    monkeypatch.setattr(admin_ops, "_TASKS_DIR", str(tmp_path / "admin_tasks"))


@pytest.fixture(autouse=True)
def _stub_pyvips(monkeypatch):
    """Insert a stub for pyvips so app.main can be imported without libvips."""
    if "pyvips" not in sys.modules:
        monkeypatch.setitem(sys.modules, "pyvips", MagicMock())


async def test_health_endpoint() -> None:
    from app.main import app, health

    result = await health()
    assert result == {"status": "ok", "version": app.version}


# ── _check_oidc_connectivity tests ──────────────────────


async def test_check_oidc_connectivity_success(monkeypatch) -> None:
    """Logs info when the OIDC metadata endpoint is reachable."""
    from app.database import settings as _settings

    monkeypatch.setattr(_settings, "oidc_issuer", "https://vault.example.com/v1/oidc")

    mock_response = AsyncMock()
    mock_response.raise_for_status = lambda: None

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.main.httpx.AsyncClient", return_value=mock_client):
        from app.main import _check_oidc_connectivity

        await _check_oidc_connectivity()  # Should not raise

    mock_client.get.assert_awaited_once_with(
        "https://vault.example.com/v1/oidc/.well-known/openid-configuration"
    )


async def test_check_oidc_connectivity_connect_error(monkeypatch) -> None:
    """Logs error when the OIDC provider is unreachable (ConnectError)."""
    from app.database import settings as _settings

    monkeypatch.setattr(_settings, "oidc_issuer", "https://vault.example.com/v1/oidc")

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(
        side_effect=httpx.ConnectError("All connection attempts failed")
    )
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.main.httpx.AsyncClient", return_value=mock_client):
        from app.main import _check_oidc_connectivity

        await _check_oidc_connectivity()  # Should not raise — logs error instead


async def test_check_oidc_connectivity_http_error(monkeypatch) -> None:
    """Logs warning when the metadata endpoint returns an HTTP error."""
    from app.database import settings as _settings

    monkeypatch.setattr(_settings, "oidc_issuer", "https://vault.example.com/v1/oidc")

    mock_response = AsyncMock()
    mock_response.status_code = 404
    mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "Not Found",
        request=httpx.Request("GET", "https://example.com"),
        response=mock_response,
    )

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.main.httpx.AsyncClient", return_value=mock_client):
        from app.main import _check_oidc_connectivity

        await _check_oidc_connectivity()  # Should not raise — logs warning instead


async def test_check_oidc_connectivity_timeout(monkeypatch) -> None:
    """Logs error when the OIDC provider times out (TimeoutException)."""
    from app.database import settings as _settings

    monkeypatch.setattr(_settings, "oidc_issuer", "https://vault.example.com/v1/oidc")

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=httpx.ConnectTimeout("timed out"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.main.httpx.AsyncClient", return_value=mock_client):
        from app.main import _check_oidc_connectivity

        await _check_oidc_connectivity()  # Should not raise — logs error instead


async def test_check_oidc_connectivity_generic_error(monkeypatch) -> None:
    """Logs warning for unexpected errors (e.g. SSL, protocol)."""
    from app.database import settings as _settings

    monkeypatch.setattr(_settings, "oidc_issuer", "https://vault.example.com/v1/oidc")

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=RuntimeError("something unexpected"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.main.httpx.AsyncClient", return_value=mock_client):
        from app.main import _check_oidc_connectivity

        await _check_oidc_connectivity()  # Should not raise — logs warning instead


# ── Storage health checks ─────────────────────────────────


async def test_storage_health_ok() -> None:
    """storage_health returns ok when the admin_tasks directory is writable."""
    from app.main import app, storage_health

    result = await storage_health()
    assert result == {"status": "ok", "version": app.version}


async def test_storage_health_unwritable(monkeypatch) -> None:
    """storage_health raises 503 when the storage volume is not writable."""
    from fastapi import HTTPException

    from app.main import storage_health

    monkeypatch.setattr(
        "app.main._check_storage_ready", AsyncMock(return_value=False)
    )

    with pytest.raises(HTTPException) as exc_info:
        await storage_health()
    assert exc_info.value.status_code == 503


async def test_readiness_ok() -> None:
    """readiness returns ready when the database and storage are reachable."""
    from app.main import app, readiness

    db = AsyncMock()
    result = await readiness(db=db)
    assert result == {"status": "ready", "version": app.version}


async def test_readiness_storage_unwritable(monkeypatch) -> None:
    """readiness raises 503 when the storage volume is not writable."""
    from fastapi import HTTPException

    from app.main import readiness

    monkeypatch.setattr(
        "app.main._check_storage_ready", AsyncMock(return_value=False)
    )

    db = AsyncMock()
    with pytest.raises(HTTPException) as exc_info:
        await readiness(db=db)
    assert exc_info.value.status_code == 503


def test_check_storage_writable_ok() -> None:
    """_check_storage_writable succeeds when the admin_tasks directory is writable."""
    from app.main import _check_storage_writable

    assert _check_storage_writable() is True


def test_check_storage_writable_fails(tmp_path, monkeypatch) -> None:
    """_check_storage_writable returns False when the directory is read-only."""
    import stat

    from app import main

    read_only_dir = tmp_path / "admin_tasks"
    read_only_dir.mkdir()
    read_only_dir.chmod(stat.S_IRUSR | stat.S_IXUSR)
    monkeypatch.setattr(main, "_ensure_tasks_dir", lambda: str(read_only_dir))

    from app.main import _check_storage_writable

    try:
        assert _check_storage_writable() is False
    finally:
        read_only_dir.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
