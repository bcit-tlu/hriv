"""Tests for the collections router: list/detail visibility and image filtering."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.routers import collections as collections_router
from app.routers.collections import get_collection, list_collections

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
            SimpleNamespace(sort_order=i, image=img)
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
