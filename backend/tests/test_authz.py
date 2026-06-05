"""Tests for the program (tenant/cohort) authorization helpers."""

from types import SimpleNamespace

from app.authz import (
    can_change_cohort_membership,
    can_create_cohort_under,
    can_manage_cohort,
    is_cohort,
    is_tenant,
    tenant_ids,
)


def _prog(id: int, parent_program_id: int | None = None) -> SimpleNamespace:
    return SimpleNamespace(id=id, parent_program_id=parent_program_id)


def _user(role: str, program_objs: list[SimpleNamespace] | None = None) -> SimpleNamespace:
    return SimpleNamespace(role=role, programs=program_objs or [])


def test_is_tenant_and_is_cohort() -> None:
    tenant = _prog(1, None)
    cohort = _prog(2, 1)
    assert is_tenant(tenant) and not is_cohort(tenant)
    assert is_cohort(cohort) and not is_tenant(cohort)


def test_tenant_ids_only_counts_tenants() -> None:
    user = _user("instructor", [_prog(1, None), _prog(2, 1), _prog(3, None)])
    assert tenant_ids(user) == {1, 3}


def test_can_create_cohort_under_admin_any_tenant() -> None:
    admin = _user("admin")
    assert can_create_cohort_under(admin, _prog(5, None)) is True


def test_can_create_cohort_under_admin_rejects_nesting() -> None:
    admin = _user("admin")
    assert can_create_cohort_under(admin, _prog(5, 1)) is False


def test_can_create_cohort_under_instructor_in_scope() -> None:
    inst = _user("instructor", [_prog(5, None)])
    assert can_create_cohort_under(inst, _prog(5, None)) is True


def test_can_create_cohort_under_instructor_out_of_scope() -> None:
    inst = _user("instructor", [_prog(5, None)])
    assert can_create_cohort_under(inst, _prog(7, None)) is False


def test_can_create_cohort_under_student_denied() -> None:
    student = _user("student", [_prog(5, None)])
    assert can_create_cohort_under(student, _prog(5, None)) is False


def test_can_manage_cohort_admin() -> None:
    admin = _user("admin")
    assert can_manage_cohort(admin, _prog(100, 5)) is True
    assert can_manage_cohort(admin, _prog(5, None)) is True


def test_can_manage_cohort_instructor_in_scope() -> None:
    inst = _user("instructor", [_prog(5, None)])
    assert can_manage_cohort(inst, _prog(100, 5)) is True


def test_can_manage_cohort_instructor_out_of_scope() -> None:
    inst = _user("instructor", [_prog(5, None)])
    assert can_manage_cohort(inst, _prog(100, 7)) is False


def test_can_manage_cohort_instructor_rejects_tenant() -> None:
    inst = _user("instructor", [_prog(5, None)])
    # A tenant is not a cohort -> instructors can never manage it.
    assert can_manage_cohort(inst, _prog(5, None)) is False


def test_two_instructors_same_tenant_comanage() -> None:
    cohort = _prog(100, 5)
    inst_a = _user("instructor", [_prog(5, None)])
    inst_b = _user("instructor", [_prog(5, None)])
    assert can_manage_cohort(inst_a, cohort)
    assert can_manage_cohort(inst_b, cohort)


def test_can_change_membership_instructor_student_in_tenant() -> None:
    inst = _user("instructor", [_prog(5, None)])
    student = _user("student", [_prog(5, None)])
    assert can_change_cohort_membership(inst, _prog(100, 5), student) is True


def test_can_change_membership_rejects_non_student() -> None:
    inst = _user("instructor", [_prog(5, None)])
    target = _user("instructor", [_prog(5, None)])
    assert can_change_cohort_membership(inst, _prog(100, 5), target) is False


def test_can_change_membership_rejects_student_outside_tenant() -> None:
    inst = _user("instructor", [_prog(5, None)])
    student = _user("student", [_prog(7, None)])
    assert can_change_cohort_membership(inst, _prog(100, 5), student) is False


def test_can_change_membership_rejects_cohort_out_of_scope() -> None:
    inst = _user("instructor", [_prog(5, None)])
    student = _user("student", [_prog(7, None)])
    assert can_change_cohort_membership(inst, _prog(100, 7), student) is False


def test_can_change_membership_rejects_tenant_target_program() -> None:
    inst = _user("instructor", [_prog(5, None)])
    student = _user("student", [_prog(5, None)])
    # Program 5 is a tenant, not a cohort.
    assert can_change_cohort_membership(inst, _prog(5, None), student) is False


def test_can_change_membership_admin_bypasses_tenant() -> None:
    admin = _user("admin")
    student = _user("student", [])  # not in any tenant
    assert can_change_cohort_membership(admin, _prog(100, 5), student) is True


def test_can_change_membership_admin_still_requires_student() -> None:
    admin = _user("admin")
    target = _user("instructor", [])
    assert can_change_cohort_membership(admin, _prog(100, 5), target) is False
