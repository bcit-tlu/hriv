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
