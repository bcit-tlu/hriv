"""Atomic, revisioned tile ordering for root/category scopes (issue #978).

One Browse/Manage scope (the root, or a single parent category) has one
combined visual order of child categories and images. This module owns:

- the canonical deterministic ordering rule shared by reads, writes, and
  normalization: ``(sort_order, item_type_priority, item_id)`` with
  categories before images on ties — never labels or file names;
- set-based position updates (one ``UPDATE ... FROM (VALUES ...)`` statement
  per entity type, regardless of item count);
- an administrative normalization routine that rewrites every scope to a
  contiguous, duplicate-free sequence and initializes its ordering revision
  (``python -m app.tile_order``).

See ``docs/tile-ordering.md``.
"""

from __future__ import annotations

import argparse
import asyncio
import os
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .models import Category, Image, TileOrderRevision

# ``scope_key`` for the root scope (``parent_category_id`` is NULL). Real
# category IDs are serial and start at 1, so 0 can never collide.
ROOT_SCOPE_KEY = 0

# Revision reported for (and seeded into) a scope that has never been written:
# ``lock_scope_revision`` inserts new rows at this value and
# ``GET /api/tile-order`` reports it when no row exists. Restore-time
# invalidation (``app/admin_ops.py``) materializes every scope at
# ``INITIAL_SCOPE_REVISION + 1`` so an implicit pre-restore revision can never
# pass the CAS check — keep the three sites in sync via this constant.
#
# INVARIANT: no committed row may exist at this revision. Every caller of
# ``lock_scope_revision`` must call ``bump_scope_revision`` in the same
# transaction (or roll back), so committed rows are always >= this value + 1.
# Restore-time invalidation depends on it: a code path that commits a row at
# this revision would let a client holding the implicit initial revision
# survive a restore and silently overwrite the restored order.
INITIAL_SCOPE_REVISION = 1

_TYPE_PRIORITY = {"category": 0, "image": 1}


@dataclass(frozen=True)
class TileRef:
    """One orderable tile in a scope."""

    type: str  # "category" | "image"
    id: int
    sort_order: int


def scope_key_for(parent_category_id: int | None) -> int:
    return ROOT_SCOPE_KEY if parent_category_id is None else parent_category_id


def canonical_sort_key(ref: TileRef) -> tuple[int, int, int]:
    """Deterministic tie-breaker: ``sort_order, item_type_priority, item_id``."""
    return (ref.sort_order, _TYPE_PRIORITY[ref.type], ref.id)


def canonical_order(refs: list[TileRef]) -> list[TileRef]:
    return sorted(refs, key=canonical_sort_key)


def validate_submitted_items(
    submitted: list[tuple[str, int]],
    scope_category_ids: set[int],
    scope_image_ids: set[int],
) -> str | None:
    """Return an error description for an invalid submission, or ``None``.

    The submitted items must be exactly the scope's members: duplicates,
    IDs from other scopes, and omissions are all rejected so a stale or
    corrupted client can never partially rewrite a scope.
    """
    seen: set[tuple[str, int]] = set()
    for item_type, item_id in submitted:
        if (item_type, item_id) in seen:
            return f"Duplicate item {item_type}:{item_id}"
        seen.add((item_type, item_id))
    submitted_categories = {i for t, i in submitted if t == "category"}
    submitted_images = {i for t, i in submitted if t == "image"}
    foreign_categories = submitted_categories - scope_category_ids
    if foreign_categories:
        return f"Categories not in scope: {sorted(foreign_categories)}"
    foreign_images = submitted_images - scope_image_ids
    if foreign_images:
        return f"Images not in scope: {sorted(foreign_images)}"
    missing_categories = scope_category_ids - submitted_categories
    if missing_categories:
        return f"Missing scope categories: {sorted(missing_categories)}"
    missing_images = scope_image_ids - submitted_images
    if missing_images:
        return f"Missing scope images: {sorted(missing_images)}"
    return None


async def load_scope_members(
    db: AsyncSession, parent_category_id: int | None
) -> tuple[set[int], set[int]]:
    """Load member category/image IDs for a scope in two bounded queries."""
    cat_where = (
        Category.parent_id.is_(None)
        if parent_category_id is None
        else Category.parent_id == parent_category_id
    )
    img_where = (
        Image.category_id.is_(None)
        if parent_category_id is None
        else Image.category_id == parent_category_id
    )
    category_ids = set((await db.execute(sa.select(Category.id).where(cat_where))).scalars())
    image_ids = set((await db.execute(sa.select(Image.id).where(img_where))).scalars())
    return category_ids, image_ids


async def load_scope_tiles(db: AsyncSession, parent_category_id: int | None) -> list[TileRef]:
    """Load the scope's tiles (two bounded queries) in canonical order."""
    cat_where = (
        Category.parent_id.is_(None)
        if parent_category_id is None
        else Category.parent_id == parent_category_id
    )
    img_where = (
        Image.category_id.is_(None)
        if parent_category_id is None
        else Image.category_id == parent_category_id
    )
    refs = [
        TileRef(type="category", id=row.id, sort_order=row.sort_order)
        for row in (await db.execute(sa.select(Category.id, Category.sort_order).where(cat_where)))
    ]
    refs += [
        TileRef(type="image", id=row.id, sort_order=row.sort_order)
        for row in (await db.execute(sa.select(Image.id, Image.sort_order).where(img_where)))
    ]
    return canonical_order(refs)


async def lock_scope_revision(db: AsyncSession, scope_key: int) -> int:
    """Ensure the scope's revision row exists and lock it for this transaction.

    ``INSERT ... ON CONFLICT DO NOTHING`` then ``SELECT ... FOR UPDATE``
    serializes concurrent writers on the same scope so two requests carrying
    the same expected revision can never both succeed.

    This relies on READ COMMITTED (the engine default): a concurrent insert
    blocks the ON CONFLICT path until it commits, and the following SELECT
    takes a fresh snapshot that sees the committed row. Under REPEATABLE
    READ or SERIALIZABLE the SELECT could miss the row and raise
    ``NoResultFound`` — revisit this if the isolation level ever changes.
    """
    await db.execute(
        pg_insert(TileOrderRevision)
        .values(scope_key=scope_key, revision=INITIAL_SCOPE_REVISION)
        .on_conflict_do_nothing(index_elements=["scope_key"])
    )
    result = await db.execute(
        sa.select(TileOrderRevision.revision)
        .where(TileOrderRevision.scope_key == scope_key)
        .with_for_update()
    )
    return result.scalar_one()


async def apply_positions(
    db: AsyncSession,
    ordered: list[tuple[str, int]],
) -> None:
    """Write contiguous positions with one set-based UPDATE per entity type.

    The statement count is constant (at most two UPDATEs) regardless of how
    many tiles the scope contains.
    """
    category_rows = [(item_id, pos) for pos, (t, item_id) in enumerate(ordered) if t == "category"]
    image_rows = [(item_id, pos) for pos, (t, item_id) in enumerate(ordered) if t == "image"]
    if category_rows:
        values = sa.values(
            sa.column("id", sa.Integer), sa.column("sort_order", sa.Integer), name="new_order"
        ).data(category_rows)
        await db.execute(
            sa.update(Category)
            .where(Category.id == values.c.id)
            .values(sort_order=values.c.sort_order)
        )
    if image_rows:
        values = sa.values(
            sa.column("id", sa.Integer), sa.column("sort_order", sa.Integer), name="new_order"
        ).data(image_rows)
        await db.execute(
            sa.update(Image).where(Image.id == values.c.id).values(sort_order=values.c.sort_order)
        )


async def bump_scope_revision(db: AsyncSession, scope_key: int) -> int:
    result = await db.execute(
        sa.update(TileOrderRevision)
        .where(TileOrderRevision.scope_key == scope_key)
        .values(revision=TileOrderRevision.revision + 1)
        .returning(TileOrderRevision.revision)
    )
    return result.scalar_one()


async def bump_scopes(db: AsyncSession, scope_keys: set[int]) -> None:
    """Lock and increment the revision of each affected scope.

    Used by the legacy per-entity reorder endpoints so ordering writes made
    during the staged frontend migration still invalidate tile-order
    revisions held by other clients. Locks are taken in sorted scope-key
    order so concurrent transactions touching overlapping scope sets cannot
    deadlock.
    """
    for scope_key in sorted(scope_keys):
        await lock_scope_revision(db, scope_key)
        await bump_scope_revision(db, scope_key)


async def normalize_scope(db: AsyncSession, parent_category_id: int | None) -> int:
    """Rewrite one scope to canonical contiguous positions; return tile count.

    Duplicate positions are resolved with the canonical tie-breaker and the
    scope's revision row is created if it does not exist yet. The revision is
    bumped so clients holding a pre-normalization revision get a 409 instead
    of silently overwriting the repaired order. Runs inside the caller's
    transaction.
    """
    scope_key = scope_key_for(parent_category_id)
    await lock_scope_revision(db, scope_key)
    tiles = await load_scope_tiles(db, parent_category_id)
    await apply_positions(db, [(t.type, t.id) for t in tiles])
    await bump_scope_revision(db, scope_key)
    return len(tiles)


async def normalize_all_scopes(db: AsyncSession) -> dict[str, int]:
    """Normalize the root scope and every category scope; commit once."""
    parent_ids = set(
        (await db.execute(sa.select(Category.id))).scalars()
    )
    scopes: list[int | None] = [None, *sorted(parent_ids)]
    tiles_total = 0
    for parent_id in scopes:
        tiles_total += await normalize_scope(db, parent_id)
    await db.commit()
    return {"scopes": len(scopes), "tiles": tiles_total}


def _resolve_database_url() -> str:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise SystemExit("DATABASE_URL is required to normalize tile ordering")
    # Deployments hand the app a driverless ``postgresql://`` URL; rewrite it
    # for the async engine the same way Settings._normalize_database_scheme
    # does (backend/app/database.py).
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


async def _run_cli() -> None:
    engine = create_async_engine(_resolve_database_url())
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_factory() as session:
            stats = await normalize_all_scopes(session)
            print(
                f"Tile ordering normalized: {stats['scopes']} scopes, "
                f"{stats['tiles']} tiles."
            )
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Normalize tile ordering for every root/category scope."
    )
    parser.parse_args()
    asyncio.run(_run_cli())


if __name__ == "__main__":
    main()
