"""Authentication endpoints."""

import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import verify_password, create_access_token, get_current_user
from ..database import get_db
from ..models import User
from ..schemas import UserOut

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
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Authenticate with email + password. Returns a JWT bearer token."""
    result = await db.execute(
        select(User).options(selectinload(User.program_rel)).where(User.email == body.email)
    )
    user = result.scalars().first()

    if not user or not user.password_hash:
        logger.warning(
            "Login failed: unknown email or no password set",
            extra={"event": "auth.login_failed", "user_email": body.email},
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
            },
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    user.last_access = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(user)

    logger.info(
        "Login successful",
        extra={
            "event": "auth.login_success",
            "user_id": user.id,
            "user_email": user.email,
        },
    )

    token = create_access_token(user)
    user_data = {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "program_id": user.program_id,
        "program_name": user.program_rel.name if user.program_rel else None,
        "metadata_extra": user.metadata_,
        "last_access": user.last_access,
        "created_at": user.created_at,
        "updated_at": user.updated_at,
    }
    return LoginResponse(
        access_token=token,
        user=UserOut(**user_data),
    )


@router.get("/me", response_model=UserOut)
async def get_me(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the currently authenticated user. Any role can access this."""
    await db.refresh(current_user, ["program_rel"])
    return UserOut(
        id=current_user.id,
        name=current_user.name,
        email=current_user.email,
        role=current_user.role,
        program_id=current_user.program_id,
        program_name=current_user.program_rel.name if current_user.program_rel else None,
        metadata_extra=current_user.metadata_,
        last_access=current_user.last_access,
        created_at=current_user.created_at,
        updated_at=current_user.updated_at,
    )
