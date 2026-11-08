"""Authentication endpoints."""

import logging
import secrets
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from ..auth import verify_password, create_access_token, get_user_from_token, hash_password
from ..auth_events import (
    AUTH_METHOD_LOCAL,
    AUTH_OUTCOME_FAILURE,
    AUTH_OUTCOME_SUCCESS,
    auth_event_fields,
)
from ..database import get_db
from ..models import User
from ..password_tokens import PasswordSetupTokenError, validate_password_setup_token
from ..middleware import get_client_ip
from ..rate_limit import (
    check_login_rate_limit,
    reset_login_rate_limit,
    check_password_setup_ip_rate_limit,
    check_password_setup_subject_rate_limit,
    check_password_change_rate_limit,
)
from ..schemas import UserOut, PasswordSetupRequest, ChangePasswordRequest
from ..serializers import user_to_out

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


@router.post("/login", response_model=LoginResponse)
async def login(
    body: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Authenticate with email + password. Returns a JWT bearer token."""
    # Rate limiting (Phase 5.3)
    client_ip = get_client_ip(request.scope)
    email_lower = body.email.lower()
    retry_after = await check_login_rate_limit(client_ip, email_lower)
    if retry_after is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please try again later.",
            headers={"Retry-After": str(retry_after)},
        )

    result = await db.execute(
        select(User).where(func.lower(User.email) == email_lower)
    )
    user = result.scalars().first()

    if not user or not user.password_hash:
        logger.warning(
            "Login failed: unknown email or no password set",
            extra={
                "event": "auth.login_failed",
                "user_email": body.email,
                **auth_event_fields(
                    method=AUTH_METHOD_LOCAL, outcome=AUTH_OUTCOME_FAILURE
                ),
            },
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not verify_password(body.password, user.password_hash):
        logger.warning(
            "Login failed: invalid password",
            extra={
                "event": "auth.login_failed",
                "user_email": body.email,
                "user_id": user.id,
                **auth_event_fields(
                    method=AUTH_METHOD_LOCAL,
                    outcome=AUTH_OUTCOME_FAILURE,
                    user=user,
                ),
            },
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not user.active:
        logger.warning(
            "Login failed: account inactive",
            extra={
                "event": "auth.login_failed",
                "user_email": body.email,
                "user_id": user.id,
                **auth_event_fields(
                    method=AUTH_METHOD_LOCAL,
                    outcome=AUTH_OUTCOME_FAILURE,
                    user=user,
                ),
            },
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive",
        )

    user.last_access = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(user)

    # Clear rate-limit counter on successful login so legitimate users
    # (especially those behind a shared campus NAT IP) aren't locked out.
    await reset_login_rate_limit(client_ip, email_lower)

    logger.info(
        "Login successful",
        extra={
            "event": "auth.login_success",
            "user_id": user.id,
            "user_email": user.email,
            **auth_event_fields(
                method=AUTH_METHOD_LOCAL,
                outcome=AUTH_OUTCOME_SUCCESS,
                user=user,
            ),
        },
    )

    token = create_access_token(user)
    await db.refresh(user, ["programs", "groups"])
    return LoginResponse(
        access_token=token,
        user=UserOut(**user_to_out(user)),
    )


@router.post("/password-setup", response_model=LoginResponse)
async def password_setup(
    body: PasswordSetupRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    user = None
    try:
        retry_after = await check_password_setup_ip_rate_limit(get_client_ip(request.scope))
        if retry_after is not None:
            raise HTTPException(
                429, "rate_limited", headers={"Retry-After": str(retry_after)}
            )
        try:
            claims = validate_password_setup_token(body.token)
        except PasswordSetupTokenError as exc:
            raise HTTPException(exc.status_code, exc.detail) from None
        retry_after = await check_password_setup_subject_rate_limit(claims["sub"])
        if retry_after is not None:
            raise HTTPException(
                429, "rate_limited", headers={"Retry-After": str(retry_after)}
            )
        result = await db.execute(
            select(User)
            .where(User.id == int(claims["sub"]))
            .with_for_update(of=User)
            .execution_options(populate_existing=True)
        )
        user = result.scalar_one_or_none()
        if user is None:
            raise HTTPException(401, "Invalid or expired password setup token")
        if not user.active:
            raise HTTPException(403, "account_inactive")
        if user.password_hash is not None:
            raise HTTPException(409, "password_already_set")
        if user.oidc_subject is not None:
            raise HTTPException(401, "Invalid or expired password setup token")
        if not user.invite_nonce or not secrets.compare_digest(
            user.invite_nonce, claims["nonce"]
        ):
            raise HTTPException(401, "Invalid or expired password setup token")
        user.password_hash = hash_password(body.password)
        user.invite_nonce = None
        user.must_change_password = False
        user.last_access = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(user)
        await db.refresh(user, ["programs", "groups"])
    except HTTPException as exc:
        logger.warning(
            "Password setup failed",
            extra={
                "event": "auth.password_setup",
                "status_code": exc.status_code,
                **auth_event_fields(
                    method=AUTH_METHOD_LOCAL, outcome=AUTH_OUTCOME_FAILURE, user=user
                ),
            },
        )
        raise
    logger.info(
        "Password setup successful",
        extra={
            "event": "auth.password_setup",
            **auth_event_fields(
                method=AUTH_METHOD_LOCAL, outcome=AUTH_OUTCOME_SUCCESS, user=user
            ),
        },
    )
    return LoginResponse(
        access_token=create_access_token(user), user=UserOut(**user_to_out(user))
    )


@router.post("/change-password", status_code=204)
async def change_password(
    body: ChangePasswordRequest,
    current_user: Annotated[User, Depends(get_user_from_token)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    try:
        if current_user.oidc_subject is not None:
            raise HTTPException(403, "oidc_linked")
        retry_after = await check_password_change_rate_limit(current_user.id)
        if retry_after is not None:
            raise HTTPException(
                429, "rate_limited", headers={"Retry-After": str(retry_after)}
            )
        result = await db.execute(
            select(User)
            .where(User.id == current_user.id)
            .with_for_update(of=User)
            .execution_options(populate_existing=True)
        )
        user = result.scalar_one_or_none()
        if user is None or not user.active:
            raise HTTPException(401, "Invalid or expired token")
        if user.oidc_subject is not None:
            raise HTTPException(403, "oidc_linked")
        if (
            not user.password_hash
            or not body.current_password
            or len(body.current_password.encode("utf-8")) > 72
            or not verify_password(body.current_password, user.password_hash)
        ):
            raise HTTPException(401, "Invalid current password")
        if body.new_password == body.current_password:
            raise HTTPException(422, "password_unchanged")
        user.password_hash = hash_password(body.new_password)
        user.must_change_password = False
        await db.commit()
    except HTTPException as exc:
        logger.warning(
            "Password change failed",
            extra={
                "event": "auth.password_change",
                "status_code": exc.status_code,
                **auth_event_fields(
                    method=AUTH_METHOD_LOCAL,
                    outcome=AUTH_OUTCOME_FAILURE,
                    user=current_user,
                ),
            },
        )
        raise
    logger.info(
        "Password change successful",
        extra={
            "event": "auth.password_change",
            **auth_event_fields(
                method=AUTH_METHOD_LOCAL, outcome=AUTH_OUTCOME_SUCCESS, user=current_user
            ),
        },
    )
    return Response(status_code=204)


@router.get("/me", response_model=UserOut)
async def get_me(
    current_user: Annotated[User, Depends(get_user_from_token)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the currently authenticated user. Any role can access this.

    Includes the caller's group memberships (``group_ids``/``group_names``)
    so the UI can show the user which groups they belong to, alongside their
    program chips.
    """
    await db.refresh(current_user, ["programs", "groups"])
    return UserOut(**user_to_out(current_user))
