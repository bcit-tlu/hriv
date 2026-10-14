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
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException, Response
from sqlalchemy import delete, event, select, update
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.models import (
    BrowseState,
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
    bulk_delete_collections,
    bulk_update_collections,
    create_collection,
    delete_collection,
    list_collections,
    move_collection,
    replace_collection_images,
    replace_collection_owners,
    replace_collection_viewport,
    transfer_collection,
    update_collection,
)
from app.routers.images import delete_image, update_image
from app.routers.tile_order import get_tile_order
from app.routers.users import delete_user
from app.schemas import (
    CollectionBulkDelete,
    CollectionBulkUpdate,
    CollectionCreate,
    CollectionImagesUpdate,
    CollectionMove,
    CollectionOwnersUpdate,
    CollectionTransfer,
    CollectionUpdate,
    CollectionViewportUpdate,
    ImageUpdate,
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


async def _new_user(session: AsyncSession, role: str, suffix: str) -> int:
    user = User(
        name=f"{TEST_PREFIX}{role}-{suffix}-{uuid4().hex[:8]}",
        email=f"{TEST_PREFIX}{role}-{suffix}-{uuid4().hex[:8]}@example.test",
        role=role,
    )
    session.add(user)
    await session.commit()
    return user.id


async def _new_student(session: AsyncSession, suffix: str) -> int:
    user = User(
        name=f"{TEST_PREFIX}student-{suffix}-{uuid4().hex[:8]}",
        email=f"{TEST_PREFIX}student-{suffix}-{uuid4().hex[:8]}@example.test",
        role="student",
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
    co_owner_ids: list[int] | None = None,
    visibility: str = "private",
) -> int:
    collection = Collection(
        name=f"{TEST_PREFIX}coll-{uuid4().hex[:8]}",
        type=type_,
        visibility=visibility,
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
        collection_owners.insert(),
        [
            {"collection_id": collection.id, "user_id": user_id}
            for user_id in [owner_id, *(co_owner_ids or [])]
        ],
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


async def _new_program_owned_collection(
    session: AsyncSession,
    type_: str,
    *,
    creator_id: int,
    program_id: int,
) -> int:
    collection = Collection(
        name=f"{TEST_PREFIX}program-coll-{uuid4().hex[:8]}",
        type=type_,
        visibility="private",
        user_id=creator_id,
        owner_program_id=program_id,
        viewport_state={},
        version=1,
    )
    session.add(collection)
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


@pytest.mark.parametrize("collection_type", ("sequence", "synchronized"))
async def test_student_collection_count_cap_and_other_type(
    session_factory, collection_type: str
) -> None:
    async with session_factory() as session:
        student_id = await _new_user(session, "student", "count")
        for index in range(9):
            await _new_collection(session, collection_type, [], owner_id=student_id)
        student = await _get_user(session, student_id)
        tenth = await create_collection(
            CollectionCreate(name=f"{TEST_PREFIX}tenth", type=collection_type),
            student,
            session,
        )
        assert tenth.type == collection_type

        with pytest.raises(HTTPException) as exc:
            await create_collection(
                CollectionCreate(name=f"{TEST_PREFIX}eleventh", type=collection_type),
                student,
                session,
            )
        assert exc.value.status_code == 422
        assert exc.value.detail == (
            f"Students may own at most 10 {collection_type} collections"
        )

        other_collection_type = (
            "synchronized" if collection_type == "sequence" else "sequence"
        )
        other_collection = await create_collection(
            CollectionCreate(
                name=f"{TEST_PREFIX}{other_collection_type}", type=other_collection_type
            ),
            student,
            session,
        )
        assert other_collection.type == other_collection_type


async def test_student_collection_count_uses_user_owners_not_creator(
    session_factory,
) -> None:
    async with session_factory() as session:
        student_id = await _new_user(session, "student", "ownership")
        admin_id = await _new_admin(session, "co-owner")
        for index in range(9):
            await _new_collection(
                session, "sequence", [], owner_id=student_id
            )
        await _new_collection(
            session,
            "sequence",
            [],
            owner_id=admin_id,
            co_owner_ids=[student_id],
        )
        student = await _get_user(session, student_id)
        with pytest.raises(HTTPException) as exc:
            await create_collection(
                CollectionCreate(name=f"{TEST_PREFIX}co-owned-cap", type="sequence"),
                student,
                session,
            )
        assert exc.value.status_code == 422
        assert exc.value.detail == "Students may own at most 10 sequence collections"

    async with session_factory() as session:
        student_id = await _new_user(session, "student", "program-only")
        program_id = await _new_program(session, "program-only")
        for _ in range(10):
            await _new_program_owned_collection(
                session,
                "sequence",
                creator_id=student_id,
                program_id=program_id,
            )
        student = await _get_user(session, student_id)
        created = await create_collection(
            CollectionCreate(name=f"{TEST_PREFIX}program-not-counted", type="sequence"),
            student,
            session,
        )
        assert created.type == "sequence"


async def test_instructor_collection_count_is_not_capped(session_factory) -> None:
    async with session_factory() as session:
        instructor_id = await _new_user(session, "instructor", "count")
        category_id = await _new_category(session, "instructor-count")
        for _ in range(10):
            await _new_collection(
                session, "sequence", [], owner_id=instructor_id
            )
        instructor = await _get_user(session, instructor_id)
        created = await create_collection(
            CollectionCreate(
                name=f"{TEST_PREFIX}instructor-eleventh",
                type="sequence",
                category_id=category_id,
            ),
            instructor,
            session,
        )
        assert created.type == "sequence"


async def test_student_sequence_create_rejects_twenty_one_images(session_factory) -> None:
    async with session_factory() as session:
        student_id = await _new_user(session, "student", "create-images")
        student = await _get_user(session, student_id)
        with pytest.raises(HTTPException) as exc:
            await create_collection(
                CollectionCreate(
                    name=f"{TEST_PREFIX}long-sequence",
                    type="sequence",
                    image_ids=list(range(1, 22)),
                ),
                student,
                session,
            )
        assert exc.value.status_code == 422
        assert exc.value.detail == (
            "Students may add at most 20 images to a sequence collection"
        )


async def test_student_sequence_add_and_over_cap_edits(session_factory) -> None:
    async with session_factory() as session:
        student_id = await _new_user(session, "student", "put-images")
        instructor_id = await _new_user(session, "instructor", "put-images")
        image_ids = [
            await _new_image(session, f"cap-{index}") for index in range(1, 24)
        ]
        collection_id = await _new_collection(
            session,
            "sequence",
            [],
            owner_id=student_id,
            co_owner_ids=[instructor_id],
        )
        instructor = await _get_user(session, instructor_id)
        seeded = await replace_collection_images(
            collection_id,
            CollectionImagesUpdate(image_ids=image_ids[:22], version=1),
            instructor,
            session,
        )
        assert seeded.version == 2 and seeded.image_count == 22

        student = await _get_user(session, student_id)
        with pytest.raises(HTTPException) as exc:
            await replace_collection_images(
                collection_id,
                CollectionImagesUpdate(
                    image_ids=[*image_ids[2:22], image_ids[22]],
                    version=2,
                ),
                student,
                session,
            )
        assert exc.value.status_code == 422
        assert exc.value.detail == (
            "Students may add at most 20 images to a sequence collection"
        )

        reordered = await replace_collection_images(
            collection_id,
            CollectionImagesUpdate(image_ids=list(reversed(image_ids[:20])), version=2),
            student,
            session,
        )
        assert reordered.version == 3 and reordered.image_count == 20
        assert [image.id for image in reordered.images] == list(
            reversed(image_ids[:20])
        )


async def test_student_sequence_retained_unseen_images_count_toward_cap(
    session_factory,
) -> None:
    async with session_factory() as session:
        student_id = await _new_user(session, "student", "retained")
        visible_ids = [
            await _new_image(session, f"visible-{index}") for index in range(18)
        ]
        hidden_ids = [
            await _new_image(session, f"hidden-{index}") for index in range(2)
        ]
        new_id = await _new_image(session, "new")
        collection_id = await _new_collection(
            session,
            "sequence",
            [*visible_ids, *hidden_ids],
            owner_id=student_id,
        )
        await session.execute(
            update(Image)
            .where(Image.id.in_(hidden_ids))
            .values(active=False)
        )
        await session.commit()
        student = await _get_user(session, student_id)

        with pytest.raises(HTTPException) as exc:
            await replace_collection_images(
                collection_id,
                CollectionImagesUpdate(
                    image_ids=[*visible_ids, new_id],
                    version=1,
                ),
                student,
                session,
            )
        assert exc.value.status_code == 422
        assert exc.value.detail == (
            "Students may add at most 20 images to a sequence collection"
        )


async def test_student_synchronized_image_cap_remains_four(session_factory) -> None:
    async with session_factory() as session:
        student_id = await _new_user(session, "student", "sync-cap")
        image_ids = [
            await _new_image(session, f"sync-{index}") for index in range(5)
        ]
        collection_id = await _new_collection(
            session,
            "synchronized",
            image_ids[:4],
            owner_id=student_id,
        )
        student = await _get_user(session, student_id)
        with pytest.raises(HTTPException) as exc:
            await replace_collection_images(
                collection_id,
                CollectionImagesUpdate(image_ids=image_ids, version=1),
                student,
                session,
            )
        assert exc.value.status_code == 422
        assert "at most 4" in exc.value.detail


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


async def test_create_collection_files_category_and_invalidates_browse(session_factory) -> None:
    async with session_factory() as session:
        admin_id = await _new_admin(session, "create-filed")
        category_id = await _new_category(session, "create-filed")
        admin = await _get_user(session, admin_id)
        root_before = (
            await session.execute(
                select(TileOrderRevision.revision).where(TileOrderRevision.scope_key == 0)
            )
        ).scalar_one_or_none()
        category_before = (
            await session.execute(
                select(TileOrderRevision.revision).where(
                    TileOrderRevision.scope_key == category_id
                )
            )
        ).scalar_one_or_none()
        browse_before = (
            await session.execute(
                select(BrowseState.revision).where(BrowseState.id == 1)
            )
        ).scalar_one_or_none() or 0

        out = await create_collection(
            CollectionCreate(name=f"{TEST_PREFIX}filed", type="sequence", category_id=category_id),
            admin,
            session,
        )
        assert out.category_id == category_id
        category_after = (
            await session.execute(
                select(TileOrderRevision.revision).where(
                    TileOrderRevision.scope_key == category_id
                )
            )
        ).scalar_one()
        root_after = (
            await session.execute(
                select(TileOrderRevision.revision).where(TileOrderRevision.scope_key == 0)
            )
        ).scalar_one_or_none()
        browse_after = (
            await session.execute(
                select(BrowseState.revision).where(BrowseState.id == 1)
            )
        ).scalar_one()
        assert category_after > (category_before or 0)
        assert root_after == root_before
        assert browse_after == browse_before + 1


async def test_create_unfiled_student_bumps_browse_not_scopes(session_factory) -> None:
    """An unfiled create bumps no tile-order scope but still advances the
    browse revision — the new collection is a row in ``GET /api/collections``
    (#1619)."""
    async with session_factory() as session:
        student = User(
            name=f"{TEST_PREFIX}student-create-{uuid4().hex[:8]}",
            email=f"{TEST_PREFIX}student-create-{uuid4().hex[:8]}@example.test",
            role="student",
        )
        session.add(student)
        await session.flush()
        student_id = student.id
        await session.commit()
        student = await _get_user(session, student_id)
        await session.refresh(student, attribute_names=["programs", "groups"])
        root_before = (
            await session.execute(
                select(TileOrderRevision.revision).where(TileOrderRevision.scope_key == 0)
            )
        ).scalar_one_or_none()
        browse_before = (
            await session.execute(
                select(BrowseState.revision).where(BrowseState.id == 1)
            )
        ).scalar_one_or_none()

        out = await create_collection(
            CollectionCreate(name=f"{TEST_PREFIX}unfiled", type="sequence"),
            student,
            session,
        )
        assert out.category_id is None
        assert (
            await session.execute(
                select(TileOrderRevision.revision).where(TileOrderRevision.scope_key == 0)
            )
        ).scalar_one_or_none() == root_before
        browse_after = (
            await session.execute(
                select(BrowseState.revision).where(BrowseState.id == 1)
            )
        ).scalar_one()
        assert browse_after == (browse_before or 0) + 1


async def test_list_limit_orders_and_truncates(session_factory) -> None:
    async with session_factory() as session:
        student_id = await _new_student(session, "limit-order")
        collection_ids = [
            await _new_collection(session, "sequence", [], owner_id=student_id)
            for _ in range(6)
        ]
        newest = datetime.now(timezone.utc)
        for age, collection_id in enumerate(collection_ids):
            await session.execute(
                update(Collection)
                .where(Collection.id == collection_id)
                .values(updated_at=newest + timedelta(minutes=age))
            )
        await session.commit()

        student = await _get_user(session, student_id)
        rows = await list_collections(student, mine=True, limit=3, db=session)
        assert [row.id for row in rows] == list(reversed(collection_ids[-3:]))


async def test_list_limit_applies_after_student_visibility_filter(
    session_factory,
) -> None:
    async with session_factory() as session:
        student_id = await _new_student(session, "limit-visible")
        hidden_category_id = await _new_category(session, "limit-hidden")
        await session.execute(
            update(Category)
            .where(Category.id == hidden_category_id)
            .values(status="hidden")
        )
        hidden_collection_id = await _new_collection(
            session, "sequence", [], owner_id=student_id
        )
        await session.execute(
            update(Collection)
            .where(Collection.id == hidden_collection_id)
            .values(category_id=hidden_category_id)
        )
        visible_ids = [
            await _new_collection(session, "sequence", [], owner_id=student_id)
            for _ in range(5)
        ]
        await session.commit()

        student = await _get_user(session, student_id)
        rows = await list_collections(student, mine=True, limit=5, db=session)
        assert len(rows) == 5
        assert {row.id for row in rows} == set(visible_ids)
        assert hidden_collection_id not in {row.id for row in rows}


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


async def test_image_ids_in_collections_real_pg(session_factory) -> None:
    """The member-image invalidation helper (#1619): members of any
    collection — filed or unfiled — count (their thumb/count render on the
    collection's list row); non-members do not."""
    from app.collection_views import image_ids_in_collections

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

        found = await image_ids_in_collections(
            session, {img_filed, img_unfiled, img_orphan}
        )
        assert found == {img_filed, img_unfiled}
        # Empty input short-circuits without a query.
        assert await image_ids_in_collections(session, set()) == set()


# ---------------------------------------------------------------------------
# GET /api/collections — search / sort / paging (#1631)
# ---------------------------------------------------------------------------


async def test_list_paging_counts_only_visible_collections(session_factory) -> None:
    """A student paging through interleaved non-visible private collections
    gets exactly ``page_size`` visible rows per page, and ``X-Total-Count``
    counts only the visible set."""
    async with session_factory() as session:
        student_id = await _new_student(session, "paging")
        admin_id = await _new_admin(session, "paging")
        visible_ids = []
        # Interleave the student's own private collections (visible) with
        # admin-owned private collections (invisible to the student).
        for index in range(7):
            collection_id = await _new_collection(
                session,
                "sequence",
                [],
                owner_id=student_id if index % 2 == 0 else admin_id,
            )
            if index % 2 == 0:
                visible_ids.append(collection_id)
        student = await _get_user(session, student_id)

        # ``q`` scopes the listing to this test's rows (seeded collections
        # share the database).
        response = Response()
        page1 = await list_collections(
            student,
            q=f"{TEST_PREFIX}coll-",
            page_size=2,
            page=1,
            response=response,
            db=session,
        )
        assert len(page1) == 2
        assert response.headers["X-Total-Count"] == str(len(visible_ids))
        page2 = await list_collections(
            student,
            q=f"{TEST_PREFIX}coll-",
            page_size=2,
            page=2,
            response=Response(),
            db=session,
        )
        assert len(page2) == 2
        page3 = await list_collections(
            student,
            q=f"{TEST_PREFIX}coll-",
            page_size=2,
            page=3,
            response=Response(),
            db=session,
        )
        assert page3 == []
        assert {c.id for c in [*page1, *page2]} == set(visible_ids)


async def test_list_paged_rows_carry_hydrated_member_data(session_factory) -> None:
    """Two-phase load: the first query noloads ``image_links``, so a paged
    row only has correct ``image_count`` / ``cover_thumb`` if the hydrate
    select populated them (a MissingGreenlet here means hydration broke)."""
    async with session_factory() as session:
        admin_id = await _new_admin(session, "hydrate")
        image_a = await _new_image(session, "ha")
        image_b = await _new_image(session, "hb")
        collection_id = await _new_collection(
            session, "sequence", [image_a, image_b], owner_id=admin_id
        )
        await session.execute(
            update(Image).where(Image.id == image_a).values(thumb="/thumbs/ha.jpg")
        )
        await session.commit()
        admin = await _get_user(session, admin_id)

        response = Response()
        rows = await list_collections(
            admin,
            q=f"{TEST_PREFIX}coll-",
            page_size=1,
            page=1,
            response=response,
            db=session,
        )
        assert [c.id for c in rows] == [collection_id]
        assert response.headers["X-Total-Count"] == "1"
        assert rows[0].image_count == 2
        assert rows[0].cover_thumb is not None
        assert "/thumbs/ha.jpg" in rows[0].cover_thumb


async def test_list_image_count_sort_counts_student_visible_members(
    session_factory,
) -> None:
    """``sort=image_count`` uses the grouped count query; for a student it
    excludes members in a hidden (excluded) category — matching
    ``ctx.visible_images``."""
    async with session_factory() as session:
        student_id = await _new_student(session, "counts")
        admin_id = await _new_admin(session, "counts")
        hidden_cat = Category(
            label=f"{TEST_PREFIX}hidden-cat", status="hidden"
        )
        session.add(hidden_cat)
        await session.flush()
        visible_a = await _new_image(session, "ca")
        visible_b = await _new_image(session, "cb")
        hidden_a = Image(
            name=f"{TEST_PREFIX}hidden-a",
            thumb="",
            tile_sources="",
            category_id=hidden_cat.id,
        )
        hidden_b = Image(
            name=f"{TEST_PREFIX}hidden-b",
            thumb="",
            tile_sources="",
            category_id=hidden_cat.id,
        )
        session.add_all([hidden_a, hidden_b])
        await session.flush()
        # three visible to admin, one to the student
        sparse_id = await _new_collection(
            session,
            "sequence",
            [visible_a, hidden_a.id, hidden_b.id],
            owner_id=admin_id,
            visibility="public",
        )
        # two visible to both
        dense_id = await _new_collection(
            session,
            "sequence",
            [visible_a, visible_b],
            owner_id=admin_id,
            visibility="public",
        )
        await session.commit()

        student = await _get_user(session, student_id)
        student_rows = await list_collections(
            student,
            q=f"{TEST_PREFIX}coll-",
            sort="image_count",
            db=session,
        )
        assert [c.id for c in student_rows] == [dense_id, sparse_id]
        assert [c.image_count for c in student_rows] == [2, 1]

        admin = await _get_user(session, admin_id)
        admin_rows = await list_collections(
            admin,
            q=f"{TEST_PREFIX}coll-",
            sort="image_count",
            db=session,
        )
        assert [c.id for c in admin_rows] == [sparse_id, dense_id]
        assert [c.image_count for c in admin_rows] == [3, 2]


async def test_list_q_percent_is_literal(session_factory) -> None:
    """``%`` in ``q`` is a literal substring, not a LIKE wildcard."""
    async with session_factory() as session:
        admin_id = await _new_admin(session, "q-pct")
        collection_id = await _new_collection(
            session, "sequence", [], owner_id=admin_id
        )
        await session.execute(
            update(Collection)
            .where(Collection.id == collection_id)
            .values(name=f"{TEST_PREFIX}100% off")
        )
        await session.commit()
        admin = await _get_user(session, admin_id)

        rows = await list_collections(admin, q="%", db=session)
        assert collection_id in [c.id for c in rows]
        assert all("%" in c.name for c in rows)


# ---------------------------------------------------------------------------
# GET /api/collections — ETag / revision (#1619)
# ---------------------------------------------------------------------------


async def _list_etag(session: AsyncSession, user: User, **kwargs) -> str:
    """Run the list endpoint and return its ``ETag`` header."""
    response = Response()
    await list_collections(user, response=response, db=session, **kwargs)
    etag = response.headers.get("ETag")
    assert etag is not None
    return etag


async def test_list_etag_is_stable_across_identical_calls(session_factory) -> None:
    async with session_factory() as session:
        admin_id = await _new_admin(session, "etag-stable")
        admin = await _get_user(session, admin_id)
        etag1 = await _list_etag(session, admin)
        etag2 = await _list_etag(session, admin)
        assert etag1 == etag2
        assert etag1.startswith('W/"collections-')
        # A different query fragment hashes to a different tag.
        assert await _list_etag(session, admin, mine=True) != etag1


async def test_list_etag_changes_after_each_collection_mutation(
    session_factory,
) -> None:
    """Every list-visible write bumps the browse revision, so the ETag must
    change after each mutation — including on unfiled collections (#1619)."""
    async with session_factory() as session:
        admin_id = await _new_admin(session, "etag-seq")
        other_admin_id = await _new_admin(session, "etag-seq2")
        category_id = await _new_category(session, "etag-seq")
        program_id = await _new_program(session, "etag-seq")
        image_id = await _new_image(session, "etag-seq")
        admin = await _get_user(session, admin_id)

        seen: list[str] = []

        async def next_etag() -> str:
            etag = await _list_etag(session, admin)
            assert etag not in seen
            seen.append(etag)
            return etag

        await next_etag()
        # create (filed)
        created = await create_collection(
            CollectionCreate(
                name=f"{TEST_PREFIX}etag", type="sequence",
                category_id=category_id,
            ),
            admin,
            session,
        )
        collection_id = created.id
        await next_etag()
        # PATCH
        await update_collection(
            collection_id,
            CollectionUpdate(name=f"{TEST_PREFIX}etag-renamed", version=1),
            admin,
            session,
        )
        await next_etag()
        # PUT images
        await replace_collection_images(
            collection_id,
            CollectionImagesUpdate(image_ids=[image_id], version=2),
            admin,
            session,
        )
        await next_etag()
        # PUT viewport
        await replace_collection_viewport(
            collection_id,
            CollectionViewportUpdate(
                viewport_state={"1": {"zoom": 2.0}}, version=3
            ),
            admin,
            session,
        )
        await next_etag()
        # POST move (file → a different category needs a second category;
        # move to root/unfiled)
        await move_collection(
            collection_id,
            CollectionMove(category_id=None, version=4),
            admin,
            session,
        )
        await next_etag()
        # PUT owners
        await replace_collection_owners(
            collection_id,
            CollectionOwnersUpdate(
                user_ids=[admin_id, other_admin_id], version=5
            ),
            admin,
            session,
        )
        await next_etag()
        # POST transfer (to program)
        await transfer_collection(
            collection_id,
            CollectionTransfer(program_id=program_id, version=6),
            admin,
            session,
        )
        await next_etag()
        # bulk PATCH (hidden)
        await bulk_update_collections(
            CollectionBulkUpdate(
                collection_ids=[collection_id], hidden=True
            ),
            admin,
            session,
        )
        await next_etag()
        # bulk DELETE a separate collection (helper insert — no endpoint
        # mutation, so no bump of its own)
        second_id = await _new_collection(
            session, "sequence", [], owner_id=admin_id
        )
        await session.commit()
        await bulk_delete_collections(
            CollectionBulkDelete(collection_ids=[second_id]),
            admin,
            session,
        )
        await next_etag()
        # DELETE
        await delete_collection(collection_id, admin, session)
        await next_etag()


async def test_list_etag_unfiled_collection_member_image_writes_bump(
    session_factory,
) -> None:
    """Deactivating or deleting an uncategorized image that is a member of
    an *unfiled* collection changes the list row (cover/count) — the ETag
    must advance (#1619)."""
    async with session_factory() as session:
        admin_id = await _new_admin(session, "etag-member")
        admin = await _get_user(session, admin_id)
        img_a = await _new_image(session, "member-a")
        img_b = await _new_image(session, "member-b")
        await session.commit()
        await _new_collection(
            session, "sequence", [img_a, img_b], owner_id=admin_id
        )

        before = await _list_etag(session, admin)
        request = MagicMock()
        request.headers = {}
        await update_image(
            img_a, ImageUpdate(active=False), request, admin, session
        )
        after_deactivate = await _list_etag(session, admin)
        assert after_deactivate != before

        await delete_image(img_b, admin, db=session)
        after_delete = await _list_etag(session, admin)
        assert after_delete != after_deactivate


async def test_list_etag_delete_sole_owner_of_unfiled_collection_bumps(
    session_factory,
) -> None:
    """Deleting a user whose sole-owned collection is unfiled removes a
    list row — the ETag must advance even though no tile was affected
    (#1619)."""
    async with session_factory() as session:
        admin_id = await _new_admin(session, "etag-user")
        owner_id = await _new_user(session, "student", "etag-owner")
        admin = await _get_user(session, admin_id)
        await _new_collection(
            session, "sequence", [], owner_id=owner_id
        )

        before = await _list_etag(session, admin)
        await delete_user(owner_id, admin, session)
        after = await _list_etag(session, admin)
        assert after != before
