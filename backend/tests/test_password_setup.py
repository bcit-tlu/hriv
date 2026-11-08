"""Admin-issued, purpose-scoped, single-use password setup credentials."""

import logging
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import jwt
import pytest
from fastapi import FastAPI, HTTPException
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql

from app import auth, rate_limit
from app.database import get_db
from app.password_tokens import (
    PasswordSetupTokenError,
    issue_password_setup_token,
    validate_password_setup_token,
)
from app.routers import auth as auth_router, users as users_router
from app.schemas import PasswordSetupRequest


@pytest.fixture
def guest() -> SimpleNamespace:
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=7,
        name="Guest",
        email="guest@example.invalid",
        role="student",
        active=True,
        password_hash=None,
        oidc_subject=None,
        invite_nonce="nonce",
        must_change_password=False,
        metadata_=None,
        programs=[],
        groups=[],
        last_access=None,
        created_at=now,
        updated_at=now,
    )


@pytest.fixture
def db(guest: SimpleNamespace) -> AsyncMock:
    session = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = guest
    session.execute.return_value = result
    session.get.return_value = guest
    return session


@pytest.fixture
def app(db: AsyncMock, monkeypatch: pytest.MonkeyPatch) -> FastAPI:
    application = FastAPI()
    application.include_router(auth_router.router, prefix="/api")
    application.include_router(users_router.router, prefix="/api")
    application.dependency_overrides[get_db] = lambda: db
    application.dependency_overrides[auth.get_current_user] = lambda: SimpleNamespace(
        id=1, role="admin"
    )
    monkeypatch.setattr(
        auth_router, "check_password_setup_rate_limit", AsyncMock(return_value=None)
    )
    return application


def _claims(**overrides) -> dict:
    return {
        "purpose": "password_setup",
        "sub": "7",
        "nonce": "nonce",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
        **overrides,
    }


def _sign(claims: dict) -> str:
    return jwt.encode(
        claims,
        auth.auth_settings.jwt_secret,
        algorithm=auth.auth_settings.jwt_algorithm,
    )


def test_token_roundtrip_and_ttl(guest: SimpleNamespace) -> None:
    token = issue_password_setup_token(guest, "nonce")
    claims = validate_password_setup_token(token)
    assert claims["purpose"] == "password_setup"
    assert claims["sub"] == "7"
    assert claims["nonce"] == "nonce"
    remaining = claims["exp"] - datetime.now(timezone.utc).timestamp()
    assert (
        auth.auth_settings.password_setup_token_ttl_minutes * 60 - 2
        <= remaining
        <= auth.auth_settings.password_setup_token_ttl_minutes * 60
    )


@pytest.mark.parametrize(
    "overrides",
    [
        {"purpose": "tile"},
        {"purpose": "password_change"},
        {"exp": datetime.now(timezone.utc) - timedelta(minutes=1)},
        {"sub": "not-an-id"},
        {"sub": "0"},
        {"sub": "2147483648"},
        {"sub": 7},
        {"nonce": ""},
        {"nonce": None},
        {"nonce": "x" * 65},
        {"nonce": "é"},
    ],
)
def test_invalid_token_claims(overrides: dict) -> None:
    with pytest.raises(PasswordSetupTokenError) as exc:
        validate_password_setup_token(_sign(_claims(**overrides)))
    assert exc.value.status_code == 401


@pytest.mark.parametrize("missing", ["purpose", "sub", "nonce", "exp"])
def test_missing_token_claim(missing: str) -> None:
    claims = _claims()
    claims.pop(missing)
    with pytest.raises(PasswordSetupTokenError):
        validate_password_setup_token(_sign(claims))


@pytest.mark.parametrize("token", ["", "garbage", "a.b.c"])
def test_malformed_token(token: str) -> None:
    with pytest.raises(PasswordSetupTokenError):
        validate_password_setup_token(token)


def test_wrong_signing_key() -> None:
    token = jwt.encode(
        _claims(), "other-key-for-testing-that-is-long-enough", algorithm="HS256"
    )
    with pytest.raises(PasswordSetupTokenError):
        validate_password_setup_token(token)


@pytest.mark.parametrize("minutes", [59, 43201])
def test_ttl_bounds(minutes: int) -> None:
    with pytest.raises(ValidationError):
        auth.AuthSettings(password_setup_token_ttl_minutes=minutes)


def test_ttl_setting_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PASSWORD_SETUP_TOKEN_TTL_MINUTES", "60")
    assert auth.AuthSettings().password_setup_token_ttl_minutes == 60


async def test_setup_token_is_not_bearer(guest: SimpleNamespace, db: AsyncMock) -> None:
    with pytest.raises(HTTPException) as exc:
        await auth.get_user_from_token(issue_password_setup_token(guest, "nonce"), db)
    assert exc.value.status_code == 401
    db.get.assert_not_awaited()


async def test_mint_rotates_nonce(
    app: FastAPI, guest: SimpleNamespace, db: AsyncMock, caplog
) -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        with caplog.at_level(logging.INFO):
            first = await client.post("/api/users/7/password-setup-link")
            first_nonce = guest.invite_nonce
            second = await client.post("/api/users/7/password-setup-link")
        assert first.status_code == second.status_code == 200
        assert guest.invite_nonce != first_nonce
        claims = validate_password_setup_token(second.json()["setup_token"])
        assert claims["nonce"] == guest.invite_nonce
        assert (
            datetime.fromisoformat(second.json()["expires_at"]).timestamp()
            == claims["exp"]
        )
        old = await client.post(
            "/api/auth/password-setup",
            json={"token": first.json()["setup_token"], "password": "password"},
        )
    assert old.status_code == 401
    assert guest.password_hash is None
    assert db.commit.await_count == 2
    assert "FOR UPDATE OF users" in str(
        db.execute.call_args_list[0].args[0].compile(dialect=postgresql.dialect())
    )
    logs = [
        r for r in caplog.records if getattr(r, "event", "") == "auth.invite_minted"
    ]
    assert len(logs) == 2
    assert logs[0].admin_id == 1
    assert logs[0].__dict__["auth.user_id"] == 7
    assert logs[0].__dict__["auth.outcome"] == "success"
    assert first.json()["setup_token"] not in caplog.text
    assert first_nonce not in caplog.text


@pytest.mark.parametrize("role", ["student", "instructor", "staff"])
async def test_mint_requires_admin(app: FastAPI, role: str, db: AsyncMock) -> None:
    app.dependency_overrides[auth.get_current_user] = lambda: SimpleNamespace(
        id=1, role=role
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = await client.post("/api/users/7/password-setup-link")
    assert result.status_code == 403
    db.execute.assert_not_awaited()


async def test_mint_requires_authentication(app: FastAPI, db: AsyncMock) -> None:
    app.dependency_overrides.pop(auth.get_current_user)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = await client.post("/api/users/7/password-setup-link")
    assert result.status_code == 401
    db.execute.assert_not_awaited()


@pytest.mark.parametrize(
    "attribute,value,status,detail",
    [
        ("active", False, 403, "account_inactive"),
        ("oidc_subject", "subject", 422, "oidc_linked"),
        ("password_hash", "hash", 409, "password_already_set"),
    ],
)
async def test_mint_guards(
    app: FastAPI,
    guest: SimpleNamespace,
    db: AsyncMock,
    attribute,
    value,
    status,
    detail,
) -> None:
    setattr(guest, attribute, value)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = await client.post("/api/users/7/password-setup-link")
    assert result.status_code == status
    assert result.json()["detail"] == detail
    assert guest.invite_nonce == "nonce"
    db.commit.assert_not_awaited()


async def test_mint_not_found(app: FastAPI, db: AsyncMock) -> None:
    db.execute.return_value.scalar_one_or_none.return_value = None
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = await client.post("/api/users/7/password-setup-link")
    assert result.status_code == 404
    db.commit.assert_not_awaited()


async def test_redeem_and_second_use(
    app: FastAPI, guest: SimpleNamespace, db: AsyncMock, caplog
) -> None:
    guest.must_change_password = True
    token = issue_password_setup_token(guest, "nonce")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        with caplog.at_level(logging.INFO):
            result = await client.post(
                "/api/auth/password-setup",
                json={"token": token, "password": "new-password"},
            )
            second = await client.post(
                "/api/auth/password-setup",
                json={"token": token, "password": "different-password"},
            )
    assert result.status_code == 200
    assert auth.verify_password("new-password", guest.password_hash)
    assert guest.invite_nonce is None
    assert guest.must_change_password is False
    assert guest.last_access is not None
    data = result.json()
    assert data["token_type"] == "bearer"
    assert data["user"]["has_local_password"] is True
    assert data["user"]["oidc_linked"] is False
    assert data["user"]["must_change_password"] is False
    assert not {"password_hash", "invite_nonce", "oidc_subject"} & data["user"].keys()
    assert await auth.get_user_from_token(data["access_token"], db) is guest
    assert second.status_code == 409
    assert second.json()["detail"] == "password_already_set"
    db.commit.assert_awaited_once()
    assert "FOR UPDATE OF users" in str(
        db.execute.call_args_list[0].args[0].compile(dialect=postgresql.dialect())
    )
    events = [
        r.__dict__
        for r in caplog.records
        if getattr(r, "event", "") == "auth.password_setup"
    ]
    assert [e["auth.outcome"] for e in events] == ["success", "failure"]
    assert all(e["auth.method"] == "local" and e["auth.user_id"] == 7 for e in events)
    assert token not in caplog.text and "new-password" not in caplog.text


@pytest.mark.parametrize(
    "attribute,value,status,detail",
    [
        ("active", False, 403, "account_inactive"),
        ("password_hash", "hash", 409, "password_already_set"),
        ("invite_nonce", None, 401, None),
        ("invite_nonce", "rotated", 401, None),
        ("oidc_subject", "linked-after-mint", 401, None),
    ],
)
async def test_redeem_guards(
    app: FastAPI,
    guest: SimpleNamespace,
    db: AsyncMock,
    attribute,
    value,
    status,
    detail,
) -> None:
    setattr(guest, attribute, value)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = await client.post(
            "/api/auth/password-setup",
            json={"token": _sign(_claims()), "password": "password"},
        )
    assert result.status_code == status
    if detail:
        assert result.json()["detail"] == detail
    db.commit.assert_not_awaited()


@pytest.mark.parametrize(
    "token", ["", "invalid", _sign(_claims(purpose="tile")), _sign(_claims(exp=1))]
)
async def test_redeem_invalid_token(
    app: FastAPI, db: AsyncMock, token: str, caplog
) -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = await client.post(
            "/api/auth/password-setup", json={"token": token, "password": "password"}
        )
    assert result.status_code == 401
    db.execute.assert_not_awaited()
    event = next(
        r.__dict__
        for r in caplog.records
        if getattr(r, "event", "") == "auth.password_setup"
    )
    assert event["auth.outcome"] == "failure"


async def test_redeem_missing_user(app: FastAPI, db: AsyncMock) -> None:
    db.execute.return_value.scalar_one_or_none.return_value = None
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = await client.post(
            "/api/auth/password-setup",
            json={"token": _sign(_claims()), "password": "password"},
        )
    assert result.status_code == 401


async def test_redeem_rate_limit_first(
    app: FastAPI, db: AsyncMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        auth_router, "check_password_setup_rate_limit", AsyncMock(return_value=42)
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        result = await client.post(
            "/api/auth/password-setup",
            json={"token": "invalid", "password": "password"},
        )
    assert result.status_code == 429
    assert result.headers["retry-after"] == "42"
    db.execute.assert_not_awaited()


@pytest.mark.parametrize("password", ["", "1234567", "x" * 73, "é" * 37])
def test_setup_password_validation(password: str) -> None:
    with pytest.raises(ValidationError):
        PasswordSetupRequest(token="token", password=password)


@pytest.mark.parametrize(
    "ip_retry,subject_retry", [(None, None), (None, 30), (20, None)]
)
async def test_dual_rate_limit(
    monkeypatch: pytest.MonkeyPatch, ip_retry, subject_retry
) -> None:
    checker = AsyncMock(side_effect=[ip_retry, subject_retry])
    monkeypatch.setattr(rate_limit, "check_rate_limit", checker)
    result = await rate_limit.check_password_setup_rate_limit(
        "127.0.0.1", _sign(_claims())
    )
    assert result == (ip_retry if ip_retry is not None else subject_retry)
    assert checker.await_args_list[0].args[0] == "rate:pwsetup:127.0.0.1"
    assert checker.await_count == (1 if ip_retry is not None else 2)
    if ip_retry is None:
        assert checker.await_args_list[1].args[0].startswith("rate:pwsetup:subject:")


@pytest.mark.parametrize(
    "token", ["invalid", _sign(_claims(sub=None)), _sign(_claims(sub="invalid"))]
)
async def test_invalid_subject_is_ip_limited(
    monkeypatch: pytest.MonkeyPatch, token: str
) -> None:
    checker = AsyncMock(return_value=None)
    monkeypatch.setattr(rate_limit, "check_rate_limit", checker)
    assert await rate_limit.check_password_setup_rate_limit("ip", token) is None
    checker.assert_awaited_once()


async def test_subject_budget_shared_across_ips_and_rotations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    checker = AsyncMock(return_value=None)
    monkeypatch.setattr(rate_limit, "check_rate_limit", checker)
    await rate_limit.check_password_setup_rate_limit("ip1", _sign(_claims(nonce="one")))
    await rate_limit.check_password_setup_rate_limit("ip2", _sign(_claims(nonce="two")))
    assert checker.await_args_list[1].args == checker.await_args_list[3].args
