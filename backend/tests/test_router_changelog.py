"""Tests for the legacy changelog shim (``/api/changelog``).

Since ``0042_announcements`` release notes are ``kind='release'``
announcements; the shim keeps the ``ChangelogEntry`` response shape.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.routers.changelog import (
    create_entry,
    delete_entry,
    list_entries,
    mark_read,
    update_entry,
)
from app.schemas import ChangelogEntryCreate, ChangelogEntryUpdate

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _mock_scalars(rows: list[object]) -> MagicMock:
    scalars = MagicMock()
    scalars.all.return_value = rows
    result = MagicMock()
    result.scalars.return_value = scalars
    return result


def _release(**overrides) -> SimpleNamespace:
    base = dict(
        id=4,
        title="Release 1",
        message="Body text",
        kind="release",
        audience="staff",
        publish_at=NOW,
        expires_at=None,
        notified_at=NOW,
        created_at=NOW,
        updated_at=NOW,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


async def test_list_entries_returns_legacy_shape() -> None:
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalars([_release(), _release(id=5, title=None)]))

    result = await list_entries(db, None)

    assert [(e.id, e.title, e.body) for e in result] == [
        (4, "Release 1", "Body text"),
        (5, "", "Body text"),
    ]
    assert result[0].published_at == NOW


async def test_list_entries_excludes_drafts_in_query() -> None:
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalars([]))

    assert await list_entries(db, None) == []

    stmt = db.execute.call_args.args[0]
    sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    assert "announcements.kind = 'release'" in sql
    assert "announcements.audience = 'staff'" in sql  # targeted releases stay private
    assert "announcements.publish_at IS NOT NULL" in sql
    assert "announcements.publish_at <=" in sql  # scheduled releases hidden until live
    assert "expires_at" not in sql.split("WHERE", 1)[1]  # expired releases stay listed/editable


def _refresh_like_db(ann) -> None:
    """Stand in for the DB populating server defaults on refresh."""
    ann.id = ann.id or 42
    ann.created_at = ann.created_at or NOW
    ann.updated_at = ann.updated_at or NOW


async def test_create_entry_writes_release_announcement() -> None:
    db = AsyncMock()
    db.add = MagicMock()
    db.refresh = AsyncMock(side_effect=_refresh_like_db)
    author = SimpleNamespace(id=9)

    result = await create_entry(ChangelogEntryCreate(title="New", body="Details"), db, author)

    db.add.assert_called_once()
    created = db.add.call_args.args[0]
    assert created.kind == "release"
    assert created.audience == "staff"
    assert created.author_id == 9
    assert created.title == "New"
    assert created.message == "Details"
    assert created.publish_at is not None
    assert created.notified_at == created.publish_at
    db.commit.assert_awaited_once()
    db.refresh.assert_awaited_once_with(created)
    assert result.title == "New"
    assert result.body == "Details"


async def test_mark_read_records_seen_state_and_preserves_existing_keys() -> None:
    current_user = SimpleNamespace(metadata_={"theme": "dark", "announcement_seen": {"1": "x"}})
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalars([_release(id=4), _release(id=5)]))

    result = await mark_read(db, current_user)

    assert current_user.metadata_["theme"] == "dark"
    assert current_user.metadata_["announcement_seen"] == {
        "1": "x",
        "4": NOW.isoformat(),
        "5": NOW.isoformat(),
    }
    # Legacy watermark still written for the deployed NotificationMenu (#1838 drops it).
    assert current_user.metadata_["changelog_last_read_at"] == result.changelog_last_read_at
    db.commit.assert_awaited_once()


async def test_update_entry_bumps_notified_at() -> None:
    ann = _release()
    result_mock = MagicMock()
    result_mock.scalar_one_or_none.return_value = ann
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result_mock)

    result = await update_entry(4, ChangelogEntryUpdate(title="Updated"), db, None)

    assert ann.title == "Updated"
    assert ann.message == "Body text"
    assert ann.publish_at > NOW
    assert ann.notified_at == ann.publish_at
    assert result.title == "Updated"
    db.commit.assert_awaited_once()


async def test_update_entry_raises_404_when_missing() -> None:
    result_mock = MagicMock()
    result_mock.scalar_one_or_none.return_value = None
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result_mock)

    with pytest.raises(HTTPException) as exc:
        await update_entry(99, ChangelogEntryUpdate(title="x"), db, None)
    assert exc.value.status_code == 404


async def test_delete_entry_commits() -> None:
    ann = _release()
    result_mock = MagicMock()
    result_mock.scalar_one_or_none.return_value = ann
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result_mock)

    assert await delete_entry(4, db, None) is None

    db.delete.assert_awaited_once_with(ann)
    db.commit.assert_awaited_once()
