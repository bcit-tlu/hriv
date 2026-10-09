"""Tests for the collections router: list/detail visibility, image filtering,
the write API (create / update / delete / images / viewport + OCC), and
ownership transfer / orphan handling."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.sql.dml import Update

from app.models import Category, Collection, CollectionImage, Group, Image, Program, User
from app.routers import collections as collections_router
from app.routers.collections import (
    _unseen_links,
    _ViewerContext,
    bulk_delete_collections,
    bulk_update_collections,
    create_collection,
    delete_collection,
    get_collection,
    list_collections,
    move_collection,
    replace_collection_images,
    replace_collection_owners,
    replace_collection_viewport,
    require_collections_enabled,
    transfer_collection,
    update_collection,
)
from app.schemas import (
    CollectionBulkDelete,
    CollectionBulkUpdate,
    CollectionCreate,
    CollectionImagesUpdate,
    CollectionMove,
    CollectionOwnersUpdate,
    CollectionTransfer,
    CollectionUpdate,
    CollectionViewportUpdate,
)

NOW = datetime.now(timezone.utc)


def _user(
    role: str = "admin",
    id: int = 1,
    programs: list[int] | None = None,
    groups: list[int] | None = None,
    active: bool = True,
) -> User:
    """A real (transient) ORM user — ``create_collection`` assigns it to the
    ``Collection.owners`` relationship, which rejects plain namespaces.
    """
    u = User(
        id=id, role=role, name=f"user{id}", email=f"u{id}@e.com", active=active
    )
    u.programs = [Program(id=p, name=f"P{p}") for p in (programs or [])]
    u.groups = [Group(id=g, name=f"G{g}") for g in (groups or [])]
    return u


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
    owner_ids: list[int] | None = None,
    owner_program_id: int | None = None,
    images: list | None = None,
    programs: list[int] | None = None,
    groups: list[int] | None = None,
    type: str = "sequence",
    category_id: int | None = None,
    sort_order: int = 0,
    hidden: bool = False,
    cover_image_id: int | None = None,
    cover_blank: bool = False,
) -> SimpleNamespace:
    # ``user_id`` is the creator audit column; ownership is the ``owners``
    # list (``collection_owners`` rows), defaulting to the creator like the
    # 0032 backfill. Pass ``owner_ids`` explicitly for co-owned / orphaned /
    # program-only states.
    if owner_ids is None:
        owner_ids = [user_id] if user_id is not None else []
    owners = [SimpleNamespace(id=uid, name=f"user{uid}") for uid in owner_ids]
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
        creator=SimpleNamespace(id=user_id, name=f"user{user_id}") if user_id else None,
        owners=owners,
        owner_program=owner_program,
        category_id=category_id,
        sort_order=sort_order,
        hidden=hidden,
        cover_image_id=cover_image_id,
        cover_blank=cover_blank,
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
    users: list | None = None,
    collection_count: int = 0,
    categories: list | None = None,
    cas_rowcount: int = 1,
) -> AsyncMock:
    """Mock session for the write API.

    ``execute`` answers ``SELECT`` by entity (Image / Program / Group / User)
    with the supplied rows and answers the optimistic-concurrency ``UPDATE``
    with ``cas_rowcount``. ``refresh`` fills server-generated columns on
    freshly created ORM instances so ``collection_out`` can serialize them.
    """
    db = AsyncMock()
    db.add = MagicMock()
    category_by_id = {category.id: category for category in categories or []}

    async def _get(entity, entity_id):
        if entity is Category:
            return category_by_id.get(entity_id)
        return get

    db.get = AsyncMock(side_effect=_get)
    rows_by_entity = {
        Image: images or [],
        Program: programs or [],
        Group: groups or [],
        User: users or [],
    }

    async def _execute(stmt):
        result = MagicMock()
        if isinstance(stmt, Update):
            result.rowcount = cas_rowcount
            return result
        if stmt.column_descriptions[0]["name"] == "count":
            result.scalar_one.return_value = collection_count
            return result
        entity = stmt.column_descriptions[0]["entity"]
        result.scalars.return_value.all.return_value = rows_by_entity[entity]
        return result

    async def _refresh(obj, *args, **kwargs):
        if isinstance(obj, Collection):
            if obj.id is None:
                obj.id = 1
            if obj.hidden is None:
                obj.hidden = False
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
        "app.collection_views.get_student_excluded_category_ids",
        AsyncMock(return_value=set()),
    )
    # Revision bumps (tile-order scopes / browse ETag) write to real tables;
    # stub them here — tests that assert on them install their own spies.
    monkeypatch.setattr(
        collections_router, "bump_scopes", AsyncMock()
    )
    monkeypatch.setattr(
        collections_router, "bump_browse_revision", AsyncMock(return_value=1)
    )


# ── feature flag ──────────────────────────────────────────


def test_router_gated_by_collections_enabled_dependency() -> None:
    gates = [
        dep.dependency for dep in collections_router.router.dependencies
    ]
    assert require_collections_enabled in gates


def test_require_collections_enabled_404_when_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(collections_router.settings, "collections_enabled", False)
    with pytest.raises(HTTPException) as exc:
        require_collections_enabled()
    assert exc.value.status_code == 404
    assert exc.value.detail == "Not Found"


def test_require_collections_enabled_passes_when_on(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(collections_router.settings, "collections_enabled", True)
    assert require_collections_enabled() is None


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
    assert [(o.user_id, o.name) for o in summary.owners] == [(2, "user2")]
    assert summary.owners[0].program_id is None
    assert summary.permissions.can_edit is True
    # Student sole owner: scope + delete allowed; transfer never (#1531).
    assert summary.permissions.can_change_scope is True
    assert summary.permissions.can_delete is True
    assert summary.permissions.can_transfer is False
    assert summary.version == 3
    # Non-restricted collections carry an empty scope on summaries (#1567).
    assert summary.program_ids == []
    assert summary.group_ids == []


async def test_list_summary_carries_restriction_scope() -> None:
    """Summaries expose program/group ids so Browse tiles can render the
    collection's own restriction chips like category tiles do (#1567)."""
    col = _collection(1, "restricted", user_id=10, programs=[1, 2], groups=[5])
    out = await list_collections(_user("admin", id=1), db=_mock_db([col]))
    summary = out[0]
    assert summary.program_ids == [1, 2]
    assert summary.group_ids == [5]


async def test_list_co_owned_permissions_for_student_co_owner() -> None:
    """A student co-owner edits content but not scope/delete/owners (#1531)."""
    col = _collection(1, "private", owner_ids=[10, 2])
    out = await list_collections(_user("student", id=2), db=_mock_db([col]))
    perms = out[0].permissions
    assert perms.can_edit is True
    assert perms.can_change_scope is False
    assert perms.can_delete is False
    assert perms.can_transfer is False


async def test_list_co_owned_collection_is_visible_to_co_owner_student() -> None:
    """A private co-owned collection is visible to every user-owner."""
    col = _collection(1, "private", owner_ids=[10, 2])
    out = await list_collections(_user("student", id=2), db=_mock_db([col]))
    assert [c.id for c in out] == [1]
    assert sorted(o.user_id for o in out[0].owners) == [2, 10]


async def test_list_staff_owner_has_student_parity_rights() -> None:
    """Staff see everything like instructors, and hold student-parity rights
    on collections they own (#1531): a sole-owner staff member may edit,
    change scope, and delete — but can never manage owners or transfer."""
    col = _collection(1, "private", user_id=3)
    out = await list_collections(_user("staff", id=3), db=_mock_db([col]))
    perms = out[0].permissions
    assert perms.can_edit is True
    assert perms.can_change_scope is True
    assert perms.can_delete is True
    assert perms.can_transfer is False


async def test_list_staff_co_owner_cannot_scope_or_delete() -> None:
    """A staff member who is one of several co-owners may edit content but
    not scope/delete — the same co-owner rule students get (#1531)."""
    col = _collection(1, "private", owner_ids=[3, 4])
    out = await list_collections(_user("staff", id=3), db=_mock_db([col]))
    perms = out[0].permissions
    assert perms.can_edit is True
    assert perms.can_change_scope is False
    assert perms.can_delete is False
    assert perms.can_transfer is False


async def test_list_program_owned_owner_and_instructor_permissions() -> None:
    col = _collection(1, "public", user_id=None, owner_program_id=3)
    out = await list_collections(
        _user("instructor", id=7, programs=[3]), db=_mock_db([col])
    )
    assert len(out[0].owners) == 1
    assert out[0].owners[0].program_id == 3 and out[0].owners[0].name == "P3"
    assert out[0].permissions.can_edit is True
    assert out[0].permissions.can_change_scope is True
    assert out[0].permissions.can_transfer is True
    other = await list_collections(
        _user("instructor", id=8, programs=[4]), db=_mock_db([col])
    )
    assert other[0].permissions.can_edit is False


async def test_list_user_and_program_owners_serialize_together() -> None:
    """A program-owned collection with user co-owners lists both kinds."""
    col = _collection(1, "public", owner_ids=[10, 4], owner_program_id=3)
    out = await list_collections(_user("admin"), db=_mock_db([col]))
    kinds = [(o.user_id, o.program_id) for o in out[0].owners]
    # User owners sort by name ("user10" < "user4" lexicographically);
    # the program entry follows.
    assert kinds == [(10, None), (4, None), (None, 3)]


async def test_list_orphaned_owner_is_none() -> None:
    col = _collection(1, "public", user_id=None, owner_program_id=None)
    out = await list_collections(_user("admin"), db=_mock_db([col]), orphaned=True)
    assert out[0].owners == []
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
        limit=2,
    )
    sql = str(db.execute.call_args.args[0])
    assert "collections.type =" in sql
    # mine / owner_user_id resolve through collection_owners membership
    # (#1531); orphaned = no owner rows AND no program owner.
    assert "collection_owners" in sql and "users.id =" in sql
    assert "collections.owner_program_id =" in sql
    assert "NOT" in sql and "EXISTS" in sql
    assert "collections.owner_program_id IS NULL" in sql
    assert "ORDER BY collections.updated_at DESC" in sql
    assert "LIMIT" not in sql


async def test_list_limits_summaries_after_visibility_filter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    collections = [_collection(id=i, visibility="public") for i in range(1, 6)]
    can_view = MagicMock(side_effect=lambda collection: collection.id != 2)
    ctx = SimpleNamespace(can_view=can_view)
    summary_out = MagicMock(side_effect=lambda _ctx, collection: collection.id)
    monkeypatch.setattr(
        collections_router._ViewerContext, "build", AsyncMock(return_value=ctx)
    )
    monkeypatch.setattr(collections_router, "collection_summary_out", summary_out)

    rows = await list_collections(
        _user("admin"), db=_mock_db(collections), limit=2
    )

    assert rows == [1, 3]
    assert can_view.call_count == len(collections)
    assert [call.args[1].id for call in summary_out.call_args_list] == [1, 3]


def test_list_rejects_out_of_range_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.auth import get_current_user
    from app.database import get_db, settings

    test_app = FastAPI()
    test_app.include_router(collections_router.router)

    async def current_user():
        return _user("admin")

    async def unused_db():
        yield AsyncMock()

    test_app.dependency_overrides[get_current_user] = current_user
    test_app.dependency_overrides[get_db] = unused_db
    monkeypatch.setattr(settings, "collections_enabled", True)

    with TestClient(test_app) as client:
        for limit in (0, 101):
            response = client.get(f"/collections?limit={limit}")
            assert response.status_code == 422


async def test_list_student_image_count_omits_hidden_images(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    excluded = AsyncMock(return_value={20})
    monkeypatch.setattr(
        "app.collection_views.get_student_excluded_category_ids", excluded
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
        "app.collection_views.get_student_excluded_category_ids", excluded
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


async def test_get_collection_member_count_counts_hidden_members(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # member_count is nominal (all members) for viewers whose image list is
    # unfiltered so the UI can distinguish a truly empty collection from one
    # whose members are all restricted (#1529).
    excluded = AsyncMock(return_value={20})
    monkeypatch.setattr(
        "app.collection_views.get_student_excluded_category_ids", excluded
    )
    images = [_image(1, category_id=20), _image(2, category_id=20), _image(3)]
    col = _collection(1, "public", user_id=10, images=images)
    instructor = _user("instructor", id=7, programs=[1], groups=[5])
    out = await get_collection(1, instructor, db=_mock_db(get=col))
    assert out.image_count == 3
    assert out.member_count == 3


async def test_get_collection_member_count_clamps_restricted_total(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Students must not learn how many members are restricted: member_count
    # is clamped to len(visible) + 1 — enough to signal that hidden members
    # exist (which the restricted-members message already reveals) without
    # disclosing the true nominal total (#1529).
    excluded = AsyncMock(return_value={20})
    monkeypatch.setattr(
        "app.collection_views.get_student_excluded_category_ids", excluded
    )
    images = [
        _image(1, category_id=20),
        _image(2, category_id=20),
        _image(3, category_id=20),
        _image(4),
    ]
    col = _collection(1, "public", user_id=10, images=images)
    student = _user("student", id=2, programs=[1], groups=[5])
    out = await get_collection(1, student, db=_mock_db(get=col))
    assert [i.id for i in out.images] == [4]
    assert out.image_count == 1
    assert out.member_count == 2  # visible + 1, not the nominal 4

    all_hidden = _collection(2, "public", user_id=10, images=images[:3])
    out2 = await get_collection(2, student, db=_mock_db(get=all_hidden))
    assert out2.images == []
    assert out2.image_count == 0
    assert out2.member_count == 1  # > 0: all-restricted, nominal still hidden


async def test_get_collection_member_count_omitted_from_summaries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Summaries deliberately omit member_count so list rows and Browse tiles
    # cannot leak that hidden members exist (#1529).
    excluded = AsyncMock(return_value={20})
    monkeypatch.setattr(
        "app.collection_views.get_student_excluded_category_ids", excluded
    )
    col = _collection(1, "public", user_id=10, images=[_image(1, category_id=20)])
    student = _user("student", id=2, programs=[1], groups=[5])
    out = await list_collections(student, db=_mock_db([col]))
    assert out[0].image_count == 0
    assert not hasattr(out[0], "member_count")


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
        "app.collection_views.get_student_excluded_category_ids",
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
    curator = role in {"admin", "instructor"}
    db = _write_db(
        images=[_image(1), _image(2)],
        categories=[Category(id=1, label="C1")] if curator else [],
    )
    body = CollectionCreate(
        name="  Mine ",
        type="sequence",
        image_ids=[2, 1],
        category_id=1 if curator else None,
    )
    out = await create_collection(body, _user(role, id=42), db=db)
    created = db.add.call_args.args[0]
    assert isinstance(created, Collection)
    assert created.user_id == 42 and created.owner_program_id is None
    assert [o.id for o in created.owners] == [42]
    assert created.name == "Mine"
    assert created.category_id == body.category_id
    assert created.visibility == "private"
    assert created.version == 1
    assert created.viewport_state == {}
    assert _links(created) == [(2, 0), (1, 1)]
    assert out.version == 1 and out.type == "sequence"
    db.commit.assert_awaited_once()
    if curator:
        collections_router.bump_scopes.assert_awaited_once()
        collections_router.bump_browse_revision.assert_awaited_once()
    else:
        collections_router.bump_scopes.assert_not_awaited()
        collections_router.bump_browse_revision.assert_not_awaited()


@pytest.mark.parametrize("role", ["admin", "instructor"])
async def test_create_curator_requires_category(role: str) -> None:
    with pytest.raises(HTTPException) as exc:
        await create_collection(
            CollectionCreate(name="C", type="sequence"),
            _user(role),
            db=_write_db(),
        )
    assert exc.value.status_code == 422
    assert exc.value.detail == "A category is required when creating a collection"


async def test_create_curator_rejects_unknown_category() -> None:
    with pytest.raises(HTTPException) as exc:
        await create_collection(
            CollectionCreate(name="C", type="sequence", category_id=9),
            _user("admin"),
            db=_write_db(),
        )
    assert exc.value.status_code == 422
    assert exc.value.detail == "Invalid category ID: 9"


@pytest.mark.parametrize("role", ["staff", "student"])
async def test_create_non_curator_cannot_file_collection(role: str) -> None:
    with pytest.raises(HTTPException) as exc:
        await create_collection(
            CollectionCreate(name="C", type="sequence", category_id=1),
            _user(role),
            db=_write_db(),
        )
    assert exc.value.status_code == 403
    assert exc.value.detail == "Only admins and instructors may file collections"


@pytest.mark.parametrize("role", ["staff", "student"])
async def test_create_non_curator_collection_is_unfiled(role: str) -> None:
    db = _write_db()
    out = await create_collection(
        CollectionCreate(name="C", type="sequence"),
        _user(role),
        db=db,
    )
    assert out.category_id is None
    collections_router.bump_scopes.assert_not_awaited()
    collections_router.bump_browse_revision.assert_not_awaited()


@pytest.mark.parametrize("collection_type", ("sequence", "synchronized"))
async def test_create_student_collection_count_cap_per_type(collection_type: str) -> None:
    body = CollectionCreate(name="Tenth", type=collection_type)
    db = _write_db(collection_count=9)
    await create_collection(body, _user("student", id=42), db=db)
    assert isinstance(db.add.call_args.args[0], Collection)
    statements = [call.args[0] for call in db.execute.await_args_list]
    assert statements[0]._for_update_arg is not None
    assert statements[1].column_descriptions[0]["name"] == "count"

    db = _write_db(collection_count=10)
    with pytest.raises(HTTPException) as exc:
        await create_collection(body, _user("student", id=42), db=db)
    assert exc.value.status_code == 422
    assert exc.value.detail == f"Students may own at most 10 {collection_type} collections"
    assert db.add.call_count == 0


async def test_create_student_sequence_cap_is_422() -> None:
    body = CollectionCreate(
        name="Long sequence", type="sequence", image_ids=list(range(1, 22))
    )
    db = _write_db(collection_count=0)
    with pytest.raises(HTTPException) as exc:
        await create_collection(body, _user("student", id=42), db=db)
    assert exc.value.status_code == 422
    assert exc.value.detail == "Students may add at most 20 images to a sequence collection"
    assert db.add.call_count == 0


async def test_create_restricted_admin_attaches_any_program_and_group() -> None:
    db = _write_db(
        programs=[_program(1), _program(2)],
        groups=[_group(5, [99])],
        categories=[Category(id=1, label="C1")],
    )
    body = CollectionCreate(
        name="R", type="synchronized", visibility="restricted",
        program_ids=[1, 2], group_ids=[5], category_id=1,
    )
    out = await create_collection(body, _user("admin"), db=db)
    created = db.add.call_args.args[0]
    assert [p.id for p in created.programs] == [1, 2]
    assert [g.id for g in created.groups] == [5]
    assert out.program_ids == [1, 2] and out.group_ids == [5]


async def test_create_restricted_instructor_own_program_and_managed_group() -> None:
    db = _write_db(
        programs=[_program(1)],
        groups=[_group(5, [7])],
        categories=[Category(id=1, label="C1")],
    )
    body = CollectionCreate(
        name="R", type="sequence", visibility="restricted",
        program_ids=[1], group_ids=[5], category_id=1,
    )
    out = await create_collection(body, _user("instructor", id=7, programs=[1]), db=db)
    assert out.program_ids == [1] and out.group_ids == [5]


async def test_create_restricted_instructor_foreign_program_is_403() -> None:
    db = _write_db(programs=[_program(2)], categories=[Category(id=1, label="C1")])
    body = CollectionCreate(
        name="R", type="sequence", visibility="restricted", program_ids=[2], category_id=1,
    )
    with pytest.raises(HTTPException) as exc:
        await create_collection(body, _user("instructor", id=7, programs=[1]), db=db)
    assert exc.value.status_code == 403
    db.commit.assert_not_awaited()


async def test_create_restricted_instructor_unmanaged_group_is_403() -> None:
    db = _write_db(groups=[_group(5, [8])], categories=[Category(id=1, label="C1")])
    body = CollectionCreate(
        name="R", type="sequence", visibility="restricted", group_ids=[5], category_id=1,
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
        name="R", type="sequence", visibility="restricted", program_ids=[1, 9], category_id=1,
    )
    with pytest.raises(HTTPException) as exc:
        await create_collection(
            body,
            _user("admin"),
            db=_write_db(
                programs=[_program(1)],
                categories=[Category(id=1, label="C1")],
            ),
        )
    assert exc.value.status_code == 422 and "[9]" in exc.value.detail

    body = CollectionCreate(
        name="R", type="sequence", visibility="restricted", group_ids=[5], category_id=1,
    )
    with pytest.raises(HTTPException) as exc:
        await create_collection(
            body,
            _user("admin"),
            db=_write_db(categories=[Category(id=1, label="C1")]),
        )
    assert exc.value.status_code == 422 and "[5]" in exc.value.detail


async def test_create_with_missing_image_id_is_422() -> None:
    body = CollectionCreate(name="C", type="sequence", image_ids=[1, 7], category_id=1)
    with pytest.raises(HTTPException) as exc:
        await create_collection(
            body,
            _user("admin"),
            db=_write_db(
                images=[_image(1)],
                categories=[Category(id=1, label="C1")],
            ),
        )
    assert exc.value.status_code == 422 and "[7]" in exc.value.detail


async def test_create_student_invisible_image_is_422(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    excluded = AsyncMock(return_value={20})
    monkeypatch.setattr("app.collection_views.get_student_excluded_category_ids", excluded)
    images = [_image(1, category_id=20), _image(2, category_id=21), _image(3, active=False)]
    body = CollectionCreate(name="C", type="sequence", image_ids=[1, 2, 3])
    student = _user("student", id=2, programs=[1], groups=[5])
    with pytest.raises(HTTPException) as exc:
        await create_collection(body, student, db=_write_db(images=images))
    assert exc.value.status_code == 422 and "[1, 3]" in exc.value.detail
    assert excluded.await_args.args[1:] == ({1}, {5})


@pytest.mark.parametrize("role", ["instructor", "staff"])
async def test_create_non_student_may_add_inactive_image(role: str) -> None:
    curator = role == "instructor"
    db = _write_db(
        images=[_image(3, active=False)],
        categories=[Category(id=1, label="C1")] if curator else [],
    )
    body = CollectionCreate(
        name="C", type="sequence", image_ids=[3], category_id=1 if curator else None
    )
    await create_collection(body, _user(role, id=3), db=db)
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


@pytest.mark.parametrize("role", ["admin", "instructor", "student"])
async def test_owner_or_admin_may_update(role: str) -> None:
    col = _collection(1, "private", user_id=2)
    user = _user(role, id=2 if role != "admin" else 1)
    out = await update_collection(1, _patch(name="New"), user, db=_write_db(get=col))
    assert out.name == "New"


async def test_staff_owner_may_update() -> None:
    """Staff hold student-parity rights on collections they own (#1531)."""
    col = _collection(1, "private", user_id=2)
    out = await update_collection(
        1, _patch(name="New"), _user("staff", id=2), db=_write_db(get=col)
    )
    assert out.name == "New"


@pytest.mark.parametrize("role", ["student", "staff"])
async def test_co_owner_edits_content_but_not_scope(role: str) -> None:
    """Field-level PATCH authority (#1531): a co-owning student or staff
    member may change name/description but not visibility/program/group
    scope."""
    col = _collection(1, "private", owner_ids=[10, 2])
    user = _user(role, id=2)
    out = await update_collection(
        1, _patch(name="New", description="d"), user, db=_write_db(get=col)
    )
    assert out.name == "New"
    for body in (
        _patch(visibility="public"),
        _patch(program_ids=[1]),
        _patch(group_ids=[5]),
    ):
        with pytest.raises(HTTPException) as exc:
            await update_collection(1, body, user, db=_write_db(get=col))
        assert exc.value.status_code == 403


@pytest.mark.parametrize("role", ["student", "staff"])
async def test_sole_owner_may_change_scope(role: str) -> None:
    col = _collection(1, "private", user_id=2)
    out = await update_collection(
        1, _patch(visibility="public"), _user(role, id=2), db=_write_db(get=col)
    )
    assert out.visibility == "public"


@pytest.mark.parametrize("role", ["student", "staff"])
async def test_co_owner_cannot_delete(role: str) -> None:
    """Delete follows the scope rule: students and staff need sole
    ownership (#1531)."""
    col = _collection(1, "public", owner_ids=[10, 2])
    with pytest.raises(HTTPException) as exc:
        await delete_collection(1, _user(role, id=2), db=_write_db(get=col))
    assert exc.value.status_code == 403


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


# ── curatorial hide (#1559) ────────────────────────────────


async def test_list_hidden_collection_visible_to_owning_student_only() -> None:
    """A hidden collection drops out of every student's list unless the
    student is a user-owner — owners keep access."""
    cols = [
        _collection(1, "public", user_id=10, hidden=True),
        _collection(2, "public", user_id=2, hidden=True),
        _collection(3, "public", user_id=10),
    ]
    out = await list_collections(_user("student", id=2), db=_mock_db(cols))
    assert [c.id for c in out] == [2, 3]


async def test_list_non_students_see_hidden_collections() -> None:
    col = _collection(1, "public", user_id=10, hidden=True)
    for role in ("admin", "instructor", "staff"):
        out = await list_collections(_user(role, id=99), db=_mock_db([col]))
        assert [c.id for c in out] == [1]


async def test_get_hidden_collection_is_404_for_nonowner_student() -> None:
    col = _collection(1, "public", user_id=10, hidden=True)
    with pytest.raises(HTTPException) as exc:
        await get_collection(1, _user("student", id=2), db=_mock_db(get=col))
    assert exc.value.status_code == 404


async def test_get_hidden_collection_visible_to_owning_student() -> None:
    col = _collection(1, "private", user_id=2, hidden=True)
    out = await get_collection(1, _user("student", id=2), db=_mock_db(get=col))
    assert out.hidden is True


@pytest.mark.parametrize("role", ["admin", "instructor"])
async def test_update_hidden_curators_may_hide_any_collection(role: str) -> None:
    """Hide is curatorial and global — a non-owning instructor may hide a
    collection via a hidden-only PATCH; the owner-edit gate does not apply."""
    col = _collection(1, "private", user_id=10)
    out = await update_collection(
        1, _patch(hidden=True), _user(role, id=7), db=_write_db(get=col)
    )
    assert col.hidden is True
    assert out.hidden is True


async def test_update_hidden_noop_repeat_still_allowed_for_curator() -> None:
    """A hidden-only PATCH whose value matches the current flag is still a
    curator action — the gate keys on the field being supplied, not on the
    value changing (Devin Review on #1560)."""
    col = _collection(1, "private", user_id=10, hidden=True)
    out = await update_collection(
        1, _patch(hidden=True), _user("instructor", id=7), db=_write_db(get=col)
    )
    assert out.hidden is True


@pytest.mark.parametrize("role", ["student", "staff"])
async def test_update_hidden_noncurator_owner_is_403(role: str) -> None:
    """Owners may not hide — the toggle belongs to admins and instructors.
    Supplying `hidden` at all requires curatorial rights, even a no-op."""
    col = _collection(1, "private", user_id=2)
    with pytest.raises(HTTPException) as exc:
        await update_collection(
            1, _patch(hidden=True), _user(role, id=2), db=_write_db(get=col)
        )
    assert exc.value.status_code == 403


async def test_update_hidden_noop_value_from_owner_is_403() -> None:
    """An owner supplying `hidden` — even the current value — is still a
    hide/show request and requires curatorial rights."""
    col = _collection(1, "private", user_id=2, hidden=True)
    with pytest.raises(HTTPException) as exc:
        await update_collection(
            1, _patch(hidden=True), _user("student", id=2), db=_write_db(get=col)
        )
    assert exc.value.status_code == 403


async def test_update_hidden_owner_cannot_unhide() -> None:
    col = _collection(1, "private", user_id=2, hidden=True)
    with pytest.raises(HTTPException) as exc:
        await update_collection(
            1, _patch(hidden=False), _user("student", id=2), db=_write_db(get=col)
        )
    assert exc.value.status_code == 403


async def test_update_hidden_mixed_body_still_requires_edit_rights() -> None:
    """Bundling ``hidden`` with content edits still requires can_edit — the
    hidden-only carve-out for curators is exact."""
    col = _collection(1, "private", user_id=10)
    with pytest.raises(HTTPException) as exc:
        await update_collection(
            1, _patch(hidden=True, name="x"), _user("instructor", id=7), db=_write_db(get=col)
        )
    assert exc.value.status_code == 403


@pytest.mark.parametrize(
    "role,expected",
    [("admin", True), ("instructor", True), ("student", False), ("staff", False)],
)
async def test_permissions_can_hide_serializes_by_role(
    role: str, expected: bool
) -> None:
    col = _collection(1, "private", user_id=2)
    out = await update_collection(
        1, _patch(name="x"), _user(role, id=2 if role != "admin" else 1), db=_write_db(get=col)
    )
    assert out.permissions.can_hide is expected


# ── pinned cover ──────────────────────────────────────────


async def test_update_cover_pins_member_and_serializes() -> None:
    col = _collection(1, "private", user_id=2, images=[_image(1), _image(2)])
    out = await update_collection(
        1, _patch(cover_image_id=2), _user("student", id=2), db=_write_db(get=col)
    )
    assert col.cover_image_id == 2
    assert out.cover_image_id == 2
    assert out.cover_thumb.endswith("/thumbs/2.jpg")
    assert col.version == 4


async def test_update_cover_null_restores_first_member_fallback() -> None:
    col = _collection(
        1, "private", user_id=2, images=[_image(1), _image(2)], cover_image_id=2
    )
    out = await update_collection(
        1, _patch(cover_image_id=None), _user("student", id=2), db=_write_db(get=col)
    )
    assert col.cover_image_id is None
    assert out.cover_image_id is None
    assert out.cover_thumb.endswith("/thumbs/1.jpg")


async def test_update_cover_blank_sets_flag_and_clears_pin() -> None:
    """The picker's "None" row — an explicit blank wins over any stored
    pin and reports no thumb even with members present."""
    col = _collection(
        1,
        "private",
        user_id=2,
        images=[_image(1), _image(2)],
        cover_image_id=2,
    )
    out = await update_collection(
        1, _patch(cover_blank=True), _user("student", id=2), db=_write_db(get=col)
    )
    assert col.cover_blank is True
    assert col.cover_image_id is None
    assert out.cover_blank is True
    assert out.cover_image_id is None
    assert out.cover_thumb is None


async def test_update_cover_blank_false_restores_fallback() -> None:
    """Un-blanking (the picker's "Automatic" row) returns the tile to the
    first-member fallback."""
    col = _collection(
        1, "private", user_id=2, images=[_image(1), _image(2)], cover_blank=True
    )
    out = await update_collection(
        1, _patch(cover_blank=False), _user("student", id=2), db=_write_db(get=col)
    )
    assert col.cover_blank is False
    assert out.cover_thumb.endswith("/thumbs/1.jpg")


async def test_update_cover_pin_clears_blank() -> None:
    """A member pin is mutually exclusive with the blank flag — picking a
    member from the picker un-blanks the tile."""
    col = _collection(
        1, "private", user_id=2, images=[_image(1), _image(2)], cover_blank=True
    )
    out = await update_collection(
        1, _patch(cover_image_id=2), _user("student", id=2), db=_write_db(get=col)
    )
    assert col.cover_blank is False
    assert col.cover_image_id == 2
    assert out.cover_blank is False
    assert out.cover_thumb.endswith("/thumbs/2.jpg")


async def test_update_cover_nonmember_is_422() -> None:
    col = _collection(1, "private", user_id=2, images=[_image(1)])
    with pytest.raises(HTTPException) as exc:
        await update_collection(
            1, _patch(cover_image_id=9), _user("student", id=2), db=_write_db(get=col)
        )
    assert exc.value.status_code == 422
    assert col.cover_image_id is None and col.version == 3


async def test_update_cover_invisible_member_is_422(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A member hidden from the caller cannot be pinned — the picker never
    offers it and naming one must not leak its membership."""
    monkeypatch.setattr(
        "app.collection_views.get_student_excluded_category_ids",
        AsyncMock(return_value={20}),
    )
    col = _collection(
        1,
        "private",
        user_id=2,
        images=[_image(1), _image(2, category_id=20)],
    )
    with pytest.raises(HTTPException) as exc:
        await update_collection(
            1, _patch(cover_image_id=2), _user("student", id=2), db=_write_db(get=col)
        )
    assert exc.value.status_code == 422
    assert col.cover_image_id is None and col.version == 3


async def test_summary_cover_falls_back_for_unseen_pinned_member(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A pin on a member the viewer cannot see is reported as no pin, and
    the thumb falls back to the first visible member."""
    monkeypatch.setattr(
        "app.collection_views.get_student_excluded_category_ids",
        AsyncMock(return_value={20}),
    )
    col = _collection(
        1,
        "private",
        user_id=2,
        images=[_image(1), _image(2, category_id=20)],
        cover_image_id=2,
    )
    out = await update_collection(
        1, _patch(name="x"), _user("student", id=2), db=_write_db(get=col)
    )
    assert out.cover_image_id is None
    assert out.cover_thumb.endswith("/thumbs/1.jpg")


async def test_replace_images_clears_cover_on_dropped_member() -> None:
    col = _collection(
        1, "private", user_id=2, images=[_image(1), _image(2)], cover_image_id=2
    )
    db = _write_db(get=col, images=[_image(1)])
    out = await replace_collection_images(
        1, _images_body([1]), _user("student", id=2), db=db
    )
    assert col.cover_image_id is None
    assert out.cover_image_id is None
    assert out.cover_thumb.endswith("/thumbs/1.jpg")


async def test_replace_images_keeps_cover_on_retained_unseen_member(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A pin on a member the editor cannot view survives member edits —
    the retained unseen link still counts as membership."""
    monkeypatch.setattr(
        "app.collection_views.get_student_excluded_category_ids",
        AsyncMock(return_value={20}),
    )
    col = _collection(
        1,
        "private",
        user_id=2,
        images=[_image(1), _image(2, category_id=20)],
        cover_image_id=2,
    )
    db = _write_db(get=col, images=[_image(1), _image(3)])
    await replace_collection_images(
        1, _images_body([3, 1]), _user("student", id=2), db=db
    )
    assert [link.image_id for link in col.image_links] == [3, 1, 2]
    assert col.cover_image_id == 2


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
    images = [_image(i) for i in range(1, 22)]
    await replace_collection_images(
        1,
        _images_body(list(range(1, 22))),
        _user("instructor", id=2),
        db=_write_db(get=col, images=images),
    )
    assert [o for _, o in _links(col)] == list(range(21))


async def test_replace_images_student_sequence_cap_rejects_new_images() -> None:
    member_images = [_image(i) for i in range(1, 22)]
    col = _collection(1, "private", user_id=2, type="sequence", images=member_images)
    db = _write_db(get=col, images=[*member_images, _image(22)])
    with pytest.raises(HTTPException) as exc:
        await replace_collection_images(
            1, _images_body([*range(1, 22), 22]), _user("student", id=2), db=db
        )
    assert exc.value.status_code == 422
    assert exc.value.detail == "Students may add at most 20 images to a sequence collection"
    assert col.version == 3
    assert not any(isinstance(call.args[0], Update) for call in db.execute.await_args_list)


async def test_replace_images_over_cap_sequence_allows_removal_and_reorder() -> None:
    member_images = [_image(i) for i in range(1, 23)]
    col = _collection(1, "private", user_id=2, type="sequence", images=member_images)
    db = _write_db(get=col, images=member_images)
    out = await replace_collection_images(
        1,
        _images_body(list(range(22, 2, -1))),
        _user("student", id=2),
        db=db,
    )
    assert [image_id for image_id, _ in _links(col)] == list(range(22, 2, -1))
    assert out.version == 4


async def test_replace_images_over_cap_sequence_rejects_remove_two_add_one() -> None:
    member_images = [_image(i) for i in range(1, 23)]
    col = _collection(1, "private", user_id=2, type="sequence", images=member_images)
    db = _write_db(get=col, images=[*member_images, _image(23)])
    with pytest.raises(HTTPException) as exc:
        await replace_collection_images(
            1,
            _images_body([*range(3, 23), 23]),
            _user("student", id=2),
            db=db,
        )
    assert exc.value.status_code == 422
    assert exc.value.detail == "Students may add at most 20 images to a sequence collection"
    assert col.version == 3


async def test_replace_images_student_sequence_retained_unseen_count_toward_cap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.collection_views.get_student_excluded_category_ids",
        AsyncMock(return_value={20}),
    )
    hidden = [_image(20, category_id=20), _image(21, category_id=20)]
    visible = [_image(i) for i in range(1, 19)]
    new_image = _image(30)
    col = _collection(1, "private", user_id=2, type="sequence", images=[*hidden, *visible])
    db = _write_db(get=col, images=[*visible, new_image])
    with pytest.raises(HTTPException) as exc:
        await replace_collection_images(
            1,
            _images_body([*range(1, 19), 30]),
            _user("student", id=2),
            db=db,
        )
    assert exc.value.status_code == 422
    assert exc.value.detail == "Students may add at most 20 images to a sequence collection"
    assert col.version == 3


async def test_replace_images_student_invisible_is_422(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    excluded = AsyncMock(return_value={20})
    monkeypatch.setattr("app.collection_views.get_student_excluded_category_ids", excluded)
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


def test_unseen_links_filters_by_viewer_and_keeps_relative_order() -> None:
    col = _collection(
        1, images=[_image(1, category_id=20), _image(2), _image(3, active=False), _image(4, category_id=20)]
    )
    col.image_links.append(SimpleNamespace(sort_order=4, image_id=9, image=None))  # dangling
    col.image_links[0].sort_order = 7  # sort_order gaps / out-of-order rows are honoured
    student = _ViewerContext(_user("student", id=2), excluded_category_ids={20})
    assert [link.image_id for link in _unseen_links(student, col)] == [3, 4, 1]
    assert _unseen_links(_ViewerContext(_user("admin"), excluded_category_ids=None), col) == []


async def test_replace_images_student_retains_unseen_members(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # GET omits images 1 (excluded category) and 3 (inactive), so a client
    # can only ever submit [2, 4]; the PUT must not drop the hidden members.
    monkeypatch.setattr(
        "app.collection_views.get_student_excluded_category_ids", AsyncMock(return_value={20})
    )
    hidden_a, visible_b, hidden_c, visible_d = (
        _image(1, category_id=20),
        _image(2),
        _image(3, active=False),
        _image(4, category_id=21),
    )
    col = _collection(1, "private", user_id=2, images=[hidden_a, visible_b, hidden_c, visible_d])
    kept = {link.image_id: link for link in col.image_links}
    db = _write_db(get=col, images=[visible_b, visible_d, _image(5)])
    out = await replace_collection_images(
        1, _images_body([5, 4, 2]), _user("student", id=2), db=db
    )
    assert _links(col) == [(5, 0), (4, 1), (2, 2), (1, 3), (3, 4)]
    assert col.image_links[3] is kept[1] and col.image_links[4] is kept[3]
    # The mock never hydrates ``link.image`` for the new row (5); the point is
    # that the retained hidden members stay out of the response.
    assert [i.id for i in out.images] == [4, 2] and out.image_count == 2
    assert col.version == 4 and out.version == 4
    db.commit.assert_awaited_once()

    # Removing every visible image still keeps the hidden ones.
    col = _collection(1, "private", user_id=2, images=[hidden_a, visible_b, hidden_c])
    await replace_collection_images(1, _images_body([]), _user("student", id=2), db=_write_db(get=col))
    assert _links(col) == [(1, 0), (3, 1)]

    # Naming a hidden member explicitly is still 422 (no probing).
    col = _collection(1, "private", user_id=2, images=[hidden_a, visible_b])
    with pytest.raises(HTTPException) as exc:
        await replace_collection_images(
            1, _images_body([2, 1]), _user("student", id=2), db=_write_db(get=col, images=[hidden_a, visible_b])
        )
    assert exc.value.status_code == 422 and "[1]" in exc.value.detail


async def test_replace_images_unseen_members_count_toward_synchronized_cap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.collection_views.get_student_excluded_category_ids", AsyncMock(return_value={20})
    )
    hidden = _image(9, category_id=20)
    visible = [_image(i) for i in range(1, 5)]
    col = _collection(1, "private", user_id=2, type="synchronized", images=[hidden, *visible[:2]])
    with pytest.raises(HTTPException) as exc:
        await replace_collection_images(
            1, _images_body([1, 2, 3, 4]), _user("student", id=2), db=_write_db(get=col, images=visible)
        )
    assert exc.value.status_code == 422
    assert "at most 4" in exc.value.detail and "1 not visible" in exc.value.detail
    assert col.version == 3 and _links(col) == [(9, 0), (1, 1), (2, 2)]
    out = await replace_collection_images(
        1, _images_body([1, 2, 3]), _user("student", id=2), db=_write_db(get=col, images=visible)
    )
    assert _links(col) == [(1, 0), (2, 1), (3, 2), (9, 3)]
    assert [i.id for i in out.images] == [1, 2] and out.version == 4


async def test_replace_images_non_student_drops_inactive_members() -> None:
    # Non-students see every image, so nothing is retained behind their back:
    # omitting an inactive member really removes it.
    col = _collection(1, "private", user_id=10, images=[_image(1, active=False), _image(2)])
    db = _write_db(get=col, images=[_image(2)])
    out = await replace_collection_images(1, _images_body([2]), _user("admin"), db=db)
    assert _links(col) == [(2, 0)] and out.image_count == 1


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


# ── ownership (PUT /owners + program transfer, #1531) ─────


def _target_user(id: int, active: bool = True) -> SimpleNamespace:
    return SimpleNamespace(id=id, name=f"user{id}", role="instructor", active=active)


def _transfer_db(
    collection: object,
    users: list | None = None,
    programs: list | None = None,
    cas_rowcount: int = 1,
) -> AsyncMock:
    """``_write_db`` whose ``get`` dispatches on the entity (Collection /
    Program) and whose ``execute`` answers ``SELECT User`` — the owner
    resolver — with the supplied rows."""
    db = _write_db(get=collection, users=users, cas_rowcount=cas_rowcount)
    by_entity: dict[type, dict[int, object]] = {
        Collection: {collection.id: collection} if collection else {},
        User: {u.id: u for u in (users or [])},
        Program: {p.id: p for p in (programs or [])},
    }

    async def _get(entity, key):
        return by_entity[entity].get(key)

    db.get = AsyncMock(side_effect=_get)
    return db


def _owners_body(user_ids: list[int], version: int = 3) -> CollectionOwnersUpdate:
    return CollectionOwnersUpdate(user_ids=user_ids, version=version)


def _to_program(program_id: int | None, version: int = 3) -> CollectionTransfer:
    return CollectionTransfer(program_id=program_id, version=version)


async def test_owners_admin_replaces_user_owner_set() -> None:
    col = _collection(1, "private", user_id=10)
    targets = [_target_user(20), _target_user(30)]
    db = _transfer_db(col, users=targets)
    out = await replace_collection_owners(
        1, _owners_body([20, 30]), _user("admin"), db=db
    )
    assert [o.id for o in col.owners] == [20, 30]
    # The creator audit column is untouched by ownership changes.
    assert col.user_id == 10
    assert [o.user_id for o in out.owners] == [20, 30]
    assert col.version == 4 and out.version == 4
    cas = db.execute.call_args.args[0]
    assert isinstance(cas, Update)
    db.commit.assert_awaited_once()
    db.refresh.assert_awaited_once_with(col)


async def test_owners_admin_may_target_any_active_role() -> None:
    """Co-ownership is not role-restricted — students may be added (#1531)."""
    col = _collection(1, "private", user_id=10)
    student = _target_user(30)
    student.role = "student"
    db = _transfer_db(col, users=[student])
    out = await replace_collection_owners(
        1, _owners_body([30]), _user("admin"), db=db
    )
    assert [o.user_id for o in out.owners] == [30]


async def test_owners_dedupes_submitted_ids() -> None:
    assert _owners_body([20, 20, 30]).user_ids == [20, 30]


async def test_owners_unknown_and_inactive_targets_are_422() -> None:
    col = _collection(1, "private", user_id=10)
    db = _transfer_db(col, users=[_target_user(20)])
    with pytest.raises(HTTPException) as exc:
        await replace_collection_owners(1, _owners_body([20, 99]), _user("admin"), db=db)
    assert exc.value.status_code == 422 and "99" in exc.value.detail

    db = _transfer_db(col, users=[_target_user(20, active=False)])
    with pytest.raises(HTTPException) as exc:
        await replace_collection_owners(1, _owners_body([20]), _user("admin"), db=db)
    assert exc.value.status_code == 422 and "deactivated" in exc.value.detail
    assert [o.id for o in col.owners] == [10] and col.version == 3
    db.commit.assert_not_awaited()


async def test_owners_empty_set_orphan_guard() -> None:
    """Emptying user owners is 422 unless a program owner remains."""
    col = _collection(1, "private", user_id=10)
    with pytest.raises(HTTPException) as exc:
        await replace_collection_owners(
            1, _owners_body([]), _user("admin"), db=_transfer_db(col)
        )
    assert exc.value.status_code == 422
    assert [o.id for o in col.owners] == [10] and col.version == 3

    # With a program owner the same request succeeds (program still owns it).
    program_owned = _collection(2, "public", owner_ids=[10], owner_program_id=3)
    out = await replace_collection_owners(
        2, _owners_body([]), _user("admin"), db=_transfer_db(program_owned)
    )
    assert program_owned.owners == [] and out.owners[0].program_id == 3


async def test_owners_instructor_manages_own_and_program_collections() -> None:
    own = _collection(1, "private", user_id=7)
    instructor = _user("instructor", id=7, programs=[3])
    out = await replace_collection_owners(
        1,
        _owners_body([7, 20]),
        instructor,
        db=_transfer_db(own, users=[_target_user(7), _target_user(20)]),
    )
    assert sorted(o.user_id for o in out.owners) == [7, 20]

    program_owned = _collection(2, "public", owner_ids=[9], owner_program_id=3)
    out = await replace_collection_owners(
        2,
        _owners_body([9, 21]),
        instructor,
        db=_transfer_db(program_owned, users=[_target_user(9), _target_user(21)]),
    )
    assert sorted(o.user_id for o in out.owners if o.user_id) == [9, 21]


async def test_owners_instructor_unrelated_collection_is_403() -> None:
    col = _collection(1, "public", user_id=10)
    outsider = _user("instructor", id=7, programs=[3])
    with pytest.raises(HTTPException) as exc:
        await replace_collection_owners(
            1, _owners_body([7]), outsider, db=_transfer_db(col)
        )
    assert exc.value.status_code == 403
    db_unused = _transfer_db(col)
    db_unused.commit.assert_not_awaited()


@pytest.mark.parametrize("role", ["staff", "student"])
async def test_owners_staff_and_student_are_403_even_as_owner(role: str) -> None:
    """Students and staff can never manage owners — even sole owners (#1531)."""
    col = _collection(1, "private", user_id=2)
    with pytest.raises(HTTPException) as exc:
        await replace_collection_owners(
            1, _owners_body([2, 20]), _user(role, id=2), db=_transfer_db(col)
        )
    assert exc.value.status_code == 403
    assert [o.id for o in col.owners] == [2] and col.version == 3


async def test_owners_hidden_collection_is_404_not_403() -> None:
    col = _collection(1, "private", user_id=10)
    with pytest.raises(HTTPException) as exc:
        await replace_collection_owners(
            1, _owners_body([2]), _user("student", id=2), db=_transfer_db(col)
        )
    assert exc.value.status_code == 404


async def test_owners_missing_collection_is_404() -> None:
    with pytest.raises(HTTPException) as exc:
        await replace_collection_owners(
            9, _owners_body([20]), _user("admin"), db=_transfer_db(None)
        )
    assert exc.value.status_code == 404


async def test_owners_stale_version_is_409_with_current_collection() -> None:
    col = _collection(1, "private", user_id=10)
    db = _transfer_db(col, users=[_target_user(20)])
    with pytest.raises(HTTPException) as exc:
        await replace_collection_owners(
            1, _owners_body([20], version=2), _user("admin"), db=db
        )
    assert exc.value.status_code == 409
    assert exc.value.detail["version"] == 3
    assert exc.value.detail["owners"] == [
        {"user_id": 10, "program_id": None, "name": "user10"}
    ]
    assert [o.id for o in col.owners] == [10]
    db.commit.assert_not_awaited()


async def test_transfer_admin_to_program_sets_program_and_clears_user_owners() -> None:
    col = _collection(1, "private", user_id=10)
    prog = _program(5)
    out = await transfer_collection(
        1, _to_program(5), _user("admin"), db=_transfer_db(col, programs=[prog])
    )
    assert col.owner_program_id == 5 and col.owner_program is prog
    # Transfer-to-program makes the program the sole owner (#1531); the
    # creator audit column is untouched.
    assert col.owners == [] and col.user_id == 10
    assert [o.model_dump() for o in out.owners] == [
        {"user_id": None, "program_id": 5, "name": "P5"}
    ]
    assert out.version == 4


async def test_transfer_clear_program_keeps_user_owners() -> None:
    """``program_id: null`` clears program ownership; user owners remain."""
    col = _collection(1, "public", owner_ids=[10, 4], owner_program_id=3)
    db = _transfer_db(col, programs=[_program(3)])
    out = await transfer_collection(1, _to_program(None), _user("admin"), db=db)
    assert col.owner_program_id is None and col.owner_program is None
    assert sorted(o.id for o in col.owners) == [4, 10]
    assert all(o.program_id is None for o in out.owners)


async def test_transfer_clear_program_with_no_user_owners_is_422() -> None:
    col = _collection(1, "public", user_id=None, owner_program_id=3)
    with pytest.raises(HTTPException) as exc:
        await transfer_collection(1, _to_program(None), _user("admin"), db=_transfer_db(col))
    assert exc.value.status_code == 422
    assert col.owner_program_id == 3 and col.version == 3


async def test_transfer_admin_unknown_program_is_422() -> None:
    col = _collection(1, "private", user_id=10)
    db = _transfer_db(col)
    with pytest.raises(HTTPException) as exc:
        await transfer_collection(1, _to_program(99), _user("admin"), db=db)
    assert exc.value.status_code == 422 and "99" in exc.value.detail
    assert col.owner_program_id is None and col.version == 3
    db.commit.assert_not_awaited()


async def test_transfer_instructor_own_collection_to_own_program() -> None:
    col = _collection(1, "private", user_id=7)
    instructor = _user("instructor", id=7, programs=[3])
    out = await transfer_collection(
        1, _to_program(3), instructor, db=_transfer_db(col, programs=[_program(3)])
    )
    assert col.owners == [] and col.owner_program_id == 3
    assert out.owners[0].program_id == 3 and out.version == 4
    # Still an instructor in the owning program, so still an editor.
    assert out.permissions.can_edit and out.permissions.can_transfer


async def test_transfer_instructor_own_collection_to_foreign_program_is_403() -> None:
    col = _collection(1, "private", user_id=7)
    db = _transfer_db(col, programs=[_program(4)])
    with pytest.raises(HTTPException) as exc:
        await transfer_collection(1, _to_program(4), _user("instructor", id=7, programs=[3]), db=db)
    assert exc.value.status_code == 403
    assert "P4" in exc.value.detail
    assert [o.id for o in col.owners] == [7] and col.owner_program_id is None
    assert col.version == 3
    db.commit.assert_not_awaited()


async def test_transfer_instructor_in_owning_program_to_other_own_program() -> None:
    col = _collection(1, "public", user_id=None, owner_program_id=3)
    instructor = _user("instructor", id=7, programs=[3, 4])
    out = await transfer_collection(
        1, _to_program(4), instructor, db=_transfer_db(col, programs=[_program(4)])
    )
    assert col.owner_program_id == 4
    assert out.owners[0].program_id == 4 and out.version == 4


async def test_transfer_instructor_in_owning_program_to_foreign_program_is_403() -> None:
    col = _collection(1, "public", user_id=None, owner_program_id=3)
    db = _transfer_db(col, programs=[_program(5)])
    with pytest.raises(HTTPException) as exc:
        await transfer_collection(1, _to_program(5), _user("instructor", id=7, programs=[3]), db=db)
    assert exc.value.status_code == 403
    assert col.owner_program_id == 3


async def test_transfer_instructor_outside_owning_program_is_403() -> None:
    col = _collection(1, "public", user_id=None, owner_program_id=3)
    outsider = _user("instructor", id=8, programs=[4])
    with pytest.raises(HTTPException) as exc:
        await transfer_collection(
            1, _to_program(4), outsider, db=_transfer_db(col, programs=[_program(4)])
        )
    assert exc.value.status_code == 403
    assert exc.value.detail == "You may not transfer this collection"


async def test_transfer_instructor_not_owner_of_user_collection_is_403() -> None:
    col = _collection(1, "public", user_id=10)
    with pytest.raises(HTTPException) as exc:
        await transfer_collection(
            1, _to_program(3), _user("instructor", id=7, programs=[3]),
            db=_transfer_db(col, programs=[_program(3)]),
        )
    assert exc.value.status_code == 403


@pytest.mark.parametrize("role", ["staff", "student"])
async def test_transfer_staff_and_student_are_403_even_as_owner(role: str) -> None:
    col = _collection(1, "public", user_id=2)
    db = _transfer_db(col, programs=[_program(3)])
    with pytest.raises(HTTPException) as exc:
        await transfer_collection(1, _to_program(3), _user(role, id=2), db=db)
    assert exc.value.status_code == 403
    db.commit.assert_not_awaited()
    assert [o.id for o in col.owners] == [2] and col.version == 3


async def test_transfer_hidden_collection_is_404_not_403() -> None:
    col = _collection(1, "private", user_id=10)
    with pytest.raises(HTTPException) as exc:
        await transfer_collection(
            1, _to_program(3), _user("student", id=2, programs=[3]),
            db=_transfer_db(col, programs=[_program(3)]),
        )
    assert exc.value.status_code == 404


async def test_transfer_missing_collection_is_404() -> None:
    with pytest.raises(HTTPException) as exc:
        await transfer_collection(
            9, _to_program(3), _user("admin"), db=_transfer_db(None)
        )
    assert exc.value.status_code == 404


async def test_transfer_stale_version_is_409_with_current_collection() -> None:
    col = _collection(1, "private", user_id=10)
    db = _transfer_db(col, programs=[_program(3)])
    with pytest.raises(HTTPException) as exc:
        await transfer_collection(
            1, _to_program(3, version=2), _user("admin"), db=db
        )
    assert exc.value.status_code == 409
    assert exc.value.detail["version"] == 3
    assert exc.value.detail["owners"] == [
        {"user_id": 10, "program_id": None, "name": "user10"}
    ]
    assert [o.id for o in col.owners] == [10]
    db.commit.assert_not_awaited()


async def test_transfer_lost_cas_race_is_409() -> None:
    col = _collection(1, "private", user_id=10)
    db = _transfer_db(col, programs=[_program(3)], cas_rowcount=0)
    with pytest.raises(HTTPException) as exc:
        await transfer_collection(1, _to_program(3), _user("admin"), db=db)
    assert exc.value.status_code == 409
    assert [o.id for o in col.owners] == [10] and col.version == 3


async def test_transfer_body_program_id_nullable_but_required() -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        CollectionTransfer(version=1)  # program_id missing
    assert CollectionTransfer(program_id=None, version=1).program_id is None
    assert CollectionTransfer(program_id=2, version=1).program_id == 2


# ── orphaned collections (program deleted) ────────────────────


def _orphan(id: int = 1, visibility: str = "public", **kwargs) -> SimpleNamespace:
    return _collection(id, visibility, user_id=None, owner_program_id=None, **kwargs)


async def test_orphan_admin_reassigns_via_transfer_or_owners() -> None:
    col = _orphan(programs=[3])  # restricted scope row may outlive its program
    prog = _program(4)
    out = await transfer_collection(
        1, _to_program(4), _user("admin"), db=_transfer_db(col, programs=[prog])
    )
    assert col.owner_program_id == 4 and out.owners[0].program_id == 4
    col2 = _orphan(2)
    out = await replace_collection_owners(
        2, _owners_body([20]), _user("admin"), db=_transfer_db(col2, users=[_target_user(20)])
    )
    assert [o.user_id for o in out.owners] == [20]


async def test_orphan_transfer_is_admin_only() -> None:
    col = _orphan(programs=[3])
    for user in (
        _user("instructor", id=7, programs=[3]),
        _user("staff", id=3),
        _user("student", id=2, programs=[3]),
    ):
        db = _transfer_db(col, programs=[_program(3)])
        with pytest.raises(HTTPException) as exc:
            await transfer_collection(1, _to_program(3), user, db=db)
        assert exc.value.status_code == 403
        db.commit.assert_not_awaited()
        with pytest.raises(HTTPException) as exc:
            await replace_collection_owners(
                1, _owners_body([3]), user, db=_transfer_db(col)
            )
        assert exc.value.status_code == 403
    assert col.owner_program_id is None and col.owners == []


async def test_orphan_edit_and_delete_403_for_instructor_owning_nothing() -> None:
    col = _orphan(programs=[3])
    instructor = _user("instructor", id=7, programs=[3])
    with pytest.raises(HTTPException) as exc:
        await update_collection(1, _patch(name="N"), instructor, db=_write_db(get=col))
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        await replace_collection_images(1, _images_body([]), instructor, db=_write_db(get=col))
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        await replace_collection_viewport(
            1, CollectionViewportUpdate(viewport_state={}, version=3), instructor, db=_write_db(get=col)
        )
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        await delete_collection(1, instructor, db=_write_db(get=col))
    assert exc.value.status_code == 403
    assert col.name == "C1" and col.version == 3


async def test_orphan_public_collection_visible_to_students() -> None:
    col = _orphan(1, "public", images=[_image(1)])
    student = _user("student", id=2)
    out = await get_collection(1, student, db=_mock_db(get=col))
    assert out.id == 1 and out.owners == [] and out.image_count == 1
    assert out.permissions.can_edit is False
    assert out.permissions.can_transfer is False
    listed = await list_collections(student, db=_mock_db([col]))
    assert [c.id for c in listed] == [1]


async def test_orphan_private_collection_hidden_from_students() -> None:
    col = _orphan(1, "private")
    with pytest.raises(HTTPException) as exc:
        await get_collection(1, _user("student", id=2), db=_mock_db(get=col))
    assert exc.value.status_code == 404
    assert await list_collections(_user("student", id=2), db=_mock_db([col])) == []


async def test_orphan_restricted_scope_still_gates_students() -> None:
    """A deleted program's ``collection_programs`` rows disappear (FK cascade),
    so an orphan restricted only to that program becomes unrestricted on the
    program dimension; a surviving group scope row still gates students."""
    unrestricted = _orphan(1, "restricted")  # scope rows gone with the program
    gated = _orphan(2, "restricted", groups=[8])
    listed = await list_collections(
        _user("student", id=2), db=_mock_db([unrestricted, gated])
    )
    assert [c.id for c in listed] == [1]
    listed = await list_collections(
        _user("student", id=2, groups=[8]), db=_mock_db([unrestricted, gated])
    )
    assert [c.id for c in listed] == [1, 2]


async def test_orphan_admin_list_filter_and_permissions() -> None:
    col = _orphan(1, "public")
    out = await list_collections(_user("admin"), orphaned=True, db=_mock_db([col]))
    assert out[0].owners == []
    assert out[0].permissions.can_edit and out[0].permissions.can_transfer


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


# ── move (browse placement, #1527) ────────────────────────


def _move_db(
    collection=None,
    category=None,
    cas_rowcount: int = 1,
) -> AsyncMock:
    """Mock session for ``move_collection``: ``db.get`` answers Collection /
    Category lookups, ``execute`` answers the optimistic-concurrency UPDATE.
    """
    db = AsyncMock()

    async def _get(entity, pk):
        if entity is Collection:
            return collection
        if entity is Category:
            return category
        return None

    db.get = AsyncMock(side_effect=_get)
    result = MagicMock()
    result.rowcount = cas_rowcount
    db.execute = AsyncMock(return_value=result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db


def _move(category_id: int | None, version: int = 3) -> CollectionMove:
    return CollectionMove(category_id=category_id, version=version)


async def test_move_endpoint_is_admin_instructor_only() -> None:
    route = next(
        r for r in collections_router.router.routes if r.path.endswith("/move")
    )
    gate = next(
        dep.call
        for dep in route.dependant.dependencies
        if dep.call.__name__ == "_check"
    )
    for role in ("student", "staff"):
        with pytest.raises(HTTPException) as exc:
            await gate(current_user=_user(role))
        assert exc.value.status_code == 403
    for role in ("admin", "instructor"):
        assert (await gate(current_user=_user(role))).role == role


async def test_move_admin_files_collection_into_category(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    col = _collection(1, "public", user_id=10, category_id=7, sort_order=2)
    cat = SimpleNamespace(id=3)
    db = _move_db(collection=col, category=cat)
    out = await move_collection(1, _move(3), _user("admin"), db=db)
    assert col.category_id == 3
    assert col.version == 4 and out.version == 4
    collections_router.bump_scopes.assert_awaited_once()
    assert collections_router.bump_scopes.call_args.args[1] == {7, 3}
    collections_router.bump_browse_revision.assert_awaited_once()
    db.commit.assert_awaited_once()
    db.refresh.assert_awaited_once_with(col)


async def test_move_instructor_to_root_via_null(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    col = _collection(1, "private", user_id=99, category_id=7)
    db = _move_db(collection=col)
    out = await move_collection(1, _move(None), _user("instructor", id=5), db=db)
    assert col.category_id is None
    collections_router.bump_scopes.assert_awaited_once()
    assert collections_router.bump_scopes.call_args.args[1] == {7}
    collections_router.bump_browse_revision.assert_awaited_once()
    assert out.category_id is None


async def test_move_uncategorized_into_category() -> None:
    col = _collection(1, "public", user_id=10, category_id=None)
    cat = SimpleNamespace(id=9)
    db = _move_db(collection=col, category=cat)
    await move_collection(1, _move(9), _user("admin"), db=db)
    assert col.category_id == 9
    assert collections_router.bump_scopes.call_args.args[1] == {9}


async def test_move_same_category_is_noop_without_bumps() -> None:
    col = _collection(1, "public", user_id=10, category_id=3)
    cat = SimpleNamespace(id=3)
    db = _move_db(collection=col, category=cat)
    out = await move_collection(1, _move(3), _user("admin"), db=db)
    assert col.category_id == 3
    collections_router.bump_scopes.assert_not_awaited()
    collections_router.bump_browse_revision.assert_not_awaited()
    # The version CAS still runs so stale tokens get a 409.
    assert col.version == 4 and out.version == 4


async def test_move_missing_collection_is_404() -> None:
    db = _move_db(collection=None)
    with pytest.raises(HTTPException) as exc:
        await move_collection(9, _move(3), _user("admin"), db=db)
    assert exc.value.status_code == 404
    db.commit.assert_not_awaited()


async def test_move_unknown_category_is_422() -> None:
    col = _collection(1, "public", user_id=10, category_id=None)
    db = _move_db(collection=col, category=None)
    with pytest.raises(HTTPException) as exc:
        await move_collection(1, _move(99), _user("admin"), db=db)
    assert exc.value.status_code == 422 and "99" in exc.value.detail
    assert col.category_id is None
    db.commit.assert_not_awaited()


async def test_move_stale_version_is_409_with_current_collection() -> None:
    col = _collection(1, "public", user_id=10, category_id=7)
    db = _move_db(collection=col, category=SimpleNamespace(id=3), cas_rowcount=0)
    with pytest.raises(HTTPException) as exc:
        await move_collection(1, _move(3, version=1), _user("admin"), db=db)
    assert exc.value.status_code == 409
    assert exc.value.detail["id"] == 1 and exc.value.detail["version"] == 3
    assert col.category_id == 7


async def test_move_body_rejects_missing_version() -> None:
    with pytest.raises(Exception):
        CollectionMove(category_id=3)


async def test_move_does_not_change_sort_order() -> None:
    col = _collection(1, "public", user_id=10, category_id=7, sort_order=4)
    db = _move_db(collection=col, category=SimpleNamespace(id=3))
    out = await move_collection(1, _move(3), _user("admin"), db=db)
    assert col.sort_order == 4 and out.sort_order == 4


async def test_move_lock_order_scopes_then_row_then_browse() -> None:
    """Deadlock guard (epic #1525): move must lock scope revisions, then the
    collection row (via the version CAS), then browse_state — the same
    row-before-browse order as PATCH, so concurrent move+PATCH cannot
    deadlock."""
    order: list[str] = []
    collections_router.bump_scopes.side_effect = lambda *a, **k: order.append(
        "scopes"
    )
    collections_router.bump_browse_revision.side_effect = (
        lambda *a, **k: order.append("browse")
    )
    col = _collection(1, "public", user_id=10, category_id=7)
    db = _move_db(collection=col, category=SimpleNamespace(id=3))
    inner = db.execute

    async def _record(stmt):
        order.append("row")
        return await inner(stmt)

    db.execute = AsyncMock(side_effect=_record)
    await move_collection(1, _move(3), _user("admin"), db=db)
    assert order == ["scopes", "row", "browse"]


async def test_delete_lock_order_scopes_then_row_then_browse() -> None:
    order: list[str] = []
    collections_router.bump_scopes.side_effect = lambda *a, **k: order.append(
        "scopes"
    )
    collections_router.bump_browse_revision.side_effect = (
        lambda *a, **k: order.append("browse")
    )
    col = _collection(1, "public", user_id=10, category_id=7)
    owner = _user("instructor", id=10)
    db = AsyncMock()
    db.get = AsyncMock(return_value=col)
    db.delete = AsyncMock(side_effect=lambda *a: order.append("row"))
    db.commit = AsyncMock()
    await delete_collection(1, owner, db=db)
    assert order == ["scopes", "row", "browse"]


async def test_delete_unfiled_collection_skips_scope_bump() -> None:
    col = _collection(1, "public", user_id=10, category_id=None)
    db = AsyncMock()
    db.get = AsyncMock(return_value=col)
    db.delete = AsyncMock()
    db.commit = AsyncMock()

    await delete_collection(1, _user("admin"), db=db)

    collections_router.bump_scopes.assert_not_awaited()
    collections_router.bump_browse_revision.assert_awaited_once()


async def test_list_uncategorized_filter() -> None:
    cols = [_collection(1, "public", user_id=10)]
    db = _mock_db(cols)
    await list_collections(_user("admin"), db=db, uncategorized=True)
    stmt = db.execute.call_args.args[0]
    compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    assert "category_id IS NULL" in compiled


async def test_list_student_hides_collections_in_excluded_categories(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A student-visible collection filed into an excluded category must not
    surface in the list — the category ancestor gate applies on top of the
    collection's own visibility gate."""
    monkeypatch.setattr(
        "app.collection_views.get_student_excluded_category_ids",
        AsyncMock(return_value={8}),
    )
    cols = [
        _collection(1, "public", user_id=10, category_id=8),  # hidden category
        _collection(2, "public", user_id=10, category_id=3),  # visible category
        _collection(3, "public", user_id=10),  # uncategorized
    ]
    student = _user("student", id=2, programs=[1], groups=[5])
    out = await list_collections(student, db=_mock_db(cols))
    assert [c.id for c in out] == [2, 3]


# ── bulk operations (#1578) ─────────────────────────────


def _bulk_db(
    collections: list | None = None,
    category: object = None,
    locked: list | None = None,
) -> AsyncMock:
    """Mock session for the bulk endpoints: the first ``execute`` answers
    the unlocked ``select(Collection)`` load with *collections*; the
    second is the FOR UPDATE re-read and answers with *locked* (defaults
    to the same rows — no concurrent drift). ``db.get`` returns *category*
    for the ``category_id`` validity check."""
    db = AsyncMock()
    db.get = AsyncMock(return_value=category)
    first = MagicMock()
    first.scalars.return_value.all.return_value = collections or []
    second = MagicMock()
    second.scalars.return_value.all.return_value = (
        collections if locked is None else locked
    ) or []
    pending = [first, second]

    async def _execute(*args, **kwargs):  # noqa: ANN002, ANN003, ANN202
        return pending.pop(0) if pending else first

    db.execute = AsyncMock(side_effect=_execute)
    return db


def test_bulk_endpoints_registered_before_id_routes() -> None:
    """``/bulk`` must precede ``/{collection_id}`` in the route table for
    each method or "bulk" would be parsed as an id (422, not a bulk call)."""
    for method in ("PATCH", "DELETE"):
        routes = [r for r in collections_router.router.routes if method in r.methods]
        paths = [r.path for r in routes]
        assert paths.index("/collections/bulk") < paths.index(
            "/collections/{collection_id}"
        )


async def test_bulk_update_endpoint_is_admin_instructor_only() -> None:
    route = next(
        r
        for r in collections_router.router.routes
        if r.path.endswith("/bulk") and "PATCH" in r.methods
    )
    gate = next(
        dep.call
        for dep in route.dependant.dependencies
        if dep.call.__name__ == "_check"
    )
    for role in ("student", "staff"):
        with pytest.raises(HTTPException) as exc:
            await gate(current_user=_user(role))
        assert exc.value.status_code == 403
    for role in ("admin", "instructor"):
        assert (await gate(current_user=_user(role))).role == role


async def test_bulk_update_hidden_and_category() -> None:
    cols = [
        _collection(1, "public", user_id=10, category_id=None),
        _collection(2, "public", user_id=10, category_id=3),
    ]
    db = _bulk_db(cols, category=SimpleNamespace(id=7))
    out = await bulk_update_collections(
        CollectionBulkUpdate(collection_ids=[1, 2], category_id=7, hidden=True),
        _user("instructor", id=9),
        db=db,
    )
    for c in cols:
        assert c.category_id == 7 and c.hidden is True and c.version == 4
    collections_router.bump_scopes.assert_awaited_once()
    # Only filed source and destination scopes are affected.
    assert collections_router.bump_scopes.call_args.args[1] == {3, 7}
    collections_router.bump_browse_revision.assert_awaited_once()
    db.commit.assert_awaited_once()
    assert [s.id for s in out] == [1, 2]
    assert all(s.hidden and s.category_id == 7 for s in out)


async def test_bulk_update_hidden_only_bumps_browse_not_scopes() -> None:
    cols = [_collection(1, hidden=False), _collection(2, hidden=False)]
    db = _bulk_db(cols)
    await bulk_update_collections(
        CollectionBulkUpdate(collection_ids=[1, 2], hidden=True),
        _user("admin"),
        db=db,
    )
    assert all(c.hidden for c in cols)
    assert all(c.version == 4 for c in cols)
    collections_router.bump_scopes.assert_not_awaited()
    collections_router.bump_browse_revision.assert_awaited_once()
    db.commit.assert_awaited_once()


async def test_bulk_update_noop_skips_versions_and_bumps() -> None:
    """Echoing current values must not advance versions or revisions —
    mirrors PATCH /images/bulk so a no-op bulk edit stays a no-op."""
    cols = [
        _collection(1, category_id=7, hidden=True),
        _collection(2, category_id=7, hidden=True),
    ]
    db = _bulk_db(cols, category=SimpleNamespace(id=7))
    out = await bulk_update_collections(
        CollectionBulkUpdate(collection_ids=[1, 2], category_id=7, hidden=True),
        _user("admin"),
        db=db,
    )
    collections_router.bump_scopes.assert_not_awaited()
    collections_router.bump_browse_revision.assert_not_awaited()
    assert [c.version for c in cols] == [3, 3]
    assert len(out) == 2
    db.commit.assert_awaited_once()


async def test_bulk_update_partial_move_bumps_only_moved_sources() -> None:
    """Only collections actually changing category contribute source scopes."""
    cols = [
        _collection(1, category_id=7),
        _collection(2, category_id=3),
    ]
    db = _bulk_db(cols, category=SimpleNamespace(id=7))
    await bulk_update_collections(
        CollectionBulkUpdate(collection_ids=[1, 2], category_id=7),
        _user("admin"),
        db=db,
    )
    collections_router.bump_scopes.assert_awaited_once()
    assert collections_router.bump_scopes.call_args.args[1] == {3, 7}
    assert cols[0].version == 3 and cols[1].version == 4


async def test_bulk_update_unfiles_to_null_without_root_scope_bump() -> None:
    cols = [_collection(1, category_id=7)]
    db = _bulk_db(cols)
    await bulk_update_collections(
        CollectionBulkUpdate(collection_ids=[1], category_id=None),
        _user("admin"),
        db=db,
    )
    assert cols[0].category_id is None
    assert collections_router.bump_scopes.call_args.args[1] == {7}
    collections_router.bump_browse_revision.assert_awaited_once()
    db.get.assert_not_awaited()


async def test_bulk_update_missing_collection_is_404() -> None:
    db = _bulk_db([_collection(1)])
    with pytest.raises(HTTPException) as exc:
        await bulk_update_collections(
            CollectionBulkUpdate(collection_ids=[1, 2], hidden=True),
            _user("admin"),
            db=db,
        )
    assert exc.value.status_code == 404
    db.commit.assert_not_awaited()


async def test_bulk_update_unknown_category_is_422() -> None:
    cols = [_collection(1, category_id=3)]
    db = _bulk_db(cols, category=None)
    with pytest.raises(HTTPException) as exc:
        await bulk_update_collections(
            CollectionBulkUpdate(collection_ids=[1], category_id=99),
            _user("admin"),
            db=db,
        )
    assert exc.value.status_code == 422 and "99" in exc.value.detail
    collections_router.bump_scopes.assert_not_awaited()
    db.commit.assert_not_awaited()


async def test_bulk_delete_admin_deletes_all() -> None:
    cols = [
        _collection(1, "public", user_id=10, category_id=7),
        _collection(2, "private", user_id=11, category_id=None),
    ]
    db = _bulk_db(cols)
    resp = await bulk_delete_collections(
        CollectionBulkDelete(collection_ids=[1, 2]), _user("admin"), db=db
    )
    assert resp.status_code == 204
    assert db.delete.await_count == 2
    collections_router.bump_scopes.assert_awaited_once()
    assert collections_router.bump_scopes.call_args.args[1] == {7}
    collections_router.bump_browse_revision.assert_awaited_once()
    db.commit.assert_awaited_once()


async def test_bulk_delete_student_sole_owner() -> None:
    """A student sole-owner may bulk-delete their own collections — the
    same can_delete_collection gate as the single DELETE, at scale."""
    cols = [_collection(1, "private", user_id=5)]
    db = _bulk_db(cols)
    resp = await bulk_delete_collections(
        CollectionBulkDelete(collection_ids=[1]), _user("student", id=5), db=db
    )
    assert resp.status_code == 204
    db.delete.assert_awaited_once_with(cols[0])


async def test_bulk_delete_unfiled_collections_skips_scope_bump() -> None:
    cols = [_collection(1, "private", user_id=10, category_id=None)]
    db = _bulk_db(cols)

    resp = await bulk_delete_collections(
        CollectionBulkDelete(collection_ids=[1]), _user("admin"), db=db
    )

    assert resp.status_code == 204
    collections_router.bump_scopes.assert_not_awaited()
    collections_router.bump_browse_revision.assert_awaited_once()


async def test_bulk_delete_student_forbidden_on_others() -> None:
    """A viewable-but-not-deletable row in the set fails the whole call."""
    cols = [
        _collection(1, "private", user_id=5),
        _collection(2, "public", user_id=10),
    ]
    db = _bulk_db(cols)
    with pytest.raises(HTTPException) as exc:
        await bulk_delete_collections(
            CollectionBulkDelete(collection_ids=[1, 2]),
            _user("student", id=5),
            db=db,
        )
    assert exc.value.status_code == 403
    db.delete.assert_not_awaited()
    db.commit.assert_not_awaited()


async def test_bulk_delete_unviewable_is_404_not_403() -> None:
    """A private collection the caller cannot see answers 404 like the
    single DELETE — private ids cannot be probed."""
    cols = [
        _collection(1, "private", user_id=5),
        _collection(2, "private", user_id=10),
    ]
    db = _bulk_db(cols)
    with pytest.raises(HTTPException) as exc:
        await bulk_delete_collections(
            CollectionBulkDelete(collection_ids=[1, 2]),
            _user("student", id=5),
            db=db,
        )
    assert exc.value.status_code == 404
    db.delete.assert_not_awaited()


async def test_bulk_delete_missing_is_404() -> None:
    db = _bulk_db([_collection(1, "public", user_id=5)])
    with pytest.raises(HTTPException) as exc:
        await bulk_delete_collections(
            CollectionBulkDelete(collection_ids=[1, 2]), _user("admin"), db=db
        )
    assert exc.value.status_code == 404
    db.delete.assert_not_awaited()


async def test_bulk_delete_lock_order_scopes_then_rows_then_browse() -> None:
    order: list[str] = []
    collections_router.bump_scopes.side_effect = lambda *a, **k: order.append(
        "scopes"
    )
    collections_router.bump_browse_revision.side_effect = (
        lambda *a, **k: order.append("browse")
    )
    cols = [
        _collection(1, "public", user_id=10, category_id=7),
        _collection(2, "public", user_id=10, category_id=3),
    ]
    db = _bulk_db(cols)
    db.delete = AsyncMock(side_effect=lambda *a: order.append("row"))
    await bulk_delete_collections(
        CollectionBulkDelete(collection_ids=[1, 2]), _user("admin"), db=db
    )
    assert order == ["scopes", "row", "row", "browse"]


async def test_bulk_update_concurrent_move_is_409() -> None:
    """A collection refiled between the unlocked read and the row lock
    leaves its real source scope unbumped — 409 lets the caller retry
    rather than silently skipping the tile-order invalidation."""
    cols = [_collection(1, category_id=7)]
    drifted = _collection(1, category_id=8)
    db = _bulk_db(cols, category=SimpleNamespace(id=9), locked=[drifted])
    with pytest.raises(HTTPException) as exc:
        await bulk_update_collections(
            CollectionBulkUpdate(collection_ids=[1], category_id=9),
            _user("admin"),
            db=db,
        )
    assert exc.value.status_code == 409
    assert cols[0].category_id == 7  # speculative write never applied
    db.commit.assert_not_awaited()


async def test_bulk_update_missing_at_lock_is_409() -> None:
    """A row deleted before the FOR UPDATE re-read is drift too."""
    db = _bulk_db(
        [_collection(1), _collection(2)],
        locked=[_collection(1)],
    )
    with pytest.raises(HTTPException) as exc:
        await bulk_update_collections(
            CollectionBulkUpdate(collection_ids=[1, 2], hidden=True),
            _user("admin"),
            db=db,
        )
    assert exc.value.status_code == 409
    db.commit.assert_not_awaited()


async def test_bulk_update_refreshes_changed_rows_for_updated_at() -> None:
    """``updated_at`` is SQL-generated — only changed rows are refreshed
    post-commit so summaries carry the committed modification time."""
    cols = [_collection(1, hidden=False), _collection(2, hidden=True)]
    db = _bulk_db(cols)
    await bulk_update_collections(
        CollectionBulkUpdate(collection_ids=[1, 2], hidden=True),
        _user("admin"),
        db=db,
    )
    db.refresh.assert_awaited_once_with(cols[0])


async def test_bulk_delete_concurrent_move_is_409() -> None:
    cols = [_collection(1, "public", user_id=10, category_id=7)]
    drifted = _collection(1, "public", user_id=10, category_id=8)
    db = _bulk_db(cols, locked=[drifted])
    with pytest.raises(HTTPException) as exc:
        await bulk_delete_collections(
            CollectionBulkDelete(collection_ids=[1]), _user("admin"), db=db
        )
    assert exc.value.status_code == 409
    db.delete.assert_not_awaited()
    db.commit.assert_not_awaited()
