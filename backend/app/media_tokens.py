"""Stateless HMAC media tokens for announcement images/videos (#1835).

Mirrors :mod:`tile_tokens`: a token is bound to one ``content_media.id`` and
expires after :data:`MEDIA_TOKEN_TTL_MINUTES`. Tokens are minted fresh every
time an announcement is serialized (``media_tokens`` in the feed response) so
``<img>``/``<video>`` URLs never need a bearer JWT, and are validated by
signature + expiry + id alone — no database access.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt

from .auth import auth_settings

MEDIA_TOKEN_PURPOSE = "media"
MEDIA_URL_PREFIX = "/api/media/"
MEDIA_TOKEN_TTL_MINUTES = 60


class MediaTokenError(Exception):
    """Raised when a media token fails validation (401 invalid/expired, 403 wrong id)."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def issue_media_token(media_id: int) -> str:
    """Sign a short-lived token granting read access to one media file."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=MEDIA_TOKEN_TTL_MINUTES)
    payload = {"purpose": MEDIA_TOKEN_PURPOSE, "mid": media_id, "exp": expire}
    return jwt.encode(payload, auth_settings.jwt_secret, algorithm=auth_settings.jwt_algorithm)


def validate_media_token(token: str, media_id: int) -> None:
    """Validate signature, expiry and media-id binding. No DB access."""
    try:
        payload = jwt.decode(
            token, auth_settings.jwt_secret, algorithms=[auth_settings.jwt_algorithm]
        )
    except jwt.PyJWTError:
        raise MediaTokenError(401, "Invalid or expired media token")
    if payload.get("purpose") != MEDIA_TOKEN_PURPOSE:
        raise MediaTokenError(401, "Invalid or expired media token")
    if payload.get("mid") != media_id:
        raise MediaTokenError(403, "Media token does not match this file")


def media_url(media_id: int) -> str:
    return f"{MEDIA_URL_PREFIX}{media_id}"


def tokenized_media_url(media_id: int) -> str:
    return f"{media_url(media_id)}?token={issue_media_token(media_id)}"
