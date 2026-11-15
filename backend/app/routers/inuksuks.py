"""Visibility-filtered Inuksuks for Organize and the image drawer."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..board_views import (
    BoardViewerContext, get_visible_board, inuksuk_load_options, inuksuk_out,
    load_memberships, page_rows, read_response,
)
from ..database import get_db
from ..inuksuks import require_inuksuks_enabled
from ..models import Image, Inuksuk, User
from ..schemas import InuksukOut

router = APIRouter(
    prefix="/inuksuks", tags=["inuksuks"],
    dependencies=[Depends(require_inuksuks_enabled)],
)

_SORTS = {
    "id", "title", "description", "image_id", "favourite",
    "sort_order", "created_at", "updated_at",
}


async def visible_inuksuks(
    db: AsyncSession, ctx: BoardViewerContext, *, image_id: int | None = None,
    favourite: bool | None = None, board_id: int | None = None,
    section_id: int | None = None, scope: str | None = None,
    drawer: bool = False,
) -> list[InuksukOut]:
    stmt = select(Inuksuk).options(*inuksuk_load_options())
    if image_id is not None:
        stmt = stmt.where(Inuksuk.image_id == image_id)
    if favourite is not None:
        stmt = stmt.where(Inuksuk.favourite == favourite)
    items = (await db.execute(stmt)).scalars().unique().all()
    memberships = await load_memberships(db, (item.id for item in items))
    rows = []
    for item in items:
        links = memberships.get(item.id, [])
        boards = ctx.visible_boards(links)
        if not ctx.can_view_inuksuk(item, boards):
            continue
        if (board_id is not None or section_id is not None) and not any(
            ctx.can_view_board(link.board)
            and (board_id is None or link.board_id == board_id)
            and (section_id is None or link.section_id == section_id)
            for link in links
        ):
            continue
        source = ctx.source(item, boards)
        if (drawer and source is None) or (scope is not None and source != scope):
            continue
        rows.append(inuksuk_out(ctx, item, boards))
    return rows


@router.get("", response_model=list[InuksukOut])
async def list_inuksuks(
    request: Request, response: Response,
    user: Annotated[User, Depends(get_current_user)],
    board_id: int | None = None, section_id: int | None = None,
    image_id: int | None = None, favourite: bool | None = None,
    scope: Literal["mine", "instructor", "public"] | None = None,
    q: str | None = None, sort: str = "updated_at",
    order: str | None = None, direction: str | None = None,
    limit: Annotated[int | None, Query(ge=1, le=100)] = None,
    page: Annotated[int | None, Query(ge=1)] = None,
    page_size: Annotated[int | None, Query(ge=1, le=200)] = None,
    db: AsyncSession = Depends(get_db),
) -> list[InuksukOut] | Response:
    ctx = await BoardViewerContext.build(db, user)
    if board_id is not None:
        await get_visible_board(db, ctx, board_id)
    rows = await visible_inuksuks(
        db, ctx, image_id=image_id, favourite=favourite, board_id=board_id,
        section_id=section_id, scope=scope,
    )
    needle = (q or "").strip().casefold()
    if needle:
        rows = [row for row in rows if needle in row.title.casefold() or needle in (row.description or "").casefold()]
    rows, total = page_rows(
        rows, sort=sort, allowed_sorts=_SORTS, order=order, direction=direction,
        limit=limit, page=page, page_size=page_size,
    )
    return read_response(request, response, user, rows, total=total)


async def image_inuksuks(
    image_id: int, request: Request, response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> list[InuksukOut] | Response:
    ctx = await BoardViewerContext.build(db, user)
    image = await db.get(Image, image_id)
    if image is None or not ctx.can_view_image(image):
        raise HTTPException(status_code=404, detail="Image not found")
    rows = await visible_inuksuks(db, ctx, image_id=image_id, drawer=True)
    rows.sort(key=lambda row: ({"mine": 0, "instructor": 1, "public": 2}[row.source], row.sort_order, row.id))
    return read_response(request, response, user, rows, total=len(rows))
