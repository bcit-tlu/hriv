from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete as sql_delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user, require_role
from ..authz import (
    can_change_cohort_membership,
    can_create_cohort_under,
    can_manage_cohort,
    is_tenant,
    tenant_ids,
)
from ..database import get_db
from ..models import Program, User, user_programs
from ..schemas import ProgramCreate, ProgramUpdate, ProgramOut, UserOut
from .users import _user_to_out

router = APIRouter(prefix="/programs", tags=["programs"])

_any_authenticated = get_current_user
_editor = require_role("admin", "instructor")


@router.get("/", response_model=list[ProgramOut])
async def list_programs(
    _user: Annotated[User, Depends(_any_authenticated)],
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Program).order_by(Program.name)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{program_id}", response_model=ProgramOut)
async def get_program(
    program_id: int,
    _user: Annotated[User, Depends(_any_authenticated)],
    db: AsyncSession = Depends(get_db),
):
    program = await db.get(Program, program_id)
    if not program:
        raise HTTPException(status_code=404, detail="Program not found")
    return program


@router.post("/", response_model=ProgramOut, status_code=201)
async def create_program(
    body: ProgramCreate,
    user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
):
    # Check for duplicate name
    existing = await db.execute(
        select(Program).where(Program.name == body.name)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Program name already exists")

    parent: Program | None = None
    if body.parent_program_id is not None:
        parent = await db.get(Program, body.parent_program_id)
        if parent is None:
            raise HTTPException(status_code=422, detail="Parent program not found")
        if not is_tenant(parent):
            raise HTTPException(
                status_code=422,
                detail="Cohorts cannot be nested; parent must be a top-level program",
            )

    oidc_group = body.oidc_group
    if user.role != "admin":
        # Instructors may only create cohorts under a tenant they belong to,
        # and may never set an OIDC group.
        if parent is None:
            raise HTTPException(
                status_code=403,
                detail="Instructors must create a cohort under a program they belong to",
            )
        if not can_create_cohort_under(user, parent):
            raise HTTPException(
                status_code=403,
                detail="Not permitted to create a cohort under this program",
            )
        oidc_group = None

    # A cohort never carries an OIDC group (membership is not IdP-sourced).
    if parent is not None:
        oidc_group = None

    if oidc_group is not None:
        dup = await db.execute(
            select(Program).where(Program.oidc_group == oidc_group)
        )
        if dup.scalar_one_or_none():
            raise HTTPException(
                status_code=409, detail="OIDC group already mapped to another program",
            )

    program = Program(
        name=body.name,
        oidc_group=oidc_group,
        parent_program_id=body.parent_program_id,
    )
    db.add(program)
    await db.commit()
    await db.refresh(program)
    return program


@router.patch("/{program_id}", response_model=ProgramOut)
async def update_program(
    program_id: int,
    body: ProgramUpdate,
    user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
):
    program = await db.get(Program, program_id)
    if not program:
        raise HTTPException(status_code=404, detail="Program not found")
    update_data = body.model_dump(exclude_unset=True)

    if user.role != "admin":
        # Instructors may only rename cohorts within their scope.
        if not can_manage_cohort(user, program):
            raise HTTPException(
                status_code=403, detail="Not permitted to modify this program",
            )
        if "oidc_group" in update_data or "parent_program_id" in update_data:
            raise HTTPException(
                status_code=403, detail="Instructors may only rename cohorts",
            )

    if "name" in update_data:
        existing = await db.execute(
            select(Program).where(
                Program.name == update_data["name"],
                Program.id != program_id,
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Program name already exists")

    if "parent_program_id" in update_data:
        new_parent_id = update_data["parent_program_id"]
        if new_parent_id is not None:
            if new_parent_id == program_id:
                raise HTTPException(
                    status_code=422, detail="A program cannot be its own parent",
                )
            new_parent = await db.get(Program, new_parent_id)
            if new_parent is None:
                raise HTTPException(status_code=422, detail="Parent program not found")
            if not is_tenant(new_parent):
                raise HTTPException(
                    status_code=422,
                    detail="Cohorts cannot be nested; parent must be a top-level program",
                )
            # Query for children directly: accessing the lazy ``cohorts``
            # relationship would trigger blocking IO under the async session.
            child = await db.execute(
                select(Program.id)
                .where(Program.parent_program_id == program_id)
                .limit(1)
            )
            if child.scalar_one_or_none() is not None:
                raise HTTPException(
                    status_code=422,
                    detail="Cannot turn a program with cohorts into a cohort",
                )
            # A cohort never carries an OIDC group. Route this through
            # ``update_data`` so the setattr loop below cannot re-apply an
            # ``oidc_group`` submitted in the same request.
            update_data["oidc_group"] = None

    if "oidc_group" in update_data and update_data["oidc_group"] is not None:
        # A cohort never carries an OIDC group. Block setting one on a program
        # that is (or remains) a cohort, even when parent_program_id is not part
        # of this request.
        effective_parent = update_data.get(
            "parent_program_id", program.parent_program_id,
        )
        if effective_parent is not None:
            raise HTTPException(
                status_code=422, detail="Cohorts cannot carry an OIDC group",
            )
        dup = await db.execute(
            select(Program).where(
                Program.oidc_group == update_data["oidc_group"],
                Program.id != program_id,
            )
        )
        if dup.scalar_one_or_none():
            raise HTTPException(
                status_code=409, detail="OIDC group already mapped to another program",
            )

    for key, value in update_data.items():
        setattr(program, key, value)
    await db.commit()
    await db.refresh(program)
    return program


@router.delete("/{program_id}", status_code=204)
async def delete_program(
    program_id: int,
    user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
):
    program = await db.get(Program, program_id)
    if not program:
        raise HTTPException(status_code=404, detail="Program not found")
    if user.role != "admin" and not can_manage_cohort(user, program):
        raise HTTPException(
            status_code=403, detail="Not permitted to delete this program",
        )
    await db.delete(program)
    await db.commit()


async def _load_member_context(
    db: AsyncSession, cohort_id: int, user_id: int,
) -> tuple[Program, User]:
    """Load the cohort and target user for a membership change, or 404."""
    cohort = await db.get(Program, cohort_id)
    if cohort is None:
        raise HTTPException(status_code=404, detail="Program not found")
    student = await db.get(User, user_id)
    if student is None:
        raise HTTPException(status_code=404, detail="User not found")
    return cohort, student


@router.post("/{cohort_id}/members/{user_id}", response_model=UserOut)
async def add_cohort_member(
    cohort_id: int,
    user_id: int,
    user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
):
    """Add a student to a cohort (delta write — other memberships untouched)."""
    cohort, student = await _load_member_context(db, cohort_id, user_id)
    if not can_change_cohort_membership(user, cohort, student):
        raise HTTPException(
            status_code=403,
            detail="Not permitted to change this student's cohort membership",
        )
    # Atomic, idempotent insert: ON CONFLICT DO NOTHING avoids a TOCTOU race
    # between concurrent identical requests (composite PK on user_programs).
    await db.execute(
        pg_insert(user_programs)
        .values(user_id=student.id, program_id=cohort.id)
        .on_conflict_do_nothing()
    )
    await db.commit()
    await db.refresh(student, ["programs"])
    return _user_to_out(student)


@router.delete("/{cohort_id}/members/{user_id}", response_model=UserOut)
async def remove_cohort_member(
    cohort_id: int,
    user_id: int,
    user: Annotated[User, Depends(_editor)],
    db: AsyncSession = Depends(get_db),
):
    """Remove a student from a cohort (delta write — other memberships untouched)."""
    cohort, student = await _load_member_context(db, cohort_id, user_id)
    if not can_change_cohort_membership(user, cohort, student):
        raise HTTPException(
            status_code=403,
            detail="Not permitted to change this student's cohort membership",
        )
    await db.execute(
        sql_delete(user_programs).where(
            user_programs.c.user_id == student.id,
            user_programs.c.program_id == cohort.id,
        )
    )
    await db.commit()
    await db.refresh(student, ["programs"])
    return _user_to_out(student)
