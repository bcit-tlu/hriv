"""Upgrade/downgrade preserve Board membership, not the shelved grouping."""

import importlib
import os
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")
async def test_remove_grouping_preserves_board_order_and_nullable_downgrade() -> None:
    migration = importlib.import_module("app.migrations.versions.0048_remove_board_sections")
    engine = create_async_engine(os.environ["TEST_DATABASE_URL"])
    async with engine.connect() as connection:
        transaction = await connection.begin()
        schema = f"board_migration_{uuid4().hex}"
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        await connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
        await connection.execute(text("CREATE TABLE boards (id integer PRIMARY KEY)"))
        await connection.execute(text("CREATE TABLE board_inuksuks (board_id integer, inuksuk_id integer, sort_order integer NOT NULL, PRIMARY KEY (board_id,inuksuk_id))"))

        def run(sync, operation):
            with Operations.context(MigrationContext.configure(sync)):
                operation()

        await connection.run_sync(run, migration.downgrade)
        await connection.execute(text("INSERT INTO boards VALUES (1)"))
        await connection.execute(text("INSERT INTO board_sections (id,board_id,name) VALUES (10,1,'Old')"))
        await connection.execute(text("INSERT INTO board_inuksuks VALUES (1,7,4,10),(1,8,9,NULL)"))
        await connection.run_sync(run, migration.upgrade)
        assert "board_sections" not in await connection.run_sync(lambda c: inspect(c).get_table_names(schema=schema))
        assert (await connection.execute(text("SELECT * FROM board_inuksuks ORDER BY sort_order"))).all() == [(1,7,4),(1,8,9)]
        await connection.run_sync(run, migration.downgrade)
        assert (await connection.execute(text("SELECT count(*) FROM board_sections"))).scalar_one() == 0
        assert (await connection.execute(text("SELECT section_id FROM board_inuksuks"))).scalars().all() == [None, None]
        await connection.run_sync(run, migration.upgrade)
        await transaction.rollback()
    await engine.dispose()
