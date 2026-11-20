"""Visibility-filtered Markers for Organize and the image drawer."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..authz import can_delete_marker, can_edit_marker
from ..board_memberships import bump_board_membership_versions
from ..board_views import (
    BoardViewerContext, get_visible_board, marker_load_options, marker_out,
    load_memberships, page_rows, read_response,
)
from ..database import get_db
from ..board_writes import (
    bump_marker, cleanup_thumbnails, commit_write, enforce_cap,
    expected_version, marker_projection, lock_boards, lock_image_geometry, lock_marker_graph,
    owner_targets, regenerate_thumbnail, replace_assignments,
    thumbnail_target, validate_assignments,
)
from ..markers import require_markers_enabled
from ..models import Image, Marker, User
from ..schemas import (
    BoardOwnersUpdate, MarkerCreate, MarkerOrderUpdate, MarkerOut, MarkerUpdate,
)

router = APIRouter(
    prefix="/markers", tags=["markers"],
    dependencies=[Depends(require_markers_enabled)],
)

_SORTS = {
    "id", "title", "description", "image_id", "favourite",
    "sort_order", "created_at", "updated_at",
}


async def visible_markers(
    db: AsyncSession, ctx: BoardViewerContext, *, image_id: int | None = None,
    favourite: bool | None = None, board_id: int | None = None,
    scope: str | None = None,
    drawer: bool = False,
) -> list[MarkerOut]:
    stmt = select(Marker).options(*marker_load_options())
    if image_id is not None:
        stmt = stmt.where(Marker.image_id == image_id)
    if favourite is not None:
        stmt = stmt.where(Marker.favourite == favourite)
    items = (await db.execute(stmt)).scalars().unique().all()
    memberships = await load_memberships(db, (item.id for item in items))
    rows = []
    for item in items:
        links = memberships.get(item.id, [])
        boards = ctx.visible_boards(links)
        if not ctx.can_view_marker(item, boards):
            continue
        if board_id is not None and not any(
            ctx.can_view_board(link.board)
            and link.board_id == board_id
            for link in links
        ):
            continue
        source = ctx.source(item, boards)
        if (drawer and source is None) or (scope is not None and source != scope):
            continue
        rows.append(marker_out(ctx, item, boards))
    return rows


@router.get("", response_model=list[MarkerOut])
async def list_markers(
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
) -> list[MarkerOut] | Response:
    ctx = await BoardViewerContext.build(db, user)
    if board_id is not None:
        await get_visible_board(db, ctx, board_id)
    rows = await visible_markers(
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


@router.get("/{marker_id}", response_model=MarkerOut)
async def get_marker(
    marker_id: int, request: Request, response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> MarkerOut | Response:
    ctx = await BoardViewerContext.build(db, user)
    item = (await db.execute(
        select(Marker).where(Marker.id == marker_id).options(*marker_load_options())
    )).scalars().unique().one_or_none()
    if item is None:
        raise HTTPException(404, "Marker not found")
    memberships = await load_memberships(db, [item.id])
    boards = ctx.visible_boards(memberships.get(item.id, []))
    if not ctx.can_view_marker(item, boards):
        raise HTTPException(404, "Marker not found")
    return read_response(request, response, user, marker_out(ctx, item, boards))


@router.post("", response_model=MarkerOut, status_code=201)
async def create_marker(
    body: MarkerCreate, response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> MarkerOut:
    owners = await owner_targets(db, [user.id])
    await enforce_cap(db, owners, set(), "marker")
    ctx = await BoardViewerContext.build(db, user)
    image = await lock_image_geometry(db, body.image_id)
    if image is None or not ctx.can_view_image(image):
        raise HTTPException(404, "Image not found")
    boards = await lock_boards(db, (assignment.board_id for assignment in body.board_assignments))
    validate_assignments(ctx, boards, body.board_assignments)
    item = Marker(
        image=image, title=body.title, description=body.description,
        x=body.x, y=body.y, zoom=body.zoom, rotation=body.rotation,
        favourite=body.favourite, owners=owners, created_by_user_id=user.id,
    )
    db.add(item)
    await db.flush()
    await replace_assignments(db, ctx, item, boards, [], body.board_assignments)
    item_id, version = item.id, item.version
    await commit_write(db, user, "marker.created", item_id)
    await regenerate_thumbnail(db, item_id, version)
    await db.refresh(user)
    result = await marker_projection(db, ctx, item_id)
    response.headers["ETag"] = f'"{result.version}"'
    return result


@router.put("/order", response_model=list[MarkerOut])
async def reorder_markers(
    body: MarkerOrderUpdate, request: Request,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> list[MarkerOut]:
    ctx = await BoardViewerContext.build(db, user)
    _, items, _ = await lock_marker_graph(db, ctx, (item.marker_id for item in body.items))
    for position, entry in enumerate(body.items):
        item = items[entry.marker_id]
        if not can_edit_marker(user, item):
            raise HTTPException(403, "You may not reorder this Marker")
        await bump_marker(db, ctx, item, expected_version(request, entry.version))
        item.sort_order = position
    await commit_write(db, user, "markers.reordered", user.id)
    return [await marker_projection(db, ctx, entry.marker_id) for entry in body.items]


@router.patch("/{marker_id}", response_model=MarkerOut)
async def update_marker(
    marker_id: int, body: MarkerUpdate, request: Request, response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> MarkerOut:
    ctx = await BoardViewerContext.build(db, user)
    if body.model_fields_set & {"x", "y", "zoom", "rotation"}:
        image_id = await db.scalar(select(Marker.image_id).where(Marker.id == marker_id))
        if image_id is None:
            raise HTTPException(404, "Marker not found")
        image = await lock_image_geometry(db, image_id)
        if image is None or not ctx.can_view_image(image):
            raise HTTPException(404, "Image not found")
    targets = (assignment.board_id for assignment in body.board_assignments or [])
    boards, items, links = await lock_marker_graph(db, ctx, [marker_id], targets)
    item = items[marker_id]
    if not can_edit_marker(user, item):
        raise HTTPException(403, "You may not edit this Marker")
    geometry_changed = (
        (body.x is not None and body.x != item.x)
        or (body.y is not None and body.y != item.y)
        or (body.zoom is not None and body.zoom != item.zoom)
        or (body.rotation is not None and body.rotation != item.rotation)
    )
    await bump_marker(db, ctx, item, expected_version(request, body.version))
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
    await commit_write(db, user, "marker.updated", marker_id)
    if geometry_changed:
        await regenerate_thumbnail(db, marker_id, version)
        await db.refresh(user)
    result = await marker_projection(db, ctx, marker_id)
    response.headers["ETag"] = f'"{result.version}"'
    return result


@router.delete("/{marker_id}", status_code=204)
async def delete_marker(
    marker_id: int, request: Request,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> Response:
    ctx = await BoardViewerContext.build(db, user)
    _, items, _ = await lock_marker_graph(db, ctx, [marker_id])
    item = items[marker_id]
    if not can_delete_marker(user, item):
        raise HTTPException(403, "You may not delete this Marker")
    await bump_marker(db, ctx, item, expected_version(request))
    target = thumbnail_target(item)
    await bump_board_membership_versions(db, marker_ids=[item.id])
    await db.execute(delete(Marker).where(Marker.id == item.id))
    await commit_write(db, user, "marker.deleted", marker_id)
    await cleanup_thumbnails([target])
    return Response(status_code=204)


@router.put("/{marker_id}/owners", response_model=MarkerOut)
async def replace_marker_owners(
    marker_id: int, body: BoardOwnersUpdate, request: Request, response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> MarkerOut:
    ctx = await BoardViewerContext.build(db, user)
    item = (await db.execute(
        select(Marker).where(Marker.id == marker_id).options(*marker_load_options())
    )).scalars().unique().one_or_none()
    memberships = await load_memberships(db, [marker_id])
    if item is None or not ctx.can_view_marker(
        item, ctx.visible_boards(memberships.get(marker_id, [])),
    ):
        raise HTTPException(404, "Marker not found")
    if not can_edit_marker(user, item):
        raise HTTPException(403, "You may not manage this Marker's owners")
    owners = await owner_targets(db, body.user_ids)
    _, items, _ = await lock_marker_graph(db, ctx, [marker_id])
    item = items[marker_id]
    if not can_edit_marker(user, item):
        raise HTTPException(403, "You may not manage this Marker's owners")
    if not owners:
        raise HTTPException(422, "A Marker must have at least one user owner")
    await enforce_cap(db, owners, {owner.id for owner in item.owners}, "marker")
    await bump_marker(db, ctx, item, expected_version(request, body.version))
    item.owners = owners
    await commit_write(db, user, "marker.owners_updated", marker_id)
    result = await marker_projection(db, ctx, marker_id)
    response.headers["ETag"] = f'"{result.version}"'
    return result


async def image_markers(
    image_id: int, request: Request, response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> list[MarkerOut] | Response:
    ctx = await BoardViewerContext.build(db, user)
    image = await db.get(Image, image_id)
    if image is None or not ctx.can_view_image(image):
        raise HTTPException(status_code=404, detail="Image not found")
    rows = await visible_markers(db, ctx, image_id=image_id, drawer=True)
    rows.sort(key=lambda row: ({"mine": 0, "instructor": 1, "public": 2}[row.source], row.sort_order, row.id))
    return read_response(request, response, user, rows, total=len(rows))
