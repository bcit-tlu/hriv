"""Tests for the pure authorization predicate helpers in ``app.authz``."""

from types import SimpleNamespace

from app.authz import (
    can_attach_group_to_category,
    can_attach_program_to_category,
    can_edit_category,
    can_manage_group,
)


def _user(role: str, id: int = 1, programs: list | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        id=id,
        role=role,
        programs=[SimpleNamespace(id=p) for p in (programs or [])],
    )


# ── can_edit_category ─────────────────────────────────────


def test_can_edit_category_admin_and_instructor() -> None:
    assert can_edit_category(_user("admin")) is True
    assert can_edit_category(_user("instructor")) is True


def test_can_edit_category_student_denied() -> None:
    assert can_edit_category(_user("student")) is False


# ── can_manage_group ──────────────────────────────────────


def test_can_manage_group_admin_always() -> None:
    assert can_manage_group(_user("admin"), []) is True
    assert can_manage_group(_user("admin"), [99]) is True


def test_can_manage_group_instructor_owner() -> None:
    assert can_manage_group(_user("instructor", id=7), [7, 8]) is True


def test_can_manage_group_instructor_non_owner() -> None:
    assert can_manage_group(_user("instructor", id=7), [8, 9]) is False


def test_can_manage_group_student_denied() -> None:
    assert can_manage_group(_user("student", id=7), [7]) is False


# ── can_attach_program_to_category ────────────────────────


def test_can_attach_program_admin_any() -> None:
    assert can_attach_program_to_category(_user("admin"), 123) is True


def test_can_attach_program_instructor_own_only() -> None:
    instructor = _user("instructor", programs=[1, 2])
    assert can_attach_program_to_category(instructor, 1) is True
    assert can_attach_program_to_category(instructor, 3) is False


def test_can_attach_program_student_denied() -> None:
    assert can_attach_program_to_category(_user("student", programs=[1]), 1) is False


# ── can_attach_group_to_category ──────────────────────────


def test_can_attach_group_admin_any() -> None:
    assert can_attach_group_to_category(_user("admin"), [99]) is True


def test_can_attach_group_instructor_owner_only() -> None:
    instructor = _user("instructor", id=5)
    assert can_attach_group_to_category(instructor, [5]) is True
    assert can_attach_group_to_category(instructor, [6]) is False


def test_can_attach_group_student_denied() -> None:
    assert can_attach_group_to_category(_user("student", id=5), [5]) is False
