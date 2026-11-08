"""Purpose-scoped credentials for admin-delivered password setup links."""

from datetime import datetime, timedelta, timezone

import jwt

from .auth import auth_settings
from .models import User

PASSWORD_SETUP_PURPOSE = "password_setup"


class PasswordSetupTokenError(Exception):
    status_code = 401
    detail = "Invalid or expired password setup token"


def issue_password_setup_token(user: User, nonce: str) -> str:
    expires = datetime.now(timezone.utc) + timedelta(
        minutes=auth_settings.password_setup_token_ttl_minutes
    )
    return jwt.encode(
        {
            "purpose": PASSWORD_SETUP_PURPOSE,
            "sub": str(user.id),
            "nonce": nonce,
            "exp": expires,
        },
        auth_settings.jwt_secret,
        algorithm=auth_settings.jwt_algorithm,
    )


def validate_password_setup_token(token: str) -> dict:
    try:
        claims = jwt.decode(
            token,
            auth_settings.jwt_secret,
            algorithms=[auth_settings.jwt_algorithm],
            options={"require": ["purpose", "sub", "nonce", "exp"]},
        )
        if (
            claims["purpose"] != PASSWORD_SETUP_PURPOSE
            or not isinstance(claims["sub"], str)
            or not claims["sub"].isascii()
            or not claims["sub"].isdigit()
            or not 0 < int(claims["sub"]) <= 2147483647
            or not isinstance(claims["nonce"], str)
            or not claims["nonce"].isascii()
            or not 1 <= len(claims["nonce"]) <= 64
        ):
            raise PasswordSetupTokenError()
    except (jwt.PyJWTError, ValueError, TypeError, OverflowError):
        raise PasswordSetupTokenError() from None
    return claims
