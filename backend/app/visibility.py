"""Program-scoped visibility helpers for student access filtering.

Categories can be restricted to specific programs.  Students only see
categories (and their images) that either have no program restriction or
share at least one program with the student.  Restrictions cascade: if a
parent category is hidden or program-restricted, its entire subtree is
also hidden from the student.
"""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Category


def compute_excluded_category_ids(
    categories: Sequence[Category],
    user_program_ids: set[int],
) -> set[int]:
    """Pure in-memory computation of excluded category IDs.

    A category is excluded when any of the following is true:
    * Its ``status`` is ``"hidden"``.
    * It has program restrictions that do not overlap with
      *user_program_ids*.
    * Any ancestor is excluded (cascading rule).

    Categories with an empty programs list are visible to everyone.
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
            else:
                cat_prog_ids = {p.id for p in cat_by_id[cat_id].programs}
                if cat_prog_ids and not cat_prog_ids & user_program_ids:
                    excluded.add(cat_id)
            _walk(cat_id)

    _walk(None)
    return excluded


async def get_student_excluded_category_ids(
    db: AsyncSession,
    user_program_ids: set[int],
) -> set[int]:
    """Return the set of category IDs a student must not access.

    Loads all categories from the database and delegates to
    :func:`compute_excluded_category_ids`.
    """
    stmt = select(Category).order_by(Category.id)
    result = await db.execute(stmt)
    all_cats = result.scalars().unique().all()
    return compute_excluded_category_ids(all_cats, user_program_ids)


async def is_category_visible_to_student(
    db: AsyncSession,
    category_id: int | None,
    user_program_ids: set[int],
) -> bool:
    """Check whether *category_id* and all its ancestors are visible.

    Returns ``True`` for uncategorised items (``category_id is None``).
    Walks the ancestor chain; if any ancestor is hidden or
    program-restricted the category is considered invisible.
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
        cat_prog_ids = {p.id for p in cat.programs}
        if cat_prog_ids and not cat_prog_ids & user_program_ids:
            return False
        current_id = cat.parent_id
    return True
