"""Tests for the OIDC router helper functions and endpoints."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import HTTPException

from fastapi.responses import HTMLResponse

from app.routers.oidc import (
    _parse_role_mapping, _resolve_role, _ensure_oidc_enabled,
    _resolve_frontend_origin, _fragment_redirect,
    oidc_enabled, oidc_login, oidc_callback,
)


def _assert_oidc_error_redirect(resp, expected_code: str, origin: str) -> None:
    """Helper: assert ``resp`` is a client-side redirect to
    ``{origin}/#oidc_error={expected_code}``."""
    assert isinstance(resp, HTMLResponse)
    body = resp.body.decode("utf-8")
    assert f"{origin.rstrip('/')}/#oidc_error={expected_code}" in body
    assert resp.headers.get("Cache-Control", "").startswith("no-store")


def test_parse_role_mapping_valid_json() -> None:
    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_role_mapping = '{"admins": "admin", "teachers": "instructor"}'
        result = _parse_role_mapping()
    assert result == {"admins": "admin", "teachers": "instructor"}


def test_parse_role_mapping_invalid_json() -> None:
    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_role_mapping = "not-json"
        result = _parse_role_mapping()
    assert result == {}


def test_parse_role_mapping_non_dict() -> None:
    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_role_mapping = '["list", "not", "dict"]'
        result = _parse_role_mapping()
    assert result == {}


def test_resolve_role_matches_group() -> None:
    with patch("app.routers.oidc._parse_role_mapping", return_value={"admins": "admin", "teachers": "instructor"}):
        assert _resolve_role(["admins"]) == "admin"
        assert _resolve_role(["teachers"]) == "instructor"
        assert _resolve_role(["students"]) is None


def test_resolve_role_first_match_wins() -> None:
    with patch("app.routers.oidc._parse_role_mapping", return_value={"a": "admin", "b": "student"}):
        assert _resolve_role(["a", "b"]) == "admin"


def test_resolve_role_invalid_role_skipped() -> None:
    with patch("app.routers.oidc._parse_role_mapping", return_value={"grp": "superuser"}):
        assert _resolve_role(["grp"]) is None


def test_resolve_role_empty_groups() -> None:
    with patch("app.routers.oidc._parse_role_mapping", return_value={"a": "admin"}):
        assert _resolve_role([]) is None


def test_ensure_oidc_enabled_raises_when_disabled() -> None:
    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = False
        with pytest.raises(HTTPException) as exc:
            _ensure_oidc_enabled()
        assert exc.value.status_code == 404


def test_ensure_oidc_enabled_passes_when_enabled() -> None:
    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = True
        _ensure_oidc_enabled()  # Should not raise


async def test_oidc_enabled_endpoint() -> None:
    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = True
        result = await oidc_enabled()
        assert result == {"enabled": True}

    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = False
        result = await oidc_enabled()
        assert result == {"enabled": False}


# ── oidc_login tests ─────────────────────────────────────────


async def test_oidc_login_disabled() -> None:
    request = MagicMock()
    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = False
        with pytest.raises(HTTPException) as exc:
            await oidc_login(request)
        assert exc.value.status_code == 404


async def test_oidc_login_no_client() -> None:
    request = MagicMock()
    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = True
        with patch("app.routers.oidc.oauth") as mock_oauth:
            mock_oauth.create_client.return_value = None
            with pytest.raises(HTTPException) as exc:
                await oidc_login(request)
            assert exc.value.status_code == 500


async def test_oidc_login_success() -> None:
    request = MagicMock()
    mock_client = AsyncMock()
    mock_client.authorize_redirect = AsyncMock(return_value="redirect-response")

    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = True
        mock_settings.oidc_redirect_uri = "http://localhost/callback"
        with patch("app.routers.oidc.oauth") as mock_oauth:
            mock_oauth.create_client.return_value = mock_client
            result = await oidc_login(request)

    assert result == "redirect-response"


@pytest.mark.parametrize("error", [
    httpx.ConnectError("All connection attempts failed"),
    httpx.ConnectTimeout("timed out"),
])
async def test_oidc_login_provider_unreachable(error) -> None:
    """ConnectError or timeout during authorize_redirect returns a 502."""
    request = MagicMock()
    mock_client = AsyncMock()
    mock_client.authorize_redirect = AsyncMock(side_effect=error)

    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = True
        mock_settings.oidc_redirect_uri = "http://localhost/callback"
        mock_settings.oidc_issuer = "https://vault.example.com:8200/v1/identity/oidc/provider/test"
        with patch("app.routers.oidc.oauth") as mock_oauth:
            mock_oauth.create_client.return_value = mock_client
            with pytest.raises(HTTPException) as exc:
                await oidc_login(request)
            assert exc.value.status_code == 502
            assert "temporarily unavailable" in exc.value.detail


# ── oidc_callback tests ──────────────────────────────────────


async def test_oidc_callback_disabled() -> None:
    request = MagicMock()
    db = AsyncMock()
    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = False
        with pytest.raises(HTTPException) as exc:
            await oidc_callback(request, db)
        assert exc.value.status_code == 404


async def test_oidc_callback_no_client_redirects_with_error() -> None:
    """When OAuth client can't be built, redirect to frontend with
    ``#oidc_error=client_misconfigured`` instead of returning raw JSON."""
    request = MagicMock()
    db = AsyncMock()
    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = True
        mock_settings.oidc_post_login_redirect = "http://localhost:3000"
        mock_settings.cors_origins = "*"
        with patch("app.routers.oidc.oauth") as mock_oauth:
            mock_oauth.create_client.return_value = None
            resp = await oidc_callback(request, db)
    _assert_oidc_error_redirect(resp, "client_misconfigured", "http://localhost:3000")


async def test_oidc_callback_no_client_no_origin_falls_back_to_500() -> None:
    """If neither OIDC_POST_LOGIN_REDIRECT nor a non-wildcard CORS origin
    is configured, the helper has nowhere to redirect — raise 500 so an
    operator notices the missing configuration."""
    request = MagicMock()
    db = AsyncMock()
    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = True
        mock_settings.oidc_post_login_redirect = ""
        mock_settings.cors_origins = "*"
        with patch("app.routers.oidc.oauth") as mock_oauth:
            mock_oauth.create_client.return_value = None
            with pytest.raises(HTTPException) as exc:
                await oidc_callback(request, db)
    assert exc.value.status_code == 500


async def test_oidc_callback_token_exchange_failure_redirects() -> None:
    request = MagicMock()
    db = AsyncMock()
    mock_client = AsyncMock()
    mock_client.authorize_access_token = AsyncMock(side_effect=Exception("token error"))

    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = True
        mock_settings.oidc_post_login_redirect = "http://localhost:3000"
        mock_settings.cors_origins = "*"
        with patch("app.routers.oidc.oauth") as mock_oauth:
            mock_oauth.create_client.return_value = mock_client
            resp = await oidc_callback(request, db)
    _assert_oidc_error_redirect(resp, "token_exchange_failed", "http://localhost:3000")


@pytest.mark.parametrize("error", [
    httpx.ConnectError("All connection attempts failed"),
    httpx.ConnectTimeout("timed out"),
])
async def test_oidc_callback_provider_unreachable_redirects(error) -> None:
    """ConnectError or timeout during token exchange redirects the
    browser to the frontend with ``#oidc_error=provider_unreachable``."""
    request = MagicMock()
    db = AsyncMock()
    mock_client = AsyncMock()
    mock_client.authorize_access_token = AsyncMock(side_effect=error)

    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = True
        mock_settings.oidc_post_login_redirect = "http://localhost:3000"
        mock_settings.cors_origins = "*"
        mock_settings.oidc_issuer = "https://vault.example.com:8200/v1/identity/oidc/provider/test"
        with patch("app.routers.oidc.oauth") as mock_oauth:
            mock_oauth.create_client.return_value = mock_client
            resp = await oidc_callback(request, db)
    _assert_oidc_error_redirect(resp, "provider_unreachable", "http://localhost:3000")


async def test_oidc_callback_missing_claims_redirects() -> None:
    request = MagicMock()
    db = AsyncMock()
    mock_client = AsyncMock()
    mock_client.authorize_access_token = AsyncMock(return_value={
        "userinfo": {"sub": "", "email": ""},
    })

    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = True
        mock_settings.oidc_post_login_redirect = "http://localhost:3000"
        mock_settings.cors_origins = "*"
        with patch("app.routers.oidc.oauth") as mock_oauth:
            mock_oauth.create_client.return_value = mock_client
            resp = await oidc_callback(request, db)
    _assert_oidc_error_redirect(resp, "missing_claims", "http://localhost:3000")


def test_resolve_frontend_origin_prefers_post_login_setting() -> None:
    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_post_login_redirect = "http://frontend.example.com"
        mock_settings.cors_origins = "http://fallback.example.com"
        assert _resolve_frontend_origin() == "http://frontend.example.com"


def test_resolve_frontend_origin_falls_back_to_non_wildcard_cors() -> None:
    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_post_login_redirect = ""
        mock_settings.cors_origins = "*, http://fallback.example.com"
        assert _resolve_frontend_origin() == "http://fallback.example.com"


def test_resolve_frontend_origin_empty_when_only_wildcard() -> None:
    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_post_login_redirect = ""
        mock_settings.cors_origins = "*"
        assert _resolve_frontend_origin() == ""


def test_fragment_redirect_escapes_html_and_js() -> None:
    """Angle brackets in the origin must not break out of the <script>
    block or the <noscript> <a href> attribute."""
    resp = _fragment_redirect("http://evil.example.com</script>", "oidc_error=x")
    body = resp.body.decode("utf-8")
    # Exactly one legitimate </script> — our own closing tag.
    assert body.count("</script>") == 1
    # The attacker payload inside the JS string must be angle-escaped.
    assert "\\u003c/script>" in body
    # Inside the <a href> attribute it must be HTML-entity escaped.
    assert "&lt;/script&gt;" in body


async def test_oidc_callback_new_user_created() -> None:
    request = MagicMock()
    mock_client = AsyncMock()
    mock_client.authorize_access_token = AsyncMock(return_value={
        "userinfo": {
            "sub": "oidc-sub-123",
            "email": "new@example.com",
            "name": "New User",
            "groups": [],
        },
    })

    # User not found by oidc_subject
    mock_result_empty = MagicMock()
    mock_result_empty.scalars.return_value.first.return_value = None

    new_user = SimpleNamespace(
        id=1, name="New User", email="new@example.com",
        oidc_subject="oidc-sub-123", role="student",
        program_rel=None, program_id=None,
    )

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result_empty)
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.commit = AsyncMock()

    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = True
        mock_settings.oidc_trust_email = False
        mock_settings.oidc_post_login_redirect = "http://localhost:3000"
        mock_settings.cors_origins = "*"
        with patch("app.routers.oidc.oauth") as mock_oauth:
            mock_oauth.create_client.return_value = mock_client
            with patch("app.routers.oidc.create_access_token", return_value="jwt-token"):
                result = await oidc_callback(request, db)

    assert result.status_code == 200
    assert "jwt-token" in result.body.decode()


async def test_oidc_callback_existing_user_login() -> None:
    request = MagicMock()
    mock_client = AsyncMock()
    mock_client.authorize_access_token = AsyncMock(return_value={
        "userinfo": {
            "sub": "oidc-sub-456",
            "email": "existing@example.com",
            "name": "Existing User",
            "groups": [],
        },
    })

    existing_user = SimpleNamespace(
        id=2, name="Existing User", email="existing@example.com",
        oidc_subject="oidc-sub-456", role="admin",
        program_rel=None, program_id=None, last_access=None,
    )

    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = existing_user

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = True
        mock_settings.oidc_trust_email = False
        mock_settings.oidc_post_login_redirect = "http://localhost:3000"
        mock_settings.cors_origins = "*"
        with patch("app.routers.oidc.oauth") as mock_oauth:
            mock_oauth.create_client.return_value = mock_client
            with patch("app.routers.oidc.create_access_token", return_value="jwt-token"):
                result = await oidc_callback(request, db)

    assert result.status_code == 200


async def test_oidc_callback_subject_mismatch() -> None:
    request = MagicMock()
    mock_client = AsyncMock()
    mock_client.authorize_access_token = AsyncMock(return_value={
        "userinfo": {
            "sub": "new-sub",
            "email": "user@example.com",
            "name": "User",
            "groups": [],
            "email_verified": True,
        },
    })

    # First query (by oidc_subject) returns nothing
    mock_result_empty = MagicMock()
    mock_result_empty.scalars.return_value.first.return_value = None

    # Second query (by email) returns user with different oidc_subject
    existing_user = SimpleNamespace(
        id=2, name="User", email="user@example.com",
        oidc_subject="different-sub", role="student",
        program_rel=None, program_id=None,
    )
    mock_result_found = MagicMock()
    mock_result_found.scalars.return_value.first.return_value = existing_user

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[mock_result_empty, mock_result_found])

    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = True
        mock_settings.oidc_trust_email = True
        mock_settings.oidc_post_login_redirect = "http://localhost:3000"
        mock_settings.cors_origins = "*"
        with patch("app.routers.oidc.oauth") as mock_oauth:
            mock_oauth.create_client.return_value = mock_client
            resp = await oidc_callback(request, db)
    _assert_oidc_error_redirect(resp, "subject_mismatch", "http://localhost:3000")


async def test_oidc_callback_no_redirect_configured() -> None:
    request = MagicMock()
    mock_client = AsyncMock()
    mock_client.authorize_access_token = AsyncMock(return_value={
        "userinfo": {
            "sub": "oidc-sub-789",
            "email": "user@example.com",
            "name": "User",
            "groups": [],
        },
    })

    existing_user = SimpleNamespace(
        id=1, name="User", email="user@example.com",
        oidc_subject="oidc-sub-789", role="student",
        program_rel=None, program_id=None, last_access=None,
    )

    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = existing_user

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = True
        mock_settings.oidc_trust_email = False
        mock_settings.oidc_post_login_redirect = ""
        mock_settings.cors_origins = "*"
        with patch("app.routers.oidc.oauth") as mock_oauth:
            mock_oauth.create_client.return_value = mock_client
            with patch("app.routers.oidc.create_access_token", return_value="jwt"):
                with pytest.raises(HTTPException) as exc:
                    await oidc_callback(request, db)
                assert exc.value.status_code == 500


async def test_oidc_callback_userinfo_fallback() -> None:
    """When token_data has no userinfo, falls back to userinfo endpoint."""
    request = MagicMock()
    mock_client = AsyncMock()
    # No userinfo in token_data
    mock_client.authorize_access_token = AsyncMock(return_value={})

    # Fallback userinfo endpoint
    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "sub": "oidc-sub-fallback",
        "email": "fallback@example.com",
        "name": "Fallback User",
        "groups": [],
    }
    mock_client.get = AsyncMock(return_value=mock_resp)

    mock_result_empty = MagicMock()
    mock_result_empty.scalars.return_value.first.return_value = None

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result_empty)
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.commit = AsyncMock()

    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = True
        mock_settings.oidc_trust_email = False
        mock_settings.oidc_post_login_redirect = "http://localhost:3000"
        mock_settings.cors_origins = "*"
        with patch("app.routers.oidc.oauth") as mock_oauth:
            mock_oauth.create_client.return_value = mock_client
            with patch("app.routers.oidc.create_access_token", return_value="jwt"):
                result = await oidc_callback(request, db)

    assert result.status_code == 200


async def test_oidc_callback_userinfo_fallback_failure() -> None:
    """When both token_data userinfo and fallback endpoint fail, redirect
    to the frontend with ``#oidc_error=userinfo_failed``."""
    request = MagicMock()
    mock_client = AsyncMock()
    mock_client.authorize_access_token = AsyncMock(return_value={})
    mock_client.get = AsyncMock(side_effect=Exception("userinfo failed"))

    db = AsyncMock()

    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = True
        mock_settings.oidc_post_login_redirect = "http://localhost:3000"
        mock_settings.cors_origins = "*"
        with patch("app.routers.oidc.oauth") as mock_oauth:
            mock_oauth.create_client.return_value = mock_client
            resp = await oidc_callback(request, db)
    _assert_oidc_error_redirect(resp, "userinfo_failed", "http://localhost:3000")


async def test_oidc_callback_email_linking_with_trusted_email() -> None:
    """When trust_email is True, links by email for first-time OIDC login."""
    request = MagicMock()
    mock_client = AsyncMock()
    mock_client.authorize_access_token = AsyncMock(return_value={
        "userinfo": {
            "sub": "new-oidc-sub",
            "email": "user@example.com",
            "name": "User",
            "groups": [],
        },
    })

    # First query (by oidc_subject) returns nothing
    mock_result_empty = MagicMock()
    mock_result_empty.scalars.return_value.first.return_value = None

    # Second query (by email) returns existing user without oidc_subject
    existing_user = SimpleNamespace(
        id=2, name="User", email="user@example.com",
        oidc_subject=None, role="student",
        program_rel=None, program_id=None, last_access=None,
    )
    mock_result_found = MagicMock()
    mock_result_found.scalars.return_value.first.return_value = existing_user

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[mock_result_empty, mock_result_found])
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = True
        mock_settings.oidc_trust_email = True
        mock_settings.oidc_post_login_redirect = "http://localhost:3000"
        mock_settings.cors_origins = "*"
        with patch("app.routers.oidc.oauth") as mock_oauth:
            mock_oauth.create_client.return_value = mock_client
            with patch("app.routers.oidc.create_access_token", return_value="jwt"):
                result = await oidc_callback(request, db)

    assert result.status_code == 200
    assert existing_user.oidc_subject == "new-oidc-sub"


async def test_oidc_callback_role_resolved_from_groups() -> None:
    """Role mapping from groups updates existing user's role."""
    request = MagicMock()
    mock_client = AsyncMock()
    mock_client.authorize_access_token = AsyncMock(return_value={
        "userinfo": {
            "sub": "oidc-sub-admin",
            "email": "admin@example.com",
            "name": "Admin",
            "groups": ["admin-group"],
        },
    })

    existing_user = SimpleNamespace(
        id=1, name="Admin", email="admin@example.com",
        oidc_subject="oidc-sub-admin", role="student",
        program_rel=None, program_id=None, last_access=None,
    )

    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = existing_user

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = True
        mock_settings.oidc_trust_email = False
        mock_settings.oidc_post_login_redirect = "http://localhost:3000"
        mock_settings.cors_origins = "*"
        mock_settings.oidc_role_mapping = '{"admin-group": "admin"}'
        with patch("app.routers.oidc.oauth") as mock_oauth:
            mock_oauth.create_client.return_value = mock_client
            with patch("app.routers.oidc.create_access_token", return_value="jwt"):
                result = await oidc_callback(request, db)

    assert existing_user.role == "admin"


async def test_oidc_callback_cors_origin_fallback() -> None:
    """When oidc_post_login_redirect is empty, uses first non-wildcard CORS origin."""
    request = MagicMock()
    mock_client = AsyncMock()
    mock_client.authorize_access_token = AsyncMock(return_value={
        "userinfo": {
            "sub": "oidc-sub-cors",
            "email": "cors@example.com",
            "name": "User",
            "groups": [],
        },
    })

    existing_user = SimpleNamespace(
        id=1, name="User", email="cors@example.com",
        oidc_subject="oidc-sub-cors", role="student",
        program_rel=None, program_id=None, last_access=None,
    )

    mock_result = MagicMock()
    mock_result.scalars.return_value.first.return_value = existing_user

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = True
        mock_settings.oidc_trust_email = False
        mock_settings.oidc_post_login_redirect = ""
        mock_settings.cors_origins = "http://frontend.example.com, *"
        with patch("app.routers.oidc.oauth") as mock_oauth:
            mock_oauth.create_client.return_value = mock_client
            with patch("app.routers.oidc.create_access_token", return_value="jwt"):
                result = await oidc_callback(request, db)

    assert result.status_code == 200
    assert "frontend.example.com" in result.body.decode()
