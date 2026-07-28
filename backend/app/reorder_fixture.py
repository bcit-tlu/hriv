"""Production-scale reorder fixture for the Browse ordering epic.

Builds a deterministic category/image data set large enough to reproduce the
reorder-persistence failures tracked by epic #975:

- 80 sibling categories in one flat scope;
- 600 sibling images in one gallery scope;
- a mixed root scope containing categories and uncategorized images;
- a nested scope (four levels deep) containing categories and images;
- duplicate initial ``sort_order`` values for normalization testing.

Every entity has a deterministic ID (in a reserved high range so it never
collides with sequence-assigned rows) and a deterministic ``RF-`` prefixed
name, so tests can assert the complete authoritative order exactly.

Seeding is idempotent: existing fixture rows are purged (by the reserved ID
range and the ``RF-`` name prefix) before re-inserting, so it can be re-run
without manual cleanup.

CLI usage (requires ``DATABASE_URL``)::

    python -m app.reorder_fixture          # purge + seed
    python -m app.reorder_fixture --purge  # purge only
"""

from __future__ import annotations

import argparse
import asyncio
import os
from dataclasses import dataclass, field

from sqlalchemy import delete, or_
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from .models import Category, Image

FIXTURE_PREFIX = "RF-"

# Reserved ID ranges: far above anything a serial sequence will reach so
# explicit-ID inserts never collide with normally created rows.
CATEGORY_ID_BASE = 9_100_000
IMAGE_ID_BASE = 9_200_000

FLAT_SIBLING_CATEGORY_COUNT = 80
GALLERY_SIBLING_IMAGE_COUNT = 600
ROOT_MIXED_CATEGORY_COUNT = 5
ROOT_UNCATEGORIZED_IMAGE_COUNT = 10
NESTED_LEVELS = 4
NESTED_CHILD_CATEGORY_COUNT = 6
NESTED_IMAGE_COUNT = 8

# Every Nth sibling shares a sort_order with its predecessor so duplicate
# positions are always present for normalization testing.
DUPLICATE_SORT_ORDER_STRIDE = 2


@dataclass(frozen=True)
class CategorySpec:
    id: int
    label: str
    parent_id: int | None
    sort_order: int


@dataclass(frozen=True)
class ImageSpec:
    id: int
    name: str
    category_id: int | None
    sort_order: int


@dataclass(frozen=True)
class FixtureSpec:
    categories: list[CategorySpec] = field(default_factory=list)
    images: list[ImageSpec] = field(default_factory=list)


def _duplicated_sort_order(index: int) -> int:
    """Collapse indexes pairwise (0,0,1,1,...) so duplicates always exist."""
    return index // DUPLICATE_SORT_ORDER_STRIDE


def build_fixture_spec() -> FixtureSpec:
    """Build the deterministic fixture specification (no database access)."""
    categories: list[CategorySpec] = []
    images: list[ImageSpec] = []
    next_cat_id = CATEGORY_ID_BASE
    next_img_id = IMAGE_ID_BASE

    def add_category(label: str, parent_id: int | None, sort_order: int) -> int:
        nonlocal next_cat_id
        cat_id = next_cat_id
        next_cat_id += 1
        categories.append(
            CategorySpec(id=cat_id, label=label, parent_id=parent_id, sort_order=sort_order)
        )
        return cat_id

    def add_image(name: str, category_id: int | None, sort_order: int) -> int:
        nonlocal next_img_id
        img_id = next_img_id
        next_img_id += 1
        images.append(
            ImageSpec(id=img_id, name=name, category_id=category_id, sort_order=sort_order)
        )
        return img_id

    # ── Mixed root scope: sibling root categories + uncategorized images ──
    root_scope_ids = [
        add_category(f"{FIXTURE_PREFIX}Root-{i + 1:02d}", None, _duplicated_sort_order(i))
        for i in range(ROOT_MIXED_CATEGORY_COUNT)
    ]
    for i in range(ROOT_UNCATEGORIZED_IMAGE_COUNT):
        add_image(f"{FIXTURE_PREFIX}Uncat-Img-{i + 1:02d}", None, _duplicated_sort_order(i))

    # ── Flat scope: 80 sibling categories under one parent ──
    flat_parent_id = root_scope_ids[0]
    for i in range(FLAT_SIBLING_CATEGORY_COUNT):
        add_category(
            f"{FIXTURE_PREFIX}Flat-Cat-{i + 1:03d}",
            flat_parent_id,
            _duplicated_sort_order(i),
        )

    # ── Gallery scope: 600 sibling images inside one category ──
    gallery_id = root_scope_ids[1]
    for i in range(GALLERY_SIBLING_IMAGE_COUNT):
        add_image(
            f"{FIXTURE_PREFIX}Gallery-Img-{i + 1:03d}",
            gallery_id,
            _duplicated_sort_order(i),
        )

    # ── Nested scope: four levels, with categories and images at each level ──
    nested_parent = root_scope_ids[2]
    for level in range(1, NESTED_LEVELS + 1):
        level_children = [
            add_category(
                f"{FIXTURE_PREFIX}Nested-L{level}-Cat-{i + 1:02d}",
                nested_parent,
                _duplicated_sort_order(i),
            )
            for i in range(NESTED_CHILD_CATEGORY_COUNT)
        ]
        for i in range(NESTED_IMAGE_COUNT):
            add_image(
                f"{FIXTURE_PREFIX}Nested-L{level}-Img-{i + 1:02d}",
                nested_parent,
                # Interleave with the sibling categories' sort_order range.
                _duplicated_sort_order(i) + 1,
            )
        nested_parent = level_children[0]

    return FixtureSpec(categories=categories, images=images)


async def purge_reorder_fixture(session: AsyncSession) -> None:
    """Delete all fixture rows (reserved ID range or ``RF-`` name prefix)."""
    # ``synchronize_session="fetch"`` is pinned explicitly so deleted rows are
    # always expunged from the session identity map — reseeding with the same
    # explicit primary keys in one session must never hit an identity conflict.
    await session.execute(
        delete(Image)
        .where(or_(Image.id >= IMAGE_ID_BASE, Image.name.like(f"{FIXTURE_PREFIX}%")))
        .execution_options(synchronize_session="fetch")
    )
    # ``categories.parent_id`` has ON DELETE CASCADE, so a single bulk delete
    # removes the whole fixture tree regardless of nesting depth.
    await session.execute(
        delete(Category)
        .where(
            or_(
                Category.id >= CATEGORY_ID_BASE,
                Category.label.like(f"{FIXTURE_PREFIX}%"),
            )
        )
        .execution_options(synchronize_session="fetch")
    )
    await session.commit()


async def seed_reorder_fixture(session: AsyncSession) -> FixtureSpec:
    """Idempotently (re-)create the reorder fixture and return its spec."""
    spec = build_fixture_spec()
    await purge_reorder_fixture(session)

    for cat in spec.categories:
        session.add(
            Category(
                id=cat.id,
                label=cat.label,
                parent_id=cat.parent_id,
                sort_order=cat.sort_order,
            )
        )
    # Flush categories first so image FKs resolve.
    await session.flush()
    for img in spec.images:
        session.add(
            Image(
                id=img.id,
                name=img.name,
                thumb=f"/thumbs/reorder-fixture/{img.id}.jpg",
                tile_sources=f"/tiles/reorder-fixture/{img.id}",
                category_id=img.category_id,
                sort_order=img.sort_order,
            )
        )
    await session.commit()
    return spec


def _resolve_database_url() -> str:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise SystemExit("DATABASE_URL is required to load the reorder fixture")
    return url


async def _run_cli(purge_only: bool) -> None:
    engine = create_async_engine(_resolve_database_url())
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_factory() as session:
            if purge_only:
                await purge_reorder_fixture(session)
                print("Reorder fixture purged.")
            else:
                spec = await seed_reorder_fixture(session)
                print(
                    f"Reorder fixture seeded: {len(spec.categories)} categories, "
                    f"{len(spec.images)} images."
                )
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--purge", action="store_true", help="Remove the fixture without reseeding."
    )
    args = parser.parse_args(argv)
    asyncio.run(_run_cli(purge_only=args.purge))


if __name__ == "__main__":  # pragma: no cover
    main()
