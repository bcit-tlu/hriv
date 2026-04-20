"""Tests for the images router endpoints."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.routers.images import (
    list_images,
    get_image,
    create_image,
    update_image,
    bulk_update_images,
    bulk_delete_images,
    delete_image,
)
from app.schemas import ImageCreate, ImageUpdate, ImageBulkUpdate, ImageBulkDelete


def _make_image(
    id: int = 1,
    name: str = "test-img",
    category_id: int | None = None,
    active: bool = True,
) -> SimpleNamespace:
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=id,
        name=name,
        thumb="/thumb.jpg",
        tile_sources="/tiles/1",
        category_id=category_id,
        copyright=None,
        note=None,
        active=active,
        metadata_=None,
        version=1,
        width=None,
        height=None,
        file_size=None,
        created_at=now,
        updated_at=now,
        programs=[],
    )


def _make_user(role: str = "admin") -> SimpleNamespace:
    return SimpleNamespace(id=1, role=role, email="u@example.com")


def _mock_request(if_match: str | None = None) -> MagicMock:
    """Build a mock Request with headers for optimistic concurrency."""
    req = MagicMock()
    req.headers.get.side_effect = lambda key, default=None: (
        if_match if key == "If-Match" else default
    )
    return req


async def test_list_images_admin() -> None:
    imgs = [_make_image(id=1), _make_image(id=2)]
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = imgs

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    result = await list_images(_make_user("admin"), db=db)
    assert len(result) == 2


async def test_list_images_by_category() -> None:
    imgs = [_make_image(id=1, category_id=5)]
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = imgs

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    result = await list_images(_make_user(), category_id=5, db=db)
    assert len(result) == 1


async def test_list_images_uncategorized() -> None:
    imgs = [_make_image(id=1, category_id=None)]
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = imgs

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    result = await list_images(_make_user(), uncategorized=True, db=db)
    assert len(result) == 1


async def test_list_images_student_filters() -> None:
    imgs = [_make_image(id=1, active=True)]
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = imgs

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    result = await list_images(_make_user("student"), db=db)
    assert len(result) == 1


async def test_get_image_found() -> None:
    img = _make_image()
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)

    result = await get_image(1, _make_user(), db)
    assert result.name == "test-img"


async def test_get_image_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await get_image(999, _make_user(), db)
    assert exc.value.status_code == 404


async def test_get_image_student_inactive() -> None:
    img = _make_image(active=False)
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)

    with pytest.raises(HTTPException) as exc:
        await get_image(1, _make_user("student"), db)
    assert exc.value.status_code == 404


async def test_get_image_student_hidden_category() -> None:
    img = _make_image(category_id=5)
    cat = SimpleNamespace(id=5, status="hidden")

    db = AsyncMock()
    db.get = AsyncMock(side_effect=lambda model, id_val: img if id_val == 1 else cat)

    with pytest.raises(HTTPException) as exc:
        await get_image(1, _make_user("student"), db)
    assert exc.value.status_code == 404


async def test_get_image_student_visible_category() -> None:
    img = _make_image(category_id=5)
    cat = SimpleNamespace(id=5, status="active")

    db = AsyncMock()
    db.get = AsyncMock(side_effect=lambda model, id_val: img if id_val == 1 else cat)

    result = await get_image(1, _make_user("student"), db)
    assert result.name == "test-img"


async def test_create_image_success() -> None:
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = ImageCreate(
        name="new-img",
        thumb="/thumb.jpg",
        tile_sources="/tiles/new",
    )
    result = await create_image(body, _make_user(), db)
    db.add.assert_called_once()


async def test_create_image_with_programs() -> None:
    progs = [SimpleNamespace(id=10), SimpleNamespace(id=20)]
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = progs

    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    body = ImageCreate(
        name="new-img",
        thumb="/thumb.jpg",
        tile_sources="/tiles/new",
        program_ids=[10, 20],
    )
    result = await create_image(body, _make_user(), db)
    db.execute.assert_awaited_once()


async def test_update_image_success() -> None:
    img = _make_image()
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = ImageUpdate(name="updated")
    result = await update_image(1, body, _mock_request(), _make_user(), db)
    assert img.name == "updated"


async def test_update_image_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    body = ImageUpdate(name="nope")
    with pytest.raises(HTTPException) as exc:
        await update_image(999, body, _mock_request(), _make_user(), db)
    assert exc.value.status_code == 404


async def test_update_image_with_metadata() -> None:
    img = _make_image()
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = ImageUpdate(metadata_extra={"key": "val"})
    result = await update_image(1, body, _mock_request(), _make_user(), db)
    assert img.metadata_ == {"key": "val"}


async def test_update_image_if_match_success() -> None:
    """When If-Match matches the current version, the atomic CAS should
    succeed and the row's version should be incremented."""
    img = _make_image()
    img.version = 3

    cas_result = MagicMock()
    cas_result.rowcount = 1

    db = AsyncMock()
    db.get = AsyncMock(return_value=img)
    db.execute = AsyncMock(return_value=cas_result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = ImageUpdate(name="updated")
    await update_image(1, body, _mock_request(if_match='"3"'), _make_user(), db)
    assert img.version == 4
    assert img.name == "updated"


async def test_update_image_if_match_stale_version() -> None:
    """When If-Match does not match the current version, the atomic CAS
    should return rowcount=0 and the handler should raise 409."""
    img = _make_image()
    img.version = 5

    cas_result = MagicMock()
    cas_result.rowcount = 0  # no row matched WHERE id=? AND version=?

    db = AsyncMock()
    db.get = AsyncMock(return_value=img)
    db.execute = AsyncMock(return_value=cas_result)
    db.commit = AsyncMock()

    body = ImageUpdate(name="should-not-apply")
    with pytest.raises(HTTPException) as exc:
        await update_image(1, body, _mock_request(if_match='"3"'), _make_user(), db)
    assert exc.value.status_code == 409
    # The in-memory image should not have been mutated
    assert img.name == "test-img"
    db.commit.assert_not_awaited()


async def test_update_image_if_match_invalid() -> None:
    """A non-integer If-Match value should be rejected with 400."""
    img = _make_image()
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)

    body = ImageUpdate(name="x")
    with pytest.raises(HTTPException) as exc:
        await update_image(1, body, _mock_request(if_match="not-a-number"), _make_user(), db)
    assert exc.value.status_code == 400


async def test_update_image_with_programs() -> None:
    img = _make_image()
    progs = [SimpleNamespace(id=10)]
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = progs

    db = AsyncMock()
    db.get = AsyncMock(return_value=img)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    body = ImageUpdate(program_ids=[10])
    result = await update_image(1, body, _mock_request(), _make_user(), db)
    assert img.programs == progs


async def test_bulk_update_images_success() -> None:
    imgs = [_make_image(id=1), _make_image(id=2)]

    call_count = 0

    async def mock_execute(stmt):
        nonlocal call_count
        call_count += 1
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = imgs
        return mock_result

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=mock_execute)
    db.commit = AsyncMock()

    body = ImageBulkUpdate(image_ids=[1, 2], copyright="CC")
    result = await bulk_update_images(body, _make_user(), db)

    for img in imgs:
        assert img.copyright == "CC"


async def test_bulk_update_images_not_found() -> None:
    imgs = [_make_image(id=1)]
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = imgs

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    body = ImageBulkUpdate(image_ids=[1, 2, 3])
    with pytest.raises(HTTPException) as exc:
        await bulk_update_images(body, _make_user(), db)
    assert exc.value.status_code == 404


async def test_bulk_update_images_with_programs() -> None:
    imgs = [_make_image(id=1)]
    progs = [SimpleNamespace(id=10)]

    call_count = 0

    async def mock_execute(stmt):
        nonlocal call_count
        call_count += 1
        mock_result = MagicMock()
        if call_count == 1:
            mock_result.scalars.return_value.all.return_value = imgs
        elif call_count == 2:
            mock_result.scalars.return_value.all.return_value = progs
        else:
            mock_result.scalars.return_value.all.return_value = imgs
        return mock_result

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=mock_execute)
    db.commit = AsyncMock()

    body = ImageBulkUpdate(image_ids=[1], program_ids=[10])
    result = await bulk_update_images(body, _make_user(), db)


async def test_bulk_delete_images_success() -> None:
    imgs = [_make_image(id=1), _make_image(id=2)]
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = imgs

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)
    db.delete = AsyncMock()
    db.commit = AsyncMock()

    body = ImageBulkDelete(image_ids=[1, 2])
    await bulk_delete_images(body, _make_user(), db)
    assert db.delete.await_count == 2


async def test_bulk_delete_images_not_found() -> None:
    imgs = [_make_image(id=1)]
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = imgs

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    body = ImageBulkDelete(image_ids=[1, 2, 3])
    with pytest.raises(HTTPException) as exc:
        await bulk_delete_images(body, _make_user(), db)
    assert exc.value.status_code == 404


async def test_update_image_metadata_extra_merge_sets_key() -> None:
    """metadata_extra_merge should merge keys into existing metadata."""
    img = _make_image()
    img.metadata_ = {"existing": "value"}
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = ImageUpdate(metadata_extra_merge={"locked_overlays": [{"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4}]})
    await update_image(1, body, _mock_request(), _make_user(), db)
    assert img.metadata_["existing"] == "value"
    assert img.metadata_["locked_overlays"] == [{"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4}]


async def test_update_image_metadata_extra_merge_deletes_key() -> None:
    """metadata_extra_merge with None value should remove the key."""
    img = _make_image()
    img.metadata_ = {"locked_overlays": [{"x": 0, "y": 0, "w": 1, "h": 1}], "other": "data"}
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = ImageUpdate(metadata_extra_merge={"locked_overlays": None})
    await update_image(1, body, _mock_request(), _make_user(), db)
    assert "locked_overlays" not in img.metadata_
    assert img.metadata_["other"] == "data"


async def test_update_image_metadata_extra_merge_empty_result_sets_none() -> None:
    """When merge removes the last key, metadata should become None."""
    img = _make_image()
    img.metadata_ = {"locked_overlays": [{"x": 0, "y": 0, "w": 1, "h": 1}]}
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = ImageUpdate(metadata_extra_merge={"locked_overlays": None})
    await update_image(1, body, _mock_request(), _make_user(), db)
    assert img.metadata_ is None


async def test_update_image_metadata_extra_merge_from_empty() -> None:
    """Merge should work when existing metadata is None."""
    img = _make_image()
    img.metadata_ = None
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = ImageUpdate(metadata_extra_merge={"canvas_annotations": [{"type": "rect"}]})
    await update_image(1, body, _mock_request(), _make_user(), db)
    assert img.metadata_ == {"canvas_annotations": [{"type": "rect"}]}


async def test_delete_image_success() -> None:
    img = _make_image()
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)
    db.delete = AsyncMock()
    db.commit = AsyncMock()

    await delete_image(1, _make_user(), db)
    db.delete.assert_awaited_once_with(img)


async def test_delete_image_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await delete_image(999, _make_user(), db)
    assert exc.value.status_code == 404
