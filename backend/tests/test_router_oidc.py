"""Tests for the OIDC router helper functions and endpoints."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import HTTPException

from fastapi.responses import HTMLResponse

from app.routers.oidc import (
    _parse_role_mapping, _resolve_role, _resolve_programs, _sync_programs,
    _ensure_oidc_enabled,
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


def test_resolve_role_highest_priority_wins() -> None:
    with patch("app.routers.oidc._parse_role_mapping", return_value={"a": "admin", "b": "student"}):
        # admin > student regardless of token order
        assert _resolve_role(["a", "b"]) == "admin"
        assert _resolve_role(["b", "a"]) == "admin"


def test_resolve_role_priority_across_multiple_groups() -> None:
    """Users in multiple mapped groups get the highest-privilege role."""
    mapping = {"employees": "student", "instructors": "instructor", "admins": "admin"}
    with patch("app.routers.oidc._parse_role_mapping", return_value=mapping):
        # admin wins even when listed last
        assert _resolve_role(["employees", "instructors", "admins"]) == "admin"
        # instructor beats student
        assert _resolve_role(["employees", "instructors"]) == "instructor"
        # only student
        assert _resolve_role(["employees"]) == "student"


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
            "email": "new@example.ca",
            "name": "New User",
            "groups": [],
        },
    })

    # User not found by oidc_subject
    mock_result_empty = MagicMock()
    mock_result_empty.scalars.return_value.first.return_value = None

    new_user = SimpleNamespace(
        id=1, name="New User", email="new@example.ca",
        oidc_subject="oidc-sub-123", role="student",
        programs=[], metadata_=None,
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
            "email": "existing@example.ca",
            "name": "Existing User",
            "groups": [],
        },
    })

    existing_user = SimpleNamespace(
        id=2, name="Existing User", email="existing@example.ca",
        oidc_subject="oidc-sub-456", role="admin",
        programs=[], last_access=None, metadata_=None,
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
            "email": "user@example.ca",
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
        id=2, name="User", email="user@example.ca",
        oidc_subject="different-sub", role="student",
        programs=[], metadata_=None,
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
            "email": "user@example.ca",
            "name": "User",
            "groups": [],
        },
    })

    existing_user = SimpleNamespace(
        id=1, name="User", email="user@example.ca",
        oidc_subject="oidc-sub-789", role="student",
        programs=[], last_access=None, metadata_=None,
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
        "email": "fallback@example.ca",
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
            "email": "user@example.ca",
            "name": "User",
            "groups": [],
        },
    })

    # First query (by oidc_subject) returns nothing
    mock_result_empty = MagicMock()
    mock_result_empty.scalars.return_value.first.return_value = None

    # Second query (by email) returns existing user without oidc_subject
    existing_user = SimpleNamespace(
        id=2, name="User", email="user@example.ca",
        oidc_subject=None, role="student",
        programs=[], last_access=None, metadata_=None,
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


async def test_oidc_callback_email_linking_case_insensitive() -> None:
    """Email matching for first-time OIDC login is case-insensitive."""
    request = MagicMock()
    mock_client = AsyncMock()
    mock_client.authorize_access_token = AsyncMock(return_value={
        "userinfo": {
            "sub": "new-oidc-sub",
            "email": "kyle_hunter@bcit.ca",  # lowercase from IdP
            "name": "Kyle Hunter",
            "groups": [],
        },
    })

    # First query (by oidc_subject) returns nothing
    mock_result_empty = MagicMock()
    mock_result_empty.scalars.return_value.first.return_value = None

    # Second query (case-insensitive email) returns existing user with mixed-case email
    existing_user = SimpleNamespace(
        id=2, name="Kyle Hunter", email="Kyle_Hunter@bcit.ca",
        oidc_subject=None, role="admin",
        programs=[], last_access=None, metadata_=None,
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
        mock_settings.oidc_role_mapping = "{}"
        with patch("app.routers.oidc.oauth") as mock_oauth:
            mock_oauth.create_client.return_value = mock_client
            with patch("app.routers.oidc.create_access_token", return_value="jwt"):
                result = await oidc_callback(request, db)

    assert result.status_code == 200
    assert existing_user.oidc_subject == "new-oidc-sub"
    # Existing admin role preserved (no group matched, so role stays)
    assert existing_user.role == "admin"


async def test_oidc_callback_role_resolved_from_groups() -> None:
    """Role mapping from groups updates existing user's role."""
    request = MagicMock()
    mock_client = AsyncMock()
    mock_client.authorize_access_token = AsyncMock(return_value={
        "userinfo": {
            "sub": "oidc-sub-admin",
            "email": "admin@example.ca",
            "name": "Admin",
            "groups": ["admin-group"],
        },
    })

    existing_user = SimpleNamespace(
        id=1, name="Admin", email="admin@example.ca",
        oidc_subject="oidc-sub-admin", role="student",
        programs=[], last_access=None, metadata_=None,
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
            "email": "cors@example.ca",
            "name": "User",
            "groups": [],
        },
    })

    existing_user = SimpleNamespace(
        id=1, name="User", email="cors@example.ca",
        oidc_subject="oidc-sub-cors", role="student",
        programs=[], last_access=None, metadata_=None,
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


# ── _resolve_programs / _sync_programs helpers ───────────


async def test_resolve_programs_returns_matching() -> None:
    """_resolve_programs queries programs whose oidc_group is in groups."""
    prog_a = SimpleNamespace(id=1, name="MRAD", oidc_group="mrad-group")
    prog_b = SimpleNamespace(id=2, name="MLT", oidc_group="mlt-group")

    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [prog_a, prog_b]

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    result = await _resolve_programs(db, ["mrad-group", "mlt-group"])
    assert result == [prog_a, prog_b]
    db.execute.assert_called_once()


async def test_resolve_programs_empty_groups() -> None:
    """_resolve_programs short-circuits on empty groups list."""
    db = AsyncMock()
    result = await _resolve_programs(db, [])
    assert result == []
    db.execute.assert_not_called()


def test_sync_programs_merges_oidc_and_manual() -> None:
    """_sync_programs returns OIDC programs + manually-assigned programs."""
    oidc_prog = SimpleNamespace(id=1, name="MRAD", oidc_group="mrad-group")
    manual_prog = SimpleNamespace(id=2, name="Custom", oidc_group=None)
    old_oidc_prog = SimpleNamespace(id=3, name="MLT", oidc_group="mlt-group")

    user = SimpleNamespace(programs=[manual_prog, old_oidc_prog])
    result = _sync_programs(user, [oidc_prog])

    ids = {p.id for p in result}
    assert ids == {1, 2}


def test_sync_programs_no_oidc_keeps_manual() -> None:
    """When no OIDC programs matched, manual assignments are preserved."""
    manual_prog = SimpleNamespace(id=1, name="Custom", oidc_group=None)
    user = SimpleNamespace(programs=[manual_prog])

    result = _sync_programs(user, [])
    assert len(result) == 1
    assert result[0].id == 1


def test_sync_programs_no_duplicates() -> None:
    """If an OIDC program is already manually assigned, no duplicates."""
    prog = SimpleNamespace(id=1, name="MRAD", oidc_group="mrad-group")
    user = SimpleNamespace(programs=[prog])

    result = _sync_programs(user, [prog])
    assert len(result) == 1
    assert result[0].id == 1


# ── OIDC callback with program sync ─────────────────────


async def test_oidc_callback_new_user_with_programs() -> None:
    """New user created via OIDC gets programs from group claims."""
    request = MagicMock()
    mock_client = AsyncMock()
    mock_client.authorize_access_token = AsyncMock(return_value={
        "userinfo": {
            "sub": "oidc-sub-prog-new",
            "email": "newprog@example.ca",
            "name": "New Prog User",
            "groups": ["mrad-group"],
        },
    })

    prog = SimpleNamespace(id=10, name="MRAD", oidc_group="mrad-group")

    # First execute: user lookup by oidc_subject → None
    mock_user_empty = MagicMock()
    mock_user_empty.scalars.return_value.first.return_value = None

    # Second execute: _resolve_programs → [prog]
    mock_prog_result = MagicMock()
    mock_prog_result.scalars.return_value.all.return_value = [prog]

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[mock_user_empty, mock_prog_result])
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()

    captured_user = None

    async def mock_refresh(user, attrs=None):
        nonlocal captured_user
        captured_user = user
        if attrs:
            user.programs = []

    db.refresh = AsyncMock(side_effect=mock_refresh)

    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = True
        mock_settings.oidc_trust_email = False
        mock_settings.oidc_post_login_redirect = "http://localhost:3000"
        mock_settings.cors_origins = "*"
        mock_settings.oidc_role_mapping = "{}"
        with patch("app.routers.oidc.oauth") as mock_oauth:
            mock_oauth.create_client.return_value = mock_client
            with patch("app.routers.oidc.create_access_token", return_value="jwt"):
                result = await oidc_callback(request, db)

    assert result.status_code == 200
    assert captured_user is not None
    assert [p.id for p in captured_user.programs] == [10]


async def test_oidc_callback_existing_user_program_sync() -> None:
    """Existing user's programs are synced from OIDC groups on login."""
    request = MagicMock()
    mock_client = AsyncMock()
    mock_client.authorize_access_token = AsyncMock(return_value={
        "userinfo": {
            "sub": "oidc-sub-sync",
            "email": "sync@example.ca",
            "name": "Sync User",
            "groups": ["mrad-group"],
        },
    })

    oidc_prog = SimpleNamespace(id=10, name="MRAD", oidc_group="mrad-group")
    manual_prog = SimpleNamespace(id=20, name="Custom", oidc_group=None)
    old_oidc_prog = SimpleNamespace(id=30, name="MLT", oidc_group="mlt-group")

    existing_user = SimpleNamespace(
        id=5, name="Sync User", email="sync@example.ca",
        oidc_subject="oidc-sub-sync", role="student",
        programs=[manual_prog, old_oidc_prog], last_access=None, metadata_=None,
    )

    # First execute: user lookup → existing_user
    mock_user_result = MagicMock()
    mock_user_result.scalars.return_value.first.return_value = existing_user

    # Second execute: _resolve_programs → [oidc_prog]
    mock_prog_result = MagicMock()
    mock_prog_result.scalars.return_value.all.return_value = [oidc_prog]

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[mock_user_result, mock_prog_result])
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    with patch("app.routers.oidc._settings") as mock_settings:
        mock_settings.oidc_enabled = True
        mock_settings.oidc_trust_email = False
        mock_settings.oidc_post_login_redirect = "http://localhost:3000"
        mock_settings.cors_origins = "*"
        mock_settings.oidc_role_mapping = "{}"
        with patch("app.routers.oidc.oauth") as mock_oauth:
            mock_oauth.create_client.return_value = mock_client
            with patch("app.routers.oidc.create_access_token", return_value="jwt"):
                result = await oidc_callback(request, db)

    assert result.status_code == 200
    prog_ids = {p.id for p in existing_user.programs}
    # OIDC-derived (10) + manual (20); old OIDC (30) dropped
    assert prog_ids == {10, 20}


async def test_oidc_callback_role_and_program_sync() -> None:
    """Both role and programs are updated from groups on existing user login."""
    request = MagicMock()
    mock_client = AsyncMock()
    mock_client.authorize_access_token = AsyncMock(return_value={
        "userinfo": {
            "sub": "oidc-sub-both",
            "email": "both@example.ca",
            "name": "Both User",
            "groups": ["admin-group", "mrad-group"],
        },
    })

    oidc_prog = SimpleNamespace(id=10, name="MRAD", oidc_group="mrad-group")

    existing_user = SimpleNamespace(
        id=7, name="Both User", email="both@example.ca",
        oidc_subject="oidc-sub-both", role="student",
        programs=[], last_access=None, metadata_=None,
    )

    mock_user_result = MagicMock()
    mock_user_result.scalars.return_value.first.return_value = existing_user

    mock_prog_result = MagicMock()
    mock_prog_result.scalars.return_value.all.return_value = [oidc_prog]

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[mock_user_result, mock_prog_result])
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

    assert result.status_code == 200
    assert existing_user.role == "admin"
    assert [p.id for p in existing_user.programs] == [10]
