"""Tests for the changelog router endpoints."""

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


def _mock_scalars(rows: list[object]) -> MagicMock:
    scalars = MagicMock()
    scalars.all.return_value = rows
    result = MagicMock()
    result.scalars.return_value = scalars
    return result


async def test_list_entries_returns_rows() -> None:
    rows = [
        SimpleNamespace(id=2, title="Two", body="Body", published_at="2026-06-16T00:00:00Z"),
        SimpleNamespace(id=1, title="One", body="Body", published_at="2026-06-15T00:00:00Z"),
    ]
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalars(rows))

    result = await list_entries(db, None)

    assert result == rows


async def test_create_entry_commits_and_refreshes() -> None:
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    result = await create_entry(
        ChangelogEntryCreate(title="New", body="Details"),
        db,
        None,
    )

    db.add.assert_called_once_with(result)
    db.commit.assert_awaited_once()
    db.refresh.assert_awaited_once_with(result)
    assert result.title == "New"
    assert result.body == "Details"


async def test_mark_read_updates_metadata_and_preserves_existing_keys() -> None:
    current_user = SimpleNamespace(metadata_={"theme": "dark"})
    db = AsyncMock()
    db.commit = AsyncMock()

    result = await mark_read(db, current_user)

    db.commit.assert_awaited_once()
    assert current_user.metadata_["theme"] == "dark"
    assert "changelog_last_read_at" in current_user.metadata_
    assert result.changelog_last_read_at == current_user.metadata_["changelog_last_read_at"]


async def test_update_entry_bumps_published_at() -> None:
    original_published_at = datetime(2026, 6, 1, tzinfo=timezone.utc)
    entry = SimpleNamespace(
        id=5,
        title="Old title",
        body="Old body",
        published_at=original_published_at,
    )
    db = AsyncMock()
    db.get = AsyncMock(return_value=entry)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    result = await update_entry(
        5,
        ChangelogEntryUpdate(title="Updated title", body="Updated body"),
        db,
        None,
    )

    assert result is entry
    assert entry.title == "Updated title"
    assert entry.body == "Updated body"
    assert entry.published_at > original_published_at
    db.commit.assert_awaited_once()
    db.refresh.assert_awaited_once_with(entry)


async def test_update_entry_raises_404_when_missing() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc_info:
        await update_entry(404, ChangelogEntryUpdate(title="Missing"), db, None)

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Changelog entry not found"


async def test_delete_entry_commits() -> None:
    entry = SimpleNamespace(id=7)
    db = AsyncMock()
    db.get = AsyncMock(return_value=entry)
    db.delete = AsyncMock()
    db.commit = AsyncMock()

    await delete_entry(7, db, None)

    db.delete.assert_awaited_once_with(entry)
    db.commit.assert_awaited_once()
