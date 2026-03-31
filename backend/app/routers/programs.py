from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_role
from ..database import get_db
from ..models import Program, User
from ..schemas import ProgramCreate, ProgramUpdate, ProgramOut

router = APIRouter(prefix="/programs", tags=["programs"])

_admin = require_role("admin")
_editor = require_role("admin", "instructor")


@router.get("/", response_model=list[ProgramOut])
async def list_programs(
    _user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Program).order_by(Program.name)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{program_id}", response_model=ProgramOut)
async def get_program(
    program_id: int,
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    program = await db.get(Program, program_id)
    if not program:
        raise HTTPException(status_code=404, detail="Program not found")
    return program


@router.post("/", response_model=ProgramOut, status_code=201)
async def create_program(
    body: ProgramCreate,
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    # Check for duplicate name
    existing = await db.execute(
        select(Program).where(Program.name == body.name)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Program name already exists")

    program = Program(name=body.name)
    db.add(program)
    await db.commit()
    await db.refresh(program)
    return program


@router.patch("/{program_id}", response_model=ProgramOut)
async def update_program(
    program_id: int,
    body: ProgramUpdate,
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    program = await db.get(Program, program_id)
    if not program:
        raise HTTPException(status_code=404, detail="Program not found")
    update_data = body.model_dump(exclude_unset=True)
    if "name" in update_data:
        # Check for duplicate name
        existing = await db.execute(
            select(Program).where(
                Program.name == update_data["name"],
                Program.id != program_id,
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Program name already exists")
    for key, value in update_data.items():
        setattr(program, key, value)
    await db.commit()
    await db.refresh(program)
    return program


@router.delete("/{program_id}", status_code=204)
async def delete_program(
    program_id: int,
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    program = await db.get(Program, program_id)
    if not program:
        raise HTTPException(status_code=404, detail="Program not found")
    await db.delete(program)
    await db.commit()
