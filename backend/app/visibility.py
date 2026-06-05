"""Visibility helpers for student access filtering.

Categories can be restricted along two independent dimensions:

* **Programs** — admin/OIDC-managed.
* **Groups** — instructor-managed.

A student sees a category (and its images) only if it satisfies *both*
gates: for each dimension the category either has no restriction or shares
at least one entry with the student. The two gates are combined with AND.

Restrictions cascade: if a parent category is hidden, program-restricted, or
group-restricted away from the student, its entire subtree is also hidden.
"""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Category


def _passes_gates(
    category: Category,
    user_program_ids: set[int],
    user_group_ids: set[int],
) -> bool:
    """Return True if *category*'s own program AND group gates admit the user.

    Does not consider ``status`` or ancestry — callers handle those.
    """
    cat_prog_ids = {p.id for p in category.programs}
    if cat_prog_ids and not cat_prog_ids & user_program_ids:
        return False
    cat_group_ids = {g.id for g in category.groups}
    if cat_group_ids and not cat_group_ids & user_group_ids:
        return False
    return True


def compute_excluded_category_ids(
    categories: Sequence[Category],
    user_program_ids: set[int],
    user_group_ids: set[int],
) -> set[int]:
    """Pure in-memory computation of excluded category IDs.

    A category is excluded when any of the following is true:
    * Its ``status`` is ``"hidden"``.
    * It has program restrictions that do not overlap with
      *user_program_ids*.
    * It has group restrictions that do not overlap with *user_group_ids*.
    * Any ancestor is excluded (cascading rule).

    Categories with an empty programs/groups list are unrestricted on that
    dimension and visible to everyone.
    """
    cat_by_id: dict[int, Category] = {c.id: c for c in categories}
    children_by_parent: dict[int | None, list[int]] = {}
    for cat in categories:
        children_by_parent.setdefault(cat.parent_id, []).append(cat.id)

    excluded: set[int] = set()

    def _walk(parent_id: int | None) -> None:
        for cat_id in children_by_parent.get(parent_id, []):
            if parent_id is not None and parent_id in excluded:
                excluded.add(cat_id)
            elif cat_by_id[cat_id].status == "hidden":
                excluded.add(cat_id)
            elif not _passes_gates(
                cat_by_id[cat_id], user_program_ids, user_group_ids
            ):
                excluded.add(cat_id)
            _walk(cat_id)

    _walk(None)
    return excluded


async def get_student_excluded_category_ids(
    db: AsyncSession,
    user_program_ids: set[int],
    user_group_ids: set[int],
) -> set[int]:
    """Return the set of category IDs a student must not access.

    Loads all categories from the database and delegates to
    :func:`compute_excluded_category_ids`.
    """
    stmt = select(Category).order_by(Category.id)
    result = await db.execute(stmt)
    all_cats = result.scalars().unique().all()
    return compute_excluded_category_ids(
        all_cats, user_program_ids, user_group_ids
    )


async def is_category_visible_to_student(
    db: AsyncSession,
    category_id: int | None,
    user_program_ids: set[int],
    user_group_ids: set[int],
) -> bool:
    """Check whether *category_id* and all its ancestors are visible.

    Returns ``True`` for uncategorised items (``category_id is None``).
    Walks the ancestor chain; if any ancestor is hidden, program-restricted,
    or group-restricted away from the student the category is invisible.
    """
    if category_id is None:
        return True

    current_id: int | None = category_id
    while current_id is not None:
        cat = await db.get(Category, current_id)
        if cat is None:
            return True
        if cat.status == "hidden":
            return False
        if not _passes_gates(cat, user_program_ids, user_group_ids):
            return False
        current_id = cat.parent_id
    return True
