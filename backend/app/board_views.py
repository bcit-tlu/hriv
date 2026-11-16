"""Batch-loaded Board/Inuksuk visibility and response projections."""

from collections import defaultdict
from collections.abc import Callable, Iterable
from datetime import datetime
import hashlib
import json
import time
from typing import TypeVar
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import lazyload, selectinload

from .auth import auth_settings
from .authz import (
    can_change_board_scope, can_delete_board, can_delete_inuksuk,
    can_edit_board, can_edit_inuksuk, can_transfer_board, can_view_board,
    is_inuksuk_owner,
)
from .collection_views import _owners_out
from .models import Board, BoardInuksuk, Image, Inuksuk, User
from .schemas import (
    BoardOut, BoardPermissionsOut,
    BoardSummaryOut, CollectionOwnerOut, InuksukOut, InuksukPermissionsOut,
)
from .tile_tokens import append_inuksuk_thumb_token, append_thumb_token
from .visibility import get_student_excluded_category_ids


class BoardViewerContext:
    def __init__(self, user: User, excluded_category_ids: set[int] | None) -> None:
        self.user = user
        self.program_ids = {p.id for p in user.programs}
        self.group_ids = {g.id for g in user.groups}
        self.excluded_category_ids = excluded_category_ids

    @classmethod
    async def build(cls, db: AsyncSession, user: User) -> "BoardViewerContext":
        excluded = None
        if user.role == "student":
            excluded = await get_student_excluded_category_ids(
                db, {p.id for p in user.programs}, {g.id for g in user.groups},
            )
        return cls(user, excluded)

    def can_view_board(self, board: Board) -> bool:
        return can_view_board(self.user, board, self.program_ids, self.group_ids)

    def can_view_image(self, image: Image) -> bool:
        if self.excluded_category_ids is None:
            return True
        return bool(image.active) and (
            image.category_id not in self.excluded_category_ids
        )

    def visible_boards(self, links: Iterable[BoardInuksuk]) -> list[Board]:
        return sorted(
            (link.board for link in links if self.can_view_board(link.board)),
            key=lambda board: board.id,
        )

    def can_view_inuksuk(self, inuksuk: Inuksuk, boards: list[Board]) -> bool:
        return self.can_view_image(inuksuk.image) and (
            self.user.role != "student"
            or is_inuksuk_owner(self.user, inuksuk)
            or bool(boards)
        )

    def source(self, inuksuk: Inuksuk, boards: list[Board]) -> str | None:
        if is_inuksuk_owner(self.user, inuksuk):
            return "mine"
        if any(
            b.owner_program_id is not None
            or any(o.role in ("admin", "instructor") for o in b.owners)
            for b in boards
        ):
            return "instructor"
        if any(b.visibility == "public" for b in boards):
            return "public"
        return None


def board_load_options() -> tuple:
    return (
        lazyload("*"),
        selectinload(Board.owners),
        selectinload(Board.owner_program),
        selectinload(Board.programs),
        selectinload(Board.groups),
        selectinload(Board.inuksuk_links).selectinload(BoardInuksuk.inuksuk)
        .selectinload(Inuksuk.image).selectinload(Image.category),
        selectinload(Board.inuksuk_links).selectinload(BoardInuksuk.inuksuk)
        .selectinload(Inuksuk.owners),
    )


def inuksuk_load_options() -> tuple:
    return (
        lazyload("*"), selectinload(Inuksuk.image).selectinload(Image.category),
        selectinload(Inuksuk.owners),
    )


async def load_memberships(
    db: AsyncSession, inuksuk_ids: Iterable[int],
) -> dict[int, list[BoardInuksuk]]:
    ids = set(inuksuk_ids)
    memberships: dict[int, list[BoardInuksuk]] = defaultdict(list)
    if not ids:
        return memberships
    stmt = select(BoardInuksuk).where(BoardInuksuk.inuksuk_id.in_(ids)).options(
        lazyload("*"),
        selectinload(BoardInuksuk.board).options(
            lazyload("*"), selectinload(Board.owners),
            selectinload(Board.programs), selectinload(Board.groups),
        ),
    )
    for link in (await db.execute(stmt)).scalars().unique():
        memberships[link.inuksuk_id].append(link)
    return memberships


async def get_visible_board(
    db: AsyncSession, ctx: BoardViewerContext, board_id: int,
) -> Board:
    board = (await db.execute(
        select(Board).where(Board.id == board_id).options(*board_load_options())
    )).scalars().unique().one_or_none()
    if board is None or not ctx.can_view_board(board):
        raise HTTPException(status_code=404, detail="Board not found")
    return board


def inuksuk_thumb(inuksuk: Inuksuk) -> str | None:
    if inuksuk.thumb:
        return append_inuksuk_thumb_token(inuksuk.thumb)
    return append_thumb_token(inuksuk.image.thumb) if inuksuk.image.thumb else None


def inuksuk_out(
    ctx: BoardViewerContext, inuksuk: Inuksuk, boards: list[Board],
) -> InuksukOut:
    return InuksukOut(
        id=inuksuk.id, image_id=inuksuk.image_id, title=inuksuk.title,
        category_name=(
            inuksuk.image.category.label
            if ctx.can_view_image(inuksuk.image) and inuksuk.image.category else None
        ),
        description=inuksuk.description, x=inuksuk.x, y=inuksuk.y,
        zoom=inuksuk.zoom, rotation=inuksuk.rotation, thumb=inuksuk_thumb(inuksuk),
        favourite=inuksuk.favourite, sort_order=inuksuk.sort_order,
        version=inuksuk.version,
        owners=[
            CollectionOwnerOut(user_id=o.id, name=o.name, role=o.role)
            for o in sorted(inuksuk.owners, key=lambda o: (o.name.casefold(), o.id))
        ],
        board_ids=[b.id for b in boards], source=ctx.source(inuksuk, boards),
        permissions=InuksukPermissionsOut(
            can_edit=can_edit_inuksuk(ctx.user, inuksuk),
            can_delete=can_delete_inuksuk(ctx.user, inuksuk),
        ),
        created_at=inuksuk.created_at, updated_at=inuksuk.updated_at,
    )


def board_summary_out(ctx: BoardViewerContext, board: Board) -> BoardSummaryOut:
    visible = sorted(
        (link for link in board.inuksuk_links if ctx.can_view_image(link.inuksuk.image)),
        key=lambda link: (link.sort_order, link.inuksuk_id),
    )
    return BoardSummaryOut(
        id=board.id, name=board.name, description=board.description,
        visibility=board.visibility, owners=_owners_out(board),
        owner_program_id=board.owner_program_id,
        program_ids=sorted(p.id for p in board.programs),
        group_ids=sorted(g.id for g in board.groups),
        inuksuk_count=len(visible),
        cover_thumb=inuksuk_thumb(visible[0].inuksuk) if visible else None,
        sort_order=board.sort_order, version=board.version,
        permissions=BoardPermissionsOut(
            can_edit=can_edit_board(ctx.user, board),
            can_change_scope=can_change_board_scope(ctx.user, board),
            can_delete=can_delete_board(ctx.user, board),
            can_transfer=can_transfer_board(ctx.user, board),
        ),
        created_at=board.created_at, updated_at=board.updated_at,
    )


def board_out(
    ctx: BoardViewerContext, board: Board,
    memberships: dict[int, list[BoardInuksuk]],
) -> BoardOut:
    members = []
    for link in sorted(board.inuksuk_links, key=lambda link: (link.sort_order, link.inuksuk_id)):
        boards = ctx.visible_boards(memberships.get(link.inuksuk_id, []))
        if ctx.can_view_inuksuk(link.inuksuk, boards):
            fields = inuksuk_out(ctx, link.inuksuk, boards).model_dump()
            fields["sort_order"] = link.sort_order
            members.append(InuksukOut(**fields))
    return BoardOut(
        **board_summary_out(ctx, board).model_dump(),
        inuksuks=members,
    )


SortValue = str | int | bool | datetime | None
Row = TypeVar("Row", BoardSummaryOut, InuksukOut)

_BOARD_SORT_ACCESSORS: dict[str, Callable[[BoardSummaryOut], SortValue]] = {
    "id": lambda row: row.id,
    "name": lambda row: row.name,
    "description": lambda row: row.description,
    "visibility": lambda row: row.visibility,
    "owner": lambda row: ", ".join(owner.name for owner in row.owners),
    "inuksuk_count": lambda row: row.inuksuk_count,
    "sort_order": lambda row: row.sort_order,
    "created_at": lambda row: row.created_at,
    "updated_at": lambda row: row.updated_at,
}
_INUKSUK_SORT_ACCESSORS: dict[str, Callable[[InuksukOut], SortValue]] = {
    "id": lambda row: row.id,
    "title": lambda row: row.title,
    "description": lambda row: row.description,
    "image_id": lambda row: row.image_id,
    "favourite": lambda row: row.favourite,
    "sort_order": lambda row: row.sort_order,
    "created_at": lambda row: row.created_at,
    "updated_at": lambda row: row.updated_at,
}


def page_rows(
    rows: list[Row], *, sort: str, allowed_sorts: set[str], order: str | None,
    direction: str | None, limit: int | None, page: int | None,
    page_size: int | None,
) -> tuple[list[Row], int]:
    if sort not in allowed_sorts:
        raise HTTPException(status_code=422, detail=f"sort must be one of {', '.join(sorted(allowed_sorts))}")
    if any(value not in (None, "asc", "desc") for value in (order, direction)):
        raise HTTPException(status_code=422, detail="order/direction must be asc or desc")
    if order is not None and direction is not None and order != direction:
        raise HTTPException(status_code=422, detail="order and direction disagree")
    if page is not None and page_size is None:
        raise HTTPException(status_code=422, detail="page requires page_size")
    if limit is not None and (page is not None or page_size is not None):
        raise HTTPException(status_code=422, detail="limit cannot be combined with page/page_size")
    descending = (order or direction or (
        "desc" if sort in ("id", "created_at", "updated_at", "inuksuk_count") else "asc"
    )) == "desc"

    def key(row: BoardSummaryOut | InuksukOut) -> tuple[SortValue, int]:
        if isinstance(row, BoardSummaryOut):
            value = _BOARD_SORT_ACCESSORS[sort](row)
        else:
            value = _INUKSUK_SORT_ACCESSORS[sort](row)
        if value is None:
            value = ""
        if isinstance(value, str):
            value = value.casefold()
        return value, row.id

    rows = sorted(rows, key=key, reverse=descending)
    total = len(rows)
    if page_size is not None:
        start = ((page or 1) - 1) * page_size
        rows = rows[start:start + page_size]
    elif limit is not None:
        rows = rows[:limit]
    return rows, total


type JSONValue = str | int | float | bool | None | list[JSONValue] | dict[str, JSONValue]


def read_response(
    request: Request, response: Response, user: User,
    payload: BaseModel | list[BaseModel], *, total: int | None = None,
) -> BaseModel | list[BaseModel] | Response:
    """Content ETags include filtered memberships and a thumbnail-token TTL epoch."""
    def stable(value: JSONValue, key: str = "") -> JSONValue:
        if isinstance(value, list):
            return [stable(item) for item in value]
        if isinstance(value, dict):
            return {k: stable(v, k) for k, v in value.items()}
        if key in ("thumb", "cover_thumb") and isinstance(value, str):
            scheme, netloc, path, query, fragment = urlsplit(value)
            query = urlencode([(k, v) for k, v in parse_qsl(query) if k != "tile_token"])
            return urlunsplit((scheme, netloc, path, query, fragment))
        return value

    body = (
        [item.model_dump(mode="json") for item in payload]
        if isinstance(payload, list) else payload.model_dump(mode="json")
    )
    fingerprint = {
        "body": stable(body), "total": total,
        "viewer": [user.id, user.role, sorted(p.id for p in user.programs), sorted(g.id for g in user.groups)],
        "path": request.url.path,
        "query": sorted(request.query_params.multi_items()),
        "epoch": int(time.time() // max(1, auth_settings.tile_token_ttl_minutes * 60)),
    }
    digest = hashlib.sha256(json.dumps(fingerprint, sort_keys=True).encode()).hexdigest()
    etag = f'W/"inuksuks-{digest}"'
    headers = {"ETag": etag, "Cache-Control": "private, no-cache"}
    if total is not None:
        headers["X-Total-Count"] = str(total)
    response.headers.update(headers)
    if any(
        candidate.strip() == "*"
        or candidate.strip().removeprefix("W/") == etag.removeprefix("W/")
        for candidate in request.headers.get("if-none-match", "").split(",")
    ):
        return Response(status_code=304, headers=headers)
    return payload
