"""OIDC / OAuth 2.0 authentication endpoints.

Provides ``/api/auth/oidc/login`` (redirect to IdP) and
``/api/auth/oidc/callback`` (exchange code, upsert user, issue JWT).
"""

import html as _html
import json
import logging
from datetime import datetime, timezone

import httpx
from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import create_access_token
from ..database import get_db, settings as _settings
from ..models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/oidc", tags=["auth-oidc"])

# ── OIDC provider bootstrap ─────────────────────────────

oauth = OAuth()

if _settings.oidc_enabled:
    oauth.register(
        name="oidc",
        client_id=_settings.oidc_client_id,
        client_secret=_settings.oidc_client_secret,
        server_metadata_url=f"{_settings.oidc_issuer.rstrip('/')}/.well-known/openid-configuration",
        client_kwargs={"scope": _settings.oidc_scopes},
    )


def _parse_role_mapping() -> dict[str, str]:
    """Return the IdP-group → HRIV-role mapping from settings."""
    try:
        mapping = json.loads(_settings.oidc_role_mapping)
        if isinstance(mapping, dict):
            return {str(k): str(v) for k, v in mapping.items()}
    except (json.JSONDecodeError, TypeError):
        logger.warning(
            "Invalid OIDC_ROLE_MAPPING — falling back to empty mapping",
            extra={"event": "oidc.role_mapping_invalid"},
        )
    return {}


def _resolve_role(groups: list[str]) -> str | None:
    """Map IdP groups/claims to a HRIV role.

    The first matching group in the mapping wins.  Returns ``None`` when
    no group matched any mapping entry so callers can distinguish
    "no mapping available" from an explicit role assignment.
    """
    mapping = _parse_role_mapping()
    for group in groups:
        if group in mapping:
            role = mapping[group]
            if role in ("admin", "instructor", "student"):
                return role
    return None


def _ensure_oidc_enabled() -> None:
    if not _settings.oidc_enabled:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="OIDC authentication is not enabled",
        )


def _resolve_frontend_origin() -> str:
    """Return the configured frontend origin, or empty string.

    Prefer ``oidc_post_login_redirect``; fall back to the first
    non-wildcard entry in ``cors_origins``. Returns ``""`` when nothing
    is configured (caller must handle this — we can't build a redirect
    without somewhere to redirect to).
    """
    origin = _settings.oidc_post_login_redirect
    if origin:
        return origin
    origins = [o.strip() for o in _settings.cors_origins.split(",") if o.strip()]
    return next((o for o in origins if o != "*"), "")


def _fragment_redirect(origin: str, fragment: str) -> HTMLResponse:
    """Return an HTML page that client-side redirects to
    ``{origin}/#{fragment}``.

    We deliver the payload via a URL fragment (never a query string) so
    it does not land in access logs, and we use a client-side redirect
    rather than HTTP 302 because some proxies strip the fragment from
    ``Location`` headers.
    """
    target_url = f"{origin.rstrip('/')}/#{fragment}"
    body = (
        '<!DOCTYPE html>'
        '<html><head><meta charset="utf-8"><title>Signing in\u2026</title></head>'
        '<body><p>Signing in\u2026</p>'
        '<script>window.location.replace('
        + json.dumps(target_url).replace('<', '\\u003c')
        + ');</script>'
        '<noscript><p>JavaScript is required. '
        '<a href="' + _html.escape(origin.rstrip('/'), quote=True) + '/">Return to application</a>'
        '</p></noscript></body></html>'
    )
    return HTMLResponse(
        content=body,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, private",
            "Pragma": "no-cache",
        },
    )


# Short, stable, URL-safe error codes the frontend can recognise.
# These are intentionally NOT user-facing error messages — the frontend
# maps them to localised strings.
_OIDC_ERR_CLIENT_MISCONFIGURED = "client_misconfigured"
_OIDC_ERR_PROVIDER_UNREACHABLE = "provider_unreachable"
_OIDC_ERR_TOKEN_EXCHANGE_FAILED = "token_exchange_failed"
_OIDC_ERR_USERINFO_FAILED = "userinfo_failed"
_OIDC_ERR_MISSING_CLAIMS = "missing_claims"
_OIDC_ERR_SUBJECT_MISMATCH = "subject_mismatch"


def _oidc_callback_error(error_code: str, *, log_detail: str) -> HTMLResponse:
    """Redirect the browser to the frontend with ``#oidc_error=<code>``.

    Falling back to ``HTTPException`` when no frontend origin is
    configured would leave the user staring at raw JSON on the backend
    domain; instead we still raise a plain HTTPException in that narrow
    case so an operator can diagnose the missing configuration.
    """
    origin = _resolve_frontend_origin()
    if not origin:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "OIDC post-login redirect is not configured. "
                "Set OIDC_POST_LOGIN_REDIRECT or a non-wildcard CORS_ORIGINS. "
                f"Underlying error: {log_detail}"
            ),
        )
    return _fragment_redirect(origin, f"oidc_error={error_code}")


# ── Public endpoint: is OIDC available? ──────────────────

@router.get("/enabled")
async def oidc_enabled():
    """Return whether OIDC login is configured and enabled."""
    return {"enabled": _settings.oidc_enabled}


# ── Step 1: redirect to IdP ─────────────────────────────

@router.get("/login")
async def oidc_login(request: Request):
    """Redirect the browser to the IdP authorization endpoint."""
    _ensure_oidc_enabled()
    client = oauth.create_client("oidc")
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OIDC client not configured",
        )
    redirect_uri = _settings.oidc_redirect_uri
    try:
        return await client.authorize_redirect(request, redirect_uri)
    except (httpx.ConnectError, httpx.TimeoutException):
        metadata_url = f"{_settings.oidc_issuer.rstrip('/')}/.well-known/openid-configuration"
        logger.error(
            "Cannot reach OIDC provider to fetch metadata — "
            "verify that the backend pod can connect to the issuer URL",
            extra={
                "event": "oidc.provider_unreachable",
                "metadata_url": metadata_url,
                "issuer": _settings.oidc_issuer,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Login is temporarily unavailable — the identity provider cannot be reached.",
        )


# ── Step 2: handle callback from IdP ────────────────────

@router.get("/callback")
async def oidc_callback(request: Request, db: AsyncSession = Depends(get_db)):
    """Exchange the authorization code for tokens, upsert the user, and
    redirect to the frontend with a JWT."""
    _ensure_oidc_enabled()
    client = oauth.create_client("oidc")
    if client is None:
        return _oidc_callback_error(
            _OIDC_ERR_CLIENT_MISCONFIGURED,
            log_detail="oauth.create_client('oidc') returned None",
        )

    try:
        token_data = await client.authorize_access_token(request)
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        logger.error(
            "Cannot reach OIDC provider during token exchange — "
            "verify that the backend pod can connect to the issuer URL",
            extra={
                "event": "oidc.provider_unreachable",
                "issuer": _settings.oidc_issuer,
            },
        )
        return _oidc_callback_error(
            _OIDC_ERR_PROVIDER_UNREACHABLE, log_detail=str(exc)
        )
    except Exception as exc:
        logger.error(
            "OIDC token exchange failed",
            extra={"event": "oidc.token_exchange_failed", "error": str(exc)},
        )
        return _oidc_callback_error(
            _OIDC_ERR_TOKEN_EXCHANGE_FAILED, log_detail=str(exc)
        )

    # Extract user info — authlib's authorize_access_token already parses
    # the ID token and populates token_data["userinfo"] when available.
    userinfo = token_data.get("userinfo")

    # Log the raw token keys and userinfo for debugging IdP claim issues.
    _token_keys = sorted(k for k in token_data if k != "userinfo")
    logger.info(
        "OIDC token exchange succeeded",
        extra={
            "event": "oidc.token_received",
            "token_keys": _token_keys,
            "userinfo_present": userinfo is not None,
            "userinfo_claims": sorted(userinfo.keys()) if userinfo and hasattr(userinfo, "keys") else None,
        },
    )

    if userinfo is None:
        # Fall back to the userinfo endpoint
        try:
            resp = await client.get("userinfo", token=token_data)
            userinfo = resp.json()
            logger.info(
                "OIDC userinfo fallback succeeded",
                extra={
                    "event": "oidc.userinfo_fallback",
                    "claims": sorted(userinfo.keys()) if hasattr(userinfo, "keys") else None,
                },
            )
        except Exception as exc:
            logger.error(
                "OIDC userinfo endpoint fallback failed",
                extra={"event": "oidc.userinfo_fallback_failed", "error": str(exc)},
            )
            return _oidc_callback_error(
                _OIDC_ERR_USERINFO_FAILED, log_detail=str(exc)
            )

    sub: str = userinfo.get("sub", "")
    email: str = userinfo.get("email", "")
    name: str = userinfo.get("name") or userinfo.get("preferred_username") or email

    if not sub or not email:
        # Log all available claim keys so admins can diagnose IdP template
        # configuration issues without needing to decode the raw ID token.
        _available = sorted(userinfo.keys()) if hasattr(userinfo, "keys") else []
        logger.warning(
            "OIDC callback missing required claims",
            extra={
                "event": "oidc.missing_claims",
                "sub": sub,
                "email": email,
                "display_name": name,
                "available_claims": _available,
                "hint": "Ensure the IdP OIDC scope templates include 'email' "
                        "and 'sub' claims. For Vault, check that "
                        "vault_identity_oidc_scope resources exist for 'email' "
                        "and 'profile', and that the provider's "
                        "scopes_supported includes them.",
            },
        )
        return _oidc_callback_error(
            _OIDC_ERR_MISSING_CLAIMS,
            log_detail=f"sub={bool(sub)} email={bool(email)}",
        )

    # Resolve role from IdP groups — None means no group matched a mapping
    groups: list[str] = userinfo.get("groups", [])
    resolved_role = _resolve_role(groups)

    # Upsert: find by oidc_subject first, then by email
    result = await db.execute(
        select(User)
        .options(selectinload(User.program_rel))
        .where(User.oidc_subject == sub)
    )
    user = result.scalars().first()

    if user is None:
        # Try matching by email for first-time OIDC login by an existing user.
        # Only allow email-based linking when the IdP confirms the email is
        # verified; this prevents account takeover via unverified addresses on
        # less restrictive IdPs.
        email_verified = _settings.oidc_trust_email or userinfo.get("email_verified", False)
        if email_verified:
            result = await db.execute(
                select(User)
                .options(selectinload(User.program_rel))
                .where(User.email == email)
            )
            user = result.scalars().first()
        else:
            logger.info(
                "OIDC: skipping email-based account linking (email not verified)",
                extra={"event": "oidc.email_not_verified", "email": email, "sub": sub},
            )

    if user is None:
        # Brand-new user — create account (default to student if no mapping matched)
        user = User(
            name=name,
            email=email,
            oidc_subject=sub,
            role=resolved_role or "student",
            last_access=datetime.now(timezone.utc),
        )
        db.add(user)
        await db.flush()
        await db.refresh(user, ["program_rel"])
        logger.info(
            "OIDC: created new user",
            extra={
                "event": "oidc.user_created",
                "user_id": user.id,
                "email": email,
                "role": resolved_role or "student",
            },
        )
    else:
        # Existing user — reject if already linked to a *different* OIDC identity
        if user.oidc_subject and user.oidc_subject != sub:
            logger.warning(
                "OIDC subject mismatch for email-matched user",
                extra={
                    "event": "oidc.subject_mismatch",
                    "email": email,
                    "existing_sub": user.oidc_subject,
                    "incoming_sub": sub,
                },
            )
            return _oidc_callback_error(
                _OIDC_ERR_SUBJECT_MISMATCH,
                log_detail=f"email={email} existing_sub≠incoming_sub",
            )
        if not user.oidc_subject:
            user.oidc_subject = sub
        # Only update role when a group actually matched a mapping entry;
        # this preserves admin-assigned promotions when the IdP sends
        # unrecognised groups or no groups at all.
        if resolved_role is not None:
            user.role = resolved_role
        user.last_access = datetime.now(timezone.utc)
        logger.info(
            "OIDC: logged in existing user",
            extra={
                "event": "oidc.login_success",
                "user_id": user.id,
                "email": email,
                "role": resolved_role,
            },
        )

    await db.commit()
    await db.refresh(user)

    jwt_token = create_access_token(user)

    # Redirect to the frontend with the JWT so AuthContext can bootstrap
    # the session.  Use the dedicated setting if provided; otherwise fall
    # back to the first non-wildcard CORS origin.
    frontend_origin = _resolve_frontend_origin()
    if not frontend_origin:
        logger.error(
            "OIDC post-login redirect target not configured",
            extra={"event": "oidc.redirect_missing"},
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OIDC post-login redirect is not configured. "
                   "Set OIDC_POST_LOGIN_REDIRECT or a non-wildcard CORS_ORIGINS.",
        )
    return _fragment_redirect(
        frontend_origin, f"oidc_token={jwt_token}"
    )
