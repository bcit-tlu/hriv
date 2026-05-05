"""Tests for the MaintenanceMiddleware and admin maintenance endpoints."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.middleware import MaintenanceMiddleware, _MAINTENANCE_EXEMPT
from app.routers.admin import get_maintenance, set_maintenance


# ---------------------------------------------------------------------------
# Helpers for pure ASGI middleware tests
# ---------------------------------------------------------------------------


def _make_scope(path: str = "/api/images") -> dict:
    return {
        "type": "http",
        "method": "GET",
        "path": path,
        "headers": [],
        "client": ("127.0.0.1", 0),
    }


async def _noop_receive() -> dict:
    return {"type": "http.request", "body": b""}


async def _call_middleware(
    middleware: MaintenanceMiddleware,
    scope: dict,
    *,
    response_status: int = 200,
) -> list[dict]:
    captured: list[dict] = []

    async def inner_app(scope, receive, send):
        await send({"type": "http.response.start", "status": response_status, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    middleware.app = inner_app

    async def capturing_send(message: dict) -> None:
        captured.append(message)

    await middleware(scope, _noop_receive, capturing_send)
    return captured


def _status_from(messages: list[dict]) -> int:
    for msg in messages:
        if msg["type"] == "http.response.start":
            return msg["status"]
    raise AssertionError("no http.response.start found")


# ---------------------------------------------------------------------------
# MaintenanceMiddleware
# ---------------------------------------------------------------------------


async def test_middleware_passes_through_when_not_in_maintenance() -> None:
    middleware = MaintenanceMiddleware(app=MagicMock())
    messages = await _call_middleware(middleware, _make_scope())
    assert _status_from(messages) == 200


@patch("app.middleware.is_maintenance_mode", return_value=True)
async def test_middleware_returns_503_during_maintenance(_mock) -> None:
    middleware = MaintenanceMiddleware(app=MagicMock())
    messages = await _call_middleware(middleware, _make_scope("/api/categories"))
    assert _status_from(messages) == 503


@patch("app.middleware.is_maintenance_mode", return_value=True)
async def test_middleware_allows_health_during_maintenance(_mock) -> None:
    middleware = MaintenanceMiddleware(app=MagicMock())
    messages = await _call_middleware(middleware, _make_scope("/api/health"))
    assert _status_from(messages) == 200


@patch("app.middleware.is_maintenance_mode", return_value=True)
async def test_middleware_allows_health_ready_during_maintenance(_mock) -> None:
    middleware = MaintenanceMiddleware(app=MagicMock())
    messages = await _call_middleware(middleware, _make_scope("/api/health/ready"))
    assert _status_from(messages) == 200


@patch("app.middleware.is_maintenance_mode", return_value=True)
async def test_middleware_allows_status_during_maintenance(_mock) -> None:
    middleware = MaintenanceMiddleware(app=MagicMock())
    messages = await _call_middleware(middleware, _make_scope("/api/status"))
    assert _status_from(messages) == 200


@patch("app.middleware.is_maintenance_mode", return_value=True)
async def test_middleware_allows_admin_maintenance_during_maintenance(_mock) -> None:
    middleware = MaintenanceMiddleware(app=MagicMock())
    messages = await _call_middleware(middleware, _make_scope("/api/admin/maintenance"))
    assert _status_from(messages) == 200


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
