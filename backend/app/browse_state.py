"""Browse-state helper: a single monotonic revision used to short-circuit tree reads."""

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from .models import BrowseState

BROWSE_STATE_ID = 1


async def get_browse_revision(db: AsyncSession) -> int:
    """Return the current browse revision, or ``0`` if the singleton row is missing."""
    result = await db.execute(
        select(BrowseState.revision).where(BrowseState.id == BROWSE_STATE_ID)
    )
    revision = result.scalar_one_or_none()
    return revision if revision is not None else 0


async def bump_browse_revision(db: AsyncSession) -> int:
    """Increment the singleton browse revision and return the new value."""
    stmt = (
        pg_insert(BrowseState)
        .values(id=BROWSE_STATE_ID, revision=1, updated_at=func.now())
        .on_conflict_do_update(
            index_elements=["id"],
            set_={
                "revision": BrowseState.revision + 1,
                "updated_at": func.now(),
            },
        )
        .returning(BrowseState.revision)
    )
    result = await db.execute(stmt)
    return result.scalar_one()
