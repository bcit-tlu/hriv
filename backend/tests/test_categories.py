"""Tests for the optimised two-query category tree builder and CRUD endpoints."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.routers.categories import (
    _load_tree,
    list_categories,
    get_category,
    create_category,
    update_category,
    reorder_categories,
    delete_category,
)
from app.schemas import CategoryCreate, CategoryUpdate, CategoryReorderRequest, CategoryReorderItem


def _make_program(id: int = 1, name: str = "Test Program") -> SimpleNamespace:
    return SimpleNamespace(id=id, name=name)


def _make_category(
    id: int,
    label: str,
    parent_id: int | None = None,
    status: str = "active",
    sort_order: int = 0,
    programs: list | None = None,
) -> SimpleNamespace:
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=id,
        label=label,
        parent_id=parent_id,
        programs=programs or [],
        status=status,
        sort_order=sort_order,
        metadata_=None,
        created_at=now,
        updated_at=now,
    )


def _make_image(
    id: int,
    name: str,
    category_id: int | None,
    active: bool = True,
    sort_order: int = 0,
) -> SimpleNamespace:
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=id,
        name=name,
        thumb="/thumb.jpg",
        tile_sources="/tiles/img",
        category_id=category_id,
        copyright=None,
        note=None,
        active=active,
        sort_order=sort_order,
        metadata_=None,
        version=1,
        width=None,
        height=None,
        file_size=None,
        created_at=now,
        updated_at=now,
        programs=[],
    )


def _mock_db(categories: list, images: list) -> AsyncMock:
    """Return a mock AsyncSession whose execute() returns the supplied rows."""
    db = AsyncMock()

    cat_result = MagicMock()
    cat_scalars = MagicMock()
    cat_scalars.unique.return_value.all.return_value = categories

    img_result = MagicMock()
    img_scalars = MagicMock()
    img_scalars.unique.return_value.all.return_value = images

    call_count = 0

    async def execute_side_effect(stmt):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            result = MagicMock()
            result.scalars.return_value = cat_scalars
            return result
        else:
            result = MagicMock()
            result.scalars.return_value = img_scalars
            return result

    db.execute = AsyncMock(side_effect=execute_side_effect)
    return db


async def test_load_tree_empty_database() -> None:
    db = _mock_db([], [])
    tree = await _load_tree(db, None, user_role="admin")

    assert tree == []
    assert db.execute.await_count == 2  # categories + images


async def test_load_tree_flat_categories_with_images() -> None:
    cats = [
        _make_category(1, "Alpha"),
        _make_category(2, "Beta"),
    ]
    imgs = [
        _make_image(10, "img-a", category_id=1),
        _make_image(11, "img-b", category_id=2),
    ]
    db = _mock_db(cats, imgs)

    tree = await _load_tree(db, None, user_role="admin")

    assert len(tree) == 2
    assert tree[0].label == "Alpha"
    assert len(tree[0].images) == 1
    assert tree[0].images[0].name == "img-a"
    assert tree[1].label == "Beta"
    assert len(tree[1].images) == 1


async def test_load_tree_nested_categories() -> None:
    cats = [
        _make_category(1, "Root", sort_order=0),
        _make_category(2, "Child", parent_id=1, sort_order=0),
        _make_category(3, "Grandchild", parent_id=2, sort_order=0),
    ]
    db = _mock_db(cats, [])

    tree = await _load_tree(db, None, user_role="admin")

    assert len(tree) == 1
    assert tree[0].label == "Root"
    assert len(tree[0].children) == 1
    assert tree[0].children[0].label == "Child"
    assert len(tree[0].children[0].children) == 1
    assert tree[0].children[0].children[0].label == "Grandchild"


async def test_load_tree_student_hides_hidden_categories() -> None:
    cats = [
        _make_category(1, "Visible"),
        _make_category(2, "Hidden", status="hidden"),
    ]
    db = _mock_db(cats, [])

    tree = await _load_tree(db, None, user_role="student")

    assert len(tree) == 1
    assert tree[0].label == "Visible"


async def test_load_tree_student_hides_inactive_images() -> None:
    cats = [_make_category(1, "Cat")]
    imgs = [
        _make_image(10, "active-img", category_id=1, active=True),
        _make_image(11, "inactive-img", category_id=1, active=False),
    ]
    db = _mock_db(cats, imgs)

    tree = await _load_tree(db, None, user_role="student")

    assert len(tree) == 1
    assert len(tree[0].images) == 1
    assert tree[0].images[0].name == "active-img"


async def test_load_tree_admin_sees_all_images() -> None:
    cats = [_make_category(1, "Cat")]
    imgs = [
        _make_image(10, "active-img", category_id=1, active=True),
        _make_image(11, "inactive-img", category_id=1, active=False),
    ]
    db = _mock_db(cats, imgs)

    tree = await _load_tree(db, None, user_role="admin")

    assert len(tree[0].images) == 2


async def test_load_tree_uses_exactly_two_queries() -> None:
    """The optimised approach must issue exactly 2 DB queries regardless
    of tree depth."""
    cats = [
        _make_category(1, "L0"),
        _make_category(2, "L1", parent_id=1),
        _make_category(3, "L2", parent_id=2),
        _make_category(4, "L3", parent_id=3),
    ]
    db = _mock_db(cats, [])

    await _load_tree(db, None, user_role="admin")

    assert db.execute.await_count == 2


# ── CRUD endpoint tests ──────────────────────────────────────


async def test_list_categories_root() -> None:
    cats = [_make_category(1, "A"), _make_category(2, "B")]
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = cats

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    result = await list_categories(MagicMock(), parent_id=None, db=db)
    assert len(result) == 2


async def test_list_categories_with_parent_filter() -> None:
    child = _make_category(3, "Child", parent_id=1)
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [child]

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    result = await list_categories(MagicMock(), parent_id=1, db=db)
    assert len(result) == 1
    assert result[0].label == "Child"


async def test_get_category_found() -> None:
    cat = _make_category(1, "Test Cat")
    db = AsyncMock()
    db.get = AsyncMock(return_value=cat)

    result = await get_category(1, MagicMock(), db=db)
    assert result.label == "Test Cat"


async def test_get_category_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await get_category(999, MagicMock(), db=db)
    assert exc.value.status_code == 404


async def test_create_category_success() -> None:
    body = CategoryCreate(label="New Cat", parent_id=None)

    dup_result = MagicMock()
    dup_result.scalar_one_or_none.return_value = None

    db = AsyncMock()
    db.execute = AsyncMock(return_value=dup_result)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    result = await create_category(body, MagicMock(), db=db)
    db.add.assert_called_once()
    db.commit.assert_awaited_once()


async def test_create_category_duplicate_sibling_rejected() -> None:
    body = CategoryCreate(label="Histology", parent_id=None)

    dup_result = MagicMock()
    dup_result.scalar_one_or_none.return_value = _make_category(1, "Histology")

    db = AsyncMock()
    db.execute = AsyncMock(return_value=dup_result)

    with pytest.raises(HTTPException) as exc:
        await create_category(body, MagicMock(), db=db)
    assert exc.value.status_code == 409
    assert "already exists" in exc.value.detail.lower()


async def test_create_category_same_label_different_parent_allowed() -> None:
    """Same label under a different parent is fine."""
    body = CategoryCreate(label="Histology", parent_id=2)

    dup_result = MagicMock()
    dup_result.scalar_one_or_none.return_value = None

    db = AsyncMock()
    db.execute = AsyncMock(return_value=dup_result)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    await create_category(body, MagicMock(), db=db)
    db.add.assert_called_once()


async def test_create_category_invalid_program_ids() -> None:
    body = CategoryCreate(label="New Cat", parent_id=None, program_ids=[1, 999])

    dup_result = MagicMock()
    dup_result.scalar_one_or_none.return_value = None

    prog = SimpleNamespace(id=1, name="Biology")
    prog_result = MagicMock()
    prog_result.scalars.return_value.all.return_value = [prog]

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[dup_result, prog_result])
    db.add = MagicMock()

    with pytest.raises(HTTPException) as exc:
        await create_category(body, MagicMock(), db=db)
    assert exc.value.status_code == 422
    assert "999" in str(exc.value.detail)


async def test_update_category_not_found() -> None:
    body = CategoryUpdate(label="Updated")
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await update_category(999, body, MagicMock(), db=db)
    assert exc.value.status_code == 404


async def test_update_category_self_parent() -> None:
    cat = _make_category(1, "Cat")
    body = CategoryUpdate(parent_id=1)
    db = AsyncMock()
    db.get = AsyncMock(return_value=cat)

    with pytest.raises(HTTPException) as exc:
        await update_category(1, body, MagicMock(), db=db)
    assert exc.value.status_code == 400
    assert "own parent" in exc.value.detail.lower()


async def test_update_category_success() -> None:
    cat = _make_category(1, "Cat")
    body = CategoryUpdate(label="Updated Cat")

    dup_result = MagicMock()
    dup_result.scalar_one_or_none.return_value = None

    db = AsyncMock()
    db.get = AsyncMock(return_value=cat)
    db.execute = AsyncMock(return_value=dup_result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    result = await update_category(1, body, MagicMock(), db=db)
    assert result.label == "Updated Cat"
    db.commit.assert_awaited_once()


async def test_update_category_duplicate_sibling_rejected() -> None:
    cat = _make_category(1, "Alpha", parent_id=None)
    body = CategoryUpdate(label="Beta")

    dup_result = MagicMock()
    dup_result.scalar_one_or_none.return_value = _make_category(2, "Beta", parent_id=None)

    db = AsyncMock()
    db.get = AsyncMock(return_value=cat)
    db.execute = AsyncMock(return_value=dup_result)

    with pytest.raises(HTTPException) as exc:
        await update_category(1, body, MagicMock(), db=db)
    assert exc.value.status_code == 409
    assert "already exists" in exc.value.detail.lower()


async def test_update_category_metadata_extra() -> None:
    cat = _make_category(1, "Cat")
    body = CategoryUpdate(metadata_extra={"key": "value"})
    db = AsyncMock()
    db.get = AsyncMock(return_value=cat)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    result = await update_category(1, body, MagicMock(), db=db)
    assert result.metadata_ == {"key": "value"}


async def test_update_category_descendant_cycle() -> None:
    """Prevent moving a category into one of its own descendants."""
    # Cat 1 -> Cat 2 -> Cat 3; try to move Cat 1 under Cat 3
    cat1 = _make_category(1, "Root")
    cat3 = _make_category(3, "Grandchild", parent_id=2)
    cat2 = _make_category(2, "Child", parent_id=1)

    async def mock_get(model, id_):
        lookup = {1: cat1, 2: cat2, 3: cat3}
        return lookup.get(id_)

    body = CategoryUpdate(parent_id=3)
    db = AsyncMock()
    db.get = AsyncMock(side_effect=mock_get)

    with pytest.raises(HTTPException) as exc:
        await update_category(1, body, MagicMock(), db=db)
    assert exc.value.status_code == 400
    assert "descendants" in exc.value.detail.lower()


async def test_reorder_categories_self_parent() -> None:
    items = [CategoryReorderItem(id=1, parent_id=1, sort_order=0)]
    body = CategoryReorderRequest(items=items)
    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await reorder_categories(body, MagicMock(), db=db)
    assert exc.value.status_code == 400
    assert "own parent" in exc.value.detail.lower()


async def test_reorder_categories_success() -> None:
    cat1 = _make_category(1, "A")
    cat2 = _make_category(2, "B")

    items = [
        CategoryReorderItem(id=1, parent_id=None, sort_order=1),
        CategoryReorderItem(id=2, parent_id=None, sort_order=0),
    ]
    body = CategoryReorderRequest(items=items)

    async def mock_get(model, id_):
        lookup = {1: cat1, 2: cat2}
        return lookup.get(id_)

    db = AsyncMock()
    db.get = AsyncMock(side_effect=mock_get)
    db.commit = AsyncMock()

    result = await reorder_categories(body, MagicMock(), db=db)
    assert result == {"status": "ok"}
    db.commit.assert_awaited_once()


async def test_reorder_categories_missing_category() -> None:
    items = [CategoryReorderItem(id=999, parent_id=None, sort_order=0)]
    body = CategoryReorderRequest(items=items)

    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await reorder_categories(body, MagicMock(), db=db)
    assert exc.value.status_code == 404


async def test_delete_category_success() -> None:
    cat = _make_category(1, "Cat")
    db = AsyncMock()
    db.get = AsyncMock(return_value=cat)
    db.delete = AsyncMock()
    db.commit = AsyncMock()

    await delete_category(1, MagicMock(), db=db)
    db.delete.assert_awaited_once()
    db.commit.assert_awaited_once()


async def test_delete_category_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await delete_category(999, MagicMock(), db=db)
    assert exc.value.status_code == 404


# ── Program-scoped student filtering ────────────────────────


def _make_student_user(programs: list | None = None) -> SimpleNamespace:
    return SimpleNamespace(id=1, role="student", email="s@example.com", programs=programs or [])


async def test_list_categories_student_excludes_restricted() -> None:
    """Student without matching program should not see restricted categories."""
    prog = _make_program(10)
    cats = [
        _make_category(1, "Open"),
        _make_category(2, "Restricted", programs=[prog]),
    ]
    # First call: visibility helper fetches all cats; second call: list query result
    vis_result = MagicMock()
    vis_result.scalars.return_value.unique.return_value.all.return_value = cats

    list_result = MagicMock()
    list_result.scalars.return_value.all.return_value = [cats[0]]

    call_count = 0

    async def execute_side_effect(stmt):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return vis_result
        return list_result

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=execute_side_effect)

    result = await list_categories(_make_student_user(), parent_id=None, db=db)
    assert len(result) == 1
    assert result[0].label == "Open"


async def test_list_categories_student_sees_matching_program() -> None:
    prog = _make_program(10)
    cats = [_make_category(1, "Match", programs=[prog])]

    vis_result = MagicMock()
    vis_result.scalars.return_value.unique.return_value.all.return_value = cats

    list_result = MagicMock()
    list_result.scalars.return_value.all.return_value = cats

    call_count = 0

    async def execute_side_effect(stmt):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return vis_result
        return list_result

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=execute_side_effect)

    result = await list_categories(
        _make_student_user(programs=[_make_program(10)]),
        parent_id=None,
        db=db,
    )
    assert len(result) == 1


async def test_list_categories_admin_sees_all() -> None:
    """Admin should not be filtered by program restrictions."""
    prog = _make_program(10)
    cats = [
        _make_category(1, "Open"),
        _make_category(2, "Restricted", programs=[prog]),
    ]
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = cats

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    admin = SimpleNamespace(id=1, role="admin", email="a@example.com", programs=[])
    result = await list_categories(admin, parent_id=None, db=db)
    assert len(result) == 2


async def test_get_category_student_hidden() -> None:
    cat = _make_category(1, "Hidden", status="hidden")
    db = AsyncMock()
    db.get = AsyncMock(return_value=cat)

    with pytest.raises(HTTPException) as exc:
        await get_category(1, _make_student_user(), db=db)
    assert exc.value.status_code == 404


async def test_get_category_student_program_restricted() -> None:
    cat = _make_category(1, "Restricted", programs=[_make_program(10)])
    db = AsyncMock()
    db.get = AsyncMock(return_value=cat)

    with pytest.raises(HTTPException) as exc:
        await get_category(1, _make_student_user(), db=db)
    assert exc.value.status_code == 404


async def test_get_category_student_matching_program() -> None:
    cat = _make_category(1, "Match", programs=[_make_program(10)])
    db = AsyncMock()
    db.get = AsyncMock(return_value=cat)

    result = await get_category(
        1, _make_student_user(programs=[_make_program(10)]), db=db,
    )
    assert result.label == "Match"


async def test_get_category_student_hidden_ancestor() -> None:
    child = _make_category(2, "Child", parent_id=1)
    parent = _make_category(1, "Parent", status="hidden")

    async def mock_get(model, id_val):
        return {1: parent, 2: child}.get(id_val)

    db = AsyncMock()
    db.get = AsyncMock(side_effect=mock_get)

    with pytest.raises(HTTPException) as exc:
        await get_category(2, _make_student_user(), db=db)
    assert exc.value.status_code == 404


async def test_get_category_student_restricted_ancestor() -> None:
    child = _make_category(2, "Child", parent_id=1)
    parent = _make_category(1, "Parent", programs=[_make_program(10)])

    async def mock_get(model, id_val):
        return {1: parent, 2: child}.get(id_val)

    db = AsyncMock()
    db.get = AsyncMock(side_effect=mock_get)

    with pytest.raises(HTTPException) as exc:
        await get_category(2, _make_student_user(programs=[_make_program(20)]), db=db)
    assert exc.value.status_code == 404


async def test_get_category_student_unrestricted() -> None:
    cat = _make_category(1, "Open")
    db = AsyncMock()
    db.get = AsyncMock(return_value=cat)

    result = await get_category(1, _make_student_user(), db=db)
    assert result.label == "Open"
