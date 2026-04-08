"""Tests for the announcement router endpoints."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.routers.announcement import get_announcement, update_announcement
from app.schemas import AnnouncementUpdate


async def test_get_announcement_existing() -> None:
    ann = SimpleNamespace(id=1, message="Hello", enabled=True,
                          created_at="2025-01-01T00:00:00Z",
                          updated_at="2025-01-01T00:00:00Z")
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = ann

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    result = await get_announcement(db)
    assert result is ann


async def test_get_announcement_creates_default() -> None:
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)
    db.add = MagicMock()
    db.commit = AsyncMock()

    created_ann = SimpleNamespace(id=1, message="", enabled=False,
                                  created_at="2025-01-01T00:00:00Z",
                                  updated_at="2025-01-01T00:00:00Z")

    async def mock_refresh(obj):
        pass

    db.refresh = AsyncMock(side_effect=mock_refresh)

    result = await get_announcement(db)
    db.add.assert_called_once()
    db.commit.assert_awaited_once()


async def test_update_announcement_existing() -> None:
    ann = SimpleNamespace(id=1, message="Old", enabled=False,
                          created_at="2025-01-01T00:00:00Z",
                          updated_at="2025-01-01T00:00:00Z")
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = ann

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = AnnouncementUpdate(message="New message", enabled=True)
    result = await update_announcement(body, db, None)

    assert ann.message == "New message"
    assert ann.enabled is True
    db.commit.assert_awaited_once()


async def test_update_announcement_creates_when_missing() -> None:
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    body = AnnouncementUpdate(message="Created", enabled=True)
    result = await update_announcement(body, db, None)

    db.add.assert_called_once()
    db.flush.assert_awaited_once()


async def test_update_announcement_partial_update() -> None:
    ann = SimpleNamespace(id=1, message="Keep this", enabled=False,
                          created_at="2025-01-01T00:00:00Z",
                          updated_at="2025-01-01T00:00:00Z")
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = ann

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    # Only update enabled, not message
    body = AnnouncementUpdate(enabled=True)
    result = await update_announcement(body, db, None)

    assert ann.message == "Keep this"
    assert ann.enabled is True
