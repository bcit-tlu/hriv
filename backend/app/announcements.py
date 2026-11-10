"""Shared announcement helpers (epic #1832).

Kept router-agnostic so the legacy ``/api/announcement`` and ``/api/changelog``
shims (removed by #1838) and the new ``/api/announcements`` router (#1834) use
one definition of *live* and one way of recording seen-state.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, and_, or_, text
from sqlalchemy.ext.asyncio import AsyncSession

from .authz import can_attach_program_to_category, can_manage_group
from .database import settings
from .models import ANNOUNCEMENT_STAFF_ROLES, Announcement, Group, Program, User

SEEN_METADATA_KEY = "announcement_seen"


def announcements_feature_gate() -> None:
    """FastAPI dependency: 404 every epic-#1832 route while ``ANNOUNCEMENTS_ENABLED`` is off."""
    if not settings.announcements_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")


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


async def mark_seen_atomic(
    db: AsyncSession, user: User, announcements: Iterable[Announcement]
) -> dict[str, str]:
    """Merge seen markers in SQL (``jsonb ||``) so concurrent requests for
    different announcements cannot overwrite each other's marker.

    The ORM instance is *refreshed* from the row rather than assigned, so the
    commit does not issue a second, wholesale ``metadata`` UPDATE from a stale
    snapshot. Callers commit. Returns the markers written by this call."""
    import json

    markers = {
        str(ann.id): (ann.notified_at or ann.publish_at or utcnow()).isoformat()
        for ann in announcements
    }
    if markers:
        await db.execute(
            text(
                "UPDATE users SET metadata = COALESCE(metadata, '{}'::jsonb) "
                "|| jsonb_build_object(:key, "
                "   COALESCE(metadata->:key, '{}'::jsonb) || CAST(:markers AS jsonb)) "
                "WHERE id = :user_id"
            ),
            {"key": SEEN_METADATA_KEY, "markers": json.dumps(markers), "user_id": user.id},
        )
        await db.refresh(user, attribute_names=["metadata_"])
    return markers


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


# ── Domain rules shared by the /api/announcements router (#1834) ───────────

#: kind → (Material icon name, MUI severity). The author picks the icon; the
#: icon *is* the kind and the kind fixes the severity (no warning icon on an
#: event banner). Emoji are reactions only.
KIND_META: dict[str, tuple[str, str]] = {
    "notice": ("Campaign", "info"),
    "event": ("Event", "info"),
    "reminder": ("NotificationsActive", "info"),
    "celebration": ("Celebration", "success"),
    "release": ("RocketLaunch", "info"),
    "warning": ("WarningAmber", "warning"),
}
ADMIN_ONLY_KINDS: frozenset[str] = frozenset({"release", "warning"})
ADMIN_ONLY_AUDIENCES: frozenset[str] = frozenset({"everyone", "staff"})
REACTION_EMOJI: tuple[str, ...] = (
    "+1", "heart", "laugh", "confused", "hooray", "rocket", "eyes", "clap",
)
SITE_AUTHOR_NAME = "Site"
_MEDIA_REF_RE = re.compile(r"/api/media/(\d+)")


def is_staff_role(role: str) -> bool:
    return role in ANNOUNCEMENT_STAFF_ROLES


def status_of(ann: Announcement, now: datetime | None = None) -> str:
    now = now or utcnow()
    if ann.publish_at is None:
        return "draft"
    if ann.publish_at > now:
        return "scheduled"
    if ann.expires_at is not None and ann.expires_at <= now:
        return "expired"
    return "live"


def co_manages_group(user: User, group: Group) -> bool:
    """Instructor co-ownership (not admin authority) — used for *visibility*."""
    return user.role == "instructor" and any(i.id == user.id for i in group.instructors)


def can_view(user: User, ann: Announcement) -> bool:
    """Audience rule for readers, independent of the live window.

    everyone ∪ (staff ∧ role ∈ admin/instructor/staff) ∪ authored-by-caller ∪
    (targeted ∧ (program member ∨ group member ∨ instructor co-owner)).

    Deliberately a UNION — unlike category visibility, which is the dual gate
    (programs AND groups). A targeted announcement reaches anyone matched by
    *any* of its programs or groups.
    """
    if ann.author_id is not None and ann.author_id == user.id:
        return True
    if ann.audience == "everyone":
        return True
    if ann.audience == "staff":
        return is_staff_role(user.role)
    program_ids = {p.id for p in user.programs}
    if any(p.id in program_ids for p in ann.programs):
        return True
    group_ids = {g.id for g in user.groups}
    return any(g.id in group_ids or co_manages_group(user, g) for g in ann.groups)


def can_edit(user: User, ann: Announcement) -> bool:
    return user.role == "admin" or (ann.author_id is not None and ann.author_id == user.id)


def in_mine_scope(user: User, ann: Announcement) -> bool:
    """Admin: everything. Instructor: own posts + posts targeted at co-managed groups."""
    if user.role == "admin":
        return True
    if ann.author_id == user.id:
        return True
    return any(co_manages_group(user, g) for g in ann.groups)


def authority_error(
    user: User,
    *,
    audience: str,
    kind: str,
    programs: list[Program],
    groups: list[Group],
) -> str | None:
    """Return a 403 reason when ``user`` may not post with these settings."""
    if user.role == "admin":
        return None
    if user.role != "instructor":
        return "Only admins and instructors can post announcements"
    if audience in ADMIN_ONLY_AUDIENCES:
        return f"Only admins can address audience '{audience}'"
    if kind in ADMIN_ONLY_KINDS:
        return f"Only admins can post '{kind}' announcements"
    for program in programs:
        if not can_attach_program_to_category(user, program.id):
            return f"You are not a member of program '{program.name}'"
    for group in groups:
        if not can_manage_group(user, (i.id for i in group.instructors)):
            return f"You do not manage group '{group.name}'"
    return None


def media_tokens_for(message: str) -> dict[str, str]:
    """``{media_id: token}`` for every ``/api/media/{id}`` reference in *message*."""
    from .media_tokens import issue_media_token

    return {str(media_id): issue_media_token(media_id) for media_id in media_ids_in(message)}


def media_ids_in(message: str) -> list[int]:
    """Distinct ``/api/media/{id}`` references in Markdown, in order (#1835)."""
    seen: list[int] = []
    for match in _MEDIA_REF_RE.finditer(message or ""):
        media_id = int(match.group(1))
        if media_id not in seen:
            seen.append(media_id)
    return seen


def reaction_counts(ann: Announcement) -> dict[str, int]:
    counts: dict[str, int] = {}
    for reaction in ann.reactions:
        counts[reaction.emoji] = counts.get(reaction.emoji, 0) + 1
    return counts


def my_reactions(ann: Announcement, user: User) -> list[str]:
    return sorted({r.emoji for r in ann.reactions if r.user_id == user.id})


@dataclass(frozen=True)
class SeenStats:
    seen_count: int
    audience_size: int | None


def seen_count_from_rows(
    ann: Announcement, seen_rows: Iterable[tuple[int, dict | None]]
) -> int:
    """Count users whose seen marker matches the current ``notified_at`` version.

    ``seen_rows`` is ``(user_id, metadata["announcement_seen"])`` for every
    user that has any seen-state; one query serves a whole page of cards.
    """
    key = str(ann.id)
    version = ann.notified_at.isoformat() if ann.notified_at else None
    count = 0
    for _user_id, seen in seen_rows:
        marker = (seen or {}).get(key) if isinstance(seen, dict) else None
        if marker is None:
            continue
        if version is None or marker >= version:
            count += 1
    return count
