"""JWT authentication and RBAC utilities."""

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .database import Settings, get_db
from .models import User

logger = logging.getLogger(__name__)


class AuthSettings(Settings):
    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440  # 24 hours
    # Per-instance epoch embedded in JWTs as a private ``_epoch`` claim.
    # When left empty a random value is generated at startup, which
    # automatically invalidates tokens from a previous container instance
    # (e.g. after ``docker compose down -v``).  For multi-worker /
    # multi-replica production deployments set this to a shared value so
    # all workers accept each other's tokens; rotate the value when you
    # want to force all users to re-authenticate.
    jwt_instance_epoch: str = ""


_auth_settings: AuthSettings | None = None


def _get_auth_settings() -> AuthSettings:
    """Return the singleton ``AuthSettings``, creating it on first call.

    Lazy initialisation avoids reading environment variables and generating
    an ephemeral JWT secret at module import time, which lets unit tests
    import this module without triggering side effects.
    """
    global _auth_settings
    if _auth_settings is None:
        _auth_settings = AuthSettings()
        # Generate a random secret on each backend startup so that tokens from
        # a previous container instance (e.g. after ``docker compose down -v``)
        # are automatically invalidated.  An explicit ``JWT_SECRET`` env-var
        # still takes precedence for production deployments that need stable
        # tokens.
        explicit_secret = bool(_auth_settings.jwt_secret)
        if not explicit_secret:
            _auth_settings.jwt_secret = secrets.token_urlsafe(32)
            logger.warning(
                "No JWT_SECRET configured — using an ephemeral random secret. "
                "Sessions will not survive restarts and tokens will not be valid "
                "across multiple replicas. Set the JWT_SECRET environment variable "
                "for production deployments.",
                extra={"event": "auth.jwt_secret_missing"},
            )
        if not _auth_settings.jwt_instance_epoch:
            _auth_settings.jwt_instance_epoch = secrets.token_urlsafe(16)
            if explicit_secret:
                logger.warning(
                    "No JWT_INSTANCE_EPOCH configured — using an ephemeral random epoch. "
                    "Sessions will not survive restarts even though JWT_SECRET is set. "
                    "Set the JWT_INSTANCE_EPOCH environment variable for production "
                    "deployments that need stable sessions across restarts/replicas.",
                    extra={"event": "auth.jwt_instance_epoch_missing"},
                )
    return _auth_settings


class _LazyAuthSettings:
    """Proxy so ``auth_settings.X`` still works without eager instantiation."""
    def __getattr__(self, name: str):
        return getattr(_get_auth_settings(), name)
    def __setattr__(self, name: str, value):
        setattr(_get_auth_settings(), name, value)


auth_settings = _LazyAuthSettings()

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


# ── Password helpers ─────────────────────────────────────

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# ── JWT helpers ──────────────────────────────────────────

def create_access_token(user: User) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=auth_settings.jwt_expire_minutes)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role,
        "exp": expire,
        "_epoch": auth_settings.jwt_instance_epoch,
    }
    return jwt.encode(payload, auth_settings.jwt_secret, algorithm=auth_settings.jwt_algorithm)


async def _get_user_from_token(
    token: str, db: AsyncSession
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(
            token, auth_settings.jwt_secret, algorithms=[auth_settings.jwt_algorithm]
        )
        # Reject scoped tokens (e.g. file-export JWTs) from being used
        # as general-purpose Bearer tokens.
        if payload.get("purpose") is not None:
            raise credentials_exception
        # Reject tokens minted by a different backend instance.  This
        # ensures that after a ``docker compose down -v`` cycle (which
        # recreates the DB with the same seed user IDs), stale JWTs from
        # the previous instance are not accepted.
        if payload.get("_epoch") != auth_settings.jwt_instance_epoch:
            raise credentials_exception
        user_id_str: str | None = payload.get("sub")
        if user_id_str is None:
            raise credentials_exception
        user_id = int(user_id_str)
    except (JWTError, ValueError):
        raise credentials_exception

    user = await db.get(User, user_id)
    if user is None:
        raise credentials_exception
    return user


# ── FastAPI dependencies ─────────────────────────────────

async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Dependency: require a valid JWT and return the authenticated User."""
    return await _get_user_from_token(token, db)


def require_role(*allowed_roles: str):
    """Return a dependency that checks the current user has one of the allowed roles."""

    async def _check(
        current_user: Annotated[User, Depends(get_current_user)],
    ) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{current_user.role}' is not permitted for this action",
            )
        return current_user

    return _check
