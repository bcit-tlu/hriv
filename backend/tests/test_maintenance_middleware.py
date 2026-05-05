"""Tests for the MaintenanceMiddleware and admin maintenance endpoints."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.middleware import MaintenanceMiddleware, _MAINTENANCE_EXEMPT
from app.routers.admin import get_maintenance, set_maintenance


# ---------------------------------------------------------------------------
# MaintenanceMiddleware
# ---------------------------------------------------------------------------


def _make_request(path: str = "/api/images") -> MagicMock:
    request = MagicMock()
    request.url.path = path
    return request


async def test_middleware_passes_through_when_not_in_maintenance() -> None:
    middleware = MaintenanceMiddleware(app=MagicMock())
    expected_response = MagicMock()

    async def call_next(_req):
        return expected_response

    response = await middleware.dispatch(_make_request(), call_next)
    assert response is expected_response


@patch("app.middleware.is_maintenance_mode", return_value=True)
async def test_middleware_returns_503_during_maintenance(_mock) -> None:
    middleware = MaintenanceMiddleware(app=MagicMock())

    async def call_next(_req):
        raise AssertionError("should not be called")

    response = await middleware.dispatch(_make_request("/api/categories"), call_next)
    assert response.status_code == 503


@patch("app.middleware.is_maintenance_mode", return_value=True)
async def test_middleware_allows_health_during_maintenance(_mock) -> None:
    middleware = MaintenanceMiddleware(app=MagicMock())
    expected = MagicMock()

    async def call_next(_req):
        return expected

    response = await middleware.dispatch(_make_request("/api/health"), call_next)
    assert response is expected


@patch("app.middleware.is_maintenance_mode", return_value=True)
async def test_middleware_allows_health_ready_during_maintenance(_mock) -> None:
    middleware = MaintenanceMiddleware(app=MagicMock())
    expected = MagicMock()

    async def call_next(_req):
        return expected

    response = await middleware.dispatch(_make_request("/api/health/ready"), call_next)
    assert response is expected


@patch("app.middleware.is_maintenance_mode", return_value=True)
async def test_middleware_allows_status_during_maintenance(_mock) -> None:
    middleware = MaintenanceMiddleware(app=MagicMock())
    expected = MagicMock()

    async def call_next(_req):
        return expected

    response = await middleware.dispatch(_make_request("/api/status"), call_next)
    assert response is expected


@patch("app.middleware.is_maintenance_mode", return_value=True)
async def test_middleware_allows_admin_maintenance_during_maintenance(_mock) -> None:
    middleware = MaintenanceMiddleware(app=MagicMock())
    expected = MagicMock()

    async def call_next(_req):
        return expected

    response = await middleware.dispatch(_make_request("/api/admin/maintenance"), call_next)
    assert response is expected


def test_all_exempt_paths_listed() -> None:
    assert "/api/health" in _MAINTENANCE_EXEMPT
    assert "/api/status" in _MAINTENANCE_EXEMPT
    assert "/api/admin/maintenance" in _MAINTENANCE_EXEMPT


# ---------------------------------------------------------------------------
# Admin endpoints
# ---------------------------------------------------------------------------


def _make_admin() -> SimpleNamespace:
    return SimpleNamespace(id=1, role="admin", email="admin@bcit.ca")


@patch("app.routers.admin.is_maintenance_mode", return_value=False)
async def test_get_maintenance_returns_false(_mock) -> None:
    result = await get_maintenance(_user=_make_admin())
    assert result == {"maintenance": False}


@patch("app.routers.admin.is_maintenance_mode", return_value=True)
async def test_get_maintenance_returns_true(_mock) -> None:
    result = await get_maintenance(_user=_make_admin())
    assert result == {"maintenance": True}


@patch("app.routers.admin.is_maintenance_mode", return_value=True)
@patch("app.routers.admin.enable_maintenance_mode")
async def test_set_maintenance_enable(mock_enable, _mock_is) -> None:
    result = await set_maintenance(_user=_make_admin(), enabled=True)
    mock_enable.assert_called_once()
    assert result == {"maintenance": True}


@patch("app.routers.admin.is_maintenance_mode", return_value=False)
@patch("app.routers.admin.disable_maintenance_mode")
async def test_set_maintenance_disable(mock_disable, _mock_is) -> None:
    result = await set_maintenance(_user=_make_admin(), enabled=False)
    mock_disable.assert_called_once()
    assert result == {"maintenance": False}
