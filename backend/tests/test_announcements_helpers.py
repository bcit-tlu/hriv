"""Tests for ``app.announcements`` (live window + seen-state helpers)."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.announcements import (
    SEEN_METADATA_KEY,
    has_seen,
    is_live,
    live_clause,
    mark_seen,
    seen_map,
)

NOW = datetime(2026, 1, 1, 12, tzinfo=timezone.utc)
HOUR = timedelta(hours=1)


def _ann(**overrides) -> SimpleNamespace:
    base = dict(id=1, publish_at=NOW - HOUR, expires_at=None, notified_at=NOW - HOUR)
    base.update(overrides)
    return SimpleNamespace(**base)


def test_is_live_draft_scheduled_live_expired() -> None:
    assert is_live(_ann(publish_at=None), NOW) is False
    assert is_live(_ann(publish_at=NOW + HOUR), NOW) is False
    assert is_live(_ann(), NOW) is True
    assert is_live(_ann(expires_at=NOW + HOUR), NOW) is True
    assert is_live(_ann(expires_at=NOW - HOUR), NOW) is False


def test_live_clause_compiles_against_announcements() -> None:
    sql = str(live_clause(NOW).compile(compile_kwargs={"literal_binds": True}))
    assert "announcements.publish_at IS NOT NULL" in sql
    assert "announcements.expires_at IS NULL" in sql


def test_seen_map_tolerates_missing_or_malformed_metadata() -> None:
    assert seen_map(SimpleNamespace(metadata_=None)) == {}
    assert seen_map(SimpleNamespace(metadata_={SEEN_METADATA_KEY: "junk"})) == {}
    assert seen_map(SimpleNamespace(metadata_={SEEN_METADATA_KEY: {"1": "x"}})) == {"1": "x"}


def test_has_seen_compares_against_notified_at_version() -> None:
    marker = (NOW - HOUR).isoformat()
    user = SimpleNamespace(metadata_={SEEN_METADATA_KEY: {"1": marker}})
    assert has_seen(user, _ann()) is True
    # Re-notified after the user saw it → unseen again.
    assert has_seen(user, _ann(notified_at=NOW)) is False
    assert has_seen(user, _ann(id=2)) is False
    assert has_seen(user, _ann(notified_at=None)) is True


def test_mark_seen_merges_without_clobbering_other_keys() -> None:
    user = SimpleNamespace(metadata_={"theme": "dark", SEEN_METADATA_KEY: {"9": "old"}})

    seen = mark_seen(user, [_ann(id=1, notified_at=NOW), _ann(id=2, notified_at=None)])

    assert user.metadata_["theme"] == "dark"
    assert seen["9"] == "old"
    assert seen["1"] == NOW.isoformat()
    assert seen["2"] == (NOW - HOUR).isoformat()  # falls back to publish_at
    assert user.metadata_[SEEN_METADATA_KEY] is not None


def test_mark_seen_handles_empty_metadata() -> None:
    user = SimpleNamespace(metadata_=None)
    mark_seen(user, [_ann(id=3)])
    assert user.metadata_ == {SEEN_METADATA_KEY: {"3": (NOW - HOUR).isoformat()}}
