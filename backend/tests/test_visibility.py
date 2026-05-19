"""Tests for program-scoped visibility helpers."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.visibility import get_student_excluded_category_ids, is_category_visible_to_student


def _prog(id: int) -> SimpleNamespace:
    return SimpleNamespace(id=id)


def _cat(
    id: int,
    parent_id: int | None = None,
    status: str = "active",
    programs: list | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=id,
        parent_id=parent_id,
        status=status,
        programs=programs or [],
    )


def _mock_db_for_excluded(categories: list) -> AsyncMock:
    db = AsyncMock()
    result = MagicMock()
    result.scalars.return_value.unique.return_value.all.return_value = categories
    db.execute = AsyncMock(return_value=result)
    return db


# ── get_student_excluded_category_ids ────────────────────────


async def test_excluded_empty_database() -> None:
    db = _mock_db_for_excluded([])
    excluded = await get_student_excluded_category_ids(db, {1})
    assert excluded == set()


async def test_excluded_no_restrictions() -> None:
    cats = [_cat(1), _cat(2)]
    db = _mock_db_for_excluded(cats)
    excluded = await get_student_excluded_category_ids(db, {1})
    assert excluded == set()


async def test_excluded_hidden_category() -> None:
    cats = [_cat(1, status="hidden"), _cat(2)]
    db = _mock_db_for_excluded(cats)
    excluded = await get_student_excluded_category_ids(db, {1})
    assert excluded == {1}


async def test_excluded_program_restricted_no_overlap() -> None:
    cats = [_cat(1, programs=[_prog(10)]), _cat(2)]
    db = _mock_db_for_excluded(cats)
    excluded = await get_student_excluded_category_ids(db, {20})
    assert excluded == {1}


async def test_excluded_program_restricted_with_overlap() -> None:
    cats = [_cat(1, programs=[_prog(10)]), _cat(2)]
    db = _mock_db_for_excluded(cats)
    excluded = await get_student_excluded_category_ids(db, {10})
    assert excluded == set()


async def test_excluded_cascade_from_hidden_parent() -> None:
    cats = [
        _cat(1, status="hidden"),
        _cat(2, parent_id=1),
        _cat(3, parent_id=2),
    ]
    db = _mock_db_for_excluded(cats)
    excluded = await get_student_excluded_category_ids(db, {1})
    assert excluded == {1, 2, 3}


async def test_excluded_cascade_from_program_restricted_parent() -> None:
    cats = [
        _cat(1, programs=[_prog(10)]),
        _cat(2, parent_id=1),
        _cat(3, parent_id=2),
    ]
    db = _mock_db_for_excluded(cats)
    excluded = await get_student_excluded_category_ids(db, {20})
    assert excluded == {1, 2, 3}


async def test_excluded_child_visible_when_parent_unrestricted() -> None:
    cats = [
        _cat(1),
        _cat(2, parent_id=1, programs=[_prog(10)]),
    ]
    db = _mock_db_for_excluded(cats)
    excluded = await get_student_excluded_category_ids(db, {10})
    assert excluded == set()


async def test_excluded_mixed_tree() -> None:
    """Parent restricted to prog 10, child unrestricted, grandchild restricted to prog 20."""
    cats = [
        _cat(1, programs=[_prog(10)]),
        _cat(2, parent_id=1),
        _cat(3, parent_id=2, programs=[_prog(20)]),
        _cat(4),
    ]
    db = _mock_db_for_excluded(cats)
    # User has prog 10: cat 1 visible, cat 2 cascades (parent visible), cat 3 restricted to 20 only
    excluded = await get_student_excluded_category_ids(db, {10})
    assert excluded == {3}


async def test_excluded_user_no_programs() -> None:
    cats = [_cat(1, programs=[_prog(10)])]
    db = _mock_db_for_excluded(cats)
    excluded = await get_student_excluded_category_ids(db, set())
    assert excluded == {1}


# ── is_category_visible_to_student ───────────────────────────


async def test_visible_none_category() -> None:
    db = AsyncMock()
    result = await is_category_visible_to_student(db, None, {1})
    assert result is True


async def test_visible_active_no_restrictions() -> None:
    cat = _cat(5, parent_id=None)
    db = AsyncMock()
    db.get = AsyncMock(return_value=cat)
    result = await is_category_visible_to_student(db, 5, {1})
    assert result is True


async def test_visible_hidden_category() -> None:
    cat = _cat(5, parent_id=None, status="hidden")
    db = AsyncMock()
    db.get = AsyncMock(return_value=cat)
    result = await is_category_visible_to_student(db, 5, {1})
    assert result is False


async def test_visible_program_restricted_no_overlap() -> None:
    cat = _cat(5, parent_id=None, programs=[_prog(10)])
    db = AsyncMock()
    db.get = AsyncMock(return_value=cat)
    result = await is_category_visible_to_student(db, 5, {20})
    assert result is False


async def test_visible_program_restricted_with_overlap() -> None:
    cat = _cat(5, parent_id=None, programs=[_prog(10)])
    db = AsyncMock()
    db.get = AsyncMock(return_value=cat)
    result = await is_category_visible_to_student(db, 5, {10})
    assert result is True


async def test_visible_hidden_ancestor() -> None:
    child = _cat(5, parent_id=3)
    parent = _cat(3, parent_id=None, status="hidden")

    async def mock_get(model, id_val):
        return {5: child, 3: parent}.get(id_val)

    db = AsyncMock()
    db.get = AsyncMock(side_effect=mock_get)
    result = await is_category_visible_to_student(db, 5, {1})
    assert result is False


async def test_visible_program_restricted_ancestor() -> None:
    child = _cat(5, parent_id=3)
    parent = _cat(3, parent_id=None, programs=[_prog(10)])

    async def mock_get(model, id_val):
        return {5: child, 3: parent}.get(id_val)

    db = AsyncMock()
    db.get = AsyncMock(side_effect=mock_get)
    result = await is_category_visible_to_student(db, 5, {20})
    assert result is False


async def test_visible_category_not_in_db() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)
    result = await is_category_visible_to_student(db, 999, {1})
    assert result is True
