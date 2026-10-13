"""Stateless HMAC tile tokens for the authorized tile-delivery boundary.

Design: ``docs/tile-delivery-boundary.md`` (issues #1069 / #1064 / #1609).

Two token purposes share the same signature + expiry + image-id binding:

- ``purpose="tile"`` grants read access to the full tile set of one
  ``source_image_id`` (``image.dzi`` and every ``image_files/...`` tile).
- ``purpose="thumb"`` grants read access to the ``thumbnail.jpeg`` of one
  ``source_image_id`` only. It exists so a category card cover can render
  even when the pinned image is hidden from the viewer (#1609) without
  leaking deep-zoom tile access.

They are issued at serialization time — only *after* the existing auth +
student-visibility filtering — and validated by signature + expiry +
image-id match alone, with **no database access**, so the per-tile hot
path never touches the DB.
"""

from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import jwt

from .auth import auth_settings

TILE_TOKEN_PURPOSE = "tile"
THUMB_TOKEN_PURPOSE = "thumb"
THUMBNAIL_FILENAME = "thumbnail.jpeg"
TILE_URL_PREFIX = "/api/tiles/"


class TileTokenError(Exception):
    """Raised when a tile token fails validation.

    ``status_code`` distinguishes a missing/invalid/expired token (401) from
    a structurally valid token bound to a different image or purpose (403).
    """

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _issue(source_image_id: int, purpose: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=auth_settings.tile_token_ttl_minutes
    )
    payload = {
        "purpose": purpose,
        "sid": source_image_id,
        "exp": expire,
    }
    return jwt.encode(
        payload, auth_settings.jwt_secret, algorithm=auth_settings.jwt_algorithm
    )


def issue_tile_token(source_image_id: int) -> str:
    """Sign a short-lived token granting read access to one tile set."""
    return _issue(source_image_id, TILE_TOKEN_PURPOSE)


def issue_thumb_token(source_image_id: int) -> str:
    """Sign a short-lived token granting read access to one thumbnail."""
    return _issue(source_image_id, THUMB_TOKEN_PURPOSE)


def validate_tile_token(
    token: str, source_image_id: int, path: str | None = None
) -> None:
    """Validate signature, expiry and image-id binding. No DB access.

    Raises :class:`TileTokenError` (401 for invalid/expired signatures or
    an unknown purpose, 403 for an id mismatch or a thumbnail token used
    for anything but ``thumbnail.jpeg``). The underlying JWT library
    performs a constant-time HMAC comparison.
    """
    try:
        payload = jwt.decode(
            token,
            auth_settings.jwt_secret,
            algorithms=[auth_settings.jwt_algorithm],
        )
    except jwt.PyJWTError:
        raise TileTokenError(401, "Invalid or expired tile token")
    purpose = payload.get("purpose")
    if purpose not in (TILE_TOKEN_PURPOSE, THUMB_TOKEN_PURPOSE):
        raise TileTokenError(401, "Invalid or expired tile token")
    if payload.get("sid") != source_image_id:
        raise TileTokenError(403, "Tile token does not match this image")
    if purpose == THUMB_TOKEN_PURPOSE:
        last_segment = path.rsplit("/", 1)[-1] if path else None
        if last_segment != THUMBNAIL_FILENAME:
            raise TileTokenError(
                403, "Thumbnail token does not grant tile access"
            )


def source_image_id_from_tile_url(url: str) -> int | None:
    """Extract the ``source_image_id`` from an ``/api/tiles/<id>/…`` URL.

    Returns ``None`` for URLs that do not point at the tile route (e.g.
    legacy seed thumbnails), which callers treat as "nothing to tokenize".
    """
    path = urlsplit(url).path
    if not path.startswith(TILE_URL_PREFIX):
        return None
    first_segment = path[len(TILE_URL_PREFIX):].split("/", 1)[0]
    if not first_segment.isdigit():
        return None
    return int(first_segment)


def _append_token(url: str, issue: Callable[[int], str]) -> str:
    source_image_id = source_image_id_from_tile_url(url)
    if source_image_id is None:
        return url
    scheme, netloc, path, query, fragment = urlsplit(url)
    params = [
        (key, value)
        for key, value in parse_qsl(query, keep_blank_values=True)
        if key != "tile_token"
    ]
    params.append(("tile_token", issue(source_image_id)))
    return urlunsplit((scheme, netloc, path, urlencode(params), fragment))


def append_tile_token(url: str) -> str:
    """Append a freshly issued ``tile_token`` query parameter to a tile URL.

    URLs that do not match ``/api/tiles/<id>/…`` are returned unchanged.
    Any pre-existing ``tile_token`` parameter is replaced (persisted URLs
    should never carry tokens, but a stale duplicate would sort first and
    shadow the fresh token during validation). Must only be called on
    response paths that already sit behind the auth + student-visibility
    checks (see module docstring).
    """
    return _append_token(url, issue_tile_token)


def append_thumb_token(url: str) -> str:
    """Like :func:`append_tile_token`, but issues a thumbnail-only token.

    Used for category card covers (#1609): the thumbnail must render for
    students even when the pinned image is not otherwise visible to them,
    while the token must not authorize ``image.dzi`` or tile access.
    """
    return _append_token(url, issue_thumb_token)
