"""First-class group management endpoints.

Groups are an instructor-managed visibility dimension. Admins manage all
groups; the instructors listed in a group's ``instructors`` set co-own it and
share full management authority. The creator becomes the initial instructor.
Group members must be students; group instructors must be instructors.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_role
from ..authz import can_manage_group
from ..database import get_db
from ..models import Group, User
from ..schemas import (
    GroupCreate,
    GroupMemberOut,
    GroupMembersBulk,
    GroupOut,
    GroupUpdate,
)

router = APIRouter(prefix="/groups", tags=["groups"])

_editor = require_role("admin", "instructor")


async def _get_group_or_404(db: AsyncSession, group_id: int) -> Group:
    group = await db.get(Group, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")
    return group


def _require_manage(user: User, group: Group) -> None:
    if not can_manage_group(user, [i.id for i in group.instructors]):
        raise HTTPException(
            status_code=403,
            detail="You do not have permission to manage this group",
        )


async def _load_users(
    db: AsyncSession, user_ids: list[int], expected_role: str,
) -> list[User]:
    """Fetch users by id, requiring all to exist and match *expected_role*."""
    unique_ids = list(dict.fromkeys(user_ids))
    if not unique_ids:
        return []
    users = (await db.execute(
        select(User).where(User.id.in_(unique_ids))
    )).scalars().unique().all()
    found = {u.id for u in users}
    missing = set(unique_ids) - found
    if missing:
        raise HTTPException(422, f"Invalid user IDs: {sorted(missing)}")
    wrong_role = sorted(u.id for u in users if u.role != expected_role)
    if wrong_role:
        raise HTTPException(
            422,
            f"Users must have role '{expected_role}': {wrong_role}",
        )
    return list(users)


# ── Group CRUD ────────────────────────────────────────────


@router.get("/", response_model=list[GroupOut])
async def list_groups(
    _user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Group).order_by(Group.name))
    return result.scalars().unique().all()


@router.post("/", response_model=GroupOut, status_code=201)
async def create_group(
    body: GroupCreate,
    user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(select(Group).where(Group.name == body.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Group name already exists")

    group = Group(
        name=body.name,
        description=body.description,
        created_by_user_id=user.id,
    )
    db.add(group)
    await db.flush()
    await db.refresh(group, ["members", "instructors"])
    # The creator becomes the initial instructor so they can manage it,
    # unless an admin created it (admins manage all groups regardless).
    if user.role == "instructor":
        group.instructors.append(user)
    await db.commit()
    await db.refresh(group, ["members", "instructors"])
    return group


@router.get("/{group_id}", response_model=GroupOut)
async def get_group(
    group_id: int,
    _user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
):
    return await _get_group_or_404(db, group_id)


@router.patch("/{group_id}", response_model=GroupOut)
async def update_group(
    group_id: int,
    body: GroupUpdate,
    user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
):
    group = await _get_group_or_404(db, group_id)
    _require_manage(user, group)
    update_data = body.model_dump(exclude_unset=True)
    if "name" in update_data:
        dup = await db.execute(
            select(Group).where(
                Group.name == update_data["name"], Group.id != group_id,
            )
        )
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Group name already exists")
    for key, value in update_data.items():
        setattr(group, key, value)
    await db.commit()
    await db.refresh(group, ["members", "instructors"])
    return group


@router.delete("/{group_id}", status_code=204)
async def delete_group(
    group_id: int,
    user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
):
    group = await _get_group_or_404(db, group_id)
    _require_manage(user, group)
    if group.categories:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Group is attached to one or more categories",
                "category_ids": [c.id for c in group.categories],
                "categories": [
                    {"id": c.id, "label": c.label} for c in group.categories
                ],
            },
        )
    await db.delete(group)
    await db.commit()


# ── Members (students) ────────────────────────────────────


@router.get("/{group_id}/members", response_model=list[GroupMemberOut])
async def list_members(
    group_id: int,
    _user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
):
    group = await _get_group_or_404(db, group_id)
    return sorted(group.members, key=lambda u: u.name)


@router.post("/{group_id}/members/bulk", response_model=GroupOut)
async def add_members_bulk(
    group_id: int,
    body: GroupMembersBulk,
    user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
):
    group = await _get_group_or_404(db, group_id)
    _require_manage(user, group)
    students = await _load_users(db, body.user_ids, "student")
    existing = {m.id for m in group.members}
    for student in students:
        if student.id not in existing:
            group.members.append(student)
    await db.commit()
    await db.refresh(group, ["members", "instructors"])
    return group


@router.delete("/{group_id}/members/bulk", response_model=GroupOut)
async def remove_members_bulk(
    group_id: int,
    body: GroupMembersBulk,
    user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
):
    group = await _get_group_or_404(db, group_id)
    _require_manage(user, group)
    to_remove = set(body.user_ids)
    group.members = [m for m in group.members if m.id not in to_remove]
    await db.commit()
    await db.refresh(group, ["members", "instructors"])
    return group


@router.post("/{group_id}/members/{user_id}", response_model=GroupOut, status_code=201)
async def add_member(
    group_id: int,
    user_id: int,
    user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
):
    group = await _get_group_or_404(db, group_id)
    _require_manage(user, group)
    (student,) = await _load_users(db, [user_id], "student")
    if student.id not in {m.id for m in group.members}:
        group.members.append(student)
        await db.commit()
        await db.refresh(group, ["members", "instructors"])
    return group


@router.delete("/{group_id}/members/{user_id}", response_model=GroupOut)
async def remove_member(
    group_id: int,
    user_id: int,
    user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
):
    group = await _get_group_or_404(db, group_id)
    _require_manage(user, group)
    member = next((m for m in group.members if m.id == user_id), None)
    if member is not None:
        group.members.remove(member)
        await db.commit()
        await db.refresh(group, ["members", "instructors"])
    return group


# ── Instructors (owners) ──────────────────────────────────


@router.get("/{group_id}/instructors", response_model=list[GroupMemberOut])
async def list_instructors(
    group_id: int,
    _user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
):
    group = await _get_group_or_404(db, group_id)
    return sorted(group.instructors, key=lambda u: u.name)


@router.post("/{group_id}/instructors/bulk", response_model=GroupOut)
async def add_instructors_bulk(
    group_id: int,
    body: GroupMembersBulk,
    user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
):
    group = await _get_group_or_404(db, group_id)
    _require_manage(user, group)
    instructors = await _load_users(db, body.user_ids, "instructor")
    existing = {i.id for i in group.instructors}
    for instructor in instructors:
        if instructor.id not in existing:
            group.instructors.append(instructor)
    await db.commit()
    await db.refresh(group, ["members", "instructors"])
    return group


@router.delete("/{group_id}/instructors/bulk", response_model=GroupOut)
async def remove_instructors_bulk(
    group_id: int,
    body: GroupMembersBulk,
    user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
):
    group = await _get_group_or_404(db, group_id)
    _require_manage(user, group)
    to_remove = set(body.user_ids)
    remaining = [i for i in group.instructors if i.id not in to_remove]
    # Only block when this request would actually empty a non-empty roster;
    # a no-op bulk remove on a group with no instructors must not 409.
    if not remaining and group.instructors:
        raise HTTPException(
            status_code=409,
            detail="Cannot remove the last instructor from a group",
        )
    group.instructors = remaining
    await db.commit()
    await db.refresh(group, ["members", "instructors"])
    return group


@router.post(
    "/{group_id}/instructors/{user_id}", response_model=GroupOut, status_code=201,
)
async def add_instructor(
    group_id: int,
    user_id: int,
    user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
):
    group = await _get_group_or_404(db, group_id)
    _require_manage(user, group)
    (instructor,) = await _load_users(db, [user_id], "instructor")
    if instructor.id not in {i.id for i in group.instructors}:
        group.instructors.append(instructor)
        await db.commit()
        await db.refresh(group, ["members", "instructors"])
    return group


@router.delete("/{group_id}/instructors/{user_id}", response_model=GroupOut)
async def remove_instructor(
    group_id: int,
    user_id: int,
    user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
):
    group = await _get_group_or_404(db, group_id)
    _require_manage(user, group)
    if len(group.instructors) <= 1 and any(
        i.id == user_id for i in group.instructors
    ):
        raise HTTPException(
            status_code=409,
            detail="Cannot remove the last instructor from a group",
        )
    instructor = next((i for i in group.instructors if i.id == user_id), None)
    if instructor is not None:
        group.instructors.remove(instructor)
        await db.commit()
        await db.refresh(group, ["members", "instructors"])
    return group
