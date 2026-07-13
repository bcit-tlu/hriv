"""Tests for the images router endpoints."""

import errno
from datetime import datetime, timezone
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import FastAPI, HTTPException, UploadFile

import app.auth as auth
from app.routers import images as images_router
from app.routers.images import (
    list_images,
    get_image,
    create_image,
    update_image,
    bulk_update_images,
    bulk_delete_images,
    reorder_images,
    delete_image,
    replace_image,
)
from app.schemas import ImageCreate, ImageUpdate, ImageBulkUpdate, ImageBulkDelete, ImageReorderItem, ImageReorderRequest


def _make_image(
    id: int = 1,
    name: str = "test-img",
    category_id: int | None = None,
    active: bool = True,
    sort_order: int = 0,
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
        sort_order=sort_order,
        metadata_=None,
        version=1,
        width=None,
        height=None,
        file_size=None,
        created_at=now,
        updated_at=now,
    )


def _make_user(
    role: str = "admin", programs: list | None = None, groups: list | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=1, role=role, email=f"{role}@example.com",
        programs=programs or [], groups=groups or [],
    )


def _mock_request(if_match: str | None = None) -> MagicMock:
    """Build a mock Request with headers for optimistic concurrency."""
    req = MagicMock()
    req.headers.get.side_effect = lambda key, default=None: (
        if_match if key == "If-Match" else default
    )
    return req


def _images_test_app(user_role: str, db: AsyncMock) -> FastAPI:
    app = FastAPI()
    app.include_router(images_router.router, prefix="/api")

    async def override_db():
        yield db

    app.dependency_overrides[auth.get_current_user] = lambda: _make_user(user_role)
    app.dependency_overrides[images_router.get_db] = override_db
    return app


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

    # Visibility helper needs a categories query; return empty (no exclusions)
    cat_result = MagicMock()
    cat_result.scalars.return_value.unique.return_value.all.return_value = []

    call_count = 0

    async def execute_side_effect(stmt):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return cat_result
        return mock_result

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=execute_side_effect)

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
    cat = SimpleNamespace(id=5, status="hidden", programs=[], groups=[], parent_id=None)

    db = AsyncMock()
    db.get = AsyncMock(side_effect=lambda model, id_val: img if id_val == 1 else cat)

    with pytest.raises(HTTPException) as exc:
        await get_image(1, _make_user("student"), db)
    assert exc.value.status_code == 404


async def test_get_image_student_visible_category() -> None:
    img = _make_image(category_id=5)
    cat = SimpleNamespace(id=5, status="active", programs=[], groups=[], parent_id=None)

    db = AsyncMock()
    db.get = AsyncMock(side_effect=lambda model, id_val: img if id_val == 1 else cat)

    result = await get_image(1, _make_user("student"), db)
    assert result.name == "test-img"


async def test_get_image_student_program_restricted() -> None:
    prog = SimpleNamespace(id=10)
    img = _make_image(category_id=5)
    cat = SimpleNamespace(id=5, status="active", programs=[prog], groups=[], parent_id=None)

    db = AsyncMock()
    db.get = AsyncMock(side_effect=lambda model, id_val: img if id_val == 1 else cat)

    with pytest.raises(HTTPException) as exc:
        await get_image(1, _make_user("student"), db)
    assert exc.value.status_code == 404


async def test_get_image_student_matching_program() -> None:
    prog = SimpleNamespace(id=10)
    img = _make_image(category_id=5)
    cat = SimpleNamespace(id=5, status="active", programs=[prog], groups=[], parent_id=None)

    db = AsyncMock()
    db.get = AsyncMock(side_effect=lambda model, id_val: img if id_val == 1 else cat)

    result = await get_image(1, _make_user("student", programs=[prog]), db)
    assert result.name == "test-img"


async def test_get_image_student_uncategorized_visible() -> None:
    img = _make_image(category_id=None)
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)

    result = await get_image(1, _make_user("student"), db)
    assert result.name == "test-img"


async def test_get_image_admin_sees_restricted() -> None:
    prog = SimpleNamespace(id=10)
    img = _make_image(category_id=5)
    cat = SimpleNamespace(id=5, status="active", programs=[prog], groups=[], parent_id=None)

    db = AsyncMock()
    db.get = AsyncMock(side_effect=lambda model, id_val: img if id_val == 1 else cat)

    result = await get_image(1, _make_user("admin"), db)
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


async def test_update_image_success() -> None:
    img = _make_image()
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = ImageUpdate(name="updated")
    result = await update_image(1, body, _mock_request(), _make_user(), db)
    assert img.name == "updated"


async def test_update_image_normalizes_empty_note() -> None:
    img = _make_image()
    img.note = "existing note"
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = ImageUpdate(note="")
    await update_image(1, body, _mock_request(), _make_user(), db)
    assert img.note is None


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


async def test_delete_image_endpoint_allows_instructor() -> None:
    img = _make_image()
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)
    db.delete = AsyncMock()
    db.commit = AsyncMock()

    transport = httpx.ASGITransport(app=_images_test_app("instructor", db))
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.delete("/api/images/1")

    assert response.status_code == 204
    db.get.assert_awaited_once()
    db.delete.assert_awaited_once_with(img)
    db.commit.assert_awaited_once()


async def test_delete_image_endpoint_rejects_student() -> None:
    db = AsyncMock()

    transport = httpx.ASGITransport(app=_images_test_app("student", db))
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.delete("/api/images/1")

    assert response.status_code == 403
    db.get.assert_not_called()


async def test_bulk_delete_images_endpoint_allows_instructor() -> None:
    imgs = [_make_image(id=1), _make_image(id=2)]
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = imgs

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)
    db.delete = AsyncMock()
    db.commit = AsyncMock()

    transport = httpx.ASGITransport(app=_images_test_app("instructor", db))
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.request(
            "DELETE",
            "/api/images/bulk",
            json={"image_ids": [1, 2]},
        )

    assert response.status_code == 204
    assert db.delete.await_count == 2
    db.commit.assert_awaited_once()


async def test_bulk_delete_images_endpoint_rejects_student() -> None:
    db = AsyncMock()

    transport = httpx.ASGITransport(app=_images_test_app("student", db))
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.request(
            "DELETE",
            "/api/images/bulk",
            json={"image_ids": [1, 2]},
        )

    assert response.status_code == 403
    db.execute.assert_not_called()


# ── Replace Image tests ──────────────────────────────────


def _make_source_image(id: int = 10, image_id: int = 1) -> SimpleNamespace:
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=id,
        original_filename="replacement.jpg",
        stored_path="/data/source_images/abc.jpg",
        status="pending",
        progress=0,
        error_message=None,
        status_message=None,
        name="test-img",
        category_id=None,
        copyright=None,
        note=None,
        active=True,
        image_id=image_id,
        file_size=1024,
        created_at=now,
        updated_at=now,
    )


def _make_upload_file(
    filename: str = "test.jpg", content_type: str = "image/jpeg",
) -> UploadFile:
    return UploadFile(
        file=BytesIO(b"fake-image-data"),
        filename=filename,
        headers=MagicMock(get=lambda k, d=None: content_type if k == "content-type" else d),
    )


@patch("os.path.getsize", return_value=1024)
@patch("os.makedirs")
@patch("builtins.open", new_callable=MagicMock)
async def test_replace_image_success(
    mock_open: MagicMock,
    mock_makedirs: MagicMock,
    mock_getsize: MagicMock,
) -> None:
    """Replacement endpoint creates SourceImage and enqueues processing."""
    mock_enqueue = AsyncMock(return_value=True)
    mock_process = MagicMock()

    img = _make_image()
    src = _make_source_image()

    db = AsyncMock()
    db.get = AsyncMock(return_value=img)
    db.add = MagicMock()
    db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "id", src.id))

    background_tasks = MagicMock()
    file = _make_upload_file()

    with patch.dict("sys.modules", {
        "app.processing": MagicMock(process_replace_image=mock_process),
        "app.worker": MagicMock(enqueue_replace_image=mock_enqueue),
    }):
        result = await replace_image(
            image_id=1,
            file=file,
            background_tasks=background_tasks,
            _user=_make_user(),
            db=db,
        )

    db.add.assert_called_once()
    db.commit.assert_awaited()
    mock_enqueue.assert_awaited_once()
    assert result.original_filename == "test.jpg"
    assert result.status == "pending"


@patch("os.path.getsize", return_value=1024)
@patch("os.makedirs")
@patch("builtins.open", new_callable=MagicMock)
async def test_replace_image_fallback_to_background_tasks(
    mock_open: MagicMock,
    mock_makedirs: MagicMock,
    mock_getsize: MagicMock,
) -> None:
    """When arq enqueue fails, replacement falls back to BackgroundTasks."""
    mock_enqueue = AsyncMock(return_value=False)
    mock_process = MagicMock()

    img = _make_image()
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)
    db.add = MagicMock()
    db.refresh = AsyncMock()

    background_tasks = MagicMock()
    file = _make_upload_file()

    with patch.dict("sys.modules", {
        "app.processing": MagicMock(process_replace_image=mock_process),
        "app.worker": MagicMock(enqueue_replace_image=mock_enqueue),
    }):
        await replace_image(
            image_id=1,
            file=file,
            background_tasks=background_tasks,
            _user=_make_user(),
            db=db,
        )

    background_tasks.add_task.assert_called_once()


@patch("os.path.getsize", return_value=1024)
@patch("os.makedirs")
@patch("builtins.open", new_callable=MagicMock)
async def test_replace_image_applies_metadata_updates(
    mock_open: MagicMock,
    mock_makedirs: MagicMock,
    mock_getsize: MagicMock,
) -> None:
    """Multipart metadata updates are applied before creating the SourceImage."""
    mock_enqueue = AsyncMock(return_value=True)
    img = _make_image(name="old-name", category_id=7, active=True)

    db = AsyncMock()
    db.get = AsyncMock(return_value=img)
    db.add = MagicMock()
    db.refresh = AsyncMock()

    background_tasks = MagicMock()
    file = _make_upload_file(filename="updated.png", content_type="image/png")

    with patch.dict("sys.modules", {
        "app.processing": MagicMock(process_replace_image=MagicMock()),
        "app.worker": MagicMock(enqueue_replace_image=mock_enqueue),
    }):
        result = await replace_image(
            image_id=1,
            file=file,
            background_tasks=background_tasks,
            _user=_make_user(),
            db=db,
            name="renamed",
            category_id="",
            copyright="",
            note="updated note",
            active="0",
            metadata_extra='{"source":"upload"}',
        )

    assert img.name == "renamed"
    assert img.category_id is None
    assert img.copyright is None
    assert img.note == "updated note"
    assert img.active is False
    assert img.metadata_ == {"source": "upload"}
    assert img.version == 2
    assert result.name == "renamed"
    assert result.category_id is None
    assert result.active is False


async def test_replace_image_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    file = _make_upload_file()
    background_tasks = MagicMock()

    with pytest.raises(HTTPException) as exc:
        await replace_image(
            image_id=999,
            file=file,
            background_tasks=background_tasks,
            _user=_make_user(),
            db=db,
        )
    assert exc.value.status_code == 404


async def test_replace_image_invalid_file() -> None:
    img = _make_image()
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)

    file = _make_upload_file(filename="doc.pdf", content_type="application/pdf")
    background_tasks = MagicMock()

    with pytest.raises(HTTPException) as exc:
        await replace_image(
            image_id=1,
            file=file,
            background_tasks=background_tasks,
            _user=_make_user(),
            db=db,
        )
    assert exc.value.status_code == 400
    assert "image" in exc.value.detail.lower()


async def test_replace_image_invalid_metadata_extra() -> None:
    img = _make_image()
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)

    background_tasks = MagicMock()
    file = _make_upload_file()

    with pytest.raises(HTTPException) as exc:
        await replace_image(
            image_id=1,
            file=file,
            background_tasks=background_tasks,
            _user=_make_user(),
            db=db,
            metadata_extra="{invalid-json}",
        )

    assert exc.value.status_code == 400
    assert "metadata_extra" in exc.value.detail


async def test_replace_image_no_filename() -> None:
    img = _make_image()
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)

    file = UploadFile(file=BytesIO(b"data"), filename="")
    background_tasks = MagicMock()

    with pytest.raises(HTTPException) as exc:
        await replace_image(
            image_id=1,
            file=file,
            background_tasks=background_tasks,
            _user=_make_user(),
            db=db,
        )
    assert exc.value.status_code == 400


@patch("os.unlink")
@patch("os.makedirs")
@patch("builtins.open", side_effect=OSError(errno.ENOSPC, "No space left on device"))
async def test_replace_image_enospc(
    mock_open: MagicMock,
    mock_makedirs: MagicMock,
    mock_unlink: MagicMock,
) -> None:
    """ENOSPC during replace file write returns 507."""
    img = _make_image()
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)

    file = AsyncMock()
    file.filename = "huge.tiff"
    file.content_type = "image/tiff"
    file.read = AsyncMock(side_effect=[b"data", b""])

    background_tasks = MagicMock()

    with (
        patch("app.routers.images.settings") as mock_settings,
        pytest.raises(HTTPException) as exc,
    ):
        mock_settings.source_images_dir = "/data/source_images"
        await replace_image(
            image_id=1,
            file=file,
            background_tasks=background_tasks,
            _user=_make_user(),
            db=db,
        )

    assert exc.value.status_code == 507
    assert "storage" in exc.value.detail.lower()
    mock_unlink.assert_called_once()


@patch("os.unlink")
@patch("os.makedirs")
@patch("builtins.open", side_effect=OSError(errno.EIO, "I/O error"))
async def test_replace_image_reraises_non_enospc_oserror(
    mock_open: MagicMock,
    mock_makedirs: MagicMock,
    mock_unlink: MagicMock,
) -> None:
    """Unexpected filesystem errors should propagate after cleanup."""
    img = _make_image()
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)

    file = AsyncMock()
    file.filename = "broken.tiff"
    file.content_type = "image/tiff"
    file.read = AsyncMock(side_effect=[b"data", b""])

    background_tasks = MagicMock()

    with (
        patch("app.routers.images.settings") as mock_settings,
        pytest.raises(OSError, match="I/O error"),
    ):
        mock_settings.source_images_dir = "/data/source_images"
        await replace_image(
            image_id=1,
            file=file,
            background_tasks=background_tasks,
            _user=_make_user(),
            db=db,
        )

    mock_unlink.assert_called_once()


# ── Reorder images ────────────────────────────────────────


async def test_reorder_images_success() -> None:
    img1 = _make_image(id=1, sort_order=0)
    img2 = _make_image(id=2, sort_order=1)

    items = [
        ImageReorderItem(id=1, sort_order=1),
        ImageReorderItem(id=2, sort_order=0),
    ]
    body = ImageReorderRequest(items=items)

    async def mock_get(model, id_):
        lookup = {1: img1, 2: img2}
        return lookup.get(id_)

    db = AsyncMock()
    db.get = AsyncMock(side_effect=mock_get)
    db.commit = AsyncMock()

    result = await reorder_images(body, MagicMock(), db=db)
    assert result == {"status": "ok"}
    assert img1.sort_order == 1
    assert img2.sort_order == 0
    db.commit.assert_awaited_once()


async def test_reorder_images_missing_image() -> None:
    items = [ImageReorderItem(id=999, sort_order=0)]
    body = ImageReorderRequest(items=items)

    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await reorder_images(body, MagicMock(), db=db)
    assert exc.value.status_code == 404


async def test_reorder_images_empty_list() -> None:
    body = ImageReorderRequest(items=[])
    db = AsyncMock()
    db.commit = AsyncMock()

    result = await reorder_images(body, MagicMock(), db=db)
    assert result == {"status": "ok"}
    db.commit.assert_awaited_once()
