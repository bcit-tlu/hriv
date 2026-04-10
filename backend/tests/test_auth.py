import hashlib
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
    assert payload["_epoch"] == auth.auth_settings.jwt_instance_epoch


async def test_get_user_from_token_returns_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth.auth_settings, "jwt_secret", "unit-test-secret")
    monkeypatch.setattr(auth.auth_settings, "jwt_algorithm", "HS256")

    user = SimpleNamespace(id=42, email="person@example.com", role="student")
    token = auth.jwt.encode(
        {"sub": "42", "email": "person@example.com", "role": "student", "_epoch": auth.auth_settings.jwt_instance_epoch},
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
            "_epoch": auth.auth_settings.jwt_instance_epoch,
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
        {"sub": "999", "email": "missing@example.com", "role": "student", "_epoch": auth.auth_settings.jwt_instance_epoch},
        "unit-test-secret",
        algorithm="HS256",
    )

    db = AsyncMock()
    db.get.return_value = None

    with pytest.raises(HTTPException) as exc:
        await auth._get_user_from_token(token, db)  # type: ignore[arg-type]

    assert exc.value.status_code == 401


async def test_get_user_from_token_rejects_stale_instance_epoch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Tokens from a previous backend instance (different epoch) are rejected."""
    monkeypatch.setattr(auth.auth_settings, "jwt_secret", "unit-test-secret")
    monkeypatch.setattr(auth.auth_settings, "jwt_algorithm", "HS256")

    token = auth.jwt.encode(
        {"sub": "1", "email": "a@b.com", "role": "admin", "_epoch": "old-epoch"},
        "unit-test-secret",
        algorithm="HS256",
    )

    db = AsyncMock()
    db.get.return_value = SimpleNamespace(id=1)

    with pytest.raises(HTTPException) as exc:
        await auth._get_user_from_token(token, db)  # type: ignore[arg-type]

    assert exc.value.status_code == 401


def test_get_auth_settings_derives_epoch_from_explicit_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When JWT_SECRET is set explicitly, the epoch is derived deterministically
    from it via SHA-256 so all Uvicorn workers share the same value."""
    # Reset the singleton so _get_auth_settings() reinitialises
    monkeypatch.setattr(auth, "_auth_settings", None)
    monkeypatch.setenv("JWT_SECRET", "stable-test-secret")
    monkeypatch.delenv("JWT_INSTANCE_EPOCH", raising=False)

    settings = auth._get_auth_settings()

    expected = hashlib.sha256(b"stable-test-secret").hexdigest()[:22]
    assert settings.jwt_instance_epoch == expected

    # Calling again returns the same singleton with the same epoch
    assert auth._get_auth_settings().jwt_instance_epoch == expected


def test_get_auth_settings_uses_random_epoch_without_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When JWT_SECRET is not set (local dev), the epoch is random."""
    monkeypatch.setattr(auth, "_auth_settings", None)
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("JWT_INSTANCE_EPOCH", raising=False)

    settings = auth._get_auth_settings()

    # Epoch should be set (non-empty) but NOT a SHA-256 hex prefix
    assert settings.jwt_instance_epoch
    # The random secret was generated, so deriving from it should NOT match
    # (because the random secret is generated first, then epoch is random too)
    derived = hashlib.sha256(settings.jwt_secret.encode()).hexdigest()[:22]
    assert settings.jwt_instance_epoch != derived


def test_get_auth_settings_respects_explicit_epoch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An explicit JWT_INSTANCE_EPOCH env var takes precedence."""
    monkeypatch.setattr(auth, "_auth_settings", None)
    monkeypatch.setenv("JWT_SECRET", "stable-test-secret")
    monkeypatch.setenv("JWT_INSTANCE_EPOCH", "my-custom-epoch")

    settings = auth._get_auth_settings()

    assert settings.jwt_instance_epoch == "my-custom-epoch"


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
