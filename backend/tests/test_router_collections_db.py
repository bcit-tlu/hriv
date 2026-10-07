"""PostgreSQL-backed persistence tests for the collections write API (#1437).

Unlike ``test_router_collections.py`` (mocked sessions), these run the route
functions against a real database so persistence behaviour — ``sort_order``
rewrites, join-table scope, the optimistic-concurrency CAS, wholesale JSONB
replacement, and delete-during-write — is verified end to end.

Gated on ``TEST_DATABASE_URL`` pointing at a migrated PostgreSQL database
(CI provisions one; locally: ``docker compose up -d db migrate`` then
``TEST_DATABASE_URL=postgresql+asyncpg://hriv:hriv@localhost:5432/hriv
poetry run pytest tests/test_router_collections_db.py``). Each test seeds
rows under the ``TEST_PREFIX`` name prefix and the fixture cleans them up,
so the module shares the database with the reorder-fixture tests safely.
"""

import os
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, event, select, update
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.models import (
    Category,
    Collection,
    CollectionImage,
    Group,
    Image,
    Program,
    TileOrderRevision,
    User,
    collection_groups,
    collection_owners,
    collection_programs,
)
from app.routers.categories import delete_category
from app.routers.collections import (
    delete_collection,
    list_collections,
    move_collection,
    replace_collection_images,
    replace_collection_viewport,
    update_collection,
)
from app.routers.tile_order import get_tile_order
from app.schemas import (
    CollectionImagesUpdate,
    CollectionMove,
    CollectionUpdate,
    CollectionViewportUpdate,
)

DB_URL = os.environ.get("TEST_DATABASE_URL", "")
TEST_PREFIX = "dbtest-"

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TEST_DATABASE_URL not set (needs a migrated PostgreSQL database)",
)


@pytest.fixture
async def session_factory():
    engine = create_async_engine(DB_URL)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        yield factory
    finally:
        async with factory() as session:
            for model in (Collection, User, Image, Program, Group):
                await session.execute(
                    delete(model).where(model.name.like(f"{TEST_PREFIX}%"))
                )
            await session.execute(
                delete(Category).where(Category.label.like(f"{TEST_PREFIX}%"))
            )
            await session.commit()
        await engine.dispose()


async def _new_admin(session: AsyncSession, suffix: str) -> int:
    """Insert an admin user and return its id.

    Route calls re-load the user per session so the selectin-loaded
    ``programs``/``groups`` relationships are populated like a real request.
    """
    user = User(
        name=f"{TEST_PREFIX}admin-{suffix}-{uuid4().hex[:8]}",
        email=f"{TEST_PREFIX}{suffix}-{uuid4().hex[:8]}@example.test",
        role="admin",
    )
    session.add(user)
    await session.commit()
    return user.id


async def _get_user(session: AsyncSession, user_id: int) -> User:
    """Load a user with selectin relationships populated."""
    user = await session.get(User, user_id)
    assert user is not None
    return user


async def _new_image(session: AsyncSession, suffix: str) -> int:
    image = Image(
        name=f"{TEST_PREFIX}img-{suffix}-{uuid4().hex[:8]}",
        thumb="",
        tile_sources="",
    )
    session.add(image)
    await session.flush()
    return image.id


async def _new_collection(
    session: AsyncSession,
    type_: str,
    image_ids: list[int],
    *,
    owner_id: int,
) -> int:
    collection = Collection(
        name=f"{TEST_PREFIX}coll-{uuid4().hex[:8]}",
        type=type_,
        visibility="private",
        # Creator audit column (#1531); authority flows from ``owners``.
        user_id=owner_id,
        viewport_state={},
        version=1,
    )
    session.add(collection)
    await session.flush()
    # Direct junction insert: assigning ``collection.owners`` would lazy-load
    # the empty set first and hit MissingGreenlet under async.
    await session.execute(
        collection_owners.insert().values(
            collection_id=collection.id, user_id=owner_id
        )
    )
    for position, image_id in enumerate(image_ids):
        session.add(
            CollectionImage(
                collection_id=collection.id,
                image_id=image_id,
                sort_order=position,
            )
        )
    await session.commit()
    return collection.id


async def _new_program(session: AsyncSession, suffix: str) -> int:
    program = Program(name=f"{TEST_PREFIX}prog-{suffix}-{uuid4().hex[:8]}")
    session.add(program)
    await session.commit()
    return program.id


async def _new_group(session: AsyncSession, suffix: str) -> int:
    group = Group(name=f"{TEST_PREFIX}grp-{suffix}-{uuid4().hex[:8]}")
    session.add(group)
    await session.commit()
    return group.id


async def _link_pairs(
    session: AsyncSession, collection_id: int
) -> list[tuple[int, int]]:
    rows = (
        await session.execute(
            select(CollectionImage)
            .where(CollectionImage.collection_id == collection_id)
            .order_by(CollectionImage.sort_order)
        )
    ).scalars().all()
    return [(row.image_id, row.sort_order) for row in rows]


# ---------------------------------------------------------------------------
# PUT /api/collections/{id}/images
# ---------------------------------------------------------------------------


async def test_replace_images_persists_order_reuses_links(session_factory) -> None:
    """Reordering reuses the composite-PK link rows (a delete-then-insert
    would collide mid-flush); sort_order is rewritten to 0..n-1 and dropped
    memberships are deleted.

    Membership and order alone cannot distinguish row reuse from
    delete-then-reinsert (the composite PK is identical either way), so the
    write statements are captured at the engine: reuse emits UPDATEs on
    ``sort_order`` and a single DELETE for the dropped image — no INSERTs.
    """
    async with session_factory() as session:
        admin_id = await _new_admin(session, "reorder")
        a = await _new_image(session, "ra")
        b = await _new_image(session, "rb")
        c = await _new_image(session, "rc")
        collection_id = await _new_collection(
            session, "sequence", [a, b, c], owner_id=admin_id
        )
        await session.commit()

    # The write runs in a fresh session, like a real request.
    async with session_factory() as session:
        admin = await _get_user(session, admin_id)
        engine = session.sync_session.get_bind()
        captured: list[tuple[str, object, bool]] = []

        def _capture(conn, cursor, statement, parameters, context, executemany):
            captured.append((statement, parameters, executemany))

        event.listen(engine, "before_cursor_execute", _capture)
        try:
            await replace_collection_images(
                collection_id,
                CollectionImagesUpdate(image_ids=[c, a], version=1),
                admin,
                session,
            )
        finally:
            event.remove(engine, "before_cursor_execute", _capture)

        def _rows(verb: str) -> int:
            return sum(
                len(parameters) if executemany else 1
                for statement, parameters, executemany in captured
                if statement.lstrip().upper().startswith(verb)
                and "collection_images" in statement
            )

        assert _rows("INSERT") == 0
        assert _rows("UPDATE") == 2  # retained c, a re-ordered
        assert _rows("DELETE") == 1  # dropped b

    async with session_factory() as check:
        assert await _link_pairs(check, collection_id) == [(c, 0), (a, 1)]
        collection = await check.get(Collection, collection_id)
        assert collection is not None and collection.version == 2


async def test_replace_images_rejects_version_mismatch_without_writes(
    session_factory,
) -> None:
    """A stale ``version`` short-circuits before membership changes land."""
    async with session_factory() as session:
        admin_id = await _new_admin(session, "stale")
        a = await _new_image(session, "sa")
        b = await _new_image(session, "sb")
        collection_id = await _new_collection(session, "sequence", [a], owner_id=admin_id)

    async with session_factory() as session:
        admin = await _get_user(session, admin_id)
        with pytest.raises(HTTPException) as exc:
            await replace_collection_images(
                collection_id,
                CollectionImagesUpdate(image_ids=[b], version=999),
                admin,
                session,
            )
        assert exc.value.status_code == 409

    async with session_factory() as check:
        assert await _link_pairs(check, collection_id) == [(a, 0)]
        collection = await check.get(Collection, collection_id)
        assert collection is not None and collection.version == 1


# ---------------------------------------------------------------------------
# PATCH /api/collections/{id}
# ---------------------------------------------------------------------------


async def test_update_persists_and_clears_restricted_scope(session_factory) -> None:
    """Restricted scope lands in collection_programs/collection_groups, and
    leaving restricted clears both join tables."""
    async with session_factory() as session:
        admin_id = await _new_admin(session, "scope")
        program_id = await _new_program(session, "scope")
        group_id = await _new_group(session, "scope")
        collection_id = await _new_collection(session, "sequence", [], owner_id=admin_id)

    async with session_factory() as session:
        admin = await _get_user(session, admin_id)
        out = await update_collection(
            collection_id,
            CollectionUpdate(
                visibility="restricted",
                program_ids=[program_id],
                group_ids=[group_id],
                version=1,
            ),
            admin,
            session,
        )
        assert out.version == 2

    async with session_factory() as check:
        prog_rows = (
            await check.execute(
                select(collection_programs).where(
                    collection_programs.c.collection_id == collection_id
                )
            )
        ).all()
        group_rows = (
            await check.execute(
                select(collection_groups).where(
                    collection_groups.c.collection_id == collection_id
                )
            )
        ).all()
        assert [(r.collection_id, r.program_id) for r in prog_rows] == [
            (collection_id, program_id)
        ]
        assert [(r.collection_id, r.group_id) for r in group_rows] == [
            (collection_id, group_id)
        ]

    async with session_factory() as session:
        admin = await _get_user(session, admin_id)
        await update_collection(
            collection_id,
            CollectionUpdate(visibility="public", version=2),
            admin,
            session,
        )

    async with session_factory() as check:
        for join in (collection_programs, collection_groups):
            rows = (
                await check.execute(
                    select(join).where(join.c.collection_id == collection_id)
                )
            ).all()
            assert rows == []


async def test_update_persists_hidden_flag(session_factory) -> None:
    """``hidden`` round-trips through a real session (#1559)."""
    async with session_factory() as session:
        admin_id = await _new_admin(session, "hid")
        collection_id = await _new_collection(session, "sequence", [], owner_id=admin_id)

    async with session_factory() as session:
        admin = await _get_user(session, admin_id)
        out = await update_collection(
            collection_id,
            CollectionUpdate(hidden=True, version=1),
            admin,
            session,
        )
        assert out.hidden is True

    async with session_factory() as check:
        row = await check.get(Collection, collection_id)
        assert row is not None and row.hidden is True


# ---------------------------------------------------------------------------
# Optimistic concurrency across separate sessions
# ---------------------------------------------------------------------------


async def test_second_writer_gets_409_with_current_state(session_factory) -> None:
    """Two clients load version 1; the first write bumps it and the second
    write is 409 with the current CollectionOut as detail. The row's version
    ends at exactly 2."""
    async with session_factory() as session:
        admin_id = await _new_admin(session, "occ")
        image_id = await _new_image(session, "occ")
        collection_id = await _new_collection(
            session, "sequence", [image_id], owner_id=admin_id
        )

    # Both clients load the collection at version 1 in separate sessions.
    async with session_factory() as s1, session_factory() as s2:
        admin1 = await _get_user(s1, admin_id)
        admin2 = await _get_user(s2, admin_id)
        assert (await s1.get(Collection, collection_id)).version == 1
        assert (await s2.get(Collection, collection_id)).version == 1

        await replace_collection_viewport(
            collection_id,
            CollectionViewportUpdate(
                viewport_state={"1": {"zoom": 1.5}}, version=1
            ),
            admin1,
            s1,
        )

        with pytest.raises(HTTPException) as exc:
            await replace_collection_viewport(
                collection_id,
                CollectionViewportUpdate(
                    viewport_state={"1": {"zoom": 2.0}}, version=1
                ),
                admin2,
                s2,
            )

    assert exc.value.status_code == 409
    detail = exc.value.detail
    assert detail["id"] == collection_id
    assert detail["version"] == 2
    assert detail["viewport_state"] == {"1": {"zoom": 1.5}}

    async with session_factory() as check:
        collection = await check.get(Collection, collection_id)
        assert collection is not None and collection.version == 2


# ---------------------------------------------------------------------------
# PUT /api/collections/{id}/viewport
# ---------------------------------------------------------------------------


async def test_viewport_state_replaced_wholesale(session_factory) -> None:
    """The JSONB column is overwritten, not merged key-by-key."""
    async with session_factory() as session:
        admin_id = await _new_admin(session, "viewport")
        collection_id = await _new_collection(session, "synchronized", [], owner_id=admin_id)
        collection = await session.get(Collection, collection_id)
        assert collection is not None
        collection.viewport_state = {"1": {"zoom": 1.0}, "2": {"zoom": 0.5}}
        await session.commit()

    async with session_factory() as session:
        admin = await _get_user(session, admin_id)
        await replace_collection_viewport(
            collection_id,
            CollectionViewportUpdate(
                viewport_state={"2": {"zoom": 0.9, "x": 10}}, version=1
            ),
            admin,
            session,
        )

    async with session_factory() as check:
        collection = await check.get(Collection, collection_id)
        assert collection is not None
        assert collection.viewport_state == {"2": {"zoom": 0.9, "x": 10}}
        assert collection.version == 2


# ---------------------------------------------------------------------------
# Delete during a write → 404
# ---------------------------------------------------------------------------


async def test_write_after_concurrent_delete_returns_404(session_factory) -> None:
    """When the row is deleted between load and write, the CAS misses and
    ``db.refresh`` failure surfaces as 404 — not an unhandled error."""
    async with session_factory() as session:
        admin_id = await _new_admin(session, "delete")
        collection_id = await _new_collection(session, "sequence", [], owner_id=admin_id)

    async with session_factory() as s1, session_factory() as s2:
        admin1 = await _get_user(s1, admin_id)
        admin2 = await _get_user(s2, admin_id)
        # Client 1 loads the collection at version 1.
        assert (await s1.get(Collection, collection_id)) is not None

        # Client 2 deletes it.
        await delete_collection(collection_id, admin2, s2)

        # Client 1's write hits the refresh-after-missed-CAS path.
        with pytest.raises(HTTPException) as exc:
            await replace_collection_viewport(
                collection_id,
                CollectionViewportUpdate(viewport_state={}, version=1),
                admin1,
                s1,
            )
        assert exc.value.status_code == 404

    async with session_factory() as check:
        assert await check.get(Collection, collection_id) is None


# ── Browse placement (move / category delete, #1527) ──────


async def _new_category(
    session: AsyncSession, suffix: str, parent_id: int | None = None
) -> int:
    cat = Category(
        label=f"{TEST_PREFIX}cat-{suffix}-{uuid4().hex[:8]}",
        parent_id=parent_id,
    )
    session.add(cat)
    await session.commit()
    return cat.id


async def test_move_collection_persists_category_and_bumps_version(
    session_factory,
) -> None:
    async with session_factory() as session:
        admin_id = await _new_admin(session, "move")
        category_id = await _new_category(session, "dst")
        collection_id = await _new_collection(
            session, "sequence", [], owner_id=admin_id
        )
        admin = await _get_user(session, admin_id)

        out = await move_collection(
            collection_id,
            CollectionMove(category_id=category_id, version=1),
            admin,
            session,
        )
        assert out.category_id == category_id and out.version == 2

    async with session_factory() as check:
        row = await check.get(Collection, collection_id)
        assert row is not None and row.category_id == category_id


async def test_move_collection_to_root_via_null(session_factory) -> None:
    async with session_factory() as session:
        admin_id = await _new_admin(session, "root")
        category_id = await _new_category(session, "src")
        collection_id = await _new_collection(
            session, "sequence", [], owner_id=admin_id
        )
        root_before = await session.scalar(
            select(TileOrderRevision.revision).where(
                TileOrderRevision.scope_key == 0
            )
        )
        source_before = await session.scalar(
            select(TileOrderRevision.revision).where(
                TileOrderRevision.scope_key == category_id
            )
        )
        await session.execute(
            update(Collection)
            .where(Collection.id == collection_id)
            .values(category_id=category_id)
        )
        await session.commit()
        admin = await _get_user(session, admin_id)

        out = await move_collection(
            collection_id, CollectionMove(category_id=None, version=1), admin, session
        )
        assert out.category_id is None
        root_after = await session.scalar(
            select(TileOrderRevision.revision).where(
                TileOrderRevision.scope_key == 0
            )
        )
        source_after = await session.scalar(
            select(TileOrderRevision.revision).where(
                TileOrderRevision.scope_key == category_id
            )
        )
        assert root_after == root_before
        assert source_after == (source_before or 1) + 1

    async with session_factory() as check:
        row = await check.get(Collection, collection_id)
        assert row is not None and row.category_id is None


async def test_move_collection_stale_version_is_409(session_factory) -> None:
    async with session_factory() as session:
        admin_id = await _new_admin(session, "occ")
        category_id = await _new_category(session, "dst")
        collection_id = await _new_collection(
            session, "sequence", [], owner_id=admin_id
        )
        admin = await _get_user(session, admin_id)
        with pytest.raises(HTTPException) as exc:
            await move_collection(
                collection_id,
                CollectionMove(category_id=category_id, version=999),
                admin,
                session,
            )
        assert exc.value.status_code == 409
        await session.rollback()
        assert (
            await session.get(Collection, collection_id)
        ).category_id is None


async def test_move_collection_unknown_category_is_422(session_factory) -> None:
    async with session_factory() as session:
        admin_id = await _new_admin(session, "bad")
        collection_id = await _new_collection(
            session, "sequence", [], owner_id=admin_id
        )
        admin = await _get_user(session, admin_id)
        with pytest.raises(HTTPException) as exc:
            await move_collection(
                collection_id,
                CollectionMove(category_id=999_999, version=1),
                admin,
                session,
            )
        assert exc.value.status_code == 422


async def test_delete_category_unfiles_collection_via_set_null(
    session_factory, monkeypatch
) -> None:
    """Deleting a category unfiles collections: they leave Browse but remain
    available from the uncategorized queue."""
    from app.database import settings

    monkeypatch.setattr(settings, "collections_enabled", True)
    async with session_factory() as session:
        admin_id = await _new_admin(session, "cas")
        category_id = await _new_category(session, "victim")
        collection_id = await _new_collection(
            session, "sequence", [], owner_id=admin_id
        )
        await session.execute(
            update(Collection)
            .where(Collection.id == collection_id)
            .values(category_id=category_id)
        )
        await session.commit()
        admin = await _get_user(session, admin_id)

        await delete_category(category_id, admin, db=session)

        row = await session.get(Collection, collection_id)
        assert row is not None and row.category_id is None
        root = await get_tile_order(admin, None, session)
        assert ("collection", collection_id) not in [
            (item.type, item.id) for item in root.items
        ]
        queued = await list_collections(admin, db=session, uncategorized=True)
        assert collection_id in [item.id for item in queued]


async def test_image_ids_in_filed_collections_real_pg(session_factory) -> None:
    """The member-image invalidation helper: only members of *filed*
    collections count — uncategorized-collection members and non-members do
    not force a browse bump."""
    from app.collection_views import image_ids_in_filed_collections

    async with session_factory() as session:
        admin_id = await _new_admin(session, "filed")
        category_id = await _new_category(session, "filed")
        img_filed = await _new_image(session, "filed")
        img_unfiled = await _new_image(session, "unfiled")
        img_orphan = await _new_image(session, "orphan")
        await session.commit()

        filed_id = await _new_collection(
            session, "sequence", [img_filed], owner_id=admin_id
        )
        await session.execute(
            update(Collection)
            .where(Collection.id == filed_id)
            .values(category_id=category_id)
        )
        await _new_collection(
            session, "sequence", [img_unfiled], owner_id=admin_id
        )
        await session.commit()

        found = await image_ids_in_filed_collections(
            session, {img_filed, img_unfiled, img_orphan}
        )
        assert found == {img_filed}
        # Empty input short-circuits without a query.
        assert await image_ids_in_filed_collections(session, set()) == set()
