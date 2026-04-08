from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app import auth


def test_hash_password_and_verify_password_roundtrip() -> None:
    plain = "super-secret-password"
    hashed = auth.hash_password(plain)

    assert hashed != plain
    assert auth.verify_password(plain, hashed) is True
    assert auth.verify_password("wrong-password", hashed) is False


def test_create_access_token_contains_expected_claims(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth.auth_settings, "jwt_secret", "unit-test-secret")
    monkeypatch.setattr(auth.auth_settings, "jwt_algorithm", "HS256")
    monkeypatch.setattr(auth.auth_settings, "jwt_expire_minutes", 60)

    user = SimpleNamespace(id=123, email="user@example.com", role="admin")
    token = auth.create_access_token(user)  # type: ignore[arg-type]

    payload = auth.jwt.decode(token, "unit-test-secret", algorithms=["HS256"])
    assert payload["sub"] == "123"
    assert payload["email"] == "user@example.com"
    assert payload["role"] == "admin"
    assert "exp" in payload


async def test_get_user_from_token_returns_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth.auth_settings, "jwt_secret", "unit-test-secret")
    monkeypatch.setattr(auth.auth_settings, "jwt_algorithm", "HS256")

    user = SimpleNamespace(id=42, email="person@example.com", role="student")
    token = auth.jwt.encode(
        {"sub": "42", "email": "person@example.com", "role": "student"},
        "unit-test-secret",
        algorithm="HS256",
    )

    db = AsyncMock()
    db.get.return_value = user

    result = await auth._get_user_from_token(token, db)  # type: ignore[arg-type]

    assert result is user
    db.get.assert_awaited_once()


async def test_get_user_from_token_rejects_scoped_tokens(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth.auth_settings, "jwt_secret", "unit-test-secret")
    monkeypatch.setattr(auth.auth_settings, "jwt_algorithm", "HS256")

    token = auth.jwt.encode(
        {
            "sub": "7",
            "email": "person@example.com",
            "role": "admin",
            "purpose": "file-export",
        },
        "unit-test-secret",
        algorithm="HS256",
    )

    db = AsyncMock()
    db.get.return_value = SimpleNamespace(id=7)

    with pytest.raises(HTTPException) as exc:
        await auth._get_user_from_token(token, db)  # type: ignore[arg-type]

    assert exc.value.status_code == 401


async def test_get_user_from_token_rejects_missing_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth.auth_settings, "jwt_secret", "unit-test-secret")
    monkeypatch.setattr(auth.auth_settings, "jwt_algorithm", "HS256")

    token = auth.jwt.encode(
        {"sub": "999", "email": "missing@example.com", "role": "student"},
        "unit-test-secret",
        algorithm="HS256",
    )

    db = AsyncMock()
    db.get.return_value = None

    with pytest.raises(HTTPException) as exc:
        await auth._get_user_from_token(token, db)  # type: ignore[arg-type]

    assert exc.value.status_code == 401


async def test_require_role_allows_authorized_user() -> None:
    guard = auth.require_role("admin", "instructor")
    current_user = SimpleNamespace(role="admin")

    result = await guard(current_user)  # type: ignore[arg-type]

    assert result is current_user


async def test_require_role_rejects_unauthorized_user() -> None:
    guard = auth.require_role("admin")
    current_user = SimpleNamespace(role="student")

    with pytest.raises(HTTPException) as exc:
        await guard(current_user)  # type: ignore[arg-type]

    assert exc.value.status_code == 403
    assert "not permitted" in exc.value.detail
