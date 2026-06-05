"""Tests for the groups router: CRUD, ownership, members, instructors, bulk."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.routers.groups import (
    add_instructor,
    add_instructors_bulk,
    add_member,
    add_members_bulk,
    create_group,
    delete_group,
    get_group,
    list_groups,
    list_instructors,
    list_members,
    remove_instructor,
    remove_instructors_bulk,
    remove_member,
    remove_members_bulk,
    update_group,
)
from app.schemas import GroupCreate, GroupMembersBulk, GroupUpdate

NOW = datetime.now(timezone.utc)


def _user(role: str, id: int = 1) -> SimpleNamespace:
    return SimpleNamespace(id=id, role=role, name=f"user{id}", email=f"u{id}@e.com")


def _group(
    id: int = 1,
    name: str = "G1",
    instructors: list | None = None,
    members: list | None = None,
    categories: list | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=id,
        name=name,
        description=None,
        created_by_user_id=1,
        instructors=list(instructors or []),
        members=list(members or []),
        categories=list(categories or []),
        created_at=NOW,
        updated_at=NOW,
    )


def _mock_db(
    group: SimpleNamespace | None = None,
    users: list | None = None,
    dup: object = None,
) -> AsyncMock:
    db = AsyncMock()
    db.get = AsyncMock(return_value=group)
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.delete = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = dup
    result.scalars.return_value.unique.return_value.all.return_value = users or []
    db.execute = AsyncMock(return_value=result)
    return db


# ── list / get ────────────────────────────────────────────


async def test_list_groups() -> None:
    groups = [_group(1, "A"), _group(2, "B")]
    db = _mock_db(users=groups)
    result = await list_groups(_user("instructor"), db=db)
    assert [g.id for g in result] == [1, 2]


async def test_get_group_found() -> None:
    db = _mock_db(group=_group(1))
    result = await get_group(1, _user("instructor"), db=db)
    assert result.id == 1


async def test_get_group_not_found() -> None:
    db = _mock_db(group=None)
    with pytest.raises(HTTPException) as exc:
        await get_group(99, _user("instructor"), db=db)
    assert exc.value.status_code == 404


# ── create ────────────────────────────────────────────────


async def test_create_group_instructor_becomes_owner() -> None:
    db = _mock_db(dup=None)
    creator = _user("instructor", id=7)
    result = await create_group(
        GroupCreate(name="New", description="d"), creator, db=db
    )
    assert result.created_by_user_id == 7
    assert creator in result.instructors
    db.commit.assert_awaited()


async def test_create_group_admin_not_added_as_instructor() -> None:
    db = _mock_db(dup=None)
    admin = _user("admin", id=1)
    result = await create_group(GroupCreate(name="New"), admin, db=db)
    assert admin not in result.instructors


async def test_create_group_duplicate_name_409() -> None:
    db = _mock_db(dup=_group(1, "New"))
    with pytest.raises(HTTPException) as exc:
        await create_group(GroupCreate(name="New"), _user("admin"), db=db)
    assert exc.value.status_code == 409


# ── update ────────────────────────────────────────────────


async def test_update_group_owner_can_rename() -> None:
    group = _group(1, "Old", instructors=[_user("instructor", id=7)])
    db = _mock_db(group=group, dup=None)
    result = await update_group(
        1, GroupUpdate(name="New"), _user("instructor", id=7), db=db
    )
    assert result.name == "New"


async def test_update_group_non_owner_403() -> None:
    group = _group(1, "Old", instructors=[_user("instructor", id=7)])
    db = _mock_db(group=group)
    with pytest.raises(HTTPException) as exc:
        await update_group(
            1, GroupUpdate(name="New"), _user("instructor", id=8), db=db
        )
    assert exc.value.status_code == 403


async def test_update_group_admin_can_manage_any() -> None:
    group = _group(1, "Old", instructors=[_user("instructor", id=7)])
    db = _mock_db(group=group, dup=None)
    result = await update_group(1, GroupUpdate(name="New"), _user("admin"), db=db)
    assert result.name == "New"


async def test_update_group_duplicate_name_409() -> None:
    group = _group(1, "Old", instructors=[_user("instructor", id=7)])
    db = _mock_db(group=group, dup=_group(2, "Taken"))
    with pytest.raises(HTTPException) as exc:
        await update_group(
            1, GroupUpdate(name="Taken"), _user("instructor", id=7), db=db
        )
    assert exc.value.status_code == 409


# ── delete ────────────────────────────────────────────────


async def test_delete_group_success() -> None:
    group = _group(1, instructors=[_user("instructor", id=7)])
    db = _mock_db(group=group)
    await delete_group(1, _user("instructor", id=7), db=db)
    db.delete.assert_awaited_once()


async def test_delete_group_attached_to_categories_409() -> None:
    group = _group(
        1,
        instructors=[_user("instructor", id=7)],
        categories=[SimpleNamespace(id=3, label="Cat")],
    )
    db = _mock_db(group=group)
    with pytest.raises(HTTPException) as exc:
        await delete_group(1, _user("instructor", id=7), db=db)
    assert exc.value.status_code == 409
    assert exc.value.detail["category_ids"] == [3]


async def test_delete_group_non_owner_403() -> None:
    group = _group(1, instructors=[_user("instructor", id=7)])
    db = _mock_db(group=group)
    with pytest.raises(HTTPException) as exc:
        await delete_group(1, _user("instructor", id=8), db=db)
    assert exc.value.status_code == 403


# ── members ───────────────────────────────────────────────


async def test_list_members_sorted() -> None:
    group = _group(
        1,
        members=[_user("student", id=2), _user("student", id=3)],
    )
    group.members[0].name = "Zoe"
    group.members[1].name = "Amy"
    db = _mock_db(group=group)
    result = await list_members(1, _user("instructor"), db=db)
    assert [u.name for u in result] == ["Amy", "Zoe"]


async def test_add_member_success() -> None:
    group = _group(1, instructors=[_user("instructor", id=7)])
    student = _user("student", id=2)
    db = _mock_db(group=group, users=[student])
    result = await add_member(1, 2, _user("instructor", id=7), db=db)
    assert student in result.members


async def test_add_member_role_mismatch_422() -> None:
    group = _group(1, instructors=[_user("instructor", id=7)])
    not_student = _user("instructor", id=2)
    db = _mock_db(group=group, users=[not_student])
    with pytest.raises(HTTPException) as exc:
        await add_member(1, 2, _user("instructor", id=7), db=db)
    assert exc.value.status_code == 422


async def test_add_member_missing_user_422() -> None:
    group = _group(1, instructors=[_user("instructor", id=7)])
    db = _mock_db(group=group, users=[])
    with pytest.raises(HTTPException) as exc:
        await add_member(1, 99, _user("instructor", id=7), db=db)
    assert exc.value.status_code == 422


async def test_add_member_non_owner_403() -> None:
    group = _group(1, instructors=[_user("instructor", id=7)])
    db = _mock_db(group=group)
    with pytest.raises(HTTPException) as exc:
        await add_member(1, 2, _user("instructor", id=8), db=db)
    assert exc.value.status_code == 403


async def test_remove_member_success() -> None:
    student = _user("student", id=2)
    group = _group(1, instructors=[_user("instructor", id=7)], members=[student])
    db = _mock_db(group=group)
    result = await remove_member(1, 2, _user("instructor", id=7), db=db)
    assert student not in result.members


async def test_add_members_bulk_dedupes() -> None:
    existing = _user("student", id=2)
    group = _group(1, instructors=[_user("instructor", id=7)], members=[existing])
    new = _user("student", id=3)
    db = _mock_db(group=group, users=[existing, new])
    result = await add_members_bulk(
        1, GroupMembersBulk(user_ids=[2, 3]), _user("instructor", id=7), db=db
    )
    assert [m.id for m in result.members] == [2, 3]


async def test_remove_members_bulk() -> None:
    group = _group(
        1,
        instructors=[_user("instructor", id=7)],
        members=[_user("student", id=2), _user("student", id=3)],
    )
    db = _mock_db(group=group)
    result = await remove_members_bulk(
        1, GroupMembersBulk(user_ids=[2]), _user("instructor", id=7), db=db
    )
    assert [m.id for m in result.members] == [3]


# ── instructors ───────────────────────────────────────────


async def test_add_instructor_success() -> None:
    group = _group(1, instructors=[_user("instructor", id=7)])
    new_instr = _user("instructor", id=8)
    db = _mock_db(group=group, users=[new_instr])
    result = await add_instructor(1, 8, _user("instructor", id=7), db=db)
    assert new_instr in result.instructors


async def test_add_instructor_role_mismatch_422() -> None:
    group = _group(1, instructors=[_user("instructor", id=7)])
    student = _user("student", id=8)
    db = _mock_db(group=group, users=[student])
    with pytest.raises(HTTPException) as exc:
        await add_instructor(1, 8, _user("instructor", id=7), db=db)
    assert exc.value.status_code == 422


async def test_list_instructors_sorted() -> None:
    a = _user("instructor", id=8)
    a.name = "Amy"
    z = _user("instructor", id=7)
    z.name = "Zoe"
    group = _group(1, instructors=[z, a])
    db = _mock_db(group=group)
    result = await list_instructors(1, _user("instructor"), db=db)
    assert [u.name for u in result] == ["Amy", "Zoe"]


async def test_remove_instructor_last_one_409() -> None:
    group = _group(1, instructors=[_user("instructor", id=7)])
    db = _mock_db(group=group)
    with pytest.raises(HTTPException) as exc:
        await remove_instructor(1, 7, _user("admin"), db=db)
    assert exc.value.status_code == 409


async def test_remove_instructor_success_when_multiple() -> None:
    keep = _user("instructor", id=7)
    drop = _user("instructor", id=8)
    group = _group(1, instructors=[keep, drop])
    db = _mock_db(group=group)
    result = await remove_instructor(1, 8, _user("admin"), db=db)
    assert [i.id for i in result.instructors] == [7]


async def test_add_instructors_bulk() -> None:
    existing = _user("instructor", id=7)
    group = _group(1, instructors=[existing])
    new = _user("instructor", id=8)
    db = _mock_db(group=group, users=[existing, new])
    result = await add_instructors_bulk(
        1, GroupMembersBulk(user_ids=[7, 8]), _user("admin"), db=db
    )
    assert [i.id for i in result.instructors] == [7, 8]


async def test_remove_instructors_bulk_blocks_emptying() -> None:
    group = _group(
        1,
        instructors=[_user("instructor", id=7), _user("instructor", id=8)],
    )
    db = _mock_db(group=group)
    with pytest.raises(HTTPException) as exc:
        await remove_instructors_bulk(
            1, GroupMembersBulk(user_ids=[7, 8]), _user("admin"), db=db
        )
    assert exc.value.status_code == 409


async def test_remove_instructors_bulk_noop_on_empty_group() -> None:
    # Admin-created groups start with no instructors; a bulk-remove must not 409.
    group = _group(1, instructors=[])
    db = _mock_db(group=group)
    result = await remove_instructors_bulk(
        1, GroupMembersBulk(user_ids=[7]), _user("admin"), db=db
    )
    assert list(result.instructors) == []


async def test_remove_instructors_bulk_partial_ok() -> None:
    group = _group(
        1,
        instructors=[_user("instructor", id=7), _user("instructor", id=8)],
    )
    db = _mock_db(group=group)
    result = await remove_instructors_bulk(
        1, GroupMembersBulk(user_ids=[8]), _user("admin"), db=db
    )
    assert [i.id for i in result.instructors] == [7]
