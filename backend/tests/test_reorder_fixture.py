"""Tests for the production-scale reorder fixture (epic #975, sub-issue #976).

Two layers:

- Pure specification tests that always run and pin the fixture shape
  (counts, scopes, nesting depth, duplicate ``sort_order`` values,
  deterministic IDs and names).
- Database integration tests that run when ``REORDER_FIXTURE_DATABASE_URL``
  points at a PostgreSQL database (CI provides one; locally use
  ``docker compose up -d db`` and
  ``postgresql+asyncpg://hriv:hriv@localhost:5432/hriv``). Atomicity and
  stale-submission conflict behaviour are covered by ``test_tile_order.py``
  against the same fixture.
"""

import os
from collections import Counter, defaultdict
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

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
    _resolve_database_url,
    build_fixture_spec,
    main,
    purge_reorder_fixture,
    seed_reorder_fixture,
)
from app.routers.tile_order import get_tile_order, put_tile_order
from app.schemas import (
    TileOrderItemRef,
    TileOrderRequest,
    TileOrderScope,
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
        _resolve_database_url()
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://x/y")
    assert _resolve_database_url() == "postgresql+asyncpg://x/y"


def test_main_parses_purge_flag(monkeypatch):
    calls: list[bool] = []

    async def fake_run_cli(purge_only: bool) -> None:
        calls.append(purge_only)

    monkeypatch.setattr("app.reorder_fixture._run_cli", fake_run_cli)
    main([])
    main(["--purge"])
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

    current = await get_tile_order(_admin(), flat_parent, db_session)
    reversed_items = list(reversed(current.items))

    body = TileOrderRequest(
        scope=TileOrderScope(parent_category_id=flat_parent),
        expected_revision=current.revision,
        operation_id=None,
        items=[TileOrderItemRef(type=i.type, id=i.id) for i in reversed_items],
    )
    await put_tile_order(body, _admin(), db_session)

    after = await get_tile_order(_admin(), flat_parent, db_session)
    assert [(i.type, i.id) for i in after.items] == [
        (i.type, i.id) for i in reversed_items
    ]
