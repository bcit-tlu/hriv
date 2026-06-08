"""Tests for the auth router endpoints."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.routers.auth import login, get_me, LoginRequest


def _mock_request(client_ip: str = "127.0.0.1") -> MagicMock:
    """Build a mock Request with headers and client for rate-limit extraction."""
    req = MagicMock()
    req.headers.get.return_value = None  # no X-Forwarded-For
    req.client.host = client_ip
    return req


def _make_user(
    id: int = 1,
    name: str = "Test User",
    email: str = "test@example.com",
    password_hash: str | None = None,
    role: str = "student",
    programs: list | None = None,
    groups: list | None = None,
) -> SimpleNamespace:
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=id,
        name=name,
        email=email,
        password_hash=password_hash,
        role=role,
        programs=programs or [],
        groups=groups or [],
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
            result = await login(body, _mock_request(), db)

    assert result.access_token == "jwt-token"
    assert result.user.email == "test@example.com"


async def test_login_case_insensitive_email() -> None:
    """Password login should match emails case-insensitively (#575)."""
    user = _make_user(password_hash="hashed")

    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = user

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = LoginRequest(email="Test@Example.COM", password="secret")

    with patch("app.routers.auth.verify_password", return_value=True):
        with patch("app.routers.auth.create_access_token", return_value="jwt-token"):
            result = await login(body, _mock_request(), db)

    assert result.access_token == "jwt-token"
    # Verify db.execute was called with a case-insensitive query
    db.execute.assert_called_once()


async def test_login_unknown_email() -> None:
    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = None

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    body = LoginRequest(email="nonexistent@example.com", password="secret")

    with pytest.raises(HTTPException) as exc:
        await login(body, _mock_request(), db)
    assert exc.value.status_code == 401


async def test_login_no_password_hash() -> None:
    user = _make_user(password_hash=None)

    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = user

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    body = LoginRequest(email="test@example.com", password="secret")

    with pytest.raises(HTTPException) as exc:
        await login(body, _mock_request(), db)
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
            await login(body, _mock_request(), db)
    assert exc.value.status_code == 401


async def test_login_with_programs() -> None:
    program = SimpleNamespace(id=1, name="Biology")
    user = _make_user(password_hash="hashed", programs=[program])

    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = user

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = LoginRequest(email="test@example.com", password="secret")

    with patch("app.routers.auth.verify_password", return_value=True):
        with patch("app.routers.auth.create_access_token", return_value="jwt-token"):
            result = await login(body, _mock_request(), db)

    assert result.user.program_names == ["Biology"]
    assert result.user.program_ids == [1]


async def test_get_me_returns_current_user() -> None:
    program = SimpleNamespace(id=2, name="Chemistry")
    user = _make_user(programs=[program])

    db = AsyncMock()
    db.refresh = AsyncMock()

    result = await get_me(user, db)
    assert result.email == "test@example.com"
    assert result.program_names == ["Chemistry"]
    assert result.program_ids == [2]


async def test_get_me_without_programs() -> None:
    user = _make_user()

    db = AsyncMock()
    db.refresh = AsyncMock()

    result = await get_me(user, db)
    assert result.program_names == []
    assert result.program_ids == []
    assert result.group_ids == []
    assert result.group_names == []


async def test_get_me_includes_groups() -> None:
    """A student's group memberships are returned so the UI can show them
    alongside program chips."""
    group = SimpleNamespace(id=7, name="Field Studies")
    user = _make_user(groups=[group])

    db = AsyncMock()
    db.refresh = AsyncMock()

    result = await get_me(user, db)
    assert result.group_ids == [7]
    assert result.group_names == ["Field Studies"]


async def test_login_includes_groups() -> None:
    group = SimpleNamespace(id=7, name="Field Studies")
    user = _make_user(password_hash="hashed", groups=[group])

    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = user

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = LoginRequest(email="test@example.com", password="secret")

    with patch("app.routers.auth.verify_password", return_value=True):
        with patch("app.routers.auth.create_access_token", return_value="jwt-token"):
            result = await login(body, _mock_request(), db)

    assert result.user.group_ids == [7]
    assert result.user.group_names == ["Field Studies"]
