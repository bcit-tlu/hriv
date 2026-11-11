"""Tests for ``/api/media`` upload + token-scoped serving (#1835)."""

import io
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from starlette.datastructures import Headers, UploadFile

from app.media_tokens import issue_media_token
from app.routers import media as media_router
from app.routers.media import (
    IMAGE_MAX_BYTES,
    VIDEO_MAX_BYTES,
    image_magic_matches,
    serve_media,
    upload_media,
)

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


@pytest.fixture(autouse=True)
def _media_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(media_router.settings, "data_dir", str(tmp_path))
    return tmp_path / "media"


def _upload(data: bytes, filename: str, content_type: str) -> UploadFile:
    return UploadFile(
        io.BytesIO(data), filename=filename, headers=Headers({"content-type": content_type})
    )


def _request(content_length: int | None = None) -> SimpleNamespace:
    headers = {} if content_length is None else {"content-length": str(content_length)}
    return SimpleNamespace(headers=headers)


def _db() -> AsyncMock:
    db = AsyncMock()
    db.add = MagicMock()

    async def _refresh(obj):
        obj.id = 42

    db.refresh = AsyncMock(side_effect=_refresh)
    return db


USER = SimpleNamespace(id=3, role="instructor")


async def test_upload_png_stores_file_and_row(_media_dir) -> None:
    db = _db()
    out = await upload_media(_request(len(PNG)), _upload(PNG, "../evil/shot.png", "image/png"), db, USER, None)

    media = db.add.call_args.args[0]
    assert media.content_type == "image/png"
    assert media.original_name == "shot.png"  # sanitized basename
    assert media.size_bytes == len(PNG)
    assert media.uploader_id == 3
    assert media.stored_name.endswith(".png") and "/" not in media.stored_name
    assert (_media_dir / media.stored_name).read_bytes() == PNG
    assert not [p for p in os.listdir(_media_dir) if p.startswith(".staging-")]
    assert out.id == 42 and out.url == "/api/media/42"
    assert out.tokenized_url.startswith("/api/media/42?token=")
    db.commit.assert_awaited_once()


async def test_upload_video_by_declared_type_and_extension(_media_dir) -> None:
    out = await upload_media(_request(), _upload(b"\x00" * 100, "clip.mp4", "video/mp4"), _db(), USER, None)
    assert out.content_type == "video/mp4"
    with pytest.raises(HTTPException) as exc:
        await upload_media(_request(), _upload(b"\x00" * 100, "clip.mov", "video/mp4"), _db(), USER, None)
    assert exc.value.status_code == 415


async def test_upload_rejects_unsupported_type_and_mismatched_magic(_media_dir) -> None:
    with pytest.raises(HTTPException) as exc:
        await upload_media(_request(), _upload(b"%PDF-1.4", "doc.pdf", "application/pdf"), _db(), USER, None)
    assert exc.value.status_code == 415
    with pytest.raises(HTTPException) as exc:
        await upload_media(_request(), _upload(JPEG, "fake.png", "image/png"), _db(), USER, None)
    assert exc.value.status_code == 415
    assert not os.path.exists(_media_dir) or not os.listdir(_media_dir)  # staging discarded


async def test_upload_size_limits(_media_dir) -> None:
    # Early rejection on Content-Length.
    with pytest.raises(HTTPException) as exc:
        await upload_media(_request(IMAGE_MAX_BYTES + 10_000), _upload(PNG, "a.png", "image/png"), _db(), USER, None)
    assert exc.value.status_code == 413
    # Streaming enforcement when the header is absent.
    big = PNG + b"\x00" * IMAGE_MAX_BYTES
    with pytest.raises(HTTPException) as exc:
        await upload_media(_request(), _upload(big, "a.png", "image/png"), _db(), USER, None)
    assert exc.value.status_code == 413
    assert not os.listdir(_media_dir)
    # Video gets the larger budget.
    assert VIDEO_MAX_BYTES > IMAGE_MAX_BYTES
    out = await upload_media(_request(), _upload(b"\x00" * (IMAGE_MAX_BYTES + 10), "c.webm", "video/webm"), _db(), USER, None)
    assert out.size_bytes == IMAGE_MAX_BYTES + 10


async def test_upload_truncates_long_original_name(_media_dir) -> None:
    long_name = "a" * 300 + ".png"
    out = await upload_media(_request(), _upload(PNG, long_name, "image/png"), _db(), USER, None)
    assert len(out.original_name) == 255 and out.original_name.endswith(".png")


async def test_upload_commit_failure_keeps_file_and_rolls_back(_media_dir) -> None:
    db = _db()
    db.commit = AsyncMock(side_effect=RuntimeError("connection lost"))
    with pytest.raises(RuntimeError):
        await upload_media(_request(), _upload(PNG, "a.png", "image/png"), db, USER, None)
    db.rollback.assert_awaited_once()
    assert len(os.listdir(_media_dir)) == 1  # the row may have persisted; never orphan it


def test_media_upload_spool_cap_registered() -> None:
    from app.middleware import _upload_body_limits

    for path in ("/api/media/", "/api/media"):
        per_part, whole = _upload_body_limits(path)
        assert per_part == whole > VIDEO_MAX_BYTES
    assert _upload_body_limits("/api/media/12") is None


def test_media_upload_spool_cap_detail_cites_media_limit() -> None:
    from app.middleware import _upload_body_limit_detail

    assert _upload_body_limit_detail("/api/media/", per_part=True) == "Media file exceeds the size limit of 50 MB"
    assert "GiB" not in _upload_body_limit_detail("/api/media/", per_part=False)


def test_content_disposition_unicode_and_ascii() -> None:
    from app.routers.media import content_disposition

    assert content_disposition('sh"ot.png', fallback="x") == 'inline; filename="shot.png"'
    header = content_disposition("切片.png", fallback="abc.png")
    assert header.startswith('inline; filename=".png"; filename*=UTF-8\'\'')
    header.encode("latin-1")  # must be encodable by Starlette
    assert content_disposition("🔬", fallback="abc.png").startswith('inline; filename="abc.png"')


async def test_upload_empty_file_400(_media_dir) -> None:
    with pytest.raises(HTTPException) as exc:
        await upload_media(_request(), _upload(b"", "a.png", "image/png"), _db(), USER, None)
    assert exc.value.status_code == 400


def test_image_magic_matches() -> None:
    assert image_magic_matches("image/png", PNG)
    assert image_magic_matches("image/jpeg", JPEG)
    assert image_magic_matches("image/gif", b"GIF89a" + b"\x00" * 8)
    assert image_magic_matches("image/webp", b"RIFF\x00\x00\x00\x00WEBPVP8 ")
    assert not image_magic_matches("image/png", JPEG)
    assert not image_magic_matches("image/webp", b"RIFF\x00\x00\x00\x00WAVE")


# ── serving ──────────────────────────────────────────────────


def _serve_db(media) -> AsyncMock:
    result = MagicMock()
    result.scalar_one_or_none.return_value = media
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)
    return db


def _stored(_media_dir, name="abc.png", data=PNG):
    _media_dir.mkdir(parents=True, exist_ok=True)
    (_media_dir / name).write_bytes(data)
    return SimpleNamespace(id=5, stored_name=name, original_name='sh"ot.png', content_type="image/png")


async def test_serve_requires_valid_token(_media_dir) -> None:
    media = _stored(_media_dir)
    with pytest.raises(HTTPException) as exc:
        await serve_media(5, _serve_db(media), token=None)
    assert exc.value.status_code == 401
    with pytest.raises(HTTPException) as exc:
        await serve_media(5, _serve_db(media), token="junk")
    assert exc.value.status_code == 401
    with pytest.raises(HTTPException) as exc:
        await serve_media(5, _serve_db(media), token=issue_media_token(6))
    assert exc.value.status_code == 403


async def test_serve_returns_file_with_headers(_media_dir) -> None:
    media = _stored(_media_dir)
    response = await serve_media(5, _serve_db(media), token=issue_media_token(5))
    assert str(response.path) == str(_media_dir / "abc.png")
    assert response.media_type == "image/png"
    assert response.headers["cache-control"] == "private, max-age=3600"
    assert response.headers["content-disposition"] == 'inline; filename="shot.png"'


async def test_serve_404_for_missing_row_file_or_traversal(_media_dir) -> None:
    token = issue_media_token(5)
    with pytest.raises(HTTPException) as exc:
        await serve_media(5, _serve_db(None), token=token)
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        await serve_media(5, _serve_db(SimpleNamespace(id=5, stored_name="missing.png", original_name="x", content_type="image/png")), token=token)
    assert exc.value.status_code == 404
    outside = _media_dir.parent / "secret.txt"
    outside.write_text("nope")
    for name in ("../secret.txt", "/etc/passwd", "a\x00b.png", "..", "sub\\file.png"):
        with pytest.raises(HTTPException) as exc:
            await serve_media(5, _serve_db(SimpleNamespace(id=5, stored_name=name, original_name="x", content_type="image/png")), token=token)
        assert exc.value.status_code == 404, name
