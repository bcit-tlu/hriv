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
    monkeypatch.setattr(settings, "tiles_dir", str(tiles))
    monkeypatch.setattr(settings, "source_images_dir", str(source))


@pytest.fixture(autouse=True)
def _stub_pyvips(monkeypatch):
    """Insert a stub for pyvips so app.main can be imported without libvips."""
    if "pyvips" not in sys.modules:
        monkeypatch.setitem(sys.modules, "pyvips", MagicMock())


async def test_health_endpoint() -> None:
    from app.main import health
    result = await health()
    assert result == {"status": "ok"}


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
        "Not Found", request=httpx.Request("GET", "https://example.com"), response=mock_response,
    )

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.main.httpx.AsyncClient", return_value=mock_client):
        from app.main import _check_oidc_connectivity
        await _check_oidc_connectivity()  # Should not raise — logs warning instead


async def test_check_oidc_connectivity_generic_error(monkeypatch) -> None:
    """Logs warning for unexpected errors (e.g. timeout, SSL)."""
    from app.database import settings as _settings
    monkeypatch.setattr(_settings, "oidc_issuer", "https://vault.example.com/v1/oidc")

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=httpx.TimeoutException("timed out"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.main.httpx.AsyncClient", return_value=mock_client):
        from app.main import _check_oidc_connectivity
        await _check_oidc_connectivity()  # Should not raise — logs warning instead
