"""Shared announcement helpers (epic #1832).

Kept router-agnostic so the legacy ``/api/announcement`` and ``/api/changelog``
shims (removed by #1838) and the new ``/api/announcements`` router (#1834) use
one definition of *live* and one way of recording seen-state.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable

from sqlalchemy import ColumnElement, and_, or_

from .models import Announcement, User

SEEN_METADATA_KEY = "announcement_seen"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def is_live(ann: Announcement, now: datetime | None = None) -> bool:
    """Published, and not yet expired."""
    now = now or utcnow()
    if ann.publish_at is None or ann.publish_at > now:
        return False
    return ann.expires_at is None or ann.expires_at > now


def live_clause(now: datetime | None = None) -> ColumnElement[bool]:
    """SQL predicate equivalent of :func:`is_live`."""
    now = now or utcnow()
    return and_(
        Announcement.publish_at.is_not(None),
        Announcement.publish_at <= now,
        or_(Announcement.expires_at.is_(None), Announcement.expires_at > now),
    )


def seen_map(user: User) -> dict[str, str]:
    meta = user.metadata_ or {}
    seen = meta.get(SEEN_METADATA_KEY)
    return dict(seen) if isinstance(seen, dict) else {}


def has_seen(user: User, ann: Announcement) -> bool:
    """True when the user has seen the announcement's current version.

    The version marker is ``notified_at``: re-notifying bumps it, which makes
    the row unseen again for everyone.
    """
    marker = seen_map(user).get(str(ann.id))
    if marker is None or ann.notified_at is None:
        return marker is not None
    return marker >= ann.notified_at.isoformat()


def mark_seen(user: User, announcements: Iterable[Announcement]) -> dict[str, str]:
    """Merge seen markers into ``user.metadata_`` without touching other keys.

    Returns the updated seen map.  Callers commit.
    """
    meta = dict(user.metadata_ or {})
    seen = dict(meta.get(SEEN_METADATA_KEY) or {})
    for ann in announcements:
        marker = ann.notified_at or ann.publish_at or utcnow()
        seen[str(ann.id)] = marker.isoformat()
    meta[SEEN_METADATA_KEY] = seen
    user.metadata_ = meta
    return seen
