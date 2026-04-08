"""Tests for image optimistic concurrency (Phase 5.1)."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.routers.images import update_image
from app.schemas import ImageOut


def _make_image(version: int = 1) -> SimpleNamespace:
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=1,
        name="test-image",
        thumb="/thumb.jpg",
        tile_sources="/tiles/1",
        category_id=None,
        copyright=None,
        note=None,
        active=True,
        metadata_=None,
        version=version,
        created_at=now,
        updated_at=now,
        programs=[],
    )


def _make_request(if_match: str | None = None) -> MagicMock:
    request = MagicMock()
    request.headers = {}
    if if_match is not None:
        request.headers["If-Match"] = if_match
    return request


def _make_body(**kwargs: object) -> MagicMock:
    body = MagicMock()
    body.model_dump.return_value = kwargs if kwargs else {"name": "updated"}
    return body


def _make_user() -> SimpleNamespace:
    return SimpleNamespace(id=1, role="admin")


async def test_update_image_bumps_version() -> None:
    """Successful update increments the version number."""
    img = _make_image(version=3)
    db = AsyncMock()
    db.get.return_value = img
    db.execute.return_value = MagicMock(
        scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))
    )
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    request = _make_request(if_match='"3"')
    body = _make_body(name="updated")

    response = await update_image(
        image_id=1,
        body=body,
        request=request,
        _user=_make_user(),
        db=db,
    )

    assert img.version == 4
    db.commit.assert_awaited_once()


async def test_update_image_conflict_returns_409() -> None:
    """If-Match with stale version returns 409 Conflict."""
    img = _make_image(version=5)
    db = AsyncMock()
    db.get.return_value = img

    request = _make_request(if_match='"3"')
    body = _make_body(name="updated")

    with pytest.raises(HTTPException) as exc:
        await update_image(
            image_id=1,
            body=body,
            request=request,
            _user=_make_user(),
            db=db,
        )

    assert exc.value.status_code == 409
    assert "modified" in exc.value.detail.lower()


async def test_update_image_invalid_if_match_returns_400() -> None:
    """Non-numeric If-Match header returns 400."""
    img = _make_image(version=1)
    db = AsyncMock()
    db.get.return_value = img

    request = _make_request(if_match="not-a-number")
    body = _make_body(name="updated")

    with pytest.raises(HTTPException) as exc:
        await update_image(
            image_id=1,
            body=body,
            request=request,
            _user=_make_user(),
            db=db,
        )

    assert exc.value.status_code == 400


async def test_update_image_no_if_match_still_bumps_version() -> None:
    """Without If-Match header, update proceeds and still bumps version."""
    img = _make_image(version=2)
    db = AsyncMock()
    db.get.return_value = img
    db.execute.return_value = MagicMock(
        scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))
    )
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    request = _make_request()  # no If-Match
    body = _make_body(name="updated")

    response = await update_image(
        image_id=1,
        body=body,
        request=request,
        _user=_make_user(),
        db=db,
    )

    assert img.version == 3
    db.commit.assert_awaited_once()


async def test_update_image_not_found_returns_404() -> None:
    """Updating a non-existent image returns 404."""
    db = AsyncMock()
    db.get.return_value = None

    request = _make_request()
    body = _make_body(name="updated")

    with pytest.raises(HTTPException) as exc:
        await update_image(
            image_id=999,
            body=body,
            request=request,
            _user=_make_user(),
            db=db,
        )

    assert exc.value.status_code == 404


def test_image_out_includes_version() -> None:
    """ImageOut schema includes the version field."""
    img = _make_image(version=7)
    out = ImageOut.model_validate(img)
    assert out.version == 7


def test_image_out_defaults_version_to_one() -> None:
    """ImageOut defaults version to 1 when not provided."""
    out = ImageOut(
        id=1,
        name="test",
        thumb="/t.jpg",
        tile_sources="/tiles",
        category_id=None,
        copyright=None,
        note=None,
        program_ids=[],
        active=True,
        metadata_extra=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    assert out.version == 1
