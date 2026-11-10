"""Tests for the legacy announcement shim (``/api/announcement``).

Since ``0042_announcements`` the endpoint maps onto the newest broadcast
banner announcement (``audience='everyone'`` ∧ ``banner=true``).
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.routers.announcement import get_announcement, update_announcement
from app.schemas import LegacyAnnouncementUpdate

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _db(first: object | None) -> AsyncMock:
    result = MagicMock()
    result.scalars.return_value.first.return_value = first
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)
    db.add = MagicMock()
    return db


def _ann(**overrides) -> SimpleNamespace:
    base = dict(
        id=7,
        message="Hello",
        kind="notice",
        audience="everyone",
        banner=True,
        publish_at=NOW,
        expires_at=None,
        notified_at=NOW,
        created_at=NOW,
        updated_at=NOW,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


async def test_get_announcement_live_banner_is_enabled() -> None:
    result = await get_announcement(_db(_ann()))
    assert result.id == 7
    assert result.message == "Hello"
    assert result.enabled is True


async def test_get_announcement_draft_is_disabled() -> None:
    result = await get_announcement(_db(_ann(publish_at=None, notified_at=None)))
    assert result.enabled is False
    assert result.message == "Hello"


async def test_get_announcement_expired_is_disabled() -> None:
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    result = await get_announcement(_db(_ann(expires_at=past)))
    assert result.enabled is False


async def test_get_announcement_without_banner_returns_empty_without_writing() -> None:
    db = _db(None)
    result = await get_announcement(db)
    assert result.message == ""
    assert result.enabled is False
    db.add.assert_not_called()
    db.commit.assert_not_awaited()


async def test_update_announcement_enables_draft() -> None:
    ann = _ann(publish_at=None, notified_at=None)
    db = _db(ann)
    editor = SimpleNamespace(id=3)

    result = await update_announcement(
        LegacyAnnouncementUpdate(message="New message", enabled=True), db, editor
    )

    assert ann.message == "New message"
    assert ann.publish_at is not None
    assert ann.notified_at == ann.publish_at
    assert ann.expires_at is None
    assert result.enabled is True
    db.commit.assert_awaited_once()
    db.add.assert_not_called()


async def test_update_announcement_disabling_makes_draft() -> None:
    ann = _ann()
    db = _db(ann)

    result = await update_announcement(LegacyAnnouncementUpdate(enabled=False), db, SimpleNamespace(id=3))

    assert ann.publish_at is None
    assert ann.notified_at is None
    assert ann.message == "Hello"
    assert result.enabled is False


async def test_update_announcement_enabling_live_row_keeps_publish_at() -> None:
    ann = _ann()
    db = _db(ann)

    await update_announcement(LegacyAnnouncementUpdate(enabled=True), db, SimpleNamespace(id=3))

    assert ann.publish_at == NOW
    assert ann.notified_at == NOW


def _refresh_like_db(ann) -> None:
    """Stand in for the DB populating server defaults on refresh."""
    ann.id = ann.id or 42
    ann.created_at = ann.created_at or NOW
    ann.updated_at = ann.updated_at or NOW


async def test_update_announcement_creates_broadcast_banner_when_missing() -> None:
    db = _db(None)
    db.refresh = AsyncMock(side_effect=_refresh_like_db)
    editor = SimpleNamespace(id=3)

    await update_announcement(LegacyAnnouncementUpdate(message="Hi", enabled=True), db, editor)

    db.add.assert_called_once()
    created = db.add.call_args.args[0]
    assert created.audience == "everyone"
    assert created.banner is True
    assert created.kind == "notice"
    assert created.author_id == 3
    assert created.message == "Hi"
    assert created.publish_at is not None
    db.flush.assert_awaited_once()
    db.commit.assert_awaited_once()


async def test_update_announcement_partial_update() -> None:
    ann = _ann(message="Keep this")
    db = _db(ann)

    await update_announcement(LegacyAnnouncementUpdate(), db, SimpleNamespace(id=3))

    assert ann.message == "Keep this"
    assert ann.publish_at == NOW
