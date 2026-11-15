"""Read-only Boards API; visibility precedes search, paging and serialization."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..board_views import (
    BoardViewerContext, board_load_options, board_out, board_summary_out,
    get_visible_board, load_memberships, page_rows, read_response,
)
from ..database import get_db
from ..inuksuks import require_inuksuks_enabled
from ..models import Board, User
from ..schemas import BoardOut, BoardSummaryOut

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
