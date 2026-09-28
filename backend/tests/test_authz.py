"""Tests for the pure authorization predicate helpers in ``app.authz``."""

from types import SimpleNamespace

from app.authz import (
    can_attach_group_to_category,
    can_attach_group_to_collection,
    can_attach_program_to_category,
    can_attach_program_to_collection,
    can_delete_collection,
    can_edit_category,
    can_edit_collection,
    can_manage_group,
    can_transfer_collection,
    can_view_collection,
    user_has_admin_program,
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


# ── user_has_admin_program ────────────────────────────────


def test_user_has_admin_program_true_when_admin_program() -> None:
    user = SimpleNamespace(programs=[SimpleNamespace(name="Admin")])
    assert user_has_admin_program(user) is True


def test_user_has_admin_program_false_for_other_programs() -> None:
    user = SimpleNamespace(programs=[SimpleNamespace(name="Nursing")])
    assert user_has_admin_program(user) is False


def test_user_has_admin_program_false_when_no_programs() -> None:
    user = SimpleNamespace(programs=[])
    assert user_has_admin_program(user) is False


# ── collections ───────────────────────────────────────────

def _collection(
    visibility: str = "private",
    user_id: int | None = 10,
    owner_program_id: int | None = None,
    programs: list | None = None,
    groups: list | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        visibility=visibility,
        user_id=user_id,
        owner_program_id=owner_program_id,
        programs=[SimpleNamespace(id=p) for p in (programs or [])],
        groups=[SimpleNamespace(id=g) for g in (groups or [])],
    )


def test_can_view_collection_non_students_see_all() -> None:
    private = _collection("private", user_id=10)
    for role in ("admin", "instructor", "staff"):
        assert can_view_collection(_user(role, id=1), private, set(), set()) is True


def test_can_view_collection_student_owner_and_public() -> None:
    owner = _user("student", id=10)
    assert can_view_collection(owner, _collection("private", user_id=10), set(), set()) is True
    other = _user("student", id=2)
    assert can_view_collection(other, _collection("private", user_id=10), set(), set()) is False
    assert can_view_collection(other, _collection("public", user_id=10), set(), set()) is True


def test_can_view_collection_student_restricted_dual_gate() -> None:
    student = _user("student", id=2)
    both = _collection("restricted", programs=[1], groups=[5])
    assert can_view_collection(student, both, {1}, {5}) is True
    assert can_view_collection(student, both, {1}, {6}) is False  # group gate fails
    assert can_view_collection(student, both, {9}, {5}) is False  # program gate fails
    assert can_view_collection(student, both, set(), set()) is False
    # Empty scope on a dimension is unrestricted on that dimension.
    assert can_view_collection(student, _collection("restricted", programs=[1]), {1}, set()) is True
    assert can_view_collection(student, _collection("restricted", groups=[5]), set(), {5}) is True
    assert can_view_collection(student, _collection("restricted"), set(), set()) is True


def test_can_edit_and_delete_collection() -> None:
    owned = _collection(user_id=10)
    program_owned = _collection(user_id=None, owner_program_id=3)
    orphaned = _collection(user_id=None, owner_program_id=None)

    assert can_edit_collection(_user("admin", id=1), orphaned) is True
    assert can_delete_collection(_user("admin", id=1), owned) is True

    assert can_edit_collection(_user("student", id=10), owned) is True
    assert can_edit_collection(_user("student", id=11), owned) is False
    assert can_edit_collection(_user("staff", id=10), owned) is True
    assert can_edit_collection(_user("staff", id=11), owned) is False

    assert can_edit_collection(_user("instructor", id=7, programs=[3]), program_owned) is True
    assert can_edit_collection(_user("instructor", id=7, programs=[4]), program_owned) is False
    assert can_edit_collection(_user("student", id=7, programs=[3]), program_owned) is False
    assert can_edit_collection(_user("instructor", id=7, programs=[3]), orphaned) is False
    assert can_delete_collection(_user("instructor", id=7, programs=[3]), program_owned) is True


def test_can_transfer_collection() -> None:
    owned = _collection(user_id=10)
    program_owned = _collection(user_id=None, owner_program_id=3)
    orphaned = _collection(user_id=None, owner_program_id=None)

    assert can_transfer_collection(_user("admin", id=1), orphaned) is True
    assert can_transfer_collection(_user("instructor", id=10), owned) is True
    assert can_transfer_collection(_user("instructor", id=11), owned) is False
    assert can_transfer_collection(_user("instructor", id=11, programs=[3]), program_owned) is True
    assert can_transfer_collection(_user("instructor", id=11, programs=[3]), orphaned) is False
    # Students and staff own collections but cannot transfer them.
    assert can_transfer_collection(_user("student", id=10), owned) is False
    assert can_transfer_collection(_user("staff", id=10), owned) is False


def test_can_attach_program_to_collection() -> None:
    assert can_attach_program_to_collection(_user("admin"), 99) is True
    assert can_attach_program_to_collection(_user("instructor", programs=[1, 2]), 2) is True
    assert can_attach_program_to_collection(_user("instructor", programs=[1, 2]), 3) is False
    assert can_attach_program_to_collection(_user("staff", programs=[1]), 1) is False
    assert can_attach_program_to_collection(_user("student", programs=[1]), 1) is False


def test_can_attach_group_to_collection() -> None:
    assert can_attach_group_to_collection(_user("admin"), []) is True
    assert can_attach_group_to_collection(_user("instructor", id=7), [7]) is True
    assert can_attach_group_to_collection(_user("instructor", id=7), [8]) is False
    assert can_attach_group_to_collection(_user("staff", id=7), [7]) is False
    assert can_attach_group_to_collection(_user("student", id=7), [7]) is False
