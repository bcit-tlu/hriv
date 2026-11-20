"""PostgreSQL regression test for the atomic seen-marker merge (#1832).

``mark_seen_atomic`` is raw SQL; the router tests mock the session, so only a
real asyncpg round trip catches driver-level failures such as the untyped
jsonb key bind that made ``PUT /api/announcements/{id}/seen`` return 500.

Run with ``REORDER_FIXTURE_DATABASE_URL`` pointing at a migrated database;
skipped otherwise (CI provides one).
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import announcements as rules
from app.database import AppSession
from app.models import Announcement, User

DB_URL = os.environ.get("REORDER_FIXTURE_DATABASE_URL", "")

requires_db = pytest.mark.skipif(
    not DB_URL,
    reason="REORDER_FIXTURE_DATABASE_URL not set (needs PostgreSQL)",
)


@requires_db
async def test_mark_seen_atomic_round_trips_through_asyncpg() -> None:
    engine = create_async_engine(DB_URL)
    factory = async_sessionmaker(engine, expire_on_commit=False, sync_session_class=AppSession)
    tag = uuid.uuid4().hex[:8]
    notified = datetime(2026, 11, 11, 3, 0, tzinfo=timezone.utc)
    try:
        async with factory() as session:
            user = User(
                email=f"seen-{tag}@example.test",
                name=f"Seen {tag}",
                role="student",
                metadata_={"keep": "me"},
            )
            ann = Announcement(
                title=f"seen-{tag}",
                message="m",
                kind="notice",
                audience="everyone",
                publish_at=notified,
                notified_at=notified,
            )
            session.add_all([user, ann])
            await session.commit()

            assert not rules.has_seen(user, ann)
            markers = await rules.mark_seen_atomic(session, user, [ann])
            await session.commit()

            assert markers == {str(ann.id): notified.isoformat()}
            assert rules.has_seen(user, ann)
            assert user.metadata_["keep"] == "me"  # other metadata keys untouched

            # Idempotent, and a second call merges rather than overwrites.
            await rules.mark_seen_atomic(session, user, [ann])
            await session.commit()
            fresh = (await session.execute(select(User).where(User.id == user.id))).scalar_one()
            assert rules.seen_map(fresh) == {str(ann.id): notified.isoformat()}
    finally:
        async with factory() as session:
            await session.execute(delete(Announcement).where(Announcement.title == f"seen-{tag}"))
            await session.execute(delete(User).where(User.email == f"seen-{tag}@example.test"))
            await session.commit()
        await engine.dispose()
