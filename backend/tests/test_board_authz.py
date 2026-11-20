"""Board authority matrix and Marker visibility/source rules."""

from types import SimpleNamespace as NS

import pytest

from app.authz import (
    can_change_board_scope, can_delete_board, can_delete_marker,
    can_edit_board, can_edit_marker, can_transfer_board, can_view_board,
    is_board_owner, is_marker_owner,
)
from app.board_views import BoardViewerContext


def user(role="student"):
    return NS(id=1, role=role, programs=[NS(id=10)], groups=[NS(id=20)])


@pytest.mark.parametrize("role", ["admin", "instructor", "staff", "student"])
@pytest.mark.parametrize("visibility", ["private", "public", "restricted"])
@pytest.mark.parametrize("programs", [[], [10], [99]])
@pytest.mark.parametrize("groups", [[], [20], [99]])
@pytest.mark.parametrize("owner", [False, True])
def test_board_visibility_matrix(role, visibility, programs, groups, owner):
    caller = user(role)
    board = NS(
        owners=[caller] if owner else [], visibility=visibility,
        programs=[NS(id=p) for p in programs], groups=[NS(id=g) for g in groups],
    )
    gate = (not programs or 10 in programs) and (not groups or 20 in groups)
    expected = (
        role != "student" or owner or visibility == "public"
        or (visibility == "restricted" and gate)
    )
    assert can_view_board(caller, board, {10}, {20}) == expected
    assert is_board_owner(caller, board) == owner


@pytest.mark.parametrize("role", ["admin", "instructor", "staff", "student"])
@pytest.mark.parametrize("owners", [[], [1], [1, 2], [2]])
@pytest.mark.parametrize("program", [None, 10, 99])
def test_board_write_authority(role, owners, program):
    caller = user(role)
    board = NS(owners=[NS(id=i) for i in owners], owner_program_id=program)
    owns = 1 in owners
    manages = role == "instructor" and (owns or program == 10)
    edit = role == "admin" or manages or (role in ("staff", "student") and owns)
    scope = (
        role == "admin" or manages
        or (role in ("staff", "student") and owners == [1] and program is None)
    )
    assert can_edit_board(caller, board) == edit
    assert can_change_board_scope(caller, board) == scope
    assert can_delete_board(caller, board) == scope
    assert can_transfer_board(caller, board) == (role == "admin" or manages)


@pytest.mark.parametrize("role", ["admin", "instructor", "staff", "student"])
@pytest.mark.parametrize("owners", [[], [1], [1, 2], [2]])
def test_marker_write_authority(role, owners):
    caller = user(role)
    item = NS(owners=[NS(id=i) for i in owners])
    assert is_marker_owner(caller, item) == (1 in owners)
    assert can_edit_marker(caller, item) == (role == "admin" or 1 in owners)
    assert can_delete_marker(caller, item) == (role == "admin" or 1 in owners)


@pytest.mark.parametrize("role", ["admin", "instructor", "staff", "student"])
@pytest.mark.parametrize("active,category_id", [(False, None), (True, 99), (True, None)])
@pytest.mark.parametrize("owner,board_visible", [(False, False), (False, True), (True, False)])
def test_image_gate_cannot_be_bypassed(role, active, category_id, owner, board_visible):
    caller = user(role)
    ctx = BoardViewerContext(caller, {99} if role == "student" else None)
    item = NS(owners=[caller] if owner else [], image=NS(active=active, category_id=category_id))
    expected = (
        (role != "student" or (active and category_id != 99))
        and (role != "student" or owner or board_visible)
    )
    assert ctx.can_view_marker(item, [NS()] if board_visible else []) == expected


async def test_context_passes_both_membership_dimensions(monkeypatch):
    from unittest.mock import AsyncMock
    from app import board_views

    excluded = AsyncMock(return_value={42})
    monkeypatch.setattr(board_views, "get_student_excluded_category_ids", excluded)
    caller = user()
    db = object()
    ctx = await BoardViewerContext.build(db, caller)
    excluded.assert_awaited_once_with(db, {10}, {20})
    assert ctx.excluded_category_ids == {42}


def test_source_precedence_and_unlabelled_private_student_content():
    caller = user("staff")
    ctx = BoardViewerContext(caller, None)
    item = NS(owners=[])
    public = NS(visibility="public", owner_program_id=None, owners=[NS(role="student")])
    instructor = NS(visibility="public", owner_program_id=None, owners=[NS(id=2, role="instructor")])
    program = NS(visibility="private", owner_program_id=10, owners=[])
    private = NS(visibility="private", owner_program_id=None, owners=[NS(id=3, role="student")])
    assert ctx.source(item, [private]) is None
    assert ctx.source(item, [public]) == "public"
    assert ctx.source(item, [public, instructor]) == "instructor"
    assert ctx.source(item, [program]) == "instructor"
    item.owners = [caller]
    assert ctx.source(item, [public, instructor, program]) == "mine"


def test_others_private_boards_do_not_tag_staff_sources():
    caller = user("instructor")
    ctx = BoardViewerContext(caller, None)
    item = NS(owners=[])
    admin = NS(id=99, role="admin")
    private_admin = NS(visibility="private", owner_program_id=None, owners=[admin])
    public = NS(visibility="public", owner_program_id=None, owners=[NS(id=98, role="student")])
    assert ctx.source(item, [private_admin]) is None
    assert ctx.source(item, [private_admin, public]) == "public"
    shared = NS(visibility="private", owner_program_id=None, owners=[admin, caller])
    assert ctx.source(item, [shared]) == "instructor"
    program = NS(visibility="private", owner_program_id=10, owners=[])
    assert ctx.source(item, [program]) == "instructor"
    assert not ctx.discoverable(private_admin)
    assert ctx.discoverable(public) and ctx.discoverable(shared) and ctx.discoverable(program)
