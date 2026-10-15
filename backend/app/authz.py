"""Authorization helpers for categories, programs, and groups.

These are small, pure predicate functions kept separate from the visibility
cascade (see ``visibility``) and from FastAPI's role dependencies (see
``auth.require_role``). They encode the project's authority model:

* **All instructors are category editors globally.** Any admin or instructor
  may edit any category. Group ownership only controls which groups they can
  attach/manage; program membership only controls which programs they can
  attach. Category edit rights are independent of category visibility.
* **Group management** is limited to admins and the instructors who own the
  group (members of ``group_instructors``).
* **Attaching a restriction** to a category requires both edit authority on
  the category and authority over the thing being attached.
"""

from __future__ import annotations

from collections.abc import Iterable


ADMIN_PROGRAM_NAME = "Admin"


def user_has_admin_program(user) -> bool:
    """Return True when the user is associated with the special Admin program."""
    return any(
        p.name == ADMIN_PROGRAM_NAME
        for p in user.programs
    )


def can_edit_category(user) -> bool:
    """Any admin or instructor may edit any category (global edit authority)."""
    return user.role in ("admin", "instructor")


def can_manage_group(user, instructor_ids: Iterable[int]) -> bool:
    """Admins manage any group; instructors manage groups they own."""
    if user.role == "admin":
        return True
    return user.role == "instructor" and user.id in set(instructor_ids)


def can_attach_program_to_category(user, program_id: int) -> bool:
    """Admins may attach any program; instructors only their own programs."""
    if not can_edit_category(user):
        return False
    if user.role == "admin":
        return True
    return program_id in {p.id for p in user.programs}


def can_attach_group_to_category(user, group_instructor_ids: Iterable[int]) -> bool:
    """Admins may attach any group; instructors only groups they manage."""
    if not can_edit_category(user):
        return False
    return can_manage_group(user, group_instructor_ids)


# ── Collections ───────────────────────────────────────────
#
# Collections are co-owned by users (``collection_owners`` rows) and/or a
# program (``owner_program_id``); ``collections.user_id`` is creator-only
# audit, not ownership (#1531). A collection with no owner rows AND no
# program owner is orphaned — admin-managed until reassigned.
#
# Capability matrix (issue #1531):
#
#   view    — admin/instructor/staff: all; student: own ∪ co-owned ∪
#             public ∪ restricted-dual-gate.
#   edit    — admin: all; instructor: own ∪ program-owned ∪ co-owned;
#             student and staff: own ∪ co-owned.
#   scope   — as edit, but students and staff only when they are the sole
#             owner (no co-owners, no program owner).
#   delete  — as scope.
#   transfer / PUT /owners — admin: all; instructor: own ∪ program-owned ∪
#             co-owned; staff and students: never.


def is_collection_owner(user, collection) -> bool:
    """True when *user* holds an owner row (sole or shared) on *collection*."""
    return any(owner.id == user.id for owner in collection.owners)


def _is_sole_collection_owner(user, collection) -> bool:
    """True when *user* is the collection's only user-owner and no program
    owns it — the student's authority level for scope/delete (#1531)."""
    if collection.owner_program_id is not None:
        return False
    owners = collection.owners
    return len(owners) == 1 and owners[0].id == user.id


def _manages_owner_program(user, collection) -> bool:
    """Instructors manage collections owned by a program they belong to."""
    if user.role != "instructor" or collection.owner_program_id is None:
        return False
    return collection.owner_program_id in {p.id for p in user.programs}


def can_view_collection(
    user,
    collection,
    user_program_ids: set[int],
    user_group_ids: set[int],
) -> bool:
    """Return True when *user* may read *collection*.

    Non-students see everything. Students pass when they own or co-own the
    collection, when it is ``public``, or when it is ``restricted`` and both
    the program gate and the group gate admit them (an empty scope on a
    dimension is unrestricted on that dimension). ``private`` collections
    are owner-only.
    """
    if user.role in ("admin", "instructor", "staff"):
        return True
    if is_collection_owner(user, collection):
        return True
    if collection.visibility == "public":
        return True
    if collection.visibility != "restricted":
        return False
    program_ids = {p.id for p in collection.programs}
    if program_ids and not program_ids & user_program_ids:
        return False
    group_ids = {g.id for g in collection.groups}
    if group_ids and not group_ids & user_group_ids:
        return False
    return True


def can_edit_collection(user, collection) -> bool:
    """Content edit (name/description/images/viewport): admins always;
    instructors when they own, co-own, or belong to the owning program;
    students and staff when they own or co-own.
    """
    if user.role == "admin":
        return True
    if user.role == "instructor":
        return is_collection_owner(
            user, collection
        ) or _manages_owner_program(user, collection)
    return user.role in ("student", "staff") and is_collection_owner(
        user, collection
    )


def can_change_collection_scope(user, collection) -> bool:
    """Visibility/program/group scope changes: same as edit for admins and
    instructors; students and staff only when they are the sole owner
    (co-owners may not widen visibility on shared collections).
    """
    if user.role == "admin":
        return True
    if user.role == "instructor":
        return is_collection_owner(
            user, collection
        ) or _manages_owner_program(user, collection)
    return user.role in ("student", "staff") and _is_sole_collection_owner(
        user, collection
    )


def can_delete_collection(user, collection) -> bool:
    """Deletion authority: admins always; instructors when they own, co-own,
    or belong to the owning program; students and staff only when sole
    owner.
    """
    return can_change_collection_scope(user, collection)


def can_transfer_collection(user, collection) -> bool:
    """Admins transfer any collection; instructors transfer collections they
    own, co-own, or that belong to one of their programs. Students and staff
    can never transfer ownership or modify the owner set (``PUT /owners``).
    """
    if user.role == "admin":
        return True
    if user.role != "instructor":
        return False
    return is_collection_owner(user, collection) or _manages_owner_program(
        user, collection
    )


def can_hide_collection(user, collection) -> bool:
    """Hide/unhide (#1559): curatorial — admins and instructors may hide
    any collection, mirroring the global edit authority they hold over
    images and categories. Owners cannot unhide their own collection: an
    instructor's hide is a deliberate content decision.
    """
    return user.role in ("admin", "instructor")


def can_attach_program_to_collection(user, program_id: int) -> bool:
    """Admins may scope a collection to any program; instructors only to
    programs they belong to. Other roles cannot use restricted visibility.
    """
    if user.role == "admin":
        return True
    return user.role == "instructor" and program_id in {p.id for p in user.programs}


def can_attach_group_to_collection(user, group_instructor_ids: Iterable[int]) -> bool:
    """Admins may scope a collection to any group; instructors only to groups
    they manage.
    """
    if user.role not in ("admin", "instructor"):
        return False
    return can_manage_group(user, group_instructor_ids)
