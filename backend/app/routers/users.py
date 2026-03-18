from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_role, hash_password
from ..database import get_db
from ..models import User
from ..schemas import UserCreate, UserUpdate, UserOut

router = APIRouter(prefix="/users", tags=["users"])

_admin = require_role("admin")


@router.get("/", response_model=list[UserOut])
async def list_users(
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    stmt = select(User).order_by(User.name)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{user_id}", response_model=UserOut)
async def get_user(
    user_id: int,
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


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
        program=body.program,
        metadata_=body.metadata_extra or {},
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


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
    if "metadata_extra" in update_data:
        update_data["metadata_"] = update_data.pop("metadata_extra")
    if "password" in update_data:
        pwd = update_data.pop("password")
        if pwd is not None:
            update_data["password_hash"] = hash_password(pwd)
    for key, value in update_data.items():
        setattr(user, key, value)
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await db.delete(user)
    await db.commit()
