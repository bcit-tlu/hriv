"""Real PostgreSQL schema and cascade checks; requires a migrated test DB."""

import os
from uuid import uuid4

import pytest
from sqlalchemy import delete, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.models import (
    Board, BoardInuksuk, BoardSection, Image, Inuksuk, Program, User,
)
from app.routers.users import _delete_sole_owned_inuksuks_and_boards

DB_URL = os.environ.get("TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DB_URL, reason="TEST_DATABASE_URL not set")


@pytest.fixture
async def db():
    engine = create_async_engine(DB_URL)
    async with engine.connect() as connection:
        transaction = await connection.begin()
        async with AsyncSession(bind=connection, expire_on_commit=False) as session:
            yield session
        await transaction.rollback()
    await engine.dispose()


async def test_migrated_schema_and_constraint(db) -> None:
    connection = await db.connection()
    tables = await connection.run_sync(lambda conn: inspect(conn).get_table_names())
    assert set(tables) >= {
        "inuksuks", "inuksuk_owners", "boards", "board_owners",
        "board_programs", "board_groups", "board_sections", "board_inuksuks",
    }
    checks = await connection.run_sync(
        lambda conn: inspect(conn).get_check_constraints("boards")
    )
    assert any(c["name"] == "ck_boards_visibility" for c in checks)
    with pytest.raises(IntegrityError):
        async with db.begin_nested():
            await db.execute(text("INSERT INTO boards (name, visibility) VALUES ('bad', 'invalid')"))


async def test_image_and_section_cascades(db) -> None:
    image = Image(name="inuksuk-test", thumb="", tile_sources="")
    board = Board(name="board-test")
    db.add_all([image, board])
    await db.flush()
    bookmark = Inuksuk(image_id=image.id, title="point", x=0.2, y=0.4, zoom=2)
    section = BoardSection(board_id=board.id, name="section")
    db.add_all([bookmark, section])
    await db.flush()
    db.add(BoardInuksuk(board_id=board.id, inuksuk_id=bookmark.id, section_id=section.id))
    await db.flush()
    await db.execute(delete(BoardSection).where(BoardSection.id == section.id))
    assert await db.scalar(select(BoardInuksuk.section_id)) is None
    assert await db.scalar(select(BoardInuksuk.inuksuk_id)) == bookmark.id
    assert await db.scalar(select(Inuksuk.id)) == bookmark.id
    await db.execute(delete(Image).where(Image.id == image.id))
    assert await db.scalar(select(Inuksuk.id)) is None
    assert await db.scalar(select(BoardInuksuk.inuksuk_id)) is None
    assert await db.scalar(select(Board.id)) == board.id


@pytest.mark.parametrize("bulk", [False, True])
async def test_departing_owners_cleanup(db, bulk) -> None:
    suffix = uuid4().hex
    users = [
        User(name=f"owner-{i}", email=f"{suffix}-{i}@example.test", role="student")
        for i in range(3)
    ]
    program = Program(name=f"program-{suffix}")
    image = Image(name="test", thumb="", tile_sources="")
    db.add_all([*users, program, image])
    await db.flush()
    departing = users[:2] if bulk else users[:1]
    boards = [
        Board(name="sole", owners=departing, created_by_user_id=users[0].id),
        Board(name="co-owned", owners=[*departing, users[2]], created_by_user_id=users[0].id),
        Board(name="program", owners=departing, owner_program_id=program.id, created_by_user_id=users[0].id),
        Board(name="orphan", owners=[]),
    ]
    bookmarks = [
        Inuksuk(image_id=image.id, title="sole", x=0, y=0, zoom=1, owners=departing),
        Inuksuk(image_id=image.id, title="shared", x=0, y=0, zoom=1, owners=[*departing, users[2]]),
    ]
    db.add_all([*boards, *bookmarks])
    await db.flush()
    await _delete_sole_owned_inuksuks_and_boards(db, {u.id for u in departing})
    await db.flush()
    await db.execute(delete(User).where(User.id.in_([u.id for u in departing])))
    await db.flush()
    assert set((await db.scalars(select(Board.name))).all()) == {"co-owned", "program", "orphan"}
    assert (await db.scalars(select(Inuksuk.title))).all() == ["shared"]
    assert await db.scalar(select(Board.created_by_user_id).where(Board.name == "co-owned")) is None
    await db.execute(delete(Program).where(Program.id == program.id))
    assert await db.scalar(select(Board.id).where(Board.name == "program")) is not None
    await db.execute(delete(Board).where(Board.name == "co-owned"))
    assert await db.scalar(select(Inuksuk.title)) == "shared"


async def test_empty_cleanup(db) -> None:
    await _delete_sole_owned_inuksuks_and_boards(db, set())
    await _delete_sole_owned_inuksuks_and_boards(db, {-1})
