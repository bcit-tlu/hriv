"""Visibility-filtered Inuksuks for Organize and the image drawer."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..authz import can_delete_inuksuk, can_edit_inuksuk
from ..board_memberships import bump_board_membership_versions
from ..board_views import (
    BoardViewerContext, get_visible_board, inuksuk_load_options, inuksuk_out,
    load_memberships, page_rows, read_response,
)
from ..database import get_db
from ..board_writes import (
    bump_inuksuk, cleanup_thumbnails, commit_write, enforce_cap,
    expected_version, inuksuk_projection, lock_boards, lock_image_geometry, lock_inuksuk_graph,
    owner_targets, regenerate_thumbnail, replace_assignments,
    thumbnail_target, validate_assignments,
)
from ..inuksuks import require_inuksuks_enabled
from ..models import Image, Inuksuk, User
from ..schemas import (
    BoardOwnersUpdate, InuksukCreate, InuksukOrderUpdate, InuksukOut, InuksukUpdate,
)

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
    scope: str | None = None,
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
        if board_id is not None and not any(
            ctx.can_view_board(link.board)
            and (board_id is None or link.board_id == board_id)
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
    board_id: int | None = None,
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
        scope=scope,
    )
    needle = (q or "").strip().casefold()
    if needle:
        rows = [row for row in rows if needle in row.title.casefold() or needle in (row.description or "").casefold()]
    rows, total = page_rows(
        rows, sort=sort, allowed_sorts=_SORTS, order=order, direction=direction,
        limit=limit, page=page, page_size=page_size,
    )
    return read_response(request, response, user, rows, total=total)


@router.get("/{inuksuk_id}", response_model=InuksukOut)
async def get_inuksuk(
    inuksuk_id: int, request: Request, response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> InuksukOut | Response:
    ctx = await BoardViewerContext.build(db, user)
    item = (await db.execute(
        select(Inuksuk).where(Inuksuk.id == inuksuk_id).options(*inuksuk_load_options())
    )).scalars().unique().one_or_none()
    if item is None:
        raise HTTPException(404, "Inuksuk not found")
    memberships = await load_memberships(db, [item.id])
    boards = ctx.visible_boards(memberships.get(item.id, []))
    if not ctx.can_view_inuksuk(item, boards):
        raise HTTPException(404, "Inuksuk not found")
    return read_response(request, response, user, inuksuk_out(ctx, item, boards))


@router.post("", response_model=InuksukOut, status_code=201)
async def create_inuksuk(
    body: InuksukCreate, response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> InuksukOut:
    owners = await owner_targets(db, [user.id])
    await enforce_cap(db, owners, set(), "inuksuk")
    ctx = await BoardViewerContext.build(db, user)
    image = await lock_image_geometry(db, body.image_id)
    if image is None or not ctx.can_view_image(image):
        raise HTTPException(404, "Image not found")
    boards = await lock_boards(db, (assignment.board_id for assignment in body.board_assignments))
    validate_assignments(ctx, boards, body.board_assignments)
    item = Inuksuk(
        image=image, title=body.title, description=body.description,
        x=body.x, y=body.y, zoom=body.zoom, rotation=body.rotation,
        favourite=body.favourite, owners=owners, created_by_user_id=user.id,
    )
    db.add(item)
    await db.flush()
    await replace_assignments(db, ctx, item, boards, [], body.board_assignments)
    item_id, version = item.id, item.version
    await commit_write(db, user, "inuksuk.created", item_id)
    await regenerate_thumbnail(db, item_id, version)
    await db.refresh(user)
    result = await inuksuk_projection(db, ctx, item_id)
    response.headers["ETag"] = f'"{result.version}"'
    return result


@router.put("/order", response_model=list[InuksukOut])
async def reorder_inuksuks(
    body: InuksukOrderUpdate, request: Request,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> list[InuksukOut]:
    ctx = await BoardViewerContext.build(db, user)
    _, items, _ = await lock_inuksuk_graph(db, ctx, (item.inuksuk_id for item in body.items))
    for position, entry in enumerate(body.items):
        item = items[entry.inuksuk_id]
        if not can_edit_inuksuk(user, item):
            raise HTTPException(403, "You may not reorder this Inuksuk")
        await bump_inuksuk(db, ctx, item, expected_version(request, entry.version))
        item.sort_order = position
    await commit_write(db, user, "inuksuks.reordered", user.id)
    return [await inuksuk_projection(db, ctx, entry.inuksuk_id) for entry in body.items]


@router.patch("/{inuksuk_id}", response_model=InuksukOut)
async def update_inuksuk(
    inuksuk_id: int, body: InuksukUpdate, request: Request, response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> InuksukOut:
    ctx = await BoardViewerContext.build(db, user)
    if body.model_fields_set & {"x", "y", "zoom", "rotation"}:
        image_id = await db.scalar(select(Inuksuk.image_id).where(Inuksuk.id == inuksuk_id))
        if image_id is None:
            raise HTTPException(404, "Inuksuk not found")
        image = await lock_image_geometry(db, image_id)
        if image is None or not ctx.can_view_image(image):
            raise HTTPException(404, "Image not found")
    targets = (assignment.board_id for assignment in body.board_assignments or [])
    boards, items, links = await lock_inuksuk_graph(db, ctx, [inuksuk_id], targets)
    item = items[inuksuk_id]
    if not can_edit_inuksuk(user, item):
        raise HTTPException(403, "You may not edit this Inuksuk")
    geometry_changed = (
        (body.x is not None and body.x != item.x)
        or (body.y is not None and body.y != item.y)
        or (body.zoom is not None and body.zoom != item.zoom)
        or (body.rotation is not None and body.rotation != item.rotation)
    )
    await bump_inuksuk(db, ctx, item, expected_version(request, body.version))
    if body.board_assignments is not None:
        await replace_assignments(db, ctx, item, boards, links.get(item.id, []), body.board_assignments)
    if body.title is not None:
        item.title = body.title
    if "description" in body.model_fields_set:
        item.description = body.description
    if body.x is not None:
        item.x = body.x
    if body.y is not None:
        item.y = body.y
    if body.zoom is not None:
        item.zoom = body.zoom
    if body.rotation is not None:
        item.rotation = body.rotation
    if body.favourite is not None:
        item.favourite = body.favourite
    if geometry_changed:
        item.thumb = None
    version = item.version
    await commit_write(db, user, "inuksuk.updated", inuksuk_id)
    if geometry_changed:
        await regenerate_thumbnail(db, inuksuk_id, version)
        await db.refresh(user)
    result = await inuksuk_projection(db, ctx, inuksuk_id)
    response.headers["ETag"] = f'"{result.version}"'
    return result


@router.delete("/{inuksuk_id}", status_code=204)
async def delete_inuksuk(
    inuksuk_id: int, request: Request,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> Response:
    ctx = await BoardViewerContext.build(db, user)
    _, items, _ = await lock_inuksuk_graph(db, ctx, [inuksuk_id])
    item = items[inuksuk_id]
    if not can_delete_inuksuk(user, item):
        raise HTTPException(403, "You may not delete this Inuksuk")
    await bump_inuksuk(db, ctx, item, expected_version(request))
    target = thumbnail_target(item)
    await bump_board_membership_versions(db, inuksuk_ids=[item.id])
    await db.execute(delete(Inuksuk).where(Inuksuk.id == item.id))
    await commit_write(db, user, "inuksuk.deleted", inuksuk_id)
    await cleanup_thumbnails([target])
    return Response(status_code=204)


@router.put("/{inuksuk_id}/owners", response_model=InuksukOut)
async def replace_inuksuk_owners(
    inuksuk_id: int, body: BoardOwnersUpdate, request: Request, response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> InuksukOut:
    ctx = await BoardViewerContext.build(db, user)
    item = (await db.execute(
        select(Inuksuk).where(Inuksuk.id == inuksuk_id).options(*inuksuk_load_options())
    )).scalars().unique().one_or_none()
    memberships = await load_memberships(db, [inuksuk_id])
    if item is None or not ctx.can_view_inuksuk(
        item, ctx.visible_boards(memberships.get(inuksuk_id, [])),
    ):
        raise HTTPException(404, "Inuksuk not found")
    if not can_edit_inuksuk(user, item):
        raise HTTPException(403, "You may not manage this Inuksuk's owners")
    owners = await owner_targets(db, body.user_ids)
    _, items, _ = await lock_inuksuk_graph(db, ctx, [inuksuk_id])
    item = items[inuksuk_id]
    if not can_edit_inuksuk(user, item):
        raise HTTPException(403, "You may not manage this Inuksuk's owners")
    if not owners:
        raise HTTPException(422, "An Inuksuk must have at least one user owner")
    await enforce_cap(db, owners, {owner.id for owner in item.owners}, "inuksuk")
    await bump_inuksuk(db, ctx, item, expected_version(request, body.version))
    item.owners = owners
    await commit_write(db, user, "inuksuk.owners_updated", inuksuk_id)
    result = await inuksuk_projection(db, ctx, inuksuk_id)
    response.headers["ETag"] = f'"{result.version}"'
    return result


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
