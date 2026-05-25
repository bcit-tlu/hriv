from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_role, hash_password
from ..database import get_db
from ..models import Program, User
from ..schemas import UserCreate, UserUpdate, UserBulkUpdate, UserOut

router = APIRouter(prefix="/users", tags=["users"])

_admin = require_role("admin")
_editor = require_role("admin", "instructor")


def _user_to_out(user: User) -> dict:
    """Convert a User ORM object to a dict with program info resolved."""
    data = {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "program_ids": [p.id for p in user.programs],
        "program_names": [p.name for p in user.programs],
        "metadata_extra": user.metadata_,
        "last_access": user.last_access,
        "created_at": user.created_at,
        "updated_at": user.updated_at,
    }
    return data


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
):
    stmt = select(User).order_by(User.name)
    result = await db.execute(stmt)
    users = result.scalars().unique().all()
    return [_user_to_out(u) for u in users]


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
    return _user_to_out(user)


@router.post("/", response_model=UserOut, status_code=201)
async def create_user(
    body: UserCreate,
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    user = User(
        name=body.name,
        email=body.email,
        password_hash=hash_password(body.password),
        role=body.role,
        metadata_=body.metadata_extra or {},
    )
    db.add(user)
    await db.flush()
    await _set_user_programs(db, user, body.program_ids)
    await db.commit()
    await db.refresh(user, ["programs"])
    return _user_to_out(user)


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
    for key, value in update_data.items():
        setattr(user, key, value)
    if program_ids is not None:
        await _set_user_programs(db, user, program_ids)
    await db.commit()
    await db.refresh(user, ["programs"])
    return _user_to_out(user)


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
    if len(users) != len(body.user_ids):
        raise HTTPException(status_code=404, detail="One or more users not found")
    for user in users:
        await _set_user_programs(db, user, body.program_ids)
    await db.commit()
    # Reload to get updated programs
    stmt = select(User).where(User.id.in_(body.user_ids))
    result = await db.execute(stmt)
    users = result.scalars().unique().all()
    return [_user_to_out(u) for u in users]


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
