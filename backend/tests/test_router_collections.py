"""Tests for the collections router: list/detail visibility, image filtering,
and the write API (create / update / delete / images / viewport + OCC)."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.sql.dml import Update

from app.models import Collection, CollectionImage, Group, Image, Program, User
from app.routers import collections as collections_router
from app.routers.collections import (
    create_collection,
    delete_collection,
    get_collection,
    list_collections,
    replace_collection_images,
    replace_collection_viewport,
    update_collection,
)
from app.schemas import (
    CollectionCreate,
    CollectionImagesUpdate,
    CollectionUpdate,
    CollectionViewportUpdate,
)

NOW = datetime.now(timezone.utc)


def _user(
    role: str = "admin",
    id: int = 1,
    programs: list[int] | None = None,
    groups: list[int] | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=id,
        role=role,
        name=f"user{id}",
        email=f"u{id}@e.com",
        programs=[SimpleNamespace(id=p, name=f"P{p}") for p in (programs or [])],
        groups=[SimpleNamespace(id=g) for g in (groups or [])],
    )


def _image(id: int, category_id: int | None = None, active: bool = True) -> SimpleNamespace:
    return SimpleNamespace(
        id=id,
        name=f"img{id}",
        thumb=f"/thumbs/{id}.jpg",
        tile_sources=f"/tiles/{id}.dzi",
        category_id=category_id,
        copyright=None,
        note=None,
        active=active,
        sort_order=0,
        metadata_=None,
        version=1,
        width=None,
        height=None,
        file_size=None,
        created_at=NOW,
        updated_at=NOW,
    )


def _collection(
    id: int = 1,
    visibility: str = "private",
    user_id: int | None = 10,
    owner_program_id: int | None = None,
    images: list | None = None,
    programs: list[int] | None = None,
    groups: list[int] | None = None,
    type: str = "sequence",
) -> SimpleNamespace:
    owner = SimpleNamespace(id=user_id, name=f"user{user_id}") if user_id else None
    owner_program = (
        SimpleNamespace(id=owner_program_id, name=f"P{owner_program_id}")
        if owner_program_id
        else None
    )
    return SimpleNamespace(
        id=id,
        name=f"C{id}",
        description=None,
        type=type,
        visibility=visibility,
        user_id=user_id,
        owner_program_id=owner_program_id,
        owner=owner,
        owner_program=owner_program,
        viewport_state={"1": {"zoom": 1.0}},
        version=3,
        created_at=NOW,
        updated_at=NOW,
        programs=[SimpleNamespace(id=p) for p in (programs or [])],
        groups=[SimpleNamespace(id=g) for g in (groups or [])],
        image_links=[
            SimpleNamespace(sort_order=i, image_id=img.id, image=img)
            for i, img in enumerate(images or [])
        ],
    )


def _mock_db(collections: list | None = None, get: object = None) -> AsyncMock:
    db = AsyncMock()
    db.get = AsyncMock(return_value=get)
    result = MagicMock()
    result.scalars.return_value.unique.return_value.all.return_value = collections or []
    db.execute = AsyncMock(return_value=result)
    return db


def _program(id: int) -> Program:
    # Real (transient) ORM rows: they are assigned to ``Collection.programs``
    # on a mapped instance during create, which rejects plain namespaces.
    return Program(id=id, name=f"P{id}")


def _group(id: int, instructors: list[int] | None = None) -> Group:
    return Group(
        id=id,
        name=f"G{id}",
        instructors=[
            User(id=i, name=f"user{i}", email=f"u{i}@e.com", role="instructor")
            for i in (instructors or [])
        ],
    )


def _write_db(
    get: object = None,
    images: list | None = None,
    programs: list | None = None,
    groups: list | None = None,
    cas_rowcount: int = 1,
) -> AsyncMock:
    """Mock session for the write API.

    ``execute`` answers ``SELECT`` by entity (Image / Program / Group) with the
    supplied rows and answers the optimistic-concurrency ``UPDATE`` with
    ``cas_rowcount``. ``refresh`` fills server-generated columns on freshly
    created ORM instances so ``collection_out`` can serialize them.
    """
    db = AsyncMock()
    db.add = MagicMock()
    db.get = AsyncMock(return_value=get)
    rows_by_entity = {
        Image: images or [],
        Program: programs or [],
        Group: groups or [],
    }

    async def _execute(stmt):
        result = MagicMock()
        if isinstance(stmt, Update):
            result.rowcount = cas_rowcount
            return result
        entity = stmt.column_descriptions[0]["entity"]
        result.scalars.return_value.all.return_value = rows_by_entity[entity]
        return result

    async def _refresh(obj, *args, **kwargs):
        if isinstance(obj, Collection):
            if obj.id is None:
                obj.id = 1
            if obj.created_at is None:
                obj.created_at = NOW
            if obj.updated_at is None:
                obj.updated_at = NOW

    db.execute = AsyncMock(side_effect=_execute)
    db.refresh = AsyncMock(side_effect=_refresh)
    return db


def _links(collection) -> list[tuple[int, int]]:
    return [(link.image_id, link.sort_order) for link in collection.image_links]


@pytest.fixture(autouse=True)
def _no_excluded(monkeypatch: pytest.MonkeyPatch) -> None:
    """Default: student visibility excludes nothing; tests override as needed."""
    monkeypatch.setattr(
        collections_router,
        "get_student_excluded_category_ids",
        AsyncMock(return_value=set()),
    )


# ── list ──────────────────────────────────────────────────


async def test_list_non_students_see_everything() -> None:
    cols = [
        _collection(1, "private", user_id=10),
        _collection(2, "restricted", user_id=11, programs=[1], groups=[5]),
    ]
    for role in ("admin", "instructor", "staff"):
        out = await list_collections(_user(role, id=99), db=_mock_db(cols))
        assert [c.id for c in out] == [1, 2]


async def test_list_student_filters_private_and_dual_gate() -> None:
    cols = [
        _collection(1, "private", user_id=10),  # someone else's private
        _collection(2, "private", user_id=2),  # own private
        _collection(3, "public", user_id=10),
        _collection(4, "restricted", user_id=10, programs=[1], groups=[5]),  # pass
        _collection(5, "restricted", user_id=10, programs=[1], groups=[6]),  # group fails
        _collection(6, "restricted", user_id=10, programs=[9], groups=[5]),  # program fails
        _collection(7, "restricted", user_id=10),  # unrestricted on both dims
    ]
    student = _user("student", id=2, programs=[1], groups=[5])
    out = await list_collections(student, db=_mock_db(cols))
    assert [c.id for c in out] == [2, 3, 4, 7]


async def test_list_summary_fields_and_permissions_for_owner() -> None:
    images = [_image(1), _image(2)]
    col = _collection(1, "private", user_id=2, images=images)
    out = await list_collections(_user("student", id=2), db=_mock_db([col]))
    summary = out[0]
    assert summary.image_count == 2
    assert summary.cover_thumb == "/thumbs/1.jpg"
    assert summary.owner.user_id == 2 and summary.owner.name == "user2"
    assert summary.owner.program_id is None
    assert summary.permissions.can_edit is True
    assert summary.permissions.can_delete is True
    assert summary.permissions.can_transfer is False  # students cannot transfer
    assert summary.version == 3


async def test_list_program_owned_owner_and_instructor_permissions() -> None:
    col = _collection(1, "public", user_id=None, owner_program_id=3)
    out = await list_collections(
        _user("instructor", id=7, programs=[3]), db=_mock_db([col])
    )
    assert out[0].owner.program_id == 3 and out[0].owner.name == "P3"
    assert out[0].permissions.can_edit is True
    assert out[0].permissions.can_transfer is True
    other = await list_collections(
        _user("instructor", id=8, programs=[4]), db=_mock_db([col])
    )
    assert other[0].permissions.can_edit is False


async def test_list_orphaned_owner_is_none() -> None:
    col = _collection(1, "public", user_id=None, owner_program_id=None)
    out = await list_collections(_user("admin"), db=_mock_db([col]), orphaned=True)
    assert out[0].owner is None
    assert out[0].permissions.can_edit is True


async def test_list_orphaned_filter_admin_only() -> None:
    for role in ("instructor", "staff", "student"):
        with pytest.raises(HTTPException) as exc:
            await list_collections(_user(role), db=_mock_db([]), orphaned=True)
        assert exc.value.status_code == 403


async def test_list_rejects_unknown_type() -> None:
    with pytest.raises(HTTPException) as exc:
        await list_collections(_user("admin"), db=_mock_db([]), type="bogus")
    assert exc.value.status_code == 422


async def test_list_applies_query_filters_to_statement() -> None:
    db = _mock_db([])
    await list_collections(
        _user("admin"),
        db=db,
        type="synchronized",
        mine=True,
        owner_user_id=4,
        owner_program_id=5,
        orphaned=True,
    )
    sql = str(db.execute.call_args.args[0])
    assert "collections.type =" in sql
    assert "collections.user_id =" in sql
    assert "collections.owner_program_id =" in sql
    assert "collections.user_id IS NULL" in sql
    assert "collections.owner_program_id IS NULL" in sql
    assert "ORDER BY collections.updated_at DESC" in sql


async def test_list_student_image_count_omits_hidden_images(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    excluded = AsyncMock(return_value={20})
    monkeypatch.setattr(
        collections_router, "get_student_excluded_category_ids", excluded
    )
    images = [_image(1, category_id=20), _image(2, category_id=21), _image(3, active=False)]
    col = _collection(1, "public", user_id=10, images=images)
    student = _user("student", id=2, programs=[1], groups=[5])
    out = await list_collections(student, db=_mock_db([col]))
    assert out[0].image_count == 1
    assert out[0].cover_thumb == "/thumbs/2.jpg"
    # Both gates are passed through — never omit user_group_ids.
    excluded.assert_awaited_once()
    assert excluded.await_args.args[1:] == ({1}, {5})


async def test_list_non_student_does_not_compute_exclusions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    excluded = AsyncMock(return_value=set())
    monkeypatch.setattr(
        collections_router, "get_student_excluded_category_ids", excluded
    )
    col = _collection(1, "public", user_id=10, images=[_image(1, active=False)])
    out = await list_collections(_user("staff", id=3), db=_mock_db([col]))
    assert out[0].image_count == 1
    excluded.assert_not_awaited()


# ── detail ────────────────────────────────────────────────


async def test_get_collection_detail_shape() -> None:
    images = [_image(1), _image(2)]
    col = _collection(1, "restricted", user_id=10, images=images, programs=[1], groups=[5])
    out = await get_collection(1, _user("instructor", id=7), db=_mock_db(get=col))
    assert [i.id for i in out.images] == [1, 2]
    assert out.program_ids == [1]
    assert out.group_ids == [5]
    assert out.viewport_state == {"1": {"zoom": 1.0}}
    assert out.image_count == 2
    dumped = out.model_dump()
    assert dumped["images"][0]["tile_sources"].startswith("/tiles/1.dzi")
    assert dumped["cover_thumb"].startswith("/thumbs/1.jpg")


async def test_get_collection_missing_is_404() -> None:
    with pytest.raises(HTTPException) as exc:
        await get_collection(99, _user("admin"), db=_mock_db(get=None))
    assert exc.value.status_code == 404


async def test_get_collection_hidden_from_student_is_404_not_403() -> None:
    col = _collection(1, "private", user_id=10)
    with pytest.raises(HTTPException) as exc:
        await get_collection(1, _user("student", id=2), db=_mock_db(get=col))
    assert exc.value.status_code == 404
    assert exc.value.detail == "Collection not found"


async def test_get_collection_student_omits_invisible_images(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        collections_router,
        "get_student_excluded_category_ids",
        AsyncMock(return_value={20}),
    )
    images = [
        _image(1, category_id=20),
        _image(2, category_id=None),
        _image(3, category_id=21, active=False),
        _image(4, category_id=21),
    ]
    col = _collection(1, "public", user_id=10, images=images, type="synchronized")
    out = await get_collection(1, _user("student", id=2), db=_mock_db(get=col))
    assert [i.id for i in out.images] == [2, 4]
    assert out.image_count == 2


async def test_get_collection_skips_dangling_links() -> None:
    col = _collection(1, "public", user_id=10, images=[_image(1)])
    col.image_links.append(SimpleNamespace(sort_order=5, image=None))
    out = await get_collection(1, _user("admin"), db=_mock_db(get=col))
    assert [i.id for i in out.images] == [1]


# ── create ────────────────────────────────────────────────


@pytest.mark.parametrize("role", ["admin", "instructor", "staff", "student"])
async def test_create_private_collection_any_role_owner_is_caller(role: str) -> None:
    db = _write_db(images=[_image(1), _image(2)])
    body = CollectionCreate(name="  Mine ", type="sequence", image_ids=[2, 1])
    out = await create_collection(body, _user(role, id=42), db=db)
    created = db.add.call_args.args[0]
    assert isinstance(created, Collection)
    assert created.user_id == 42 and created.owner_program_id is None
    assert created.name == "Mine"
    assert created.visibility == "private"
    assert created.version == 1
    assert created.viewport_state == {}
    assert _links(created) == [(2, 0), (1, 1)]
    assert out.version == 1 and out.type == "sequence"
    db.commit.assert_awaited_once()


async def test_create_restricted_admin_attaches_any_program_and_group() -> None:
    db = _write_db(programs=[_program(1), _program(2)], groups=[_group(5, [99])])
    body = CollectionCreate(
        name="R", type="synchronized", visibility="restricted",
        program_ids=[1, 2], group_ids=[5],
    )
    out = await create_collection(body, _user("admin"), db=db)
    created = db.add.call_args.args[0]
    assert [p.id for p in created.programs] == [1, 2]
    assert [g.id for g in created.groups] == [5]
    assert out.program_ids == [1, 2] and out.group_ids == [5]


async def test_create_restricted_instructor_own_program_and_managed_group() -> None:
    db = _write_db(programs=[_program(1)], groups=[_group(5, [7])])
    body = CollectionCreate(
        name="R", type="sequence", visibility="restricted",
        program_ids=[1], group_ids=[5],
    )
    out = await create_collection(body, _user("instructor", id=7, programs=[1]), db=db)
    assert out.program_ids == [1] and out.group_ids == [5]


async def test_create_restricted_instructor_foreign_program_is_403() -> None:
    db = _write_db(programs=[_program(2)])
    body = CollectionCreate(
        name="R", type="sequence", visibility="restricted", program_ids=[2],
    )
    with pytest.raises(HTTPException) as exc:
        await create_collection(body, _user("instructor", id=7, programs=[1]), db=db)
    assert exc.value.status_code == 403
    db.commit.assert_not_awaited()


async def test_create_restricted_instructor_unmanaged_group_is_403() -> None:
    db = _write_db(groups=[_group(5, [8])])
    body = CollectionCreate(
        name="R", type="sequence", visibility="restricted", group_ids=[5],
    )
    with pytest.raises(HTTPException) as exc:
        await create_collection(body, _user("instructor", id=7), db=db)
    assert exc.value.status_code == 403


@pytest.mark.parametrize("role", ["staff", "student"])
async def test_create_restricted_staff_and_student_are_403(role: str) -> None:
    body = CollectionCreate(name="R", type="sequence", visibility="restricted")
    with pytest.raises(HTTPException) as exc:
        await create_collection(body, _user(role, id=3), db=_write_db())
    assert exc.value.status_code == 403


async def test_create_restricted_unknown_program_or_group_is_422() -> None:
    body = CollectionCreate(
        name="R", type="sequence", visibility="restricted", program_ids=[1, 9],
    )
    with pytest.raises(HTTPException) as exc:
        await create_collection(body, _user("admin"), db=_write_db(programs=[_program(1)]))
    assert exc.value.status_code == 422 and "[9]" in exc.value.detail

    body = CollectionCreate(
        name="R", type="sequence", visibility="restricted", group_ids=[5],
    )
    with pytest.raises(HTTPException) as exc:
        await create_collection(body, _user("admin"), db=_write_db())
    assert exc.value.status_code == 422 and "[5]" in exc.value.detail


async def test_create_with_missing_image_id_is_422() -> None:
    body = CollectionCreate(name="C", type="sequence", image_ids=[1, 7])
    with pytest.raises(HTTPException) as exc:
        await create_collection(body, _user("admin"), db=_write_db(images=[_image(1)]))
    assert exc.value.status_code == 422 and "[7]" in exc.value.detail


async def test_create_student_invisible_image_is_422(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    excluded = AsyncMock(return_value={20})
    monkeypatch.setattr(collections_router, "get_student_excluded_category_ids", excluded)
    images = [_image(1, category_id=20), _image(2, category_id=21), _image(3, active=False)]
    body = CollectionCreate(name="C", type="sequence", image_ids=[1, 2, 3])
    student = _user("student", id=2, programs=[1], groups=[5])
    with pytest.raises(HTTPException) as exc:
        await create_collection(body, student, db=_write_db(images=images))
    assert exc.value.status_code == 422 and "[1, 3]" in exc.value.detail
    assert excluded.await_args.args[1:] == ({1}, {5})


async def test_create_non_student_may_add_inactive_image() -> None:
    db = _write_db(images=[_image(3, active=False)])
    body = CollectionCreate(name="C", type="sequence", image_ids=[3])
    await create_collection(body, _user("staff", id=3), db=db)
    assert _links(db.add.call_args.args[0]) == [(3, 0)]


# ── edit / delete authority matrix ────────────────────────


def _patch(version: int = 3, **kwargs) -> CollectionUpdate:
    return CollectionUpdate(version=version, **kwargs)


async def test_update_hidden_collection_is_404_not_403() -> None:
    col = _collection(1, "private", user_id=10)
    with pytest.raises(HTTPException) as exc:
        await update_collection(1, _patch(name="x"), _user("student", id=2), db=_write_db(get=col))
    assert exc.value.status_code == 404


async def test_update_missing_collection_is_404() -> None:
    with pytest.raises(HTTPException) as exc:
        await update_collection(9, _patch(name="x"), _user("admin"), db=_write_db(get=None))
    assert exc.value.status_code == 404


async def test_update_viewable_but_not_editable_is_403() -> None:
    col = _collection(1, "public", user_id=10)
    for user in (_user("staff", id=3), _user("student", id=2), _user("instructor", id=7)):
        with pytest.raises(HTTPException) as exc:
            await update_collection(1, _patch(name="x"), user, db=_write_db(get=col))
        assert exc.value.status_code == 403


@pytest.mark.parametrize("role", ["admin", "instructor", "staff", "student"])
async def test_owner_or_admin_may_update(role: str) -> None:
    col = _collection(1, "private", user_id=2)
    user = _user(role, id=2 if role != "admin" else 1)
    out = await update_collection(1, _patch(name="New"), user, db=_write_db(get=col))
    assert out.name == "New"


async def test_instructor_of_owning_program_may_update_and_delete() -> None:
    col = _collection(1, "public", user_id=None, owner_program_id=3)
    db = _write_db(get=col)
    out = await update_collection(
        1, _patch(name="N"), _user("instructor", id=7, programs=[3]), db=db
    )
    assert out.name == "N"
    await delete_collection(1, _user("instructor", id=7, programs=[3]), db=_write_db(get=col))

    other = _user("instructor", id=8, programs=[4])
    with pytest.raises(HTTPException) as exc:
        await update_collection(1, _patch(name="N"), other, db=_write_db(get=col))
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        await delete_collection(1, other, db=_write_db(get=col))
    assert exc.value.status_code == 403


async def test_orphaned_collection_is_admin_only() -> None:
    col = _collection(1, "public", user_id=None, owner_program_id=None)
    out = await update_collection(1, _patch(name="N"), _user("admin"), db=_write_db(get=col))
    assert out.name == "N"
    await delete_collection(1, _user("admin"), db=_write_db(get=col))
    for user in (_user("instructor", id=7, programs=[3]), _user("staff", id=3)):
        with pytest.raises(HTTPException) as exc:
            await update_collection(1, _patch(name="N"), user, db=_write_db(get=col))
        assert exc.value.status_code == 403
        with pytest.raises(HTTPException) as exc:
            await delete_collection(1, user, db=_write_db(get=col))
        assert exc.value.status_code == 403


async def test_delete_owner_returns_204_and_deletes() -> None:
    col = _collection(1, "private", user_id=2)
    db = _write_db(get=col)
    response = await delete_collection(1, _user("student", id=2), db=db)
    assert response.status_code == 204
    db.delete.assert_awaited_once_with(col)
    db.commit.assert_awaited_once()


async def test_delete_hidden_is_404_and_visible_non_owner_is_403() -> None:
    hidden = _collection(1, "private", user_id=10)
    with pytest.raises(HTTPException) as exc:
        await delete_collection(1, _user("student", id=2), db=_write_db(get=hidden))
    assert exc.value.status_code == 404
    public = _collection(2, "public", user_id=10)
    with pytest.raises(HTTPException) as exc:
        await delete_collection(2, _user("staff", id=3), db=_write_db(get=public))
    assert exc.value.status_code == 403


# ── update semantics ──────────────────────────────────────


async def test_update_changes_fields_and_increments_version() -> None:
    col = _collection(1, "private", user_id=2)
    db = _write_db(get=col)
    out = await update_collection(
        1,
        _patch(name="Renamed", description="  d  ", type="sequence"),
        _user("student", id=2),
        db=db,
    )
    assert col.name == "Renamed" and col.description == "d"
    assert col.version == 4 and out.version == 4
    cas = db.execute.call_args.args[0]
    assert isinstance(cas, Update)
    assert "collections.version =" in str(cas)
    db.commit.assert_awaited_once()
    db.refresh.assert_awaited_once_with(col)


async def test_update_blank_description_clears_it() -> None:
    col = _collection(1, "private", user_id=2)
    col.description = "old"
    await update_collection(1, _patch(description=""), _user("student", id=2), db=_write_db(get=col))
    assert col.description is None


async def test_update_type_change_is_422_same_type_is_ok() -> None:
    col = _collection(1, "private", user_id=2, type="sequence")
    with pytest.raises(HTTPException) as exc:
        await update_collection(
            1, _patch(type="synchronized"), _user("student", id=2), db=_write_db(get=col)
        )
    assert exc.value.status_code == 422
    assert col.version == 3


async def test_update_stale_version_is_409_with_current_collection() -> None:
    col = _collection(1, "private", user_id=2)
    db = _write_db(get=col)
    with pytest.raises(HTTPException) as exc:
        await update_collection(1, _patch(version=2, name="x"), _user("student", id=2), db=db)
    assert exc.value.status_code == 409
    detail = exc.value.detail
    assert detail["id"] == 1 and detail["version"] == 3 and detail["name"] == "C1"
    assert detail["viewport_state"] == {"1": {"zoom": 1.0}}
    assert col.name == "C1"
    db.commit.assert_not_awaited()
    db.refresh.assert_awaited_once_with(col)


async def test_update_lost_cas_race_is_409() -> None:
    """Version matched in memory but the atomic UPDATE hit zero rows."""
    col = _collection(1, "private", user_id=2)
    db = _write_db(get=col, cas_rowcount=0)
    with pytest.raises(HTTPException) as exc:
        await update_collection(1, _patch(name="x"), _user("student", id=2), db=db)
    assert exc.value.status_code == 409
    assert exc.value.detail["version"] == 3
    db.commit.assert_not_awaited()


async def test_update_to_restricted_requires_admin_or_instructor() -> None:
    for role in ("staff", "student"):
        col = _collection(1, "private", user_id=2)
        with pytest.raises(HTTPException) as exc:
            await update_collection(
                1, _patch(visibility="restricted"), _user(role, id=2), db=_write_db(get=col)
            )
        assert exc.value.status_code == 403


async def test_update_restricted_scope_rechecks_attach_authority() -> None:
    col = _collection(1, "restricted", user_id=7, programs=[1])
    db = _write_db(get=col, programs=[_program(1), _program(2)])
    with pytest.raises(HTTPException) as exc:
        await update_collection(
            1, _patch(program_ids=[1, 2]), _user("instructor", id=7, programs=[1]), db=db
        )
    assert exc.value.status_code == 403
    db.commit.assert_not_awaited()

    # Already-attached programs are retained without re-checking; dropping is free.
    col = _collection(1, "restricted", user_id=7, programs=[1, 2])
    db = _write_db(get=col, programs=[_program(2)])
    out = await update_collection(
        1, _patch(program_ids=[2]), _user("instructor", id=7, programs=[1]), db=db
    )
    assert out.program_ids == [2]


async def test_update_restricted_groups_admin_any_instructor_managed_only() -> None:
    col = _collection(1, "restricted", user_id=1)
    db = _write_db(get=col, groups=[_group(5, [8])])
    out = await update_collection(1, _patch(group_ids=[5]), _user("admin"), db=db)
    assert out.group_ids == [5]

    col = _collection(1, "restricted", user_id=7)
    db = _write_db(get=col, groups=[_group(5, [8])])
    with pytest.raises(HTTPException) as exc:
        await update_collection(1, _patch(group_ids=[5]), _user("instructor", id=7), db=db)
    assert exc.value.status_code == 403


async def test_update_leaving_restricted_clears_scope() -> None:
    col = _collection(1, "restricted", user_id=1, programs=[1], groups=[5])
    out = await update_collection(
        1, _patch(visibility="public"), _user("admin"), db=_write_db(get=col)
    )
    assert col.visibility == "public"
    assert col.programs == [] and col.groups == []
    assert out.program_ids == [] and out.group_ids == []


async def test_update_scope_on_non_restricted_is_422() -> None:
    col = _collection(1, "public", user_id=1)
    with pytest.raises(HTTPException) as exc:
        await update_collection(
            1, _patch(program_ids=[1]), _user("admin"), db=_write_db(get=col)
        )
    assert exc.value.status_code == 422
    assert col.version == 3


# ── images ────────────────────────────────────────────────


def _images_body(ids: list[int], version: int = 3) -> CollectionImagesUpdate:
    return CollectionImagesUpdate(image_ids=ids, version=version)


async def test_replace_images_rewrites_sort_order_and_reuses_links() -> None:
    col = _collection(1, "private", user_id=2, images=[_image(1), _image(2), _image(3)])
    kept = {link.image_id: link for link in col.image_links}
    db = _write_db(get=col, images=[_image(1), _image(3), _image(4)])
    out = await replace_collection_images(
        1, _images_body([4, 3, 1]), _user("student", id=2), db=db
    )
    assert _links(col) == [(4, 0), (3, 1), (1, 2)]
    assert col.image_links[1] is kept[3] and col.image_links[2] is kept[1]
    assert isinstance(col.image_links[0], CollectionImage)
    assert col.version == 4 and out.version == 4
    db.commit.assert_awaited_once()


async def test_replace_images_empty_list_clears_collection() -> None:
    col = _collection(1, "private", user_id=2, images=[_image(1)])
    db = _write_db(get=col)
    out = await replace_collection_images(1, _images_body([]), _user("student", id=2), db=db)
    assert col.image_links == [] and out.image_count == 0
    db.execute.assert_awaited_once()  # only the version CAS, no image lookup


async def test_replace_images_missing_id_is_422() -> None:
    col = _collection(1, "private", user_id=2)
    db = _write_db(get=col, images=[_image(1)])
    with pytest.raises(HTTPException) as exc:
        await replace_collection_images(1, _images_body([1, 8]), _user("student", id=2), db=db)
    assert exc.value.status_code == 422 and "[8]" in exc.value.detail
    assert col.version == 3
    db.commit.assert_not_awaited()


async def test_replace_images_duplicates_are_422() -> None:
    with pytest.raises(ValueError):
        CollectionImagesUpdate(image_ids=[1, 1], version=3)
    col = _collection(1, "private", user_id=2)
    body = SimpleNamespace(image_ids=[1, 1], version=3)
    with pytest.raises(HTTPException) as exc:
        await replace_collection_images(1, body, _user("student", id=2), db=_write_db(get=col))
    assert exc.value.status_code == 422


async def test_replace_images_synchronized_cap_is_422() -> None:
    col = _collection(1, "private", user_id=2, type="synchronized")
    images = [_image(i) for i in range(1, 6)]
    with pytest.raises(HTTPException) as exc:
        await replace_collection_images(
            1, _images_body([1, 2, 3, 4, 5]), _user("student", id=2), db=_write_db(get=col, images=images)
        )
    assert exc.value.status_code == 422 and "at most 4" in exc.value.detail
    out = await replace_collection_images(
        1, _images_body([1, 2, 3, 4]), _user("student", id=2), db=_write_db(get=col, images=images)
    )
    assert _links(col) == [(1, 0), (2, 1), (3, 2), (4, 3)] and out.version == 4


async def test_replace_images_sequence_has_no_cap() -> None:
    col = _collection(1, "private", user_id=2, type="sequence")
    images = [_image(i) for i in range(1, 7)]
    await replace_collection_images(
        1, _images_body([1, 2, 3, 4, 5, 6]), _user("student", id=2), db=_write_db(get=col, images=images)
    )
    assert [o for _, o in _links(col)] == [0, 1, 2, 3, 4, 5]


async def test_replace_images_student_invisible_is_422(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    excluded = AsyncMock(return_value={20})
    monkeypatch.setattr(collections_router, "get_student_excluded_category_ids", excluded)
    col = _collection(1, "private", user_id=2)
    images = [_image(1, category_id=20), _image(2, category_id=21), _image(3, active=False)]
    student = _user("student", id=2, programs=[1], groups=[5])
    with pytest.raises(HTTPException) as exc:
        await replace_collection_images(
            1, _images_body([2, 1]), student, db=_write_db(get=col, images=images)
        )
    assert exc.value.status_code == 422 and "[1]" in exc.value.detail
    with pytest.raises(HTTPException) as exc:
        await replace_collection_images(
            1, _images_body([3]), student, db=_write_db(get=col, images=images)
        )
    assert exc.value.status_code == 422 and "[3]" in exc.value.detail
    assert excluded.await_args.args[1:] == ({1}, {5})
    out = await replace_collection_images(
        1, _images_body([2]), student, db=_write_db(get=col, images=images)
    )
    assert _links(col) == [(2, 0)] and out.version == 4


async def test_replace_images_authority_and_version() -> None:
    col = _collection(1, "public", user_id=10)
    with pytest.raises(HTTPException) as exc:
        await replace_collection_images(1, _images_body([]), _user("staff", id=3), db=_write_db(get=col))
    assert exc.value.status_code == 403
    hidden = _collection(2, "private", user_id=10)
    with pytest.raises(HTTPException) as exc:
        await replace_collection_images(2, _images_body([]), _user("student", id=2), db=_write_db(get=hidden))
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        await replace_collection_images(1, _images_body([], version=1), _user("admin"), db=_write_db(get=col))
    assert exc.value.status_code == 409 and exc.value.detail["version"] == 3


# ── viewport ──────────────────────────────────────────────


async def test_replace_viewport_is_whole_replacement() -> None:
    col = _collection(1, "private", user_id=2)  # has {"1": {"zoom": 1.0}}
    db = _write_db(get=col)
    body = CollectionViewportUpdate(viewport_state={"2": {"pan": [0, 1]}}, version=3)
    out = await replace_collection_viewport(1, body, _user("student", id=2), db=db)
    assert col.viewport_state == {"2": {"pan": [0, 1]}}  # key "1" not merged in
    assert out.viewport_state == {"2": {"pan": [0, 1]}}
    assert col.version == 4 and out.version == 4
    db.commit.assert_awaited_once()

    out = await replace_collection_viewport(
        1, CollectionViewportUpdate(viewport_state={}, version=4), _user("student", id=2), db=db
    )
    assert col.viewport_state == {} and out.version == 5


async def test_replace_viewport_stale_version_is_409() -> None:
    col = _collection(1, "private", user_id=2)
    body = CollectionViewportUpdate(viewport_state={"x": 1}, version=1)
    with pytest.raises(HTTPException) as exc:
        await replace_collection_viewport(1, body, _user("student", id=2), db=_write_db(get=col))
    assert exc.value.status_code == 409
    assert exc.value.detail["viewport_state"] == {"1": {"zoom": 1.0}}
    assert col.viewport_state == {"1": {"zoom": 1.0}}


async def test_replace_viewport_authority() -> None:
    body = CollectionViewportUpdate(viewport_state={}, version=3)
    with pytest.raises(HTTPException) as exc:
        await replace_collection_viewport(
            1, body, _user("staff", id=3), db=_write_db(get=_collection(1, "public", user_id=10))
        )
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        await replace_collection_viewport(
            1, body, _user("student", id=2), db=_write_db(get=_collection(1, "private", user_id=10))
        )
    assert exc.value.status_code == 404


# ── write helpers (direct) ────────────────────────────────


def test_replace_image_links_reuses_rows_and_rewrites_order() -> None:
    col = Collection(id=1, name="C", type="sequence", visibility="private", version=1)
    keep = CollectionImage(image_id=1, sort_order=0)
    drop = CollectionImage(image_id=2, sort_order=1)
    col.image_links = [keep, drop]
    collections_router._replace_image_links(col, [_image(3), _image(1)])
    assert _links(col) == [(3, 0), (1, 1)]
    assert col.image_links[1] is keep and drop not in col.image_links
    collections_router._replace_image_links(col, [])
    assert col.image_links == []


async def test_bump_version_matches_and_increments() -> None:
    col = _collection(1, "private", user_id=2)
    db = _write_db(get=col)
    ctx = await collections_router._ViewerContext.build(db, _user("student", id=2))
    await collections_router._bump_version_or_409(db, ctx, col, 3)
    assert col.version == 4
    stmt = db.execute.call_args.args[0]
    assert isinstance(stmt, Update)
    compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    assert "collections.version = 3" in compiled and "SET version=4" in compiled
    db.refresh.assert_not_awaited()


async def test_bump_version_mismatch_skips_update_and_raises_409() -> None:
    col = _collection(1, "private", user_id=2)
    db = _write_db(get=col)
    ctx = await collections_router._ViewerContext.build(db, _user("student", id=2))
    with pytest.raises(HTTPException) as exc:
        await collections_router._bump_version_or_409(db, ctx, col, 2)
    assert exc.value.status_code == 409
    assert exc.value.detail["version"] == 3
    db.execute.assert_not_awaited()
    db.refresh.assert_awaited_once_with(col)
    assert col.version == 3


async def test_bump_version_after_concurrent_delete_is_404() -> None:
    col = _collection(1, "private", user_id=2)
    db = _write_db(get=col, cas_rowcount=0)
    db.refresh = AsyncMock(side_effect=InvalidRequestError("Could not refresh instance"))
    ctx = await collections_router._ViewerContext.build(db, _user("student", id=2))
    with pytest.raises(HTTPException) as exc:
        await collections_router._bump_version_or_409(db, ctx, col, 3)
    assert exc.value.status_code == 404


async def test_get_editable_collection_or_error_matrix() -> None:
    col = _collection(1, "public", user_id=10)
    ctx, got = await collections_router.get_editable_collection_or_error(
        _write_db(get=col), _user("admin"), 1
    )
    assert got is col and ctx.excluded_category_ids is None
    with pytest.raises(HTTPException) as exc:
        await collections_router.get_editable_collection_or_error(
            _write_db(get=col), _user("staff", id=3), 1
        )
    assert exc.value.status_code == 403
    hidden = _collection(2, "private", user_id=10)
    with pytest.raises(HTTPException) as exc:
        await collections_router.get_editable_collection_or_error(
            _write_db(get=hidden), _user("student", id=2), 2
        )
    assert exc.value.status_code == 404


def test_require_restricted_authority() -> None:
    collections_router._require_restricted_authority(_user("admin"))
    collections_router._require_restricted_authority(_user("instructor", id=7))
    for role in ("staff", "student"):
        with pytest.raises(HTTPException) as exc:
            collections_router._require_restricted_authority(_user(role, id=3))
        assert exc.value.status_code == 403
