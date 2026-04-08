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
        created_at=now,
        updated_at=now,
        programs=[],
    )


def _make_user(role: str = "admin") -> SimpleNamespace:
    return SimpleNamespace(id=1, role=role, email="u@example.com")


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
    result = await update_image(1, body, _make_user(), db)
    assert img.name == "updated"


async def test_update_image_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    body = ImageUpdate(name="nope")
    with pytest.raises(HTTPException) as exc:
        await update_image(999, body, _make_user(), db)
    assert exc.value.status_code == 404


async def test_update_image_with_metadata() -> None:
    img = _make_image()
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = ImageUpdate(metadata_extra={"key": "val"})
    result = await update_image(1, body, _make_user(), db)
    assert img.metadata_ == {"key": "val"}


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
    result = await update_image(1, body, _make_user(), db)
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
