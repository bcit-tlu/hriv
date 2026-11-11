"""Tests for ``/api/announcements`` (#1834): visibility, authority, seen-state,
seen counts, reactions and route ordering."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app import announcements as rules
from app.models import Announcement, Group, Program, User
from app.routers import announcements as router_module
from app.routers.announcements import (
    _feature_gate,
    _load_stats,
    add_reaction,
    create_announcement,
    delete_announcement,
    list_announcements,
    list_broadcast,
    mark_announcement_seen,
    remove_reaction,
    update_announcement,
)
from app.schemas import AnnouncementCreate, AnnouncementUpdate

NOW = datetime(2026, 1, 10, 12, tzinfo=timezone.utc)
HOUR = timedelta(hours=1)


# ── fixtures & helpers ─────────────────────────────────────────


def _user(role: str = "student", id: int = 1, programs=(), groups=(), metadata=None) -> SimpleNamespace:
    return SimpleNamespace(
        id=id,
        name=f"user{id}",
        role=role,
        active=True,
        programs=list(programs),
        groups=list(groups),
        metadata_=metadata,
    )


def _program(id: int, name: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(id=id, name=name or f"P{id}")


def _group(id: int, instructor_ids=(), name: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        id=id,
        name=name or f"G{id}",
        instructors=[SimpleNamespace(id=i) for i in instructor_ids],
    )


def _reaction(user_id: int, emoji: str) -> SimpleNamespace:
    return SimpleNamespace(user_id=user_id, emoji=emoji)


def _ann(**overrides) -> SimpleNamespace:
    base = dict(
        id=10,
        title="Hello",
        message="Body",
        kind="notice",
        audience="everyone",
        author_id=2,
        author=SimpleNamespace(name="Ada"),
        programs=[],
        groups=[],
        reactions=[],
        publish_at=NOW - HOUR,
        expires_at=None,
        notified_at=NOW - HOUR,
        pinned=False,
        banner=False,
        created_at=NOW - HOUR,
        updated_at=NOW - HOUR,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _db(rows=None, *, one=None) -> AsyncMock:
    """A session whose ``execute`` answers list queries with ``rows`` and
    single-row queries with ``one``."""
    result = MagicMock()
    result.scalars.return_value.all.return_value = list(rows or [])
    result.scalar_one_or_none.return_value = one
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)
    db.add = MagicMock()
    return db


def _refresh_like_db(obj) -> None:
    obj.id = getattr(obj, "id") or 99
    obj.created_at = obj.created_at or NOW
    obj.updated_at = obj.updated_at or NOW


@pytest.fixture(autouse=True)
def _enable_flag(monkeypatch):
    monkeypatch.setattr(router_module.settings, "announcements_enabled", True)


@pytest.fixture
def no_stats():
    with patch.object(router_module, "_load_stats", AsyncMock(return_value={})) as mocked:
        yield mocked


# ── feature gate ──────────────────────────────────────────────


def test_feature_gate_404_when_disabled(monkeypatch) -> None:
    monkeypatch.setattr(router_module.settings, "announcements_enabled", False)
    with pytest.raises(HTTPException) as exc:
        _feature_gate()
    assert exc.value.status_code == 404
    monkeypatch.setattr(router_module.settings, "announcements_enabled", True)
    assert _feature_gate() is None
    # Router-level so it runs before auth: disabled API is 404, never 401/403.
    assert any(d.dependency is _feature_gate for d in router_module.router.dependencies)


# ── visibility matrix (rules.can_view) ────────────────────────


@pytest.mark.parametrize(
    "role, expected",
    [("admin", True), ("instructor", True), ("staff", True), ("student", False)],
)
def test_staff_audience_by_role(role: str, expected: bool) -> None:
    assert rules.can_view(_user(role, id=5), _ann(audience="staff")) is expected


@pytest.mark.parametrize(
    ("audience", "role", "expected"),
    [
        ("admins", "admin", True),
        ("admins", "instructor", False),
        ("admins", "staff", False),
        ("instructors", "instructor", True),
        ("instructors", "admin", False),
        ("staff_only", "staff", True),
        ("staff_only", "admin", False),
        ("staff_only", "student", False),
    ],
)
def test_single_role_audiences(audience: str, role: str, expected: bool) -> None:
    assert rules.can_view(_user(role, id=5), _ann(audience=audience)) is expected


def test_role_audiences_are_admin_only() -> None:
    assert set(rules.ROLE_AUDIENCES) <= rules.ADMIN_ONLY_AUDIENCES
    assert rules.ROLE_AUDIENCES["staff"] == frozenset(rules.ANNOUNCEMENT_STAFF_ROLES)


def test_everyone_and_author_always_visible() -> None:
    assert rules.can_view(_user("student", id=5), _ann(audience="everyone")) is True
    draft_targeted = _ann(audience="targeted", author_id=5, groups=[_group(1)])
    assert rules.can_view(_user("student", id=5), draft_targeted) is True


def test_targeted_is_a_union_of_program_group_and_co_ownership() -> None:
    ann = _ann(audience="targeted", programs=[_program(1)], groups=[_group(7, instructor_ids=[3])])
    assert rules.can_view(_user("student", id=5, programs=[_program(1)]), ann) is True
    assert rules.can_view(_user("student", id=5, groups=[_group(7)]), ann) is True
    assert rules.can_view(_user("instructor", id=3), ann) is True  # co-owner
    assert rules.can_view(_user("instructor", id=4), ann) is False
    assert rules.can_view(_user("student", id=6, programs=[_program(2)], groups=[_group(8)]), ann) is False
    # Admins get no implicit reach into targeted posts they did not author.
    assert rules.can_view(_user("admin", id=9), ann) is False


# ── list: inbox / mine ────────────────────────────────────────


async def test_inbox_filters_by_visibility_and_serializes(no_stats) -> None:
    student = _user("student", id=5, groups=[_group(7)], metadata={"announcement_seen": {"10": (NOW - HOUR).isoformat()}})
    visible = _ann(id=10, reactions=[_reaction(5, "heart"), _reaction(6, "heart"), _reaction(6, "rocket")])
    hidden = _ann(id=11, audience="staff")
    targeted = _ann(id=12, audience="targeted", groups=[_group(7)], message="see /api/media/3 and /api/media/3")
    db = _db([visible, hidden, targeted])

    out = await list_announcements(db, student, scope="inbox")

    assert [a.id for a in out] == [10, 12]
    first = out[0]
    assert first.status == "live"
    assert first.seen is True
    assert out[1].seen is False
    assert first.reactions == {"heart": 2, "rocket": 1}
    assert first.my_reactions == ["heart"]
    assert first.author_name == "Ada"
    assert first.icon == "Campaign" and first.severity == "info"
    assert first.can_edit is False
    assert first.seen_count is None and first.audience_size is None
    assert list(out[1].media_tokens) == ["3"] and out[1].media_tokens["3"]
    assert out[1].group_names == ["G7"]
    no_stats.assert_not_awaited()  # students never trigger the count queries
    sql = str(db.execute.call_args.args[0].compile(compile_kwargs={"literal_binds": True}))
    assert "announcements.publish_at IS NOT NULL" in sql  # live window applied in SQL


async def test_inbox_site_author_and_staff_counts() -> None:
    instructor = _user("instructor", id=3)
    ann = _ann(id=10, author_id=None, author=None, audience="staff")
    stats = {10: rules.SeenStats(seen_count=4, audience_size=9)}
    db = _db([ann])
    with patch.object(router_module, "_load_stats", AsyncMock(return_value=stats)) as load:
        (out,) = await list_announcements(db, instructor, scope="inbox")
    load.assert_awaited_once()
    assert out.author_name == "Site"
    assert out.seen_count == 4 and out.audience_size == 9


async def test_mine_requires_admin_or_instructor(no_stats) -> None:
    for role in ("student", "staff"):
        with pytest.raises(HTTPException) as exc:
            await list_announcements(_db([]), _user(role), scope="mine")
        assert exc.value.status_code == 403


async def test_mine_scope_instructor_sees_own_and_co_managed_read_only(no_stats) -> None:
    me = _user("instructor", id=3)
    own_draft = _ann(id=1, author_id=3, publish_at=None, notified_at=None)
    co_managed = _ann(id=2, author_id=4, audience="targeted", groups=[_group(7, instructor_ids=[3, 4])])
    other = _ann(id=3, author_id=4, audience="everyone")
    db = _db([own_draft, co_managed, other])

    out = await list_announcements(db, me, scope="mine")

    assert [(a.id, a.can_edit, a.status) for a in out] == [(1, True, "draft"), (2, False, "live")]


async def test_mine_scope_admin_sees_everything(no_stats) -> None:
    rows = [_ann(id=1, author_id=4), _ann(id=2, author_id=5, audience="targeted", groups=[_group(7)])]
    out = await list_announcements(_db(rows), _user("admin", id=9), scope="mine")
    assert [(a.id, a.can_edit) for a in out] == [(1, True), (2, True)]


def test_status_derivation() -> None:
    assert rules.status_of(_ann(publish_at=None), NOW) == "draft"
    assert rules.status_of(_ann(publish_at=NOW + HOUR), NOW) == "scheduled"
    assert rules.status_of(_ann(expires_at=NOW - HOUR), NOW) == "expired"
    assert rules.status_of(_ann(), NOW) == "live"


# ── broadcast ─────────────────────────────────────────────────


async def test_broadcast_returns_minimal_shape_and_filters_in_sql() -> None:
    db = _db([_ann(id=1, kind="warning", banner=True)])
    (out,) = await list_broadcast(db)
    assert out.model_dump().keys() == {
        "id", "title", "message", "kind", "icon", "severity", "publish_at", "expires_at", "updated_at"
    }
    assert out.severity == "warning"
    sql = str(db.execute.call_args.args[0].compile(compile_kwargs={"literal_binds": True}))
    assert "announcements.audience = 'everyone'" in sql
    assert "announcements.banner IS true" in sql
    order_by = sql.split("ORDER BY", 1)[1]
    assert order_by.lstrip().startswith("announcements.notified_at DESC")
    assert "pinned" not in order_by
    assert "announcements.publish_at IS NOT NULL" in sql


# ── create ────────────────────────────────────────────────────


def _targets_db(programs=(), groups=()):
    """execute() resolves Program / Group lookups by entity."""

    async def _exec(stmt, *_a, **_k):
        result = MagicMock()
        entity = stmt.column_descriptions[0].get("entity")
        rows = list(programs) if entity is Program else list(groups) if entity is Group else []
        result.scalars.return_value.all.return_value = rows
        return result

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=_exec)
    db.add = MagicMock()
    db.refresh = AsyncMock(side_effect=_refresh_like_db)
    return db


async def test_create_publishes_now_by_default_and_sets_notified_at(no_stats) -> None:
    program = _program(1)
    me = _user("instructor", id=3, programs=[program])
    db = _targets_db(programs=[program])

    out = await create_announcement(
        AnnouncementCreate(title="Lab moved", message="Room 2", program_ids=[1]), db, me
    )

    created = db.add.call_args.args[0]
    assert isinstance(created, Announcement)
    assert created.author_id == 3
    assert created.audience == "targeted" and created.kind == "notice"
    assert created.publish_at is not None and created.notified_at == created.publish_at
    assert created.programs == [program]
    assert out.status == "live" and out.program_ids == [1] and out.can_edit is True
    db.commit.assert_awaited_once()


async def test_create_draft_has_no_publish_or_notified_at(no_stats) -> None:
    program = _program(1)
    me = _user("instructor", id=3, programs=[program])
    out = await create_announcement(
        AnnouncementCreate(title="Soon", program_ids=[1], draft=True), _targets_db(programs=[program]), me
    )
    assert out.status == "draft" and out.publish_at is None and out.notified_at is None


async def test_create_schema_validation() -> None:
    with pytest.raises(ValidationError):
        AnnouncementCreate(title="x", audience="targeted")  # no targets
    with pytest.raises(ValidationError):
        AnnouncementCreate(title="x", audience="everyone", program_ids=[1])
    with pytest.raises(ValidationError):
        AnnouncementCreate(title="x", audience="everyone", publish_at=NOW, expires_at=NOW)
    naive = AnnouncementCreate(title="x", audience="everyone", expires_at=datetime(2030, 1, 1))
    assert naive.expires_at.tzinfo is not None  # naive input is taken as UTC
    assert AnnouncementUpdate(publish_at=datetime(2030, 1, 1)).publish_at.tzinfo is not None
    with pytest.raises(ValidationError):
        AnnouncementCreate(title="x", audience="everyone", message="m" * 10_001)
    with pytest.raises(ValidationError):
        AnnouncementCreate(title="   ", audience="everyone")
    with pytest.raises(ValidationError):
        AnnouncementCreate(title="x", audience="everyone", kind="emoji")  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "body_kwargs",
    [
        dict(audience="everyone"),
        dict(audience="staff"),
        dict(audience="admins"),
        dict(audience="instructors"),
        dict(audience="staff_only"),
        dict(audience="targeted", program_ids=[1], kind="release"),
        dict(audience="targeted", program_ids=[1], kind="warning"),
    ],
)
async def test_instructor_cannot_use_admin_only_audience_or_kind(body_kwargs, no_stats) -> None:
    program = _program(1)
    me = _user("instructor", id=3, programs=[program])
    with pytest.raises(HTTPException) as exc:
        await create_announcement(
            AnnouncementCreate(title="x", **body_kwargs), _targets_db(programs=[program]), me
        )
    assert exc.value.status_code == 403


async def test_instructor_cannot_target_foreign_program_or_group(no_stats) -> None:
    me = _user("instructor", id=3, programs=[_program(1)])
    with pytest.raises(HTTPException) as exc:
        await create_announcement(
            AnnouncementCreate(title="x", program_ids=[2]), _targets_db(programs=[_program(2)]), me
        )
    assert exc.value.status_code == 403 and "program" in exc.value.detail
    with pytest.raises(HTTPException) as exc:
        await create_announcement(
            AnnouncementCreate(title="x", group_ids=[7]),
            _targets_db(groups=[_group(7, instructor_ids=[4])]),
            me,
        )
    assert exc.value.status_code == 403 and "group" in exc.value.detail


async def test_admin_may_broadcast_release_notes(no_stats) -> None:
    out = await create_announcement(
        AnnouncementCreate(title="v2", audience="staff", kind="release", banner=True),
        _targets_db(),
        _user("admin", id=9),
    )
    assert out.kind == "release" and out.icon == "RocketLaunch" and out.audience == "staff"


async def test_create_unknown_target_ids_422(no_stats) -> None:
    with pytest.raises(HTTPException) as exc:
        await create_announcement(
            AnnouncementCreate(title="x", group_ids=[7, 8]), _targets_db(groups=[_group(7)]), _user("admin")
        )
    assert exc.value.status_code == 422


# ── update / delete ───────────────────────────────────────────


def _update_db(ann, programs=(), groups=()):
    async def _exec(stmt, *_a, **_k):
        result = MagicMock()
        entity = stmt.column_descriptions[0].get("entity")
        if entity is Announcement:
            result.scalar_one_or_none.return_value = ann
        rows = list(programs) if entity is Program else list(groups) if entity is Group else []
        result.scalars.return_value.all.return_value = rows
        return result

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=_exec)
    return db


async def test_update_message_only_keeps_notified_at(no_stats) -> None:
    ann = _ann(author_id=3)
    before = ann.notified_at
    out = await update_announcement(10, AnnouncementUpdate(message="edited"), _update_db(ann), _user("instructor", id=3))
    assert ann.message == "edited" and ann.notified_at == before
    assert out.message == "edited"


async def test_update_notify_again_bumps_notified_at(no_stats) -> None:
    ann = _ann(author_id=3)
    await update_announcement(10, AnnouncementUpdate(notify_again=True), _update_db(ann), _user("instructor", id=3))
    assert ann.notified_at > NOW - HOUR
    assert ann.publish_at == NOW - HOUR  # publish date untouched


async def test_update_publish_draft_sets_notified_at_and_unpublish_clears(no_stats) -> None:
    ann = _ann(author_id=3, publish_at=None, notified_at=None)
    db = _update_db(ann)
    me = _user("instructor", id=3)
    await update_announcement(10, AnnouncementUpdate(draft=False), db, me)
    assert ann.publish_at is not None and ann.notified_at == ann.publish_at
    await update_announcement(10, AnnouncementUpdate(draft=True), db, me)
    assert ann.publish_at is None and ann.notified_at is None


async def test_update_by_non_author_403_and_admin_ok(no_stats) -> None:
    ann = _ann(author_id=3)
    with pytest.raises(HTTPException) as exc:
        await update_announcement(10, AnnouncementUpdate(title="t"), _update_db(ann), _user("instructor", id=4))
    assert exc.value.status_code == 403
    await update_announcement(10, AnnouncementUpdate(title="t"), _update_db(ann), _user("admin", id=9))
    assert ann.title == "t"


async def test_update_targeting_revalidates_authority_only_when_touched(no_stats) -> None:
    group = _group(7, instructor_ids=[4])  # author lost co-ownership
    ann = _ann(author_id=3, audience="targeted", groups=[group])
    me = _user("instructor", id=3)
    # message-only edit still works…
    await update_announcement(10, AnnouncementUpdate(message="m"), _update_db(ann, groups=[group]), me)
    # …but touching the audience re-checks group authority.
    with pytest.raises(HTTPException) as exc:
        await update_announcement(10, AnnouncementUpdate(group_ids=[7]), _update_db(ann, groups=[group]), me)
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        await update_announcement(10, AnnouncementUpdate(group_ids=[]), _update_db(ann, groups=[group]), me)
    assert exc.value.status_code == 422  # targeted with no targets


async def test_update_switching_to_everyone_drops_targets_for_admin(no_stats) -> None:
    ann = _ann(author_id=9, audience="targeted", groups=[_group(7)])
    await update_announcement(10, AnnouncementUpdate(audience="everyone"), _update_db(ann), _user("admin", id=9))
    assert ann.audience == "everyone" and ann.groups == [] and ann.programs == []


async def test_update_expiry_validation_and_clear(no_stats) -> None:
    ann = _ann(author_id=9)
    with pytest.raises(HTTPException) as exc:
        await update_announcement(10, AnnouncementUpdate(expires_at=NOW - 2 * HOUR), _update_db(ann), _user("admin", id=9))
    assert exc.value.status_code == 422
    ann.expires_at = NOW + HOUR
    await update_announcement(10, AnnouncementUpdate(clear_expires_at=True), _update_db(ann), _user("admin", id=9))
    assert ann.expires_at is None


async def test_update_404_when_missing(no_stats) -> None:
    with pytest.raises(HTTPException) as exc:
        await update_announcement(99, AnnouncementUpdate(title="t"), _update_db(None), _user("admin"))
    assert exc.value.status_code == 404


async def test_delete_author_or_admin_only() -> None:
    ann = _ann(author_id=3)
    db = _db(one=ann)
    with pytest.raises(HTTPException) as exc:
        await delete_announcement(10, db, _user("instructor", id=4))
    assert exc.value.status_code == 403
    response = await delete_announcement(10, db, _user("instructor", id=3))
    assert response.status_code == 204
    db.delete.assert_awaited_once_with(ann)


# ── seen ──────────────────────────────────────────────────────


async def test_mark_seen_merges_idempotently_and_404s_when_invisible() -> None:
    student = _user("student", id=5, metadata={"theme": "dark"})
    ann = _ann(audience="everyone")
    db = _db(one=ann)

    async def _refresh(user, attribute_names=None):  # the DB-side jsonb merge result
        user.metadata_ = {**user.metadata_, "announcement_seen": {"10": (NOW - HOUR).isoformat()}}

    db.refresh = AsyncMock(side_effect=_refresh)

    await mark_announcement_seen(10, db, student)
    await mark_announcement_seen(10, db, student)

    assert student.metadata_ == {
        "theme": "dark",
        "announcement_seen": {"10": (NOW - HOUR).isoformat()},
    }
    assert db.commit.await_count == 2
    # Refreshed from the row, never assigned: no stale wholesale UPDATE on commit.
    assert db.refresh.await_count == 2
    assert rules.has_seen(student, ann) is True
    # The write is an atomic JSONB merge, not a wholesale metadata overwrite.
    update_calls = [c for c in db.execute.call_args_list if "jsonb_build_object" in str(c.args[0])]
    assert len(update_calls) == 2 and update_calls[0].args[1]["user_id"] == 5

    with pytest.raises(HTTPException) as exc:
        await mark_announcement_seen(10, _db(one=_ann(audience="staff")), student)
    assert exc.value.status_code == 404


def test_seen_flag_flips_back_after_notify_again() -> None:
    student = _user("student", id=5, metadata={"announcement_seen": {"10": (NOW - HOUR).isoformat()}})
    assert rules.has_seen(student, _ann()) is True
    assert rules.has_seen(student, _ann(notified_at=NOW)) is False


# ── seen counts / audience size ───────────────────────────────


def test_seen_count_from_rows_matches_version() -> None:
    ann = _ann(id=10, notified_at=NOW)
    rows = [
        (1, {"10": NOW.isoformat()}),  # current version
        (2, {"10": (NOW - HOUR).isoformat()}),  # stale → re-notified since
        (3, {"11": NOW.isoformat()}),  # other announcement
        (4, None),
        (5, "junk"),
    ]
    assert rules.seen_count_from_rows(ann, rows) == 1
    assert rules.seen_count_from_rows(_ann(id=10, notified_at=None), rows) == 2


async def test_load_stats_queries_counts_without_identities() -> None:
    everyone = _ann(id=1, audience="everyone", notified_at=NOW)
    staff = _ann(id=2, audience="staff", notified_at=NOW)
    targeted = _ann(id=3, audience="targeted", notified_at=NOW)
    admins = _ann(id=4, audience="admins", notified_at=NOW)
    seen_rows = [(1, {"1": NOW.isoformat(), "3": NOW.isoformat()}), (2, {"2": NOW.isoformat()})]
    calls = []

    async def _exec(stmt, *_a, **_k):
        sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))
        calls.append(sql)
        result = MagicMock()
        if "announcement_seen" in sql:
            result.all.return_value = seen_rows
        elif "GROUP BY users.role" in sql:
            result.all.return_value = [("admin", 2), ("instructor", 4), ("staff", 6), ("student", 90)]
        else:
            result.all.return_value = [(3, 5)]
        return result

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=_exec)

    stats = await _load_stats(db, [everyone, staff, targeted, admins])

    assert stats[1] == rules.SeenStats(seen_count=1, audience_size=None)
    assert stats[2] == rules.SeenStats(seen_count=1, audience_size=12)
    assert stats[3] == rules.SeenStats(seen_count=1, audience_size=5)
    assert stats[4] == rules.SeenStats(seen_count=0, audience_size=2)
    assert len(calls) == 3  # one head-count query serves every role audience
    union_sql = calls[2]
    for table in ("announcement_programs", "user_programs", "group_members", "group_instructors"):
        assert table in union_sql
    assert "announcements.author_id" in union_sql  # the author is part of the reach
    assert "count(DISTINCT" in union_sql
    assert await _load_stats(db, []) == {}


# ── reactions ─────────────────────────────────────────────────


async def test_reactions_add_is_idempotent_and_remove_toggles_off() -> None:
    me = _user("student", id=5)
    ann = _ann(reactions=[_reaction(6, "heart")])
    db = _db(one=ann)

    out = await add_reaction(10, "heart", db, me)
    assert out.reactions == {"heart": 2} and out.my_reactions == ["heart"]
    added = ann.reactions[-1]
    assert added.user_id == 5 and added.emoji == "heart"
    out = await add_reaction(10, "heart", db, me)
    assert out.reactions == {"heart": 2}
    assert db.commit.await_count == 1  # second add was a no-op

    out = await remove_reaction(10, "heart", db, me)
    assert out.reactions == {"heart": 1} and out.my_reactions == []
    assert db.commit.await_count == 2
    out = await remove_reaction(10, "heart", db, me)
    assert db.commit.await_count == 2


async def test_reaction_allowlist_and_live_only() -> None:
    me = _user("student", id=5)
    with pytest.raises(HTTPException) as exc:
        await add_reaction(10, "poop", _db(one=_ann()), me)
    assert exc.value.status_code == 422
    with pytest.raises(HTTPException) as exc:
        await add_reaction(10, "+1", _db(one=_ann(publish_at=None)), me)
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        await add_reaction(10, "+1", _db(one=_ann(audience="staff")), me)
    assert exc.value.status_code == 404


def test_reaction_payload_never_carries_identities() -> None:
    from app.schemas import ReactionsOut

    assert set(ReactionsOut.model_fields) == {"reactions", "my_reactions"}


# ── route ordering ────────────────────────────────────────────


def test_literal_routes_not_shadowed_by_param_routes() -> None:
    """Literal sub-paths must register before ``/{announcement_id}`` routes.

    Starlette resolves the first FULL match in registration order, so iterate
    the router's own routes the way the mounted app would.
    """
    from starlette.routing import Match

    def _first_match_endpoint(method: str, path: str):
        for route in router_module.router.routes:
            match, _ = route.matches({"type": "http", "method": method, "path": path})
            if match == Match.FULL:
                return route.endpoint
        return None

    cases = [
        ("GET", "/announcements/broadcast", "list_broadcast"),
        ("GET", "/announcements/", "list_announcements"),
        ("PUT", "/announcements/7/seen", "mark_announcement_seen"),
        ("PUT", "/announcements/7/reactions/heart", "add_reaction"),
        ("DELETE", "/announcements/7/reactions/heart", "remove_reaction"),
        ("PATCH", "/announcements/7", "update_announcement"),
    ]
    for method, path, expected in cases:
        endpoint = _first_match_endpoint(method, path)
        assert endpoint is not None, f"{method} {path} matched no route"
        assert endpoint.__name__ == expected, f"{method} {path} resolved to {endpoint.__name__}"


def test_strip_media_tokens_canonicalises_pasted_urls() -> None:
    pasted = "![a](/api/media/12?token=abc.DEF-ghi_jkl) and /api/media/13?token=x.y.z\n/api/media/14"
    assert rules.strip_media_tokens(pasted) == "![a](/api/media/12) and /api/media/13\n/api/media/14"


async def test_update_kind_on_migrated_release_note(no_stats) -> None:
    """A changelog entry folded in by 0042 (Site author, ``staff``) can be re-kinded by an admin."""
    ann = _ann(id=10, author_id=None, author=None, audience="staff", kind="release")
    out = await update_announcement(10, AnnouncementUpdate(kind="celebration"), _update_db(ann), _user("admin", id=9))
    assert ann.kind == "celebration" and ann.audience == "staff"
    assert out.kind == "celebration" and out.severity == "success"
