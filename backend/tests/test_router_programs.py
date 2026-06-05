"""Tests for the programs router endpoints."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.routers.programs import (
    list_programs,
    get_program,
    create_program,
    update_program,
    delete_program,
    add_cohort_member,
    remove_cohort_member,
)
from app.schemas import ProgramCreate, ProgramUpdate


def _admin(**kw) -> SimpleNamespace:
    return SimpleNamespace(id=1, role="admin", programs=[], **kw)


def _instructor(tenant_ids: list[int] | None = None, **kw) -> SimpleNamespace:
    programs = [
        SimpleNamespace(id=t, parent_program_id=None) for t in (tenant_ids or [])
    ]
    return SimpleNamespace(id=2, role="instructor", programs=programs, **kw)


def _student(tenant_ids: list[int] | None = None, role: str = "student", **kw) -> SimpleNamespace:
    programs = [
        SimpleNamespace(id=t, parent_program_id=None, name=f"T{t}")
        for t in (tenant_ids or [])
    ]
    defaults = dict(
        id=10,
        name="Stu",
        email="stu@bcit.ca",
        role=role,
        programs=programs,
        metadata_={},
        last_access=None,
        created_at=None,
        updated_at=None,
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def _cohort(id: int = 100, parent_program_id: int | None = 5, **kw) -> SimpleNamespace:
    return SimpleNamespace(
        id=id, name="Cohort A", parent_program_id=parent_program_id, cohorts=[], **kw
    )


async def test_list_programs() -> None:
    progs = [SimpleNamespace(id=1, name="Bio"), SimpleNamespace(id=2, name="Chem")]
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = progs

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    result = await list_programs(MagicMock(), db)
    assert len(result) == 2


async def test_get_program_found() -> None:
    prog = SimpleNamespace(id=1, name="Bio")
    db = AsyncMock()
    db.get = AsyncMock(return_value=prog)

    result = await get_program(1, MagicMock(), db)
    assert result.name == "Bio"


async def test_get_program_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await get_program(999, MagicMock(), db)
    assert exc.value.status_code == 404


async def test_create_program_success() -> None:
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = ProgramCreate(name="NewProg")
    result = await create_program(body, _admin(), db)

    db.add.assert_called_once()
    db.commit.assert_awaited_once()


async def test_create_program_duplicate_name() -> None:
    existing = SimpleNamespace(id=1, name="Existing")
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = existing

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    body = ProgramCreate(name="Existing")
    with pytest.raises(HTTPException) as exc:
        await create_program(body, _admin(), db)
    assert exc.value.status_code == 409


async def test_update_program_success() -> None:
    prog = SimpleNamespace(id=1, name="OldName", parent_program_id=None, cohorts=[])

    mock_dup_result = MagicMock()
    mock_dup_result.scalar_one_or_none.return_value = None

    db = AsyncMock()
    db.get = AsyncMock(return_value=prog)
    db.execute = AsyncMock(return_value=mock_dup_result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = ProgramUpdate(name="NewName")
    result = await update_program(1, body, _admin(), db)

    assert prog.name == "NewName"


async def test_update_program_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    body = ProgramUpdate(name="NewName")
    with pytest.raises(HTTPException) as exc:
        await update_program(999, body, _admin(), db)
    assert exc.value.status_code == 404


async def test_update_program_duplicate_name() -> None:
    prog = SimpleNamespace(id=1, name="OldName", parent_program_id=None, cohorts=[])
    existing = SimpleNamespace(id=2, name="Taken")

    mock_dup_result = MagicMock()
    mock_dup_result.scalar_one_or_none.return_value = existing

    db = AsyncMock()
    db.get = AsyncMock(return_value=prog)
    db.execute = AsyncMock(return_value=mock_dup_result)

    body = ProgramUpdate(name="Taken")
    with pytest.raises(HTTPException) as exc:
        await update_program(1, body, _admin(), db)
    assert exc.value.status_code == 409


async def test_delete_program_success() -> None:
    prog = SimpleNamespace(id=1, name="ToDelete", parent_program_id=None)

    db = AsyncMock()
    db.get = AsyncMock(return_value=prog)
    db.delete = AsyncMock()
    db.commit = AsyncMock()

    await delete_program(1, _admin(), db)
    db.delete.assert_awaited_once_with(prog)


async def test_delete_program_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await delete_program(999, MagicMock(), db)
    assert exc.value.status_code == 404


# ── Instructor program scoping (tenant/cohort) ───────────────────────────────


def _dup_db(scalar=None):
    """An AsyncMock db whose execute returns a result with scalar_one_or_none."""
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = scalar
    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db


async def test_instructor_creates_cohort_under_own_tenant() -> None:
    db = _dup_db()
    tenant = SimpleNamespace(id=5, name="MedLab", parent_program_id=None)
    db.get = AsyncMock(return_value=tenant)

    body = ProgramCreate(name="Cohort A", parent_program_id=5)
    await create_program(body, _instructor(tenant_ids=[5]), db)

    db.add.assert_called_once()
    created = db.add.call_args.args[0]
    assert created.parent_program_id == 5
    assert created.oidc_group is None


async def test_instructor_cannot_create_cohort_under_foreign_tenant() -> None:
    db = _dup_db()
    tenant = SimpleNamespace(id=7, name="Culinary", parent_program_id=None)
    db.get = AsyncMock(return_value=tenant)

    body = ProgramCreate(name="Cohort X", parent_program_id=7)
    with pytest.raises(HTTPException) as exc:
        await create_program(body, _instructor(tenant_ids=[5]), db)
    assert exc.value.status_code == 403


async def test_instructor_cannot_create_top_level_program() -> None:
    db = _dup_db()
    body = ProgramCreate(name="New Tenant")
    with pytest.raises(HTTPException) as exc:
        await create_program(body, _instructor(tenant_ids=[5]), db)
    assert exc.value.status_code == 403


async def test_instructor_create_forces_oidc_group_null() -> None:
    db = _dup_db()
    tenant = SimpleNamespace(id=5, name="MedLab", parent_program_id=None)
    db.get = AsyncMock(return_value=tenant)

    body = ProgramCreate(name="Cohort A", parent_program_id=5, oidc_group="sneaky")
    await create_program(body, _instructor(tenant_ids=[5]), db)
    created = db.add.call_args.args[0]
    assert created.oidc_group is None


async def test_create_cohort_rejects_nesting() -> None:
    db = _dup_db()
    # Parent is itself a cohort (has a parent) -> nesting not allowed.
    parent_cohort = SimpleNamespace(id=100, name="Cohort A", parent_program_id=5)
    db.get = AsyncMock(return_value=parent_cohort)

    body = ProgramCreate(name="Nested", parent_program_id=100)
    with pytest.raises(HTTPException) as exc:
        await create_program(body, _admin(), db)
    assert exc.value.status_code == 422


async def test_admin_create_cohort_forces_oidc_null() -> None:
    db = _dup_db()
    tenant = SimpleNamespace(id=5, name="MedLab", parent_program_id=None)
    db.get = AsyncMock(return_value=tenant)

    body = ProgramCreate(name="Cohort A", parent_program_id=5, oidc_group="grp")
    await create_program(body, _admin(), db)
    created = db.add.call_args.args[0]
    assert created.oidc_group is None


async def test_instructor_renames_cohort_in_scope() -> None:
    cohort = _cohort(id=100, parent_program_id=5)
    db = _dup_db()
    db.get = AsyncMock(return_value=cohort)

    body = ProgramUpdate(name="Renamed")
    await update_program(100, body, _instructor(tenant_ids=[5]), db)
    assert cohort.name == "Renamed"


async def test_instructor_cannot_update_cohort_out_of_scope() -> None:
    cohort = _cohort(id=100, parent_program_id=7)
    db = AsyncMock()
    db.get = AsyncMock(return_value=cohort)

    body = ProgramUpdate(name="Renamed")
    with pytest.raises(HTTPException) as exc:
        await update_program(100, body, _instructor(tenant_ids=[5]), db)
    assert exc.value.status_code == 403


async def test_instructor_cannot_update_tenant() -> None:
    tenant = SimpleNamespace(id=5, name="MedLab", parent_program_id=None, cohorts=[])
    db = AsyncMock()
    db.get = AsyncMock(return_value=tenant)

    body = ProgramUpdate(name="Renamed")
    with pytest.raises(HTTPException) as exc:
        await update_program(5, body, _instructor(tenant_ids=[5]), db)
    assert exc.value.status_code == 403


async def test_instructor_cannot_set_oidc_group_on_update() -> None:
    cohort = _cohort(id=100, parent_program_id=5)
    db = AsyncMock()
    db.get = AsyncMock(return_value=cohort)

    body = ProgramUpdate(oidc_group="sneaky")
    with pytest.raises(HTTPException) as exc:
        await update_program(100, body, _instructor(tenant_ids=[5]), db)
    assert exc.value.status_code == 403


async def test_instructor_deletes_cohort_in_scope() -> None:
    cohort = _cohort(id=100, parent_program_id=5)
    db = AsyncMock()
    db.get = AsyncMock(return_value=cohort)
    db.delete = AsyncMock()
    db.commit = AsyncMock()

    await delete_program(100, _instructor(tenant_ids=[5]), db)
    db.delete.assert_awaited_once_with(cohort)


async def test_instructor_cannot_delete_cohort_out_of_scope() -> None:
    cohort = _cohort(id=100, parent_program_id=7)
    db = AsyncMock()
    db.get = AsyncMock(return_value=cohort)

    with pytest.raises(HTTPException) as exc:
        await delete_program(100, _instructor(tenant_ids=[5]), db)
    assert exc.value.status_code == 403


# ── Cohort membership endpoints ──────────────────────────────────────────────


def _membership_db(cohort, student, already_member=False):
    db = AsyncMock()
    db.get = AsyncMock(side_effect=[cohort, student])
    exists_result = MagicMock()
    exists_result.first.return_value = object() if already_member else None
    db.execute = AsyncMock(return_value=exists_result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    return db


async def test_instructor_adds_student_to_cohort() -> None:
    cohort = _cohort(id=100, parent_program_id=5)
    student = _student(tenant_ids=[5])
    db = _membership_db(cohort, student)

    out = await add_cohort_member(100, 10, _instructor(tenant_ids=[5]), db)
    # Two executes: the existence check and the insert.
    assert db.execute.await_count == 2
    db.commit.assert_awaited()
    assert out["id"] == 10


async def test_add_member_idempotent_when_already_present() -> None:
    cohort = _cohort(id=100, parent_program_id=5)
    student = _student(tenant_ids=[5])
    db = _membership_db(cohort, student, already_member=True)

    await add_cohort_member(100, 10, _instructor(tenant_ids=[5]), db)
    # Only the existence check ran; no insert.
    assert db.execute.await_count == 1


async def test_instructor_cannot_add_student_outside_tenant() -> None:
    cohort = _cohort(id=100, parent_program_id=5)
    student = _student(tenant_ids=[7])  # not in tenant 5
    db = _membership_db(cohort, student)

    with pytest.raises(HTTPException) as exc:
        await add_cohort_member(100, 10, _instructor(tenant_ids=[5]), db)
    assert exc.value.status_code == 403


async def test_instructor_cannot_add_non_student() -> None:
    cohort = _cohort(id=100, parent_program_id=5)
    target = _student(tenant_ids=[5], role="instructor", id=11)
    db = _membership_db(cohort, target)

    with pytest.raises(HTTPException) as exc:
        await add_cohort_member(100, 11, _instructor(tenant_ids=[5]), db)
    assert exc.value.status_code == 403


async def test_instructor_cannot_add_to_tenant_directly() -> None:
    # Target program is a tenant, not a cohort.
    tenant = _cohort(id=5, parent_program_id=None)
    student = _student(tenant_ids=[5])
    db = _membership_db(tenant, student)

    with pytest.raises(HTTPException) as exc:
        await add_cohort_member(5, 10, _instructor(tenant_ids=[5]), db)
    assert exc.value.status_code == 403


async def test_admin_adds_student_bypasses_tenant_check() -> None:
    cohort = _cohort(id=100, parent_program_id=5)
    student = _student(tenant_ids=[])  # not in any tenant
    db = _membership_db(cohort, student)

    out = await add_cohort_member(100, 10, _admin(), db)
    assert out["id"] == 10


async def test_remove_student_from_cohort() -> None:
    cohort = _cohort(id=100, parent_program_id=5)
    student = _student(tenant_ids=[5])
    db = AsyncMock()
    db.get = AsyncMock(side_effect=[cohort, student])
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    out = await remove_cohort_member(100, 10, _instructor(tenant_ids=[5]), db)
    db.execute.assert_awaited_once()
    db.commit.assert_awaited_once()
    assert out["id"] == 10


async def test_add_member_cohort_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)
    with pytest.raises(HTTPException) as exc:
        await add_cohort_member(100, 10, _admin(), db)
    assert exc.value.status_code == 404


async def test_add_member_student_not_found() -> None:
    cohort = _cohort(id=100, parent_program_id=5)
    db = AsyncMock()
    db.get = AsyncMock(side_effect=[cohort, None])
    with pytest.raises(HTTPException) as exc:
        await add_cohort_member(100, 999, _admin(), db)
    assert exc.value.status_code == 404
