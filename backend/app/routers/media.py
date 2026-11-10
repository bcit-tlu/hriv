"""Announcement media: authenticated upload, token-scoped serving (#1835).

Files live below ``<data_dir>/media/`` under a UUID name; the database row
(``content_media``) keeps the original filename and content type. Serving
needs no bearer token — only a signed, expiring, id-bound media token minted
with each announcement response — so Markdown ``<img>``/``<video>`` tags work.
No listing/delete endpoints in v1 (orphaned files are tolerated; a GC sweep
can come later).
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from urllib.parse import quote
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..announcements import announcements_feature_gate
from ..auth import require_role
from ..database import get_db, settings
from ..filenames import sanitize_upload_filename
from ..media_tokens import MediaTokenError, media_url, tokenized_media_url, validate_media_token
from ..middleware import MEDIA_UPLOAD_MAX_BYTES
from ..models import ContentMedia, User
from ..schemas import MediaUploadOut
from ..upload_staging import discard_staging, staging_path_for

router = APIRouter(prefix="/media", tags=["media"])

MEDIA_DIRNAME = "media"
IMAGE_TYPES: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
VIDEO_TYPES: dict[str, str] = {"video/mp4": ".mp4", "video/webm": ".webm"}
VIDEO_EXTENSIONS: dict[str, set[str]] = {"video/mp4": {".mp4", ".m4v"}, "video/webm": {".webm"}}
IMAGE_MAX_BYTES = 10 * 1024 * 1024
VIDEO_MAX_BYTES = MEDIA_UPLOAD_MAX_BYTES
ORIGINAL_NAME_MAX_CHARS = 255  # ContentMedia.original_name column width
CHUNK_SIZE = 1024 * 1024
MEDIA_CACHE_CONTROL = "private, max-age=3600"


def media_dir() -> str:
    return os.path.join(settings.data_dir, MEDIA_DIRNAME)


def max_bytes_for(content_type: str) -> int:
    return IMAGE_MAX_BYTES if content_type in IMAGE_TYPES else VIDEO_MAX_BYTES


def image_magic_matches(content_type: str, head: bytes) -> bool:
    """Cheap sniff of the declared image type against the first bytes."""
    if content_type == "image/jpeg":
        return head.startswith(b"\xff\xd8\xff")
    if content_type == "image/png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/gif":
        return head.startswith((b"GIF87a", b"GIF89a"))
    if content_type == "image/webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    return False


def _too_large(limit: int) -> HTTPException:
    return HTTPException(
        status_code=413,
        detail=f"File exceeds the {limit // (1024 * 1024)} MB limit for this media type",
    )


def _unsupported(detail: str) -> HTTPException:
    return HTTPException(status_code=415, detail=detail)


async def _stream_to_staging(file: UploadFile, staging_path: str, limit: int) -> tuple[int, bytes]:
    """Write the upload in chunks, enforcing *limit*; return (size, first bytes)."""
    written = 0
    head = b""
    with open(staging_path, "wb") as fh:
        while True:
            chunk = await file.read(CHUNK_SIZE)
            if not chunk:
                break
            if not head:
                head = chunk[:16]
            written += len(chunk)
            if written > limit:
                raise _too_large(limit)
            fh.write(chunk)
    return written, head


@router.post("/", response_model=MediaUploadOut, status_code=status.HTTP_201_CREATED)
async def upload_media(
    request: Request,
    file: Annotated[UploadFile, File()],
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(require_role("admin", "instructor"))],
    _gate: Annotated[None, Depends(announcements_feature_gate)],
):
    """Store an image (≤10 MB: jpeg/png/webp/gif) or video (≤50 MB: mp4/webm)."""
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in IMAGE_TYPES and content_type not in VIDEO_TYPES:
        raise _unsupported(
            "Unsupported media type; use JPEG, PNG, WebP or GIF images, or MP4/WebM video"
        )
    limit = max_bytes_for(content_type)
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit + 4096:
        raise _too_large(limit)

    original_name = sanitize_upload_filename(file.filename)
    ext = Path(original_name).suffix.lower()
    if len(original_name) > ORIGINAL_NAME_MAX_CHARS:
        original_name = original_name[: ORIGINAL_NAME_MAX_CHARS - len(ext)] + ext
    if content_type in VIDEO_TYPES:
        if ext not in VIDEO_EXTENSIONS[content_type]:
            raise _unsupported("Video extension does not match its declared type")
        stored_ext = VIDEO_TYPES[content_type]
    else:
        stored_ext = IMAGE_TYPES[content_type]

    directory = media_dir()
    os.makedirs(directory, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}{stored_ext}"
    stored_path = os.path.join(directory, stored_name)
    staging_path = staging_path_for(stored_path)
    try:
        size, head = await _stream_to_staging(file, staging_path, limit)
        if size == 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file")
        if content_type in IMAGE_TYPES and not image_magic_matches(content_type, head):
            raise _unsupported("File content does not match its declared image type")
        os.replace(staging_path, stored_path)
    except BaseException:
        discard_staging(staging_path)
        raise

    media = ContentMedia(
        stored_name=stored_name,
        original_name=original_name,
        content_type=content_type,
        size_bytes=size,
        uploader_id=user.id,
    )
    db.add(media)
    try:
        await db.commit()
    except BaseException:
        # Keep the file: if the commit actually persisted, deleting it
        # would leave a row that 404s forever; an orphaned file is tolerated.
        await db.rollback()
        raise
    await db.refresh(media)
    return MediaUploadOut(
        id=media.id,
        url=media_url(media.id),
        tokenized_url=tokenized_media_url(media.id),
        content_type=media.content_type,
        size_bytes=media.size_bytes,
        original_name=media.original_name,
    )


@router.get("/{media_id}")
async def serve_media(
    media_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    token: str | None = Query(default=None),
) -> FileResponse:
    """Serve a media file after validating its id-scoped token. No bearer auth."""
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing media token")
    try:
        validate_media_token(token, media_id)
    except MediaTokenError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail)

    result = await db.execute(select(ContentMedia).where(ContentMedia.id == media_id))
    media = result.scalar_one_or_none()
    if media is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media not found")

    # Same containment guard as routers/tiles.py: reject suspicious names,
    # canonicalize with realpath and require the file to sit directly below
    # the media directory. Always 404 so rejection looks like a missing file.
    name = media.stored_name or ""
    if not name or "\x00" in name or "/" in name or "\\" in name or name in (".", ".."):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media not found")
    base_real = os.path.realpath(media_dir())
    candidate_real = os.path.realpath(os.path.join(base_real, name))
    if not candidate_real.startswith(base_real + os.sep):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media not found")
    candidate = Path(candidate_real)
    if not candidate.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media not found")

    return FileResponse(
        candidate,
        media_type=media.content_type,
        headers={
            "Cache-Control": MEDIA_CACHE_CONTROL,
            "Content-Disposition": content_disposition(media.original_name, fallback=name),
        },
    )


def content_disposition(original_name: str, *, fallback: str) -> str:
    """``inline`` disposition that survives Starlette's Latin-1 header encoding.

    ``filename=`` carries an ASCII-only fallback; non-ASCII names ride in the
    RFC 5987 ``filename*`` parameter so Unicode uploads do not 500 on GET.
    """
    cleaned = original_name.replace('"', "").replace("\r", "").replace("\n", "")
    ascii_name = cleaned.encode("ascii", "ignore").decode("ascii").strip() or fallback
    header = f'inline; filename="{ascii_name}"'
    if ascii_name != cleaned:
        header += f"; filename*=UTF-8''{quote(cleaned)}"
    return header
