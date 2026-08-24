"""Unit tests for the browse-state revision helper (issue #1066)."""

import os

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.browse_state import BROWSE_STATE_ID, bump_browse_revision, get_browse_revision
from app.models import BrowseState

DB_URL = os.environ.get("REORDER_FIXTURE_DATABASE_URL", "")

requires_db = pytest.mark.skipif(
    not DB_URL,
    reason="REORDER_FIXTURE_DATABASE_URL not set (needs a migrated PostgreSQL database)",
)


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


@requires_db
async def test_get_browse_revision_returns_zero_when_row_missing(db_session):
    """A missing singleton row is interpreted as revision 0."""
    await db_session.execute(delete(BrowseState).where(BrowseState.id == BROWSE_STATE_ID))
    await db_session.commit()

    assert await get_browse_revision(db_session) == 0


@requires_db
async def test_bump_browse_revision_creates_singleton_row(db_session):
    """The first bump inserts the singleton row with revision 1."""
    await db_session.execute(delete(BrowseState).where(BrowseState.id == BROWSE_STATE_ID))
    await db_session.commit()

    assert await bump_browse_revision(db_session) == 1
    await db_session.commit()

    result = await db_session.execute(
        select(BrowseState.revision).where(BrowseState.id == BROWSE_STATE_ID)
    )
    assert result.scalar_one() == 1


@requires_db
async def test_bump_browse_revision_increments_monotonically(db_session):
    """Repeated bumps increase the singleton revision by one each time."""
    await db_session.execute(delete(BrowseState).where(BrowseState.id == BROWSE_STATE_ID))
    await db_session.commit()

    revisions = [await bump_browse_revision(db_session) for _ in range(5)]
    await db_session.commit()

    assert revisions == [1, 2, 3, 4, 5]
    assert await get_browse_revision(db_session) == 5
