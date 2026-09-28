"""Tests for the programs router endpoints.

The program-delete / collection-orphan tests at the bottom need a real
PostgreSQL database (the behaviour under test is FK ``ON DELETE`` actions):
they run when ``REORDER_FIXTURE_DATABASE_URL`` points at a migrated database
(CI does this) and are skipped otherwise.
"""

import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import AppSession
from app.models import Collection, Program, User, collection_programs
from app.routers.programs import (
    list_programs,
    get_program,
    create_program,
    update_program,
    delete_program,
)
from app.schemas import ProgramCreate, ProgramUpdate

DB_URL = os.environ.get("REORDER_FIXTURE_DATABASE_URL", "")

requires_db = pytest.mark.skipif(
    not DB_URL,
    reason="REORDER_FIXTURE_DATABASE_URL not set (needs PostgreSQL)",
)

ORPHAN_TEST_TAG = "program-delete-orphan-test"


@pytest.fixture(autouse=True)
def _patch_browse_bump(monkeypatch):
    """The real browse-state helper expects an AsyncSession; unit mocks do not
    provide the SQLAlchemy result API it calls, so stub it out across the
    router tests.
    """
    monkeypatch.setattr(
        "app.routers.programs.bump_browse_revision",
        AsyncMock(return_value=1),
    )


async def test_list_programs() -> None:
    progs = [SimpleNamespace(id=1, name="Bio"), SimpleNamespace(id=2, name="Chem")]
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = progs

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    result = await list_programs(MagicMock(), db)
    assert len(result) == 2


async def test_get_program_found() -> None:
    prog = SimpleNamespace(id=1, name="Bio")
    db = AsyncMock()
    db.get = AsyncMock(return_value=prog)

    result = await get_program(1, MagicMock(), db)
    assert result.name == "Bio"


async def test_get_program_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await get_program(999, MagicMock(), db)
    assert exc.value.status_code == 404


async def test_create_program_success() -> None:
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = ProgramCreate(name="NewProg")
    await create_program(body, MagicMock(), db)

    db.add.assert_called_once()
    db.commit.assert_awaited_once()


async def test_create_program_duplicate_name() -> None:
    existing = SimpleNamespace(id=1, name="Existing")
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = existing

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    body = ProgramCreate(name="Existing")
    with pytest.raises(HTTPException) as exc:
        await create_program(body, MagicMock(), db)
    assert exc.value.status_code == 409


async def test_update_program_success() -> None:
    prog = SimpleNamespace(id=1, name="OldName")

    mock_dup_result = MagicMock()
    mock_dup_result.scalar_one_or_none.return_value = None

    db = AsyncMock()
    db.get = AsyncMock(return_value=prog)
    db.execute = AsyncMock(return_value=mock_dup_result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = ProgramUpdate(name="NewName")
    await update_program(1, body, MagicMock(), db)

    assert prog.name == "NewName"


async def test_update_program_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    body = ProgramUpdate(name="NewName")
    with pytest.raises(HTTPException) as exc:
        await update_program(999, body, MagicMock(), db)
    assert exc.value.status_code == 404


async def test_update_program_duplicate_name() -> None:
    prog = SimpleNamespace(id=1, name="OldName")
    existing = SimpleNamespace(id=2, name="Taken")

    mock_dup_result = MagicMock()
    mock_dup_result.scalar_one_or_none.return_value = existing

    db = AsyncMock()
    db.get = AsyncMock(return_value=prog)
    db.execute = AsyncMock(return_value=mock_dup_result)

    body = ProgramUpdate(name="Taken")
    with pytest.raises(HTTPException) as exc:
        await update_program(1, body, MagicMock(), db)
    assert exc.value.status_code == 409


async def test_delete_program_success() -> None:
    prog = SimpleNamespace(id=1, name="ToDelete")

    db = AsyncMock()
    db.get = AsyncMock(return_value=prog)
    db.delete = AsyncMock()
    db.commit = AsyncMock()

    await delete_program(1, MagicMock(), db)
    db.delete.assert_awaited_once_with(prog)


async def test_delete_program_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await delete_program(999, MagicMock(), db)
    assert exc.value.status_code == 404


async def test_delete_program_does_not_guard_on_owned_collections() -> None:
    """The route never inspects collections: owned / scoped collections are
    left to the FK actions (``SET NULL`` owner, ``CASCADE`` scope rows)."""
    prog = SimpleNamespace(id=1, name="WithCollections")
    db = AsyncMock()
    db.get = AsyncMock(return_value=prog)

    await delete_program(1, MagicMock(), db)
    db.get.assert_awaited_once_with(Program, 1)
    db.execute.assert_not_awaited()
    db.delete.assert_awaited_once_with(prog)
    db.commit.assert_awaited_once()


# ── program delete → orphaned collections (real PostgreSQL) ────────────


@pytest.fixture
async def db_factory():
    engine = create_async_engine(DB_URL)
    factory = async_sessionmaker(
        engine,
        expire_on_commit=False,
        sync_session_class=AppSession,
    )
    yield factory
    async with factory() as session:
        await session.execute(
            delete(Collection).where(Collection.description == ORPHAN_TEST_TAG)
        )
        await session.execute(
            delete(User).where(User.email.like(f"{ORPHAN_TEST_TAG}%"))
        )
        await session.execute(
            delete(Program).where(Program.name.like(f"{ORPHAN_TEST_TAG}%"))
        )
        await session.commit()
    await engine.dispose()


@requires_db
async def test_delete_program_orphans_owned_collections_and_drops_scope(
    db_factory: async_sessionmaker,
) -> None:
    """Deleting a program through the real route leaves its collections in
    place with ``owner_program_id = NULL`` (FK ``SET NULL``) and removes the
    program's ``collection_programs`` rows (FK ``CASCADE``), so a collection
    restricted only to that program becomes unrestricted on the program
    dimension. Collections owned by users / other programs are untouched."""
    async with db_factory() as session:
        doomed = Program(name=f"{ORPHAN_TEST_TAG}-doomed")
        survivor = Program(name=f"{ORPHAN_TEST_TAG}-survivor")
        owner = User(
            name="Owner",
            email=f"{ORPHAN_TEST_TAG}-owner@example.com",
            role="instructor",
        )
        session.add_all([doomed, survivor, owner])
        await session.flush()
        program_owned = Collection(
            name="program owned",
            description=ORPHAN_TEST_TAG,
            type="sequence",
            visibility="restricted",
            owner_program_id=doomed.id,
            programs=[doomed],
        )
        user_owned = Collection(
            name="user owned, scoped to both",
            description=ORPHAN_TEST_TAG,
            type="sequence",
            visibility="restricted",
            user_id=owner.id,
            programs=[doomed, survivor],
        )
        other_owned = Collection(
            name="other program owned",
            description=ORPHAN_TEST_TAG,
            type="sequence",
            visibility="public",
            owner_program_id=survivor.id,
        )
        session.add_all([program_owned, user_owned, other_owned])
        await session.commit()
        doomed_id, survivor_id, owner_id = doomed.id, survivor.id, owner.id
        ids = (program_owned.id, user_owned.id, other_owned.id)

    async with db_factory() as session:
        await delete_program(doomed_id, MagicMock(), session)
        assert await session.get(Program, doomed_id) is None

    async with db_factory() as session:
        rows = {
            c.id: c
            for c in (
                await session.execute(select(Collection).where(Collection.id.in_(ids)))
            ).scalars()
        }
        assert set(rows) == set(ids), "collections must survive their program"
        orphan, scoped, other = (rows[i] for i in ids)
        assert orphan.owner_program_id is None and orphan.user_id is None
        assert orphan.visibility == "restricted"
        assert scoped.user_id == owner_id and scoped.owner_program_id is None
        assert other.owner_program_id == survivor_id

        scope_rows = (
            await session.execute(
                select(
                    collection_programs.c.collection_id,
                    collection_programs.c.program_id,
                ).where(collection_programs.c.collection_id.in_(ids))
            )
        ).all()
        assert sorted(tuple(r) for r in scope_rows) == [(scoped.id, survivor_id)]
