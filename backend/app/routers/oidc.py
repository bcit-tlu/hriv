"""OIDC / OAuth 2.0 authentication endpoints.

Provides ``/api/auth/oidc/login`` (redirect to IdP) and
``/api/auth/oidc/callback`` (exchange code, upsert user, issue JWT).
"""

import json
import logging
from datetime import datetime, timezone

import httpx
from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.middleware.sessions import SessionMiddleware  # noqa: F401 — referenced in docs

from ..auth import AuthSettings, create_access_token
from ..database import Settings, get_db
from ..models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/oidc", tags=["auth-oidc"])

_settings = Settings()
_auth_settings = AuthSettings()

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
    """Return the IdP-group → CORGI-role mapping from settings."""
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


def _resolve_role(groups: list[str]) -> str:
    """Map IdP groups/claims to a CORGI role.

    The first matching group in the mapping wins.  Unmapped users default
    to ``student`` as specified in the scalability plan.
    """
    mapping = _parse_role_mapping()
    for group in groups:
        if group in mapping:
            role = mapping[group]
            if role in ("admin", "instructor", "student"):
                return role
    return "student"


def _ensure_oidc_enabled() -> None:
    if not _settings.oidc_enabled:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="OIDC authentication is not enabled",
        )


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
    return await client.authorize_redirect(request, redirect_uri)


# ── Step 2: handle callback from IdP ────────────────────

@router.get("/callback")
async def oidc_callback(request: Request, db: AsyncSession = Depends(get_db)):
    """Exchange the authorization code for tokens, upsert the user, and
    redirect to the frontend with a JWT in the URL fragment."""
    _ensure_oidc_enabled()
    client = oauth.create_client("oidc")
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OIDC client not configured",
        )

    try:
        token_data = await client.authorize_access_token(request)
    except Exception as exc:
        logger.error(
            "OIDC token exchange failed",
            extra={"event": "oidc.token_exchange_failed", "error": str(exc)},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="OIDC authentication failed",
        )

    # Extract user info from the ID token (preferred) or userinfo endpoint
    userinfo = token_data.get("userinfo")
    if userinfo is None and "id_token" in token_data:
        userinfo = await client.parse_id_token(token_data, nonce=request.session.get("_oidc_nonce"))

    if userinfo is None:
        # Fall back to the userinfo endpoint
        try:
            resp = await client.get("userinfo", token=token_data)
            userinfo = resp.json()
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not retrieve user information from IdP",
            )

    sub: str = userinfo.get("sub", "")
    email: str = userinfo.get("email", "")
    name: str = userinfo.get("name") or userinfo.get("preferred_username") or email

    if not sub or not email:
        logger.warning(
            "OIDC callback missing required claims",
            extra={"event": "oidc.missing_claims", "sub": sub, "email": email},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="IdP did not return required claims (sub, email)",
        )

    # Resolve role from IdP groups
    groups: list[str] = userinfo.get("groups", [])
    role = _resolve_role(groups)

    # Upsert: find by oidc_subject first, then by email
    result = await db.execute(
        select(User)
        .options(selectinload(User.program_rel))
        .where(User.oidc_subject == sub)
    )
    user = result.scalars().first()

    if user is None:
        # Try matching by email for first-time OIDC login by an existing user
        result = await db.execute(
            select(User)
            .options(selectinload(User.program_rel))
            .where(User.email == email)
        )
        user = result.scalars().first()

    if user is None:
        # Brand-new user — create account
        user = User(
            name=name,
            email=email,
            oidc_subject=sub,
            role=role,
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
                "role": role,
            },
        )
    else:
        # Existing user — link OIDC subject if not yet linked and update fields
        if not user.oidc_subject:
            user.oidc_subject = sub
        user.name = name
        user.role = role
        user.last_access = datetime.now(timezone.utc)
        logger.info(
            "OIDC: logged in existing user",
            extra={
                "event": "oidc.login_success",
                "user_id": user.id,
                "email": email,
                "role": role,
            },
        )

    await db.commit()
    await db.refresh(user)

    jwt_token = create_access_token(user)

    # Redirect to the frontend with the token and user info in the URL
    # fragment (never sent to the server, safer than query params).
    frontend_origin = _settings.cors_origins.split(",")[0].strip() or ""
    redirect_url = f"{frontend_origin}/?oidc_token={jwt_token}"

    return RedirectResponse(url=redirect_url, status_code=status.HTTP_302_FOUND)
