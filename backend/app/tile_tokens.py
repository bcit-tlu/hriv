"""Stateless HMAC tile tokens for the authorized tile-delivery boundary.

Design: ``docs/tile-delivery-boundary.md`` (issues #1069 / #1064).

Tokens are short-lived JWTs scoped to a single ``source_image_id``
(``purpose="tile"``), following the task-download token precedent in
``routers/admin.py``. They are issued at image-serialization time — only
*after* the existing auth + student-visibility filtering — and validated by
signature + expiry + image-id match alone, with **no database access**, so
the per-tile hot path never touches the DB.
"""

from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from jose import JWTError, jwt

from .auth import auth_settings

TILE_TOKEN_PURPOSE = "tile"
TILE_URL_PREFIX = "/api/tiles/"


class TileTokenError(Exception):
    """Raised when a tile token fails validation.

    ``status_code`` distinguishes a missing/invalid/expired token (401) from
    a structurally valid token bound to a different image (403).
    """

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def issue_tile_token(source_image_id: int) -> str:
    """Sign a short-lived token granting read access to one tile set."""
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=auth_settings.tile_token_ttl_minutes
    )
    payload = {
        "purpose": TILE_TOKEN_PURPOSE,
        "sid": source_image_id,
        "exp": expire,
    }
    return jwt.encode(
        payload, auth_settings.jwt_secret, algorithm=auth_settings.jwt_algorithm
    )


def validate_tile_token(token: str, source_image_id: int) -> None:
    """Validate signature, expiry and image-id binding. No DB access.

    Raises :class:`TileTokenError` (401 for invalid/expired signatures,
    403 for an id mismatch). The underlying JWT library performs a
    constant-time HMAC comparison.
    """
    try:
        payload = jwt.decode(
            token,
            auth_settings.jwt_secret,
            algorithms=[auth_settings.jwt_algorithm],
        )
    except JWTError:
        raise TileTokenError(401, "Invalid or expired tile token")
    if payload.get("purpose") != TILE_TOKEN_PURPOSE:
        raise TileTokenError(401, "Invalid or expired tile token")
    if payload.get("sid") != source_image_id:
        raise TileTokenError(403, "Tile token does not match this image")


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


def append_tile_token(url: str) -> str:
    """Append a freshly issued ``tile_token`` query parameter to a tile URL.

    URLs that do not match ``/api/tiles/<id>/…`` are returned unchanged.
    Any pre-existing ``tile_token`` parameter is replaced (persisted URLs
    should never carry tokens, but a stale duplicate would sort first and
    shadow the fresh token during validation). Must only be called on
    response paths that already sit behind the auth + student-visibility
    checks (see module docstring).
    """
    source_image_id = source_image_id_from_tile_url(url)
    if source_image_id is None:
        return url
    scheme, netloc, path, query, fragment = urlsplit(url)
    params = [
        (key, value)
        for key, value in parse_qsl(query, keep_blank_values=True)
        if key != "tile_token"
    ]
    params.append(("tile_token", issue_tile_token(source_image_id)))
    return urlunsplit((scheme, netloc, path, urlencode(params), fragment))
