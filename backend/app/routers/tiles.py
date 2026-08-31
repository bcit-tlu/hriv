"""Authorized tile delivery and the nginx ``auth_request`` validator.

Design: ``docs/tile-delivery-boundary.md`` (issues #1069 / #1064).

Two routes:

- ``GET /tiles-auth`` — DB-free validator for the nginx tiles sidecar's
  ``auth_request`` subrequest. Reads the original request URI from
  ``X-Original-URI`` and the token from the ``tile_token`` query parameter
  (own query string, ``X-Tile-Token`` header, or the forwarded original
  URI's query string). Returns 204 on success, 401/403 otherwise.
- ``GET /tiles/{source_image_id}/{path}`` — FastAPI fallback that serves
  tile files directly for deployments without the sidecar (dev/compose).
  Same token, same semantics, one validation code path.
"""

import logging
import os
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from fastapi import APIRouter, Header, HTTPException, Query, Response
from fastapi.responses import FileResponse

from ..database import settings
from ..tile_tokens import (
    TileTokenError,
    source_image_id_from_tile_url,
    validate_tile_token,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["tiles"])

# Tile bytes are immutable for a given URL (see docs/tile-cache-provenance.md)
# so long browser caching is safe, but tiles are now authorized content:
# ``private`` forbids shared caches/CDNs from storing them (#1064).
TILE_CACHE_CONTROL = "private, max-age=2592000"

_MEDIA_TYPES = {
    ".dzi": "application/xml",
    ".xml": "application/xml",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
}


def _token_from_original_uri(original_uri: str) -> str | None:
    query = urlsplit(original_uri).query
    values = parse_qs(query).get("tile_token")
    return values[0] if values else None


@router.get("/tiles-auth", status_code=204)
async def tiles_auth(
    tile_token: str | None = Query(default=None),
    x_original_uri: str | None = Header(default=None),
    x_tile_token: str | None = Header(default=None),
) -> Response:
    """nginx ``auth_request`` contract: 204 valid, 401 missing/invalid, 403 mismatch.

    Signature + expiry + path/image-id match only — no DB access.
    """
    if not x_original_uri:
        raise HTTPException(status_code=401, detail="Missing X-Original-URI")
    source_image_id = source_image_id_from_tile_url(x_original_uri)
    if source_image_id is None:
        raise HTTPException(status_code=403, detail="Not a tile URI")
    token = (
        tile_token
        or x_tile_token
        or _token_from_original_uri(x_original_uri)
    )
    if not token:
        raise HTTPException(status_code=401, detail="Missing tile token")
    try:
        validate_tile_token(token, source_image_id)
    except TileTokenError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)
    return Response(status_code=204)


@router.get("/tiles/{source_image_id}/{path:path}")
async def serve_tile(
    source_image_id: int,
    path: str,
    tile_token: str | None = Query(default=None),
) -> FileResponse:
    """Serve a tile file after validating the image-scoped tile token.

    This is the dev/compose path; in Kubernetes the nginx tiles sidecar
    intercepts ``/api/tiles/`` first and only the ``auth_request``
    subrequest reaches FastAPI (see the charts for wave C3b).
    """
    if not tile_token:
        raise HTTPException(status_code=401, detail="Missing tile token")
    try:
        validate_tile_token(tile_token, source_image_id)
    except TileTokenError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)

    # Reject suspicious inputs up front (null bytes, backslashes, absolute
    # paths, ``..`` segments), then canonicalize and verify containment.
    # Always answer 404 so rejection is indistinguishable from a missing file.
    if (
        "\x00" in path
        or "\\" in path
        or path.startswith("/")
        or ".." in path.split("/")
    ):
        raise HTTPException(status_code=404, detail="Tile not found")
    base = Path(settings.tiles_dir).resolve()
    image_dir = base / str(source_image_id)
    # Canonicalize with os.path.realpath and guard containment with a
    # startswith prefix check — the sanitizer shape CodeQL's
    # py/path-injection query recognizes as a barrier (pathlib's
    # is_relative_to is not, and left alerts 3049-3051 open).
    image_dir_real = os.path.realpath(image_dir)
    candidate_real = os.path.realpath(os.path.join(image_dir_real, path))
    if not candidate_real.startswith(image_dir_real + os.sep):
        raise HTTPException(status_code=404, detail="Tile not found")
    candidate = Path(candidate_real)
    if not candidate.is_file():
        raise HTTPException(status_code=404, detail="Tile not found")

    media_type = _MEDIA_TYPES.get(
        candidate.suffix.lower(), "application/octet-stream"
    )
    return FileResponse(
        candidate,
        media_type=media_type,
        headers={"Cache-Control": TILE_CACHE_CONTROL},
    )
