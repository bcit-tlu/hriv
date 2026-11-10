"""Announcements stream (epic #1832, #1834).

One audience-filtered feed with ``inbox`` and ``mine`` scopes, author-scoped
CRUD, per-user seen state, aggregate seen counts for staff roles and emoji
reactions.  The legacy ``/api/announcement`` and ``/api/changelog`` shims stay
registered until #1838.

Route order matters: literal sub-paths (``/broadcast``) are declared before
``/{announcement_id}`` so FastAPI never captures them as an id (see
``tests/test_router_announcements.py::test_literal_routes_not_shadowed``).
"""

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import distinct, func, select, union
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import announcements as rules
from ..announcements import announcements_feature_gate as _feature_gate
from ..auth import get_current_user, require_role
from ..database import get_db, settings
from ..models import (
    Announcement,
    AnnouncementReaction,
    Group,
    Program,
    User,
    announcement_groups,
    announcement_programs,
    group_instructors,
    group_members,
    user_programs,
)
from ..schemas import (
    AnnouncementBroadcastOut,
    AnnouncementCreate,
    AnnouncementOut,
    AnnouncementUpdate,
    ReactionsOut,
)

# The flag gate is a router-level dependency so it runs before any auth/role
# dependency: a disabled API is uniformly 404, never 401/403.
router = APIRouter(
    prefix="/announcements", tags=["announcements"], dependencies=[Depends(_feature_gate)]
)

_poster = require_role("admin", "instructor")


# ── serialisation ─────────────────────────────────────────────────────────


def _serialize(
    ann: Announcement,
    user: User,
    *,
    now: datetime,
    stats: rules.SeenStats | None,
) -> AnnouncementOut:
    icon, severity = rules.KIND_META.get(ann.kind, rules.KIND_META["notice"])
    author_name = ann.author.name if ann.author is not None else rules.SITE_AUTHOR_NAME
    return AnnouncementOut(
        id=ann.id,
        title=ann.title or "",
        message=ann.message,
        kind=ann.kind,
        icon=icon,
        severity=severity,
        audience=ann.audience,
        author_id=ann.author_id,
        author_name=author_name,
        program_ids=[p.id for p in ann.programs],
        program_names=[p.name for p in ann.programs],
        group_ids=[g.id for g in ann.groups],
        group_names=[g.name for g in ann.groups],
        publish_at=ann.publish_at,
        expires_at=ann.expires_at,
        notified_at=ann.notified_at,
        pinned=ann.pinned,
        banner=ann.banner,
        status=rules.status_of(ann, now),
        seen=rules.has_seen(user, ann),
        reactions=rules.reaction_counts(ann),
        my_reactions=rules.my_reactions(ann, user),
        media_tokens=rules.media_tokens_for(ann.message),
        can_edit=rules.can_edit(user, ann),
        seen_count=stats.seen_count if stats else None,
        audience_size=stats.audience_size if stats else None,
        created_at=ann.created_at,
        updated_at=ann.updated_at,
    )


def _broadcast_shape(ann: Announcement) -> AnnouncementBroadcastOut:
    icon, severity = rules.KIND_META.get(ann.kind, rules.KIND_META["notice"])
    return AnnouncementBroadcastOut(
        id=ann.id,
        title=ann.title or "",
        message=ann.message,
        kind=ann.kind,
        icon=icon,
        severity=severity,
        publish_at=ann.publish_at,
        expires_at=ann.expires_at,
        updated_at=ann.updated_at,
    )


async def _load_stats(
    db: AsyncSession, announcements: list[Announcement]
) -> dict[int, rules.SeenStats]:
    """Aggregate seen counts and audience sizes for staff callers.

    Two or three queries for the whole page: every user's seen map, the
    staff head-count (if any ``staff`` announcement is present) and one
    ``UNION`` over the program/group junctions for the targeted ones.
    Identities never leave this function — only counts.
    """
    if not announcements:
        return {}
    seen_result = await db.execute(
        select(User.id, User.metadata_["announcement_seen"]).where(
            User.metadata_["announcement_seen"].is_not(None)
        )
    )
    seen_rows = [(row[0], row[1]) for row in seen_result.all()]

    staff_size: int | None = None
    if any(a.audience == "staff" for a in announcements):
        staff_size = (
            await db.execute(
                select(func.count(User.id)).where(
                    User.role.in_(rules.ANNOUNCEMENT_STAFF_ROLES), User.active.is_(True)
                )
            )
        ).scalar_one()

    targeted_sizes: dict[int, int] = {}
    targeted_ids = [a.id for a in announcements if a.audience == "targeted"]
    if targeted_ids:
        by_program = (
            select(
                announcement_programs.c.announcement_id.label("announcement_id"),
                user_programs.c.user_id.label("user_id"),
            )
            .select_from(announcement_programs)
            .join(user_programs, user_programs.c.program_id == announcement_programs.c.program_id)
            .where(announcement_programs.c.announcement_id.in_(targeted_ids))
        )
        by_member = (
            select(
                announcement_groups.c.announcement_id.label("announcement_id"),
                group_members.c.user_id.label("user_id"),
            )
            .select_from(announcement_groups)
            .join(group_members, group_members.c.group_id == announcement_groups.c.group_id)
            .where(announcement_groups.c.announcement_id.in_(targeted_ids))
        )
        by_instructor = (
            select(
                announcement_groups.c.announcement_id.label("announcement_id"),
                group_instructors.c.user_id.label("user_id"),
            )
            .select_from(announcement_groups)
            .join(group_instructors, group_instructors.c.group_id == announcement_groups.c.group_id)
            .where(announcement_groups.c.announcement_id.in_(targeted_ids))
        )
        # Authors always see their own post (can_view), so count them too.
        by_author = select(
            Announcement.id.label("announcement_id"), Announcement.author_id.label("user_id")
        ).where(Announcement.id.in_(targeted_ids), Announcement.author_id.is_not(None))
        reach = union(by_program, by_member, by_instructor, by_author).subquery("reach")
        size_result = await db.execute(
            select(reach.c.announcement_id, func.count(distinct(reach.c.user_id))).group_by(
                reach.c.announcement_id
            )
        )
        targeted_sizes = {row[0]: row[1] for row in size_result.all()}

    stats: dict[int, rules.SeenStats] = {}
    for ann in announcements:
        if ann.audience == "everyone":
            size: int | None = None
        elif ann.audience == "staff":
            size = staff_size
        else:
            size = targeted_sizes.get(ann.id, 0)
        stats[ann.id] = rules.SeenStats(
            seen_count=rules.seen_count_from_rows(ann, seen_rows), audience_size=size
        )
    return stats


async def _get_announcement(db: AsyncSession, announcement_id: int) -> Announcement:
    result = await db.execute(select(Announcement).where(Announcement.id == announcement_id))
    ann = result.scalar_one_or_none()
    if ann is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Announcement not found")
    return ann


async def _visible_or_404(db: AsyncSession, announcement_id: int, user: User) -> Announcement:
    """Readers get 404 (not 403) for announcements outside their audience."""
    ann = await _get_announcement(db, announcement_id)
    if not rules.can_view(user, ann):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Announcement not found")
    return ann


async def _load_targets(
    db: AsyncSession, program_ids: list[int], group_ids: list[int]
) -> tuple[list[Program], list[Group]]:
    programs: list[Program] = []
    groups: list[Group] = []
    if program_ids:
        result = await db.execute(select(Program).where(Program.id.in_(set(program_ids))))
        programs = list(result.scalars().all())
        missing = set(program_ids) - {p.id for p in programs}
        if missing:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Unknown program ids: {sorted(missing)}",
            )
    if group_ids:
        result = await db.execute(select(Group).where(Group.id.in_(set(group_ids))))
        groups = list(result.scalars().all())
        missing = set(group_ids) - {g.id for g in groups}
        if missing:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Unknown group ids: {sorted(missing)}",
            )
    return programs, groups


def _check_authority(
    user: User, *, audience: str, kind: str, programs: list[Program], groups: list[Group]
) -> None:
    reason = rules.authority_error(
        user, audience=audience, kind=kind, programs=programs, groups=groups
    )
    if reason:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=reason)


# ── routes (literal paths first) ───────────────────────────────────────────


@router.get("/broadcast", response_model=list[AnnouncementBroadcastOut])
async def list_broadcast(
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Live ``everyone`` banner announcements. Public – rendered on the login screen."""
    result = await db.execute(
        select(Announcement)
        .where(
            Announcement.audience == "everyone",
            Announcement.banner.is_(True),
            rules.live_clause(),
        )
        .order_by(Announcement.pinned.desc(), Announcement.notified_at.desc(), Announcement.id.desc())
    )
    return [_broadcast_shape(a) for a in result.scalars().all()]


@router.get("/", response_model=list[AnnouncementOut])
async def list_announcements(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    scope: Literal["inbox", "mine"] = Query("inbox"),
):
    """``inbox``: live announcements the caller can see. ``mine`` (admin/instructor):
    own posts in every state plus posts targeted at co-managed groups (read-only)."""
    now = rules.utcnow()
    if scope == "mine":
        if current_user.role not in ("admin", "instructor"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only admins and instructors have a Mine scope",
            )
        result = await db.execute(
            select(Announcement).order_by(
                Announcement.pinned.desc(),
                Announcement.notified_at.desc().nulls_first(),
                Announcement.id.desc(),
            )
        )
        rows = [a for a in result.scalars().all() if rules.in_mine_scope(current_user, a)]
    else:
        result = await db.execute(
            select(Announcement)
            .where(rules.live_clause(now))
            .order_by(
                Announcement.pinned.desc(), Announcement.notified_at.desc(), Announcement.id.desc()
            )
        )
        rows = [a for a in result.scalars().all() if rules.can_view(current_user, a)]

    stats: dict[int, rules.SeenStats] = {}
    if rules.is_staff_role(current_user.role):
        stats = await _load_stats(db, rows)
    return [_serialize(a, current_user, now=now, stats=stats.get(a.id)) for a in rows]


@router.post("/", response_model=AnnouncementOut, status_code=status.HTTP_201_CREATED)
async def create_announcement(
    body: AnnouncementCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(_poster)],
):
    programs, groups = await _load_targets(db, body.program_ids, body.group_ids)
    _check_authority(
        current_user, audience=body.audience, kind=body.kind, programs=programs, groups=groups
    )
    now = rules.utcnow()
    publish_at = None if body.draft else (body.publish_at or now)
    if publish_at and body.expires_at and body.expires_at <= publish_at:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="expires_at must be after publish_at",
        )
    ann = Announcement(
        title=body.title,
        message=body.message,
        kind=body.kind,
        audience=body.audience,
        author_id=current_user.id,
        publish_at=publish_at,
        expires_at=body.expires_at,
        notified_at=publish_at,
        pinned=body.pinned,
        banner=body.banner,
    )
    ann.programs = programs
    ann.groups = groups
    db.add(ann)
    await db.commit()
    await db.refresh(ann)
    stats = (await _load_stats(db, [ann])).get(ann.id)
    return _serialize(ann, current_user, now=now, stats=stats)


@router.patch("/{announcement_id}", response_model=AnnouncementOut)
async def update_announcement(
    announcement_id: int,
    body: AnnouncementUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(_poster)],
):
    """Author or admin. Edits never resurface a post unless ``notify_again``."""
    ann = await _get_announcement(db, announcement_id)
    if not rules.can_edit(current_user, ann):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only the author or an admin can edit this"
        )

    audience = body.audience or ann.audience
    kind = body.kind or ann.kind
    if body.touches_targeting() or body.kind is not None:
        program_ids = body.program_ids if body.program_ids is not None else [p.id for p in ann.programs]
        group_ids = body.group_ids if body.group_ids is not None else [g.id for g in ann.groups]
        if audience != "targeted":
            program_ids, group_ids = [], []
        elif not (program_ids or group_ids):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="A targeted announcement needs at least one program or group",
            )
        programs, groups = await _load_targets(db, program_ids, group_ids)
        _check_authority(current_user, audience=audience, kind=kind, programs=programs, groups=groups)
        ann.audience = audience
        ann.kind = kind
        ann.programs = programs
        ann.groups = groups

    if body.title is not None:
        ann.title = body.title
    if body.message is not None:
        ann.message = body.message
    if body.pinned is not None:
        ann.pinned = body.pinned
    if body.banner is not None:
        ann.banner = body.banner
    if body.clear_expires_at:
        ann.expires_at = None
    elif body.expires_at is not None:
        ann.expires_at = body.expires_at

    now = rules.utcnow()
    was_published = ann.publish_at is not None
    if body.draft is True:
        ann.publish_at = None
        ann.notified_at = None
    elif body.publish_at is not None:
        ann.publish_at = body.publish_at
    elif body.draft is False and not was_published:
        ann.publish_at = now
    if ann.publish_at is not None and (not was_published or ann.notified_at is None):
        ann.notified_at = ann.publish_at
    if body.notify_again and ann.publish_at is not None:
        ann.notified_at = now
    if ann.publish_at and ann.expires_at and ann.expires_at <= ann.publish_at:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="expires_at must be after publish_at",
        )

    await db.commit()
    await db.refresh(ann)
    stats = (await _load_stats(db, [ann])).get(ann.id)
    return _serialize(ann, current_user, now=now, stats=stats)


@router.delete("/{announcement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_announcement(
    announcement_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(_poster)],
):
    ann = await _get_announcement(db, announcement_id)
    if not rules.can_edit(current_user, ann):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only the author or an admin can delete this"
        )
    await db.delete(ann)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{announcement_id}/seen", status_code=status.HTTP_204_NO_CONTENT)
async def mark_announcement_seen(
    announcement_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    """Record that the caller has seen the current version. Idempotent."""
    ann = await _visible_or_404(db, announcement_id, current_user)
    await rules.mark_seen_atomic(db, current_user, [ann])
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _validate_emoji(emoji: str) -> None:
    if emoji not in rules.REACTION_EMOJI:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Unknown reaction; choose one of {', '.join(rules.REACTION_EMOJI)}",
        )


async def _reactable_or_error(db: AsyncSession, announcement_id: int, user: User) -> Announcement:
    ann = await _visible_or_404(db, announcement_id, user)
    if not rules.is_live(ann):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Reactions are only possible on live announcements",
        )
    return ann


@router.put("/{announcement_id}/reactions/{emoji}", response_model=ReactionsOut)
async def add_reaction(
    announcement_id: int,
    emoji: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _validate_emoji(emoji)
    ann = await _reactable_or_error(db, announcement_id, current_user)
    if not any(r.user_id == current_user.id and r.emoji == emoji for r in ann.reactions):
        ann.reactions.append(
            AnnouncementReaction(announcement_id=ann.id, user_id=current_user.id, emoji=emoji)
        )
        try:
            await db.commit()
        except IntegrityError:
            # A concurrent identical PUT won the unique constraint; idempotent.
            await db.rollback()
        await db.refresh(ann)
    return ReactionsOut(
        reactions=rules.reaction_counts(ann), my_reactions=rules.my_reactions(ann, current_user)
    )


@router.delete("/{announcement_id}/reactions/{emoji}", response_model=ReactionsOut)
async def remove_reaction(
    announcement_id: int,
    emoji: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
):
    _validate_emoji(emoji)
    ann = await _reactable_or_error(db, announcement_id, current_user)
    mine = [r for r in ann.reactions if r.user_id == current_user.id and r.emoji == emoji]
    if mine:
        for reaction in mine:
            ann.reactions.remove(reaction)
        await db.commit()
        await db.refresh(ann)
    return ReactionsOut(
        reactions=rules.reaction_counts(ann), my_reactions=rules.my_reactions(ann, current_user)
    )
