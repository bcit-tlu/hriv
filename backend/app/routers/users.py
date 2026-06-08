from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_role, hash_password
from ..database import get_db
from ..models import Program, User
from ..schemas import UserCreate, UserUpdate, UserBulkUpdate, UserBulkRoleUpdate, UserBulkDelete, UserOut
from ..serializers import user_to_mini_out, user_to_out

router = APIRouter(prefix="/users", tags=["users"])

_admin = require_role("admin")
_editor = require_role("admin", "instructor")

VALID_ROLES = {"admin", "instructor", "student"}


async def _set_user_programs(
    db: AsyncSession, user: User, program_ids: list[int],
) -> None:
    """Replace a user's program associations."""
    if program_ids:
        progs = (await db.execute(
            select(Program).where(Program.id.in_(program_ids))
        )).scalars().all()
        found_ids = {p.id for p in progs}
        missing = set(program_ids) - found_ids
        if missing:
            raise HTTPException(422, f"Invalid program IDs: {sorted(missing)}")
        user.programs = list(progs)
    else:
        user.programs = []


@router.get("/", response_model=list[UserOut])
async def list_users(
    _user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
    role: str | None = None,
    program_id: Annotated[list[int] | None, Query()] = None,
    q: str | None = None,
    page: Annotated[int | None, Query(ge=1)] = None,
    page_size: Annotated[int | None, Query(ge=1, le=200)] = None,
    response: Response = None,  # type: ignore[assignment]
):
    """List users, optionally filtered by ``role``, ``program_id`` and ``q``.

    The response shape is role-dependent. Admins receive full ``UserOut``
    objects (programs, metadata, last_access). Instructors receive a
    **minimal** projection — ``id, name, email, role`` plus the user's
    ``program_ids``/``program_names`` (so the membership picker can filter
    by program and render program chips); ``metadata_extra``/``last_access``
    remain hidden. Instructors only ever see students and other instructors,
    never admins.

    Filtering / pagination (applied for every role):

    * ``program_id`` — restrict to users who belong to **any** of the given
      programs (repeatable, e.g. ``?program_id=1&program_id=2`` → OR). Backs
      the multi-select program filter chips.
    * ``q`` — case-insensitive substring match on name or email.
    * ``page`` + ``page_size`` — server-side pagination. When supplied, the
      total number of matching users (before pagination) is returned in the
      ``X-Total-Count`` response header so the client can render page
      controls. Omitting them returns the full filtered list.
    """
    if role is not None and role not in VALID_ROLES:
        raise HTTPException(422, f"Invalid role: {role}")

    is_instructor = _user.role == "instructor"
    # Instructors may list students (to populate group membership) and other
    # instructors (for group co-ownership), but only with minimal fields and
    # never admin accounts. Admins see all users with full detail.
    conditions = []
    if is_instructor:
        allowed = {"student", "instructor"}
        if role is not None and role not in allowed:
            raise HTTPException(
                403, "Instructors may only list students and instructors",
            )
        conditions.append(
            User.role == role if role else User.role.in_(allowed)
        )
    elif role is not None:
        conditions.append(User.role == role)

    if program_id:
        conditions.append(User.programs.any(Program.id.in_(program_id)))
    if q and q.strip():
        like = f"%{q.strip()}%"
        conditions.append(or_(User.name.ilike(like), User.email.ilike(like)))

    # Total count (before pagination) for the X-Total-Count header.
    count_stmt = select(func.count()).select_from(User)
    for cond in conditions:
        count_stmt = count_stmt.where(cond)
    total = (await db.execute(count_stmt)).scalar_one()
    if response is not None:
        response.headers["X-Total-Count"] = str(total)

    stmt = select(User)
    for cond in conditions:
        stmt = stmt.where(cond)
    stmt = stmt.order_by(User.name)
    if page_size is not None:
        offset = (page - 1) * page_size if page is not None else 0
        stmt = stmt.limit(page_size).offset(offset)

    result = await db.execute(stmt)
    users = result.scalars().unique().all()
    if is_instructor:
        return [user_to_mini_out(u) for u in users]
    return [user_to_out(u) for u in users]


@router.post("/", response_model=UserOut, status_code=201)
async def create_user(
    body: UserCreate,
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    user = User(
        name=body.name,
        email=body.email.lower(),
        password_hash=hash_password(body.password),
        role=body.role,
        metadata_=body.metadata_extra or {},
    )
    db.add(user)
    await db.flush()
    await db.refresh(user, ["programs"])
    await _set_user_programs(db, user, body.program_ids)
    await db.commit()
    await db.refresh(user, ["programs", "groups"])
    return user_to_out(user)


@router.patch("/bulk/program", response_model=list[UserOut])
async def bulk_update_program(
    body: UserBulkUpdate,
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    """Bulk-update the program associations for multiple users."""
    stmt = select(User).where(User.id.in_(body.user_ids))
    result = await db.execute(stmt)
    users = result.scalars().unique().all()
    if len(users) != len(set(body.user_ids)):
        raise HTTPException(status_code=404, detail="One or more users not found")
    for user in users:
        await _set_user_programs(db, user, body.program_ids)
    await db.commit()
    # Reload to get updated programs
    stmt = select(User).where(User.id.in_(body.user_ids))
    result = await db.execute(stmt)
    users = result.scalars().unique().all()
    return [user_to_out(u) for u in users]


@router.patch("/bulk/role", response_model=list[UserOut])
async def bulk_update_role(
    body: UserBulkRoleUpdate,
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    """Bulk-update the role for multiple users."""
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=422, detail=f"Invalid role: {body.role}")
    stmt = select(User).where(User.id.in_(body.user_ids))
    result = await db.execute(stmt)
    users = result.scalars().unique().all()
    if len(users) != len(set(body.user_ids)):
        raise HTTPException(status_code=404, detail="One or more users not found")
    for user in users:
        user.role = body.role
    await db.commit()
    stmt = select(User).where(User.id.in_(body.user_ids))
    result = await db.execute(stmt)
    users = result.scalars().unique().all()
    return [user_to_out(u) for u in users]


@router.delete("/bulk", status_code=204)
async def bulk_delete_users(
    body: UserBulkDelete,
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    """Bulk-delete multiple users."""
    if _user.id in body.user_ids:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    stmt = select(User).where(User.id.in_(body.user_ids))
    result = await db.execute(stmt)
    users = result.scalars().unique().all()
    if len(users) != len(set(body.user_ids)):
        raise HTTPException(status_code=404, detail="One or more users not found")
    for user in users:
        await db.delete(user)
    await db.commit()


@router.get("/{user_id}", response_model=UserOut)
async def get_user(
    user_id: int,
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user_to_out(user)


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    body: UserUpdate,
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    update_data = body.model_dump(exclude_unset=True)
    program_ids = update_data.pop("program_ids", None)
    if "metadata_extra" in update_data:
        update_data["metadata_"] = update_data.pop("metadata_extra")
    if "password" in update_data:
        pwd = update_data.pop("password")
        if pwd is not None:
            update_data["password_hash"] = hash_password(pwd)
    if "email" in update_data and update_data["email"] is not None:
        update_data["email"] = update_data["email"].lower()
    for key, value in update_data.items():
        setattr(user, key, value)
    if program_ids is not None:
        await _set_user_programs(db, user, program_ids)
    await db.commit()
    await db.refresh(user, ["programs", "groups"])
    return user_to_out(user)


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    if _user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await db.delete(user)
    await db.commit()
