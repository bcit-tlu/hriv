"""Tests for the auth router endpoints."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.routers.auth import login, get_me, LoginRequest


def _make_user(
    id: int = 1,
    name: str = "Test User",
    email: str = "test@example.com",
    password_hash: str | None = None,
    role: str = "student",
    program_id: int | None = None,
    program_rel: object = None,
) -> SimpleNamespace:
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=id,
        name=name,
        email=email,
        password_hash=password_hash,
        role=role,
        program_id=program_id,
        program_rel=program_rel,
        metadata_=None,
        last_access=now,
        created_at=now,
        updated_at=now,
    )


async def test_login_success() -> None:
    user = _make_user(password_hash="hashed")

    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = user

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = LoginRequest(email="test@example.com", password="secret")

    with patch("app.routers.auth.verify_password", return_value=True):
        with patch("app.routers.auth.create_access_token", return_value="jwt-token"):
            result = await login(body, db)

    assert result.access_token == "jwt-token"
    assert result.user.email == "test@example.com"


async def test_login_unknown_email() -> None:
    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = None

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    body = LoginRequest(email="nonexistent@example.com", password="secret")

    with pytest.raises(HTTPException) as exc:
        await login(body, db)
    assert exc.value.status_code == 401


async def test_login_no_password_hash() -> None:
    user = _make_user(password_hash=None)

    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = user

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    body = LoginRequest(email="test@example.com", password="secret")

    with pytest.raises(HTTPException) as exc:
        await login(body, db)
    assert exc.value.status_code == 401


async def test_login_wrong_password() -> None:
    user = _make_user(password_hash="hashed")

    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = user

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    body = LoginRequest(email="test@example.com", password="wrong")

    with patch("app.routers.auth.verify_password", return_value=False):
        with pytest.raises(HTTPException) as exc:
            await login(body, db)
    assert exc.value.status_code == 401


async def test_login_with_program_rel() -> None:
    program = SimpleNamespace(name="Biology")
    user = _make_user(password_hash="hashed", program_id=1, program_rel=program)

    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = user

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = LoginRequest(email="test@example.com", password="secret")

    with patch("app.routers.auth.verify_password", return_value=True):
        with patch("app.routers.auth.create_access_token", return_value="jwt-token"):
            result = await login(body, db)

    assert result.user.program_name == "Biology"


async def test_get_me_returns_current_user() -> None:
    program = SimpleNamespace(name="Chemistry")
    user = _make_user(program_id=2, program_rel=program)

    db = AsyncMock()
    db.refresh = AsyncMock()

    result = await get_me(user, db)
    assert result.email == "test@example.com"
    assert result.program_name == "Chemistry"


async def test_get_me_without_program() -> None:
    user = _make_user()

    db = AsyncMock()
    db.refresh = AsyncMock()

    result = await get_me(user, db)
    assert result.program_name is None
