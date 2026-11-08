"""Local password changes and forced-change authorization boundaries."""

import logging
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi import Depends, FastAPI

from app import auth, rate_limit
from app.database import get_db
from app.routers import auth as auth_router
from app.routers import (
    images as images_router,
    users as users_router,
    tiles as tiles_router,
)
from app.tile_tokens import issue_tile_token


@pytest.fixture
def user():
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=7,
        name="Guest",
        email="guest@example.invalid",
        role="admin",
        active=True,
        password_hash=auth.hash_password("old-password"),
        oidc_subject=None,
        invite_nonce=None,
        must_change_password=True,
        programs=[],
        groups=[],
        metadata_=None,
        last_access=now,
        created_at=now,
        updated_at=now,
    )


@pytest.fixture
def db(user):
    session = AsyncMock()
    session.get.return_value = user
    result = MagicMock()
    result.scalar_one_or_none.return_value = user
    session.execute.return_value = result
    return session


@pytest.fixture
def app(db, monkeypatch):
    application = FastAPI()
    application.include_router(auth_router.router, prefix="/api")
    application.include_router(images_router.router, prefix="/api")
    application.include_router(users_router.router, prefix="/api")
    application.include_router(tiles_router.router, prefix="/api")
    application.dependency_overrides[get_db] = lambda: db
    monkeypatch.setattr(
        auth_router, "check_password_change_rate_limit", AsyncMock(return_value=None)
    )

    @application.get("/protected")
    async def protected(user=Depends(auth.get_current_user)):
        return {"id": user.id}

    @application.get("/role")
    async def role(
        user=Depends(auth.require_role("admin", "instructor", "staff", "student"))
    ):
        return {"id": user.id}

    return application


@pytest.fixture
async def client(app, user):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {auth.create_access_token(user)}"},
    ) as instance:
        yield instance


@pytest.mark.parametrize("role", ["admin", "instructor", "staff", "student"])
async def test_forced_change_blocks_and_reopens(client, user, db, role, caplog):
    user.role = role
    for path in ["/protected", "/role"]:
        response = await client.get(path)
        assert response.status_code == 403
        assert response.json()["detail"] == "password_change_required"
    me = await client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["must_change_password"] is True
    for path in ["/api/images/7", "/api/users/7"]:
        blocked = await client.get(path)
        assert blocked.status_code == 403
        assert blocked.json()["detail"] == "password_change_required"
    with caplog.at_level(logging.INFO):
        response = await client.post(
            "/api/auth/change-password",
            json={
                "current_password": "old-password",
                "new_password": "new-password",
            },
        )
    assert response.status_code == 204
    assert response.content == b""
    assert user.must_change_password is False
    assert auth.verify_password("new-password", user.password_hash)
    assert not auth.verify_password("old-password", user.password_hash)
    db.commit.assert_awaited_once()
    for path in ["/protected", "/role"]:
        assert (await client.get(path)).status_code == 200
    event = next(
        r.__dict__
        for r in caplog.records
        if getattr(r, "event", "") == "auth.password_change"
    )
    assert event["auth.outcome"] == "success"
    assert event["auth.method"] == "local"
    assert event["auth.user_id"] == 7
    assert "old-password" not in caplog.text and "new-password" not in caplog.text


async def test_unflagged_user_can_change(client, user):
    user.must_change_password = False
    response = await client.post(
        "/api/auth/change-password",
        json={"current_password": "old-password", "new_password": "12345678"},
    )
    assert response.status_code == 204


@pytest.mark.parametrize("current", [None, "", "wrong-password", "x" * 73, "é" * 37])
async def test_wrong_or_missing_current(client, user, db, current, caplog):
    old_hash = user.password_hash
    body = {"new_password": "new-password"}
    if current is not None:
        body["current_password"] = current
    response = await client.post("/api/auth/change-password", json=body)
    assert response.status_code == 401
    assert user.password_hash == old_hash
    assert user.must_change_password is True
    db.commit.assert_not_awaited()
    event = next(
        r.__dict__
        for r in caplog.records
        if getattr(r, "event", "") == "auth.password_change"
    )
    assert event["auth.outcome"] == "failure"


async def test_oidc_rejected(client, user, db):
    user.oidc_subject = "subject"
    response = await client.post(
        "/api/auth/change-password",
        json={"current_password": "old-password", "new_password": "new-password"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "oidc_linked"
    db.commit.assert_not_awaited()


async def test_passwordless_rejected(client, user, db):
    user.password_hash = None
    response = await client.post(
        "/api/auth/change-password",
        json={"current_password": "old-password", "new_password": "new-password"},
    )
    assert response.status_code == 401
    db.commit.assert_not_awaited()


@pytest.mark.parametrize("password", ["", "1234567", "x" * 73, "é" * 37, None])
async def test_new_password_validation(client, db, password):
    response = await client.post(
        "/api/auth/change-password",
        json={"current_password": "old-password", "new_password": password},
    )
    assert response.status_code == 422
    db.commit.assert_not_awaited()


async def test_rate_limit_precedes_password_verification(client, monkeypatch, db):
    limiter = AsyncMock(return_value=42)
    verify = MagicMock()
    monkeypatch.setattr(auth_router, "check_password_change_rate_limit", limiter)
    monkeypatch.setattr(auth_router, "verify_password", verify)
    response = await client.post(
        "/api/auth/change-password",
        json={"current_password": "wrong", "new_password": "new-password"},
    )
    assert response.status_code == 429
    assert response.headers["retry-after"] == "42"
    limiter.assert_awaited_once_with(7)
    verify.assert_not_called()
    db.commit.assert_not_awaited()


@pytest.mark.parametrize(
    "path", ["/api/auth/change-password", "/api/auth/me", "/protected", "/role"]
)
async def test_no_bearer_rejected(client, path):
    client.headers.clear()
    response = (
        await client.post(
            path,
            json={"current_password": "old-password", "new_password": "new-password"},
        )
        if path.endswith("change-password")
        else await client.get(path)
    )
    assert response.status_code == 401


async def test_login_still_succeeds_while_flagged(client, db, user, monkeypatch):
    db.execute.return_value.scalars.return_value.first.return_value = user
    monkeypatch.setattr(
        auth_router, "check_login_rate_limit", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(auth_router, "reset_login_rate_limit", AsyncMock())
    response = await client.post(
        "/api/auth/login", json={"email": user.email, "password": "old-password"}
    )
    assert response.status_code == 200
    assert response.json()["user"]["must_change_password"] is True


async def test_password_change_bucket(monkeypatch):
    checker = AsyncMock(return_value=30)
    monkeypatch.setattr(rate_limit, "check_rate_limit", checker)
    assert await rate_limit.check_password_change_rate_limit(7) == 30
    checker.assert_awaited_once_with(
        "rate:pwchange:7",
        rate_limit.settings.rate_limit_login_window,
        rate_limit.settings.rate_limit_login_max,
    )


async def test_existing_tile_token_remains_valid(client):
    token = issue_tile_token(7)
    response = await client.get(
        "/api/tiles-auth",
        params={"tile_token": token},
        headers={"X-Original-URI": "/api/tiles/7/image.dzi"},
    )
    assert response.status_code == 204


async def test_inactive_user_cannot_change_password(client, user, db):
    user.active = False
    response = await client.post(
        "/api/auth/change-password",
        json={"current_password": "old-password", "new_password": "new-password"},
    )
    assert response.status_code == 401
    db.commit.assert_not_awaited()
