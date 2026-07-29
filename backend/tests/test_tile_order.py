"""Tests for the atomic, revisioned tile-order API (epic #975, issue #978).

Two layers, mirroring ``test_reorder_fixture.py``:

- Pure unit tests for the canonical ordering rule, scope keys, and
  submission validation (always run).
- PostgreSQL integration tests (``REORDER_FIXTURE_DATABASE_URL``) proving
  atomic commit/rollback, compare-and-set revisions, bounded statement
  counts, membership preservation, and deterministic normalization against
  the production-scale reorder fixture.
"""

import asyncio
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models import Category, Image, TileOrderRevision
from app.reorder_fixture import seed_reorder_fixture
from app.routers.tile_order import get_tile_order, put_tile_order
from app.schemas import (
    TileOrderItemRef,
    TileOrderRequest,
    TileOrderScope,
)
from app.tile_order import (
    ROOT_SCOPE_KEY,
    TileRef,
    _resolve_database_url,
    canonical_order,
    canonical_sort_key,
    main,
    normalize_all_scopes,
    normalize_scope,
    scope_key_for,
    validate_submitted_items,
)

DB_URL = os.environ.get("REORDER_FIXTURE_DATABASE_URL", "")

requires_db = pytest.mark.skipif(
    not DB_URL,
    reason="REORDER_FIXTURE_DATABASE_URL not set (needs a migrated PostgreSQL database)",
)


def _admin() -> SimpleNamespace:
    return SimpleNamespace(id=1, role="admin", programs=[], groups=[])


# ---------------------------------------------------------------------------
# Pure unit tests (no database)
# ---------------------------------------------------------------------------


def test_scope_key_for_root_and_category():
    assert scope_key_for(None) == ROOT_SCOPE_KEY
    assert scope_key_for(42) == 42


def test_canonical_sort_key_uses_sort_order_type_priority_then_id():
    cat = TileRef(type="category", id=9, sort_order=3)
    img = TileRef(type="image", id=1, sort_order=3)
    assert canonical_sort_key(cat) < canonical_sort_key(img)
    earlier = TileRef(type="image", id=7, sort_order=2)
    assert canonical_sort_key(earlier) < canonical_sort_key(cat)
    same_type = TileRef(type="category", id=2, sort_order=3)
    assert canonical_sort_key(same_type) < canonical_sort_key(cat)


def test_canonical_order_is_deterministic_for_duplicate_positions():
    tiles = [
        TileRef(type="image", id=5, sort_order=1),
        TileRef(type="category", id=4, sort_order=1),
        TileRef(type="image", id=2, sort_order=1),
        TileRef(type="category", id=8, sort_order=0),
    ]
    ordered = canonical_order(tiles)
    assert [(t.type, t.id) for t in ordered] == [
        ("category", 8),
        ("category", 4),
        ("image", 2),
        ("image", 5),
    ]
    assert canonical_order(list(reversed(tiles))) == ordered


def test_validate_submitted_items_accepts_exact_scope():
    assert (
        validate_submitted_items(
            [("category", 1), ("image", 10)], {1}, {10}
        )
        is None
    )


def test_validate_submitted_items_rejects_duplicates():
    error = validate_submitted_items([("image", 10), ("image", 10)], set(), {10})
    assert error is not None and "Duplicate" in error


def test_validate_submitted_items_rejects_foreign_ids():
    error = validate_submitted_items([("category", 99)], {1}, set())
    assert error is not None and "not in scope" in error
    error = validate_submitted_items([("category", 1), ("image", 99)], {1}, {10})
    assert error is not None and "not in scope" in error


def test_validate_submitted_items_rejects_missing_ids():
    error = validate_submitted_items([("category", 1)], {1}, {10})
    assert error is not None and "Missing" in error
    error = validate_submitted_items([("image", 10)], {1}, {10})
    assert error is not None and "Missing" in error


def test_resolve_database_url_requires_env(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(SystemExit):
        _resolve_database_url()
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://x/y")
    assert _resolve_database_url() == "postgresql+asyncpg://x/y"


def test_main_runs_cli(monkeypatch):
    calls: list[bool] = []

    async def fake_run_cli() -> None:
        calls.append(True)

    monkeypatch.setattr("app.tile_order._run_cli", fake_run_cli)
    monkeypatch.setattr("sys.argv", ["tile_order"])
    main()
    assert calls == [True]


# ---------------------------------------------------------------------------
# Endpoint unit tests with mocked persistence helpers (no database)
# ---------------------------------------------------------------------------


def _request(
    items: list[tuple[str, int]],
    expected_revision: int = 1,
    parent_category_id: int | None = None,
) -> TileOrderRequest:
    return TileOrderRequest(
        scope=TileOrderScope(parent_category_id=parent_category_id),
        expected_revision=expected_revision,
        operation_id="0b7f9f3a-1111-4222-8333-444455556666",
        items=[TileOrderItemRef(type=t, id=i) for t, i in items],
    )


@pytest.fixture
def mocked_helpers(monkeypatch):
    mocks = SimpleNamespace(
        lock=AsyncMock(return_value=1),
        members=AsyncMock(return_value=({1, 2}, {10})),
        tiles=AsyncMock(return_value=[]),
        apply=AsyncMock(),
        bump=AsyncMock(return_value=2),
    )
    monkeypatch.setattr("app.routers.tile_order.lock_scope_revision", mocks.lock)
    monkeypatch.setattr("app.routers.tile_order.load_scope_members", mocks.members)
    monkeypatch.setattr("app.routers.tile_order.load_scope_tiles", mocks.tiles)
    monkeypatch.setattr("app.routers.tile_order.apply_positions", mocks.apply)
    monkeypatch.setattr("app.routers.tile_order.bump_scope_revision", mocks.bump)
    return mocks


async def test_put_success_returns_new_revision_and_contiguous_order(mocked_helpers):
    db = AsyncMock()
    body = _request([("image", 10), ("category", 2), ("category", 1)])
    response = await put_tile_order(body, _admin(), db)
    assert response.revision == 2
    assert [(i.type, i.id, i.sort_order) for i in response.items] == [
        ("image", 10, 0),
        ("category", 2, 1),
        ("category", 1, 2),
    ]
    mocked_helpers.apply.assert_awaited_once_with(
        db, [("image", 10), ("category", 2), ("category", 1)]
    )
    db.commit.assert_awaited_once()
    db.rollback.assert_not_awaited()


async def test_put_stale_revision_returns_409_with_current_state(mocked_helpers):
    mocked_helpers.lock.return_value = 5
    mocked_helpers.tiles.return_value = [TileRef(type="category", id=1, sort_order=0)]
    db = AsyncMock()
    body = _request([("category", 1), ("category", 2), ("image", 10)], expected_revision=4)
    with pytest.raises(HTTPException) as excinfo:
        await put_tile_order(body, _admin(), db)
    assert excinfo.value.status_code == 409
    assert excinfo.value.detail["current"]["revision"] == 5
    mocked_helpers.apply.assert_not_awaited()
    mocked_helpers.bump.assert_not_awaited()
    db.commit.assert_not_awaited()
    db.rollback.assert_awaited()


async def test_put_invalid_submission_returns_400(mocked_helpers):
    db = AsyncMock()
    body = _request([("category", 1), ("category", 2)])  # image 10 missing
    with pytest.raises(HTTPException) as excinfo:
        await put_tile_order(body, _admin(), db)
    assert excinfo.value.status_code == 400
    mocked_helpers.apply.assert_not_awaited()
    db.commit.assert_not_awaited()


async def test_put_never_touches_membership_fields(mocked_helpers):
    """Reordering delegates to apply_positions, which writes sort_order only."""
    db = AsyncMock()
    body = _request([("category", 1), ("category", 2), ("image", 10)])
    await put_tile_order(body, _admin(), db)
    # apply_positions receives only (type, id) pairs — no parent/category IDs.
    _, ordered = mocked_helpers.apply.await_args.args
    assert ordered == [("category", 1), ("category", 2), ("image", 10)]


# ---------------------------------------------------------------------------
# Database integration tests (PostgreSQL required)
# ---------------------------------------------------------------------------


@pytest.fixture
async def db_engine():
    engine = create_async_engine(DB_URL)
    yield engine
    await engine.dispose()


@pytest.fixture
async def db_session(db_engine):
    factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with factory() as session:
        yield session


async def _mixed_scope(db_session):
    """Seed the fixture and return a nested scope with categories AND images."""
    spec = await seed_reorder_fixture(db_session)
    image_parents = {i.category_id for i in spec.images if i.category_id is not None}
    for cat in spec.categories:
        if cat.parent_id in image_parents:
            parent_id = cat.parent_id
            cats = [c.id for c in spec.categories if c.parent_id == parent_id]
            imgs = [i.id for i in spec.images if i.category_id == parent_id]
            if cats and imgs:
                return parent_id, cats, imgs
    raise AssertionError("fixture has no mixed scope")


async def _scope_order(db_session, parent_id):
    cats = (
        await db_session.execute(
            select(Category.id, Category.sort_order).where(Category.parent_id == parent_id)
        )
    ).all()
    imgs = (
        await db_session.execute(
            select(Image.id, Image.sort_order).where(Image.category_id == parent_id)
        )
    ).all()
    tiles = [("category", r.id, r.sort_order) for r in cats] + [
        ("image", r.id, r.sort_order) for r in imgs
    ]
    return sorted(tiles, key=lambda t: (t[2], 0 if t[0] == "category" else 1, t[1]))


@requires_db
async def test_put_commits_categories_and_images_in_one_transaction(db_session):
    parent_id, cats, imgs = await _mixed_scope(db_session)
    items = [("image", i) for i in reversed(imgs)] + [("category", c) for c in reversed(cats)]
    current = await get_tile_order(_admin(), parent_id, db_session)
    body = TileOrderRequest(
        scope=TileOrderScope(parent_category_id=parent_id),
        expected_revision=current.revision,
        operation_id=None,
        items=[TileOrderItemRef(type=t, id=i) for t, i in items],
    )
    response = await put_tile_order(body, _admin(), db_session)
    assert response.revision == current.revision + 1
    assert [(i.type, i.id) for i in response.items] == items
    persisted = await _scope_order(db_session, parent_id)
    assert [(t, i) for t, i, _ in persisted] == items
    assert [pos for _, _, pos in persisted] == list(range(len(items)))


@requires_db
async def test_put_failure_rolls_back_both_entity_types(db_session, monkeypatch):
    parent_id, cats, imgs = await _mixed_scope(db_session)
    before = await _scope_order(db_session, parent_id)
    current = await get_tile_order(_admin(), parent_id, db_session)

    async def boom(db, scope_key):
        raise RuntimeError("simulated failure after position writes")

    monkeypatch.setattr("app.routers.tile_order.bump_scope_revision", boom)
    items = [("image", i) for i in reversed(imgs)] + [("category", c) for c in reversed(cats)]
    body = TileOrderRequest(
        scope=TileOrderScope(parent_category_id=parent_id),
        expected_revision=current.revision,
        operation_id=None,
        items=[TileOrderItemRef(type=t, id=i) for t, i in items],
    )
    with pytest.raises(RuntimeError):
        await put_tile_order(body, _admin(), db_session)
    assert await _scope_order(db_session, parent_id) == before


@requires_db
async def test_put_rejects_duplicate_missing_and_foreign_ids(db_session):
    parent_id, cats, imgs = await _mixed_scope(db_session)
    current = await get_tile_order(_admin(), parent_id, db_session)
    full = [("category", c) for c in cats] + [("image", i) for i in imgs]

    for bad_items in (
        full + [("image", imgs[0])],  # duplicate
        full[:-1],  # missing
        full + [("category", 999_999_999)],  # foreign
    ):
        body = TileOrderRequest(
            scope=TileOrderScope(parent_category_id=parent_id),
            expected_revision=current.revision,
            operation_id=None,
            items=[TileOrderItemRef(type=t, id=i) for t, i in bad_items],
        )
        with pytest.raises(HTTPException) as excinfo:
            await put_tile_order(body, _admin(), db_session)
        assert excinfo.value.status_code == 400


@requires_db
async def test_stale_revision_conflicts_and_second_writer_loses(db_session):
    parent_id, cats, imgs = await _mixed_scope(db_session)
    current = await get_tile_order(_admin(), parent_id, db_session)
    full = [("category", c) for c in cats] + [("image", i) for i in imgs]

    def body_with(revision):
        return TileOrderRequest(
            scope=TileOrderScope(parent_category_id=parent_id),
            expected_revision=revision,
            operation_id=None,
            items=[TileOrderItemRef(type=t, id=i) for t, i in full],
        )

    first = await put_tile_order(body_with(current.revision), _admin(), db_session)
    assert first.revision == current.revision + 1

    # A second writer holding the same (now stale) revision must conflict.
    with pytest.raises(HTTPException) as excinfo:
        await put_tile_order(body_with(current.revision), _admin(), db_session)
    assert excinfo.value.status_code == 409
    assert excinfo.value.detail["current"]["revision"] == first.revision


@requires_db
async def test_reorder_preserves_membership_fields(db_session):
    parent_id, cats, imgs = await _mixed_scope(db_session)
    current = await get_tile_order(_admin(), parent_id, db_session)
    items = [("image", i) for i in reversed(imgs)] + [("category", c) for c in reversed(cats)]
    body = TileOrderRequest(
        scope=TileOrderScope(parent_category_id=parent_id),
        expected_revision=current.revision,
        operation_id=None,
        items=[TileOrderItemRef(type=t, id=i) for t, i in items],
    )
    await put_tile_order(body, _admin(), db_session)
    cat_parents = (
        await db_session.execute(select(Category.parent_id).where(Category.id.in_(cats)))
    ).scalars()
    assert set(cat_parents) == {parent_id}
    img_parents = (
        await db_session.execute(select(Image.category_id).where(Image.id.in_(imgs)))
    ).scalars()
    assert set(img_parents) == {parent_id}


@requires_db
async def test_statement_count_is_bounded_by_scope_size(db_engine, db_session):
    """The gallery scope (600+ images) must not use more statements than a
    small scope: the endpoint is set-based, never one query per item."""
    spec = await seed_reorder_fixture(db_session)
    from collections import Counter

    gallery_id, gallery_count = Counter(
        i.category_id for i in spec.images if i.category_id is not None
    ).most_common(1)[0]
    assert gallery_count >= 600
    small_id, small_cats, small_imgs = await _mixed_scope(db_session)

    statements: list[str] = []

    def count_statement(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    factory = async_sessionmaker(db_engine, expire_on_commit=False)

    async def run_reorder(parent_id, items):
        async with factory() as session:
            current = await get_tile_order(_admin(), parent_id, session)
            body = TileOrderRequest(
                scope=TileOrderScope(parent_category_id=parent_id),
                expected_revision=current.revision,
                operation_id=None,
                items=[TileOrderItemRef(type=t, id=i) for t, i in items],
            )
            await put_tile_order(body, _admin(), session)

    event.listen(db_engine.sync_engine, "before_cursor_execute", count_statement)
    try:
        statements.clear()
        gallery_items = [
            ("image", i.id) for i in spec.images if i.category_id == gallery_id
        ] + [("category", c.id) for c in spec.categories if c.parent_id == gallery_id]
        await run_reorder(gallery_id, list(reversed(gallery_items)))
        large_count = len(statements)

        statements.clear()
        small_items = [("category", c) for c in small_cats] + [
            ("image", i) for i in small_imgs
        ]
        await run_reorder(small_id, list(reversed(small_items)))
        small_count = len(statements)
    finally:
        event.remove(db_engine.sync_engine, "before_cursor_execute", count_statement)

    # The gallery scope holds 600+ images (one entity type → one UPDATE);
    # the small mixed scope needs one UPDATE per entity type. Statement
    # count must never grow with item count.
    assert large_count <= small_count
    assert large_count <= 16


@requires_db
async def test_concurrent_writers_with_same_revision_only_one_succeeds(db_engine, db_session):
    """True concurrent CAS exclusivity: two sessions race on one scope."""
    parent_id, cats, imgs = await _mixed_scope(db_session)
    current = await get_tile_order(_admin(), parent_id, db_session)
    full = [("category", c) for c in cats] + [("image", i) for i in imgs]
    factory = async_sessionmaker(db_engine, expire_on_commit=False)

    async def writer():
        async with factory() as session:
            body = TileOrderRequest(
                scope=TileOrderScope(parent_category_id=parent_id),
                expected_revision=current.revision,
                operation_id=None,
                items=[TileOrderItemRef(type=t, id=i) for t, i in full],
            )
            return await put_tile_order(body, _admin(), session)

    results = await asyncio.gather(writer(), writer(), return_exceptions=True)
    successes = [r for r in results if not isinstance(r, BaseException)]
    conflicts = [
        r for r in results if isinstance(r, HTTPException) and r.status_code == 409
    ]
    assert len(successes) == 1
    assert len(conflicts) == 1
    assert successes[0].revision == current.revision + 1


@requires_db
async def test_nonexistent_parent_scope_returns_404(db_session):
    missing_parent = 999_999_999
    with pytest.raises(HTTPException) as excinfo:
        await get_tile_order(_admin(), missing_parent, db_session)
    assert excinfo.value.status_code == 404
    body = TileOrderRequest(
        scope=TileOrderScope(parent_category_id=missing_parent),
        expected_revision=1,
        operation_id=None,
        items=[],
    )
    with pytest.raises(HTTPException) as excinfo:
        await put_tile_order(body, _admin(), db_session)
    assert excinfo.value.status_code == 404
    result = await db_session.execute(
        select(TileOrderRevision).where(TileOrderRevision.scope_key == missing_parent)
    )
    assert result.scalar_one_or_none() is None


@requires_db
async def test_get_returns_canonical_order_and_revision(db_session):
    parent_id, cats, imgs = await _mixed_scope(db_session)
    response = await get_tile_order(_admin(), parent_id, db_session)
    assert response.revision >= 1
    assert {(i.type, i.id) for i in response.items} == {
        ("category", c) for c in cats
    } | {("image", i) for i in imgs}
    keys = [
        (i.sort_order, 0 if i.type == "category" else 1, i.id) for i in response.items
    ]
    assert keys == sorted(keys)


@requires_db
async def test_normalize_scope_produces_contiguous_deterministic_order(db_session):
    parent_id, cats, imgs = await _mixed_scope(db_session)
    await normalize_scope(db_session, parent_id)
    await db_session.commit()
    tiles = await _scope_order(db_session, parent_id)
    assert [pos for _, _, pos in tiles] == list(range(len(tiles)))
    # Running normalization again is a no-op (deterministic).
    await normalize_scope(db_session, parent_id)
    await db_session.commit()
    assert await _scope_order(db_session, parent_id) == tiles


@requires_db
async def test_normalize_all_scopes_initializes_revisions(db_session):
    spec = await seed_reorder_fixture(db_session)
    stats = await normalize_all_scopes(db_session)
    assert stats["scopes"] >= len({c.parent_id for c in spec.categories})
    revision_rows = (
        await db_session.execute(select(TileOrderRevision.scope_key))
    ).scalars()
    keys = set(revision_rows)
    assert ROOT_SCOPE_KEY in keys
    fixture_parents = {c.parent_id for c in spec.categories if c.parent_id is not None}
    assert fixture_parents <= keys
