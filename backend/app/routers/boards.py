"""Read-only Boards API; visibility precedes search, paging and serialization."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..authz import (
    can_attach_program_to_collection, can_change_board_scope,
    can_delete_board, can_transfer_board,
)
from ..board_views import (
    BoardViewerContext, board_load_options, board_out, board_summary_out,
    get_visible_board, load_memberships, page_rows, read_response,
)
from ..database import get_db
from ..board_writes import (
    board_projection, bump_board, cleanup_thumbnails, commit_write,
    delete_orphans, editable_board, enforce_cap, expected_version,
    lock_boards, lock_inuksuks, owner_targets, touch_inuksuks,
)
from ..inuksuks import require_inuksuks_enabled
from ..models import Board, Program, User
from ..schemas import (
    BoardCreate, BoardInuksuksOrder, BoardOrderUpdate, BoardOut,
    BoardOwnersUpdate,
    BoardSummaryOut, BoardTransfer, BoardUpdate,
)
from .collections import _require_restricted_authority, _resolve_groups, _resolve_programs

router = APIRouter(
    prefix="/boards", tags=["boards"],
    dependencies=[Depends(require_inuksuks_enabled)],
)

_SORTS = {
    "id", "name", "description", "visibility", "owner", "inuksuk_count",
    "sort_order", "created_at", "updated_at",
}


@router.get("", response_model=list[BoardSummaryOut])
async def list_boards(
    request: Request, response: Response,
    user: Annotated[User, Depends(get_current_user)],
    q: str | None = None,
    visibility: Annotated[list[Literal["private", "public", "restricted"]] | None, Query()] = None,
    sort: str = "updated_at", order: str | None = None, direction: str | None = None,
    limit: Annotated[int | None, Query(ge=1, le=100)] = None,
    page: Annotated[int | None, Query(ge=1)] = None,
    page_size: Annotated[int | None, Query(ge=1, le=200)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[BoardSummaryOut] | Response:
    ctx = await BoardViewerContext.build(db, user)
    stmt = select(Board).options(*board_load_options())
    if visibility:
        stmt = stmt.where(Board.visibility.in_(visibility))
    boards = (await db.execute(stmt)).scalars().unique().all()
    rows = [board_summary_out(ctx, b) for b in boards if ctx.can_view_board(b)]
    needle = (q or "").strip().casefold()
    if needle:
        rows = [
            row for row in rows if any(
                needle in value.casefold()
                for value in (row.name, row.description or "", *(o.name for o in row.owners))
            )
        ]
    rows, total = page_rows(
        rows, sort=sort, allowed_sorts=_SORTS, order=order, direction=direction,
        limit=limit, page=page, page_size=page_size,
    )
    return read_response(request, response, user, rows, total=total)


@router.post("", response_model=BoardOut, status_code=201)
async def create_board(
    body: BoardCreate, response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> BoardOut:
    owners = await owner_targets(db, [user.id])
    await enforce_cap(db, owners, set(), "board")
    programs, groups = [], []
    if body.visibility == "restricted":
        _require_restricted_authority(user)
        programs = await _resolve_programs(db, user, body.program_ids, set())
        groups = await _resolve_groups(db, user, body.group_ids, set())
    board = Board(
        name=body.name, description=body.description, visibility=body.visibility,
        owners=owners, programs=programs, groups=groups, created_by_user_id=user.id,
    )
    db.add(board)
    await db.flush()
    board_id = board.id
    await commit_write(db, user, "board.created", board_id)
    ctx = await BoardViewerContext.build(db, user)
    result = await board_projection(db, ctx, board_id)
    response.headers["ETag"] = f'"{result.version}"'
    return result


@router.put("/order", response_model=list[BoardOut])
async def reorder_boards(
    body: BoardOrderUpdate, request: Request,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> list[BoardOut]:
    ctx = await BoardViewerContext.build(db, user)
    locked = await lock_boards(db, (item.board_id for item in body.items))
    for position, item in enumerate(body.items):
        board = editable_board(ctx, locked, item.board_id)
        await bump_board(db, ctx, board, expected_version(request, item.version))
        board.sort_order = position
    await commit_write(db, user, "boards.reordered", user.id)
    return [await board_projection(db, ctx, item.board_id) for item in body.items]


@router.get("/{board_id}", response_model=BoardOut)
async def get_board(
    board_id: int, request: Request, response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> BoardOut | Response:
    ctx = await BoardViewerContext.build(db, user)
    board = await get_visible_board(db, ctx, board_id)
    memberships = await load_memberships(db, (link.inuksuk_id for link in board.inuksuk_links))
    return read_response(request, response, user, board_out(ctx, board, memberships))


@router.patch("/{board_id}", response_model=BoardOut)
async def update_board(
    board_id: int, body: BoardUpdate, request: Request, response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> BoardOut:
    ctx = await BoardViewerContext.build(db, user)
    board = editable_board(ctx, await lock_boards(db, [board_id]), board_id)
    scope_touched = any(value is not None for value in (body.visibility, body.program_ids, body.group_ids))
    if scope_touched and not can_change_board_scope(user, board):
        raise HTTPException(403, "You may not change this Board's scope")
    visibility = body.visibility or board.visibility
    programs, groups = None, None
    if visibility == "restricted":
        if scope_touched:
            _require_restricted_authority(user)
        if body.program_ids is not None:
            programs = await _resolve_programs(db, user, body.program_ids, {p.id for p in board.programs})
        if body.group_ids is not None:
            groups = await _resolve_groups(db, user, body.group_ids, {g.id for g in board.groups})
    else:
        if body.program_ids or body.group_ids:
            raise HTTPException(422, "program_ids/group_ids require restricted visibility")
        programs, groups = [], []
    await bump_board(db, ctx, board, expected_version(request, body.version))
    if body.name is not None:
        board.name = body.name
    if "description" in body.model_fields_set:
        board.description = body.description
    board.visibility = visibility
    if programs is not None:
        board.programs = programs
    if groups is not None:
        board.groups = groups
    await commit_write(db, user, "board.updated", board_id)
    result = await board_projection(db, ctx, board_id)
    response.headers["ETag"] = f'"{result.version}"'
    return result


@router.delete("/{board_id}", status_code=204)
async def delete_board(
    board_id: int, request: Request,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> Response:
    ctx = await BoardViewerContext.build(db, user)
    locked = await lock_boards(db, [board_id])
    board = locked.get(board_id)
    if board is None or not ctx.can_view_board(board):
        raise HTTPException(404, "Board not found")
    if not can_delete_board(user, board):
        raise HTTPException(403, "You may not delete this Board")
    await bump_board(db, ctx, board, expected_version(request))
    items = await lock_inuksuks(db, (link.inuksuk_id for link in board.inuksuk_links))
    await db.execute(delete(Board).where(Board.id == board_id).execution_options(synchronize_session=False))
    await touch_inuksuks(db, (item.id for item in items))
    targets = await delete_orphans(db, items)
    await commit_write(db, user, "board.deleted", board_id)
    await cleanup_thumbnails(targets)
    return Response(status_code=204)


@router.put("/{board_id}/owners", response_model=BoardOut)
async def replace_board_owners(
    board_id: int, body: BoardOwnersUpdate, request: Request, response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> BoardOut:
    ctx = await BoardViewerContext.build(db, user)
    board = await get_visible_board(db, ctx, board_id)
    if not can_transfer_board(user, board):
        raise HTTPException(403, "You may not manage this Board's owners")
    owners = await owner_targets(db, body.user_ids)
    board = editable_board(ctx, await lock_boards(db, [board_id]), board_id)
    if not can_transfer_board(user, board):
        raise HTTPException(403, "You may not manage this Board's owners")
    if not owners and board.owner_program_id is None:
        raise HTTPException(422, "A Board must have at least one user owner or owning program")
    await enforce_cap(db, owners, {owner.id for owner in board.owners}, "board")
    await bump_board(db, ctx, board, expected_version(request, body.version))
    board.owners = owners
    await commit_write(db, user, "board.owners_updated", board_id)
    result = await board_projection(db, ctx, board_id)
    response.headers["ETag"] = f'"{result.version}"'
    return result


@router.post("/{board_id}/transfer", response_model=BoardOut)
async def transfer_board(
    board_id: int, body: BoardTransfer, request: Request, response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> BoardOut:
    ctx = await BoardViewerContext.build(db, user)
    board = editable_board(ctx, await lock_boards(db, [board_id]), board_id)
    if not can_transfer_board(user, board):
        raise HTTPException(403, "You may not transfer this Board")
    program = None
    if body.program_id is None:
        if not board.owners:
            raise HTTPException(422, "Cannot clear the program owner without user owners")
    else:
        program = await db.get(Program, body.program_id)
        if program is None:
            raise HTTPException(422, "Invalid program ID")
        if not can_attach_program_to_collection(user, program.id):
            raise HTTPException(403, "You may only transfer to programs you belong to")
    await bump_board(db, ctx, board, expected_version(request, body.version))
    board.owner_program = program
    board.owner_program_id = body.program_id
    if program is not None:
        board.owners = []
    await commit_write(db, user, "board.transferred", board_id)
    result = await board_projection(db, ctx, board_id)
    response.headers["ETag"] = f'"{result.version}"'
    return result


@router.put("/{board_id}/inuksuks/order", response_model=BoardOut)
async def reorder_board_inuksuks(
    board_id: int, body: BoardInuksuksOrder, request: Request, response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> BoardOut:
    ctx = await BoardViewerContext.build(db, user)
    board = editable_board(ctx, await lock_boards(db, [board_id]), board_id)
    await bump_board(db, ctx, board, expected_version(request, body.version))
    visible = {link.inuksuk_id: link for link in board.inuksuk_links if ctx.can_view_image(link.inuksuk.image)}
    if {item.inuksuk_id for item in body.items} != set(visible):
        raise HTTPException(422, "items must contain every visible Board member exactly once")
    await lock_inuksuks(db, (link.inuksuk_id for link in board.inuksuk_links))
    await touch_inuksuks(db, (link.inuksuk_id for link in board.inuksuk_links))
    for position, item in enumerate(body.items):
        visible[item.inuksuk_id].sort_order = position
    hidden = [link for link in board.inuksuk_links if link.inuksuk_id not in visible]
    for position, link in enumerate(hidden, start=len(visible)):
        link.sort_order = position
    await commit_write(db, user, "board.inuksuks_reordered", board_id)
    result = await board_projection(db, ctx, board_id)
    response.headers["ETag"] = f'"{result.version}"'
    return result


@router.delete("/{board_id}/inuksuks/{inuksuk_id}", response_model=BoardOut)
async def remove_board_inuksuk(
    board_id: int, inuksuk_id: int, request: Request, response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> BoardOut:
    ctx = await BoardViewerContext.build(db, user)
    board = editable_board(ctx, await lock_boards(db, [board_id]), board_id)
    items = await lock_inuksuks(db, [inuksuk_id])
    if not items or not ctx.can_view_image(items[0].image):
        raise HTTPException(404, "Inuksuk not found")
    links = (await load_memberships(db, [inuksuk_id])).get(inuksuk_id, [])
    link = next((link for link in links if link.board_id == board_id), None)
    if link is None:
        raise HTTPException(404, "Inuksuk not found on this Board")
    if len(links) <= 1:
        raise HTTPException(422, "An Inuksuk must belong to at least one Board")
    await bump_board(db, ctx, board, expected_version(request))
    await touch_inuksuks(db, [inuksuk_id])
    await db.delete(link)
    await commit_write(db, user, "board.inuksuk_removed", board_id)
    result = await board_projection(db, ctx, board_id)
    response.headers["ETag"] = f'"{result.version}"'
    return result
