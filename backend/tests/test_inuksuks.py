"""Schema and feature-gate contracts for Inuksuks and Boards."""

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from starlette.responses import JSONResponse

from app.database import Settings, settings
from app.inuksuks import require_inuksuks_enabled
from app.middleware import InuksuksFeatureMiddleware
from app.models import (
    Board, BoardInuksuk, Inuksuk,
    STUDENT_MAX_BOARDS, STUDENT_MAX_INUKSUKS,
    board_groups, board_owners, board_programs, inuksuk_owners,
)


def test_schema_contract() -> None:
    assert STUDENT_MAX_BOARDS == 10
    assert STUDENT_MAX_INUKSUKS == 200
    for model in (Board, Inuksuk):
        c = model.__table__.c
        assert c.version.nullable is False
        assert c.version.server_default.arg == "1"
        assert next(iter(c.created_by_user_id.foreign_keys)).ondelete == "SET NULL"
        assert c.created_at.type.timezone and c.updated_at.type.timezone
    for table in (board_groups, board_owners, board_programs, inuksuk_owners):
        assert len(table.primary_key.columns) == 2
        assert all(fk.ondelete == "CASCADE" for fk in table.foreign_keys)
    assert {c.name for c in BoardInuksuk.__table__.primary_key} == {"board_id", "inuksuk_id"}
    assert next(iter(Inuksuk.__table__.c.image_id.foreign_keys)).ondelete == "CASCADE"
    assert {i.name for i in BoardInuksuk.__table__.indexes} == {
        "idx_board_inuksuks_order",
    }


def test_settings_and_dependency(monkeypatch) -> None:
    monkeypatch.delenv("INUKSUKS_ENABLED", raising=False)
    assert Settings(_env_file=None).inuksuks_enabled is False
    monkeypatch.setenv("INUKSUKS_ENABLED", "true")
    assert Settings(_env_file=None).inuksuks_enabled is True
    monkeypatch.setattr(settings, "inuksuks_enabled", False)
    with pytest.raises(HTTPException) as exc:
        require_inuksuks_enabled()
    assert exc.value.status_code == 404
    monkeypatch.setattr(settings, "inuksuks_enabled", True)
    assert require_inuksuks_enabled() is None


@pytest.mark.parametrize("enabled", [False, True])
@pytest.mark.parametrize("path", [
    "/api/boards", "/api/boards/1", "/api/inuksuks", "/api/inuksuks/1",
    "/api/boards-other", "/api/features",
])
async def test_middleware_pre_parser(monkeypatch, enabled, path) -> None:
    monkeypatch.setattr(settings, "inuksuks_enabled", enabled)

    async def endpoint(scope, receive, send):
        await JSONResponse({"reached": True})(scope, receive, send)

    async with AsyncClient(
        transport=ASGITransport(app=InuksuksFeatureMiddleware(endpoint)),
        base_url="http://test",
    ) as client:
        response = await client.post(path, content="{", headers={"content-type": "application/json"})
    blocked = not enabled and path not in ("/api/boards-other", "/api/features")
    assert response.status_code == (404 if blocked else 200)
    assert response.json() == ({"detail": "Not Found"} if blocked else {"reached": True})


async def test_middleware_non_http_passthrough(monkeypatch) -> None:
    monkeypatch.setattr(settings, "inuksuks_enabled", False)
    seen = []

    async def endpoint(scope, receive, send):
        seen.append(scope["type"])

    await InuksuksFeatureMiddleware(endpoint)({"type": "websocket"}, None, None)
    assert seen == ["websocket"]
