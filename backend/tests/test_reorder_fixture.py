"""Tests for the production-scale reorder fixture (epic #975, sub-issue #976).

Two layers:

- Pure specification tests that always run and pin the fixture shape
  (counts, scopes, nesting depth, duplicate ``sort_order`` values,
  deterministic IDs and names).
- Database integration tests that run when ``REORDER_FIXTURE_DATABASE_URL``
  points at a PostgreSQL database (CI provides one; locally use
  ``docker compose up -d db`` and
  ``postgresql+asyncpg://hriv:hriv@localhost:5432/hriv``). These include
  ``xfail(strict=True)`` regression tests that document the current
  partial-persistence and silent last-write-wins behaviour the rest of the
  epic will fix — they flip to failures once the behaviour is corrected,
  forcing the markers to be removed.
"""

import os
from collections import Counter, defaultdict
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.reorder_fixture as reorder_fixture_module
from app.models import Category, Image
from app.reorder_fixture import (
    CATEGORY_ID_BASE,
    FIXTURE_PREFIX,
    FLAT_SIBLING_CATEGORY_COUNT,
    GALLERY_SIBLING_IMAGE_COUNT,
    IMAGE_ID_BASE,
    NESTED_LEVELS,
    ROOT_MIXED_CATEGORY_COUNT,
    ROOT_UNCATEGORIZED_IMAGE_COUNT,
    build_fixture_spec,
    purge_reorder_fixture,
    seed_reorder_fixture,
)
from app.routers.categories import reorder_categories
from app.routers.images import reorder_images
from app.schemas import (
    CategoryReorderItem,
    CategoryReorderRequest,
    ImageReorderItem,
    ImageReorderRequest,
)

DB_URL = os.environ.get("REORDER_FIXTURE_DATABASE_URL", "")

requires_db = pytest.mark.skipif(
    not DB_URL,
    reason="REORDER_FIXTURE_DATABASE_URL not set (needs a migrated PostgreSQL database)",
)


def _admin() -> SimpleNamespace:
    return SimpleNamespace(id=1, role="admin", programs=[], groups=[])


# ---------------------------------------------------------------------------
# Pure specification tests (no database)
# ---------------------------------------------------------------------------


def test_spec_is_deterministic():
    assert build_fixture_spec() == build_fixture_spec()


def test_spec_ids_are_reserved_and_unique():
    spec = build_fixture_spec()
    cat_ids = [c.id for c in spec.categories]
    img_ids = [i.id for i in spec.images]
    assert len(set(cat_ids)) == len(cat_ids)
    assert len(set(img_ids)) == len(img_ids)
    assert all(cid >= CATEGORY_ID_BASE for cid in cat_ids)
    assert all(iid >= IMAGE_ID_BASE for iid in img_ids)


def test_spec_names_are_prefixed_and_unique():
    spec = build_fixture_spec()
    labels = [c.label for c in spec.categories]
    names = [i.name for i in spec.images]
    assert len(set(labels)) == len(labels)
    assert len(set(names)) == len(names)
    assert all(label.startswith(FIXTURE_PREFIX) for label in labels)
    assert all(name.startswith(FIXTURE_PREFIX) for name in names)


def test_spec_contains_flat_sibling_category_scope():
    spec = build_fixture_spec()
    by_parent: dict[int | None, list] = defaultdict(list)
    for cat in spec.categories:
        by_parent[cat.parent_id].append(cat)
    flat_scopes = [cats for cats in by_parent.values() if len(cats) >= 80]
    assert flat_scopes, "expected a scope with at least 80 sibling categories"
    assert len(flat_scopes[0]) == FLAT_SIBLING_CATEGORY_COUNT


def test_spec_contains_gallery_sibling_image_scope():
    spec = build_fixture_spec()
    by_category: Counter = Counter(i.category_id for i in spec.images)
    assert max(by_category.values()) == GALLERY_SIBLING_IMAGE_COUNT
    assert GALLERY_SIBLING_IMAGE_COUNT >= 600


def test_spec_contains_mixed_root_scope():
    spec = build_fixture_spec()
    root_cats = [c for c in spec.categories if c.parent_id is None]
    uncategorized = [i for i in spec.images if i.category_id is None]
    assert len(root_cats) == ROOT_MIXED_CATEGORY_COUNT
    assert len(uncategorized) == ROOT_UNCATEGORIZED_IMAGE_COUNT


def test_spec_contains_nested_scope_with_categories_and_images():
    spec = build_fixture_spec()
    parents = {c.id: c.parent_id for c in spec.categories}

    def depth(cat_id: int) -> int:
        d = 0
        current: int | None = cat_id
        while current is not None:
            current = parents.get(current)
            d += 1
        return d

    max_depth = max(depth(c.id) for c in spec.categories)
    assert max_depth >= NESTED_LEVELS

    # Nested scopes must contain both child categories and categorized images.
    nested_parents = {c.parent_id for c in spec.categories if c.parent_id is not None}
    image_parents = {i.category_id for i in spec.images if i.category_id is not None}
    assert nested_parents & image_parents


def test_spec_has_duplicate_sort_orders_in_every_large_scope():
    spec = build_fixture_spec()
    by_parent: dict[int | None, list[int]] = defaultdict(list)
    for cat in spec.categories:
        by_parent[cat.parent_id].append(cat.sort_order)
    for parent_id, sort_orders in by_parent.items():
        if len(sort_orders) >= 2:
            assert len(set(sort_orders)) < len(sort_orders), (
                f"scope {parent_id} has no duplicate sort_order values"
            )
    gallery_orders = Counter(
        i.sort_order for i in spec.images if i.category_id is not None
    )
    assert any(count > 1 for count in gallery_orders.values())


# ---------------------------------------------------------------------------
# CLI plumbing
# ---------------------------------------------------------------------------


def test_resolve_database_url_requires_env(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(SystemExit):
        reorder_fixture_module._resolve_database_url()
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://x/y")
    assert reorder_fixture_module._resolve_database_url() == "postgresql+asyncpg://x/y"


def test_main_parses_purge_flag(monkeypatch):
    calls: list[bool] = []

    async def fake_run_cli(purge_only: bool) -> None:
        calls.append(purge_only)

    monkeypatch.setattr(reorder_fixture_module, "_run_cli", fake_run_cli)
    reorder_fixture_module.main([])
    reorder_fixture_module.main(["--purge"])
    assert calls == [False, True]


# ---------------------------------------------------------------------------
# Database integration tests (PostgreSQL required)
# ---------------------------------------------------------------------------


@pytest.fixture
async def db_session():
    engine = create_async_engine(DB_URL)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


async def _fixture_counts(session) -> tuple[int, int]:
    cats = (
        await session.execute(
            select(Category.id).where(Category.label.like(f"{FIXTURE_PREFIX}%"))
        )
    ).all()
    imgs = (
        await session.execute(
            select(Image.id).where(Image.name.like(f"{FIXTURE_PREFIX}%"))
        )
    ).all()
    return len(cats), len(imgs)


@requires_db
async def test_seed_is_idempotent(db_session):
    spec1 = await seed_reorder_fixture(db_session)
    spec2 = await seed_reorder_fixture(db_session)
    assert spec1 == spec2
    cat_count, img_count = await _fixture_counts(db_session)
    assert cat_count == len(spec2.categories)
    assert img_count == len(spec2.images)


@requires_db
async def test_purge_removes_all_fixture_rows(db_session):
    await seed_reorder_fixture(db_session)
    await purge_reorder_fixture(db_session)
    cat_count, img_count = await _fixture_counts(db_session)
    assert (cat_count, img_count) == (0, 0)


@requires_db
async def test_full_authoritative_order_round_trip(db_session):
    """Reorder the 80-category flat scope and read the whole order back."""
    spec = await seed_reorder_fixture(db_session)
    flat_parent = spec.categories[0].id
    flat = [c for c in spec.categories if c.parent_id == flat_parent]
    reversed_ids = [c.id for c in reversed(flat)]

    body = CategoryReorderRequest(
        items=[
            CategoryReorderItem(id=cid, parent_id=flat_parent, sort_order=idx)
            for idx, cid in enumerate(reversed_ids)
        ]
    )
    await reorder_categories(body, _admin(), db_session)

    rows = (
        await db_session.execute(
            select(Category.id)
            .where(Category.parent_id == flat_parent)
            .order_by(Category.sort_order, Category.label)
        )
    ).all()
    assert [row[0] for row in rows] == reversed_ids


@requires_db
@pytest.mark.xfail(
    strict=True,
    reason=(
        "Epic #975 regression: category and image reorders persist through "
        "separate transactions, so one half can commit while the other fails "
        "(sub-issue #978 will make the pair atomic)."
    ),
)
async def test_mixed_reorder_is_atomic_across_categories_and_images(db_session):
    """A failing image half must not leave the category half committed."""
    spec = await seed_reorder_fixture(db_session)
    root_cats = [c for c in spec.categories if c.parent_id is None]
    original_first = root_cats[0].id

    cat_body = CategoryReorderRequest(
        items=[
            CategoryReorderItem(id=c.id, parent_id=None, sort_order=len(root_cats) - i)
            for i, c in enumerate(root_cats)
        ]
    )
    img_body = ImageReorderRequest(
        items=[ImageReorderItem(id=IMAGE_ID_BASE - 1, sort_order=0)]  # nonexistent
    )

    # Mirrors the frontend's two-request flow (SortableTileGrid.handleDragEnd).
    await reorder_categories(cat_body, _admin(), db_session)
    with pytest.raises(HTTPException):
        await reorder_images(img_body, _admin(), db_session)
    await db_session.rollback()

    rows = (
        await db_session.execute(
            select(Category.id)
            .where(Category.parent_id.is_(None), Category.label.like(f"{FIXTURE_PREFIX}%"))
            .order_by(Category.sort_order, Category.label)
        )
    ).all()
    # Atomicity requires the category half to have rolled back too — today it
    # commits, so the original leader is no longer first and this assert fails.
    assert [row[0] for row in rows][0] == original_first


@requires_db
@pytest.mark.xfail(
    strict=True,
    reason=(
        "Epic #975 regression: concurrent editors submitting from the same "
        "initial ordering silently last-write-win (sub-issue #978 adds a "
        "revisioned contract that must reject the stale submission)."
    ),
)
async def test_stale_submission_from_second_tab_is_rejected(db_session):
    """Two tabs reorder from the same revision; the stale one must conflict."""
    spec = await seed_reorder_fixture(db_session)
    root_cats = [c for c in spec.categories if c.parent_id is None]
    ids = [c.id for c in root_cats]

    tab_a = CategoryReorderRequest(
        items=[
            CategoryReorderItem(id=cid, parent_id=None, sort_order=i)
            for i, cid in enumerate(reversed(ids))
        ]
    )
    # Tab B still believes the initial ordering and submits a different order.
    tab_b = CategoryReorderRequest(
        items=[
            CategoryReorderItem(id=cid, parent_id=None, sort_order=i)
            for i, cid in enumerate(ids)
        ]
    )

    await reorder_categories(tab_a, _admin(), db_session)
    # A revisioned contract must reject tab B's stale submission; today it
    # silently overwrites tab A's committed order (last write wins).
    with pytest.raises(HTTPException):
        await reorder_categories(tab_b, _admin(), db_session)
