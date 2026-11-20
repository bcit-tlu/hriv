"""Shared transactional guards and thumbnail lifecycle for Board/Marker writes."""

import asyncio
import logging
from collections.abc import Iterable
from typing import Literal

from fastapi import HTTPException, Request
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import attributes, selectinload

from .authz import can_edit_board
from .board_memberships import bump_board_membership_versions
from .board_views import (
    BoardViewerContext, board_load_options, board_out, marker_load_options,
    marker_out, load_memberships,
)
from .browse_state import bump_browse_revision
from .marker_thumbs import generate_marker_thumbnail, remove_marker_thumbnail
from .models import (
    Board, BoardMarker, Image, Marker, User,
    STUDENT_MAX_BOARDS, STUDENT_MAX_MARKERS,
)
from .routers.collections import _resolve_owner_users
from .schemas import BoardAssignment, BoardOut, MarkerOut

logger = logging.getLogger(__name__)


def expected_version(request: Request, version: int | None = None) -> int:
    header = request.headers.get("if-match")
    if header is not None:
        try:
            parsed = int(header.removeprefix("W/").strip('"'))
            if parsed < 1:
                raise ValueError
        except ValueError:
            raise HTTPException(400, "Invalid If-Match header")
        if version is not None and version != parsed:
            raise HTTPException(400, "If-Match and body version disagree")
        return parsed
    if version is None:
        raise HTTPException(428, "If-Match or version is required")
    return version


async def lock_image_geometry(db: AsyncSession, image_id: int) -> Image | None:
    return (await db.execute(
        select(Image).where(Image.id == image_id).with_for_update(read=True)
        .execution_options(populate_existing=True)
    )).scalars().unique().one_or_none()


async def lock_boards(db: AsyncSession, ids: Iterable[int]) -> dict[int, Board]:
    boards = (await db.execute(
        select(Board).where(Board.id.in_(set(ids))).order_by(Board.id)
        .with_for_update().execution_options(populate_existing=True)
        .options(
            *board_load_options(),
            selectinload(Board.owners).selectinload(User.programs),
            selectinload(Board.owners).selectinload(User.groups),
        )
    )).scalars().unique().all()
    return {board.id: board for board in boards}


def editable_board(ctx: BoardViewerContext, boards: dict[int, Board], board_id: int) -> Board:
    board = boards.get(board_id)
    if board is None or not ctx.can_view_board(board):
        raise HTTPException(404, "Board not found")
    if not can_edit_board(ctx.user, board):
        raise HTTPException(403, "You may not edit this Board")
    return board


async def board_projection(db: AsyncSession, ctx: BoardViewerContext, board_id: int) -> BoardOut:
    board = (await db.execute(
        select(Board).where(Board.id == board_id).options(
            *board_load_options(),
            selectinload(Board.owners).selectinload(User.programs),
            selectinload(Board.owners).selectinload(User.groups),
        )
        .execution_options(populate_existing=True)
    )).scalars().unique().one_or_none()
    if board is None:
        raise HTTPException(404, "Board not found")
    links = await load_memberships(db, (link.marker_id for link in board.marker_links))
    return board_out(ctx, board, links)


async def marker_projection(
    db: AsyncSession, ctx: BoardViewerContext, marker_id: int,
) -> MarkerOut:
    item = (await db.execute(
        select(Marker).where(Marker.id == marker_id).options(
            *marker_load_options(),
            selectinload(Marker.owners).selectinload(User.programs),
            selectinload(Marker.owners).selectinload(User.groups),
        )
        .execution_options(populate_existing=True)
    )).scalars().unique().one_or_none()
    if item is None:
        raise HTTPException(404, "Marker not found")
    links = await load_memberships(db, [item.id])
    return marker_out(ctx, item, ctx.visible_boards(links.get(item.id, [])))


async def bump_board(
    db: AsyncSession, ctx: BoardViewerContext, board: Board, version: int,
) -> None:
    result = await db.execute(
        update(Board).where(Board.id == board.id, Board.version == version)
        .values(version=version + 1).execution_options(synchronize_session=False)
    )
    if not result.rowcount:
        current = await board_projection(db, ctx, board.id)
        raise HTTPException(409, current.model_dump(mode="json"))
    attributes.set_committed_value(board, "version", version + 1)


async def bump_marker(
    db: AsyncSession, ctx: BoardViewerContext, item: Marker, version: int,
) -> None:
    result = await db.execute(
        update(Marker).where(Marker.id == item.id, Marker.version == version)
        .values(version=version + 1).execution_options(synchronize_session=False)
    )
    if not result.rowcount:
        current = await marker_projection(db, ctx, item.id)
        raise HTTPException(409, current.model_dump(mode="json"))
    attributes.set_committed_value(item, "version", version + 1)


async def touch_markers(db: AsyncSession, ids: Iterable[int]) -> None:
    ids = set(ids)
    if ids:
        await db.execute(
            update(Marker).where(Marker.id.in_(ids)).values(version=Marker.version + 1)
            .execution_options(synchronize_session=False)
        )


async def lock_markers(db: AsyncSession, ids: Iterable[int]) -> list[Marker]:
    return list((await db.execute(
        select(Marker).where(Marker.id.in_(set(ids))).order_by(Marker.id)
        .with_for_update().execution_options(populate_existing=True)
        .options(
            *marker_load_options(),
            selectinload(Marker.owners).selectinload(User.programs),
            selectinload(Marker.owners).selectinload(User.groups),
        )
    )).scalars().unique().all())


async def lock_marker_graph(
    db: AsyncSession, ctx: BoardViewerContext, ids: Iterable[int],
    target_board_ids: Iterable[int] = (),
) -> tuple[dict[int, Board], dict[int, Marker], dict[int, list[BoardMarker]]]:
    ids = set(ids)
    board_ids = set((await db.execute(
        select(BoardMarker.board_id).where(BoardMarker.marker_id.in_(ids))
    )).scalars())
    board_ids.update(target_board_ids)
    boards = await lock_boards(db, board_ids)
    items = {item.id: item for item in await lock_markers(db, ids)}
    if set(items) != ids:
        raise HTTPException(404, "Marker not found")
    links = await load_memberships(db, ids)
    for item in items.values():
        memberships = links.get(item.id, [])
        if not ctx.can_view_marker(item, ctx.visible_boards(memberships)):
            raise HTTPException(404, "Marker not found")
        # Board locks precede Marker locks; retry if a new parent appeared.
        if any(link.board_id not in boards for link in memberships):
            raise HTTPException(409, (await marker_projection(db, ctx, item.id)).model_dump(mode="json"))
    return boards, items, links


async def owner_targets(db: AsyncSession, ids: list[int]) -> list[User]:
    owners = await _resolve_owner_users(db, list(dict.fromkeys(ids)))
    if owners:
        owners = list((await db.execute(
            select(User).where(User.id.in_([owner.id for owner in owners]))
            .order_by(User.id).with_for_update().execution_options(populate_existing=True)
        )).scalars().unique().all())
        if any(not owner.active for owner in owners):
            raise HTTPException(422, "Owners must be active users")
    return owners


async def enforce_cap(
    db: AsyncSession, owners: list[User], existing_ids: set[int],
    kind: Literal["board", "marker"],
) -> None:
    for owner in owners:
        if owner.role != "student" or owner.id in existing_ids:
            continue
        if kind == "board":
            count = await db.scalar(select(func.count()).select_from(Board).where(Board.owners.any(User.id == owner.id)))
            cap = STUDENT_MAX_BOARDS
        else:
            count = await db.scalar(select(func.count()).select_from(Marker).where(Marker.owners.any(User.id == owner.id)))
            cap = STUDENT_MAX_MARKERS
        if count >= cap:
            raise HTTPException(422, f"Students may own at most {cap} {kind}s")


def validate_assignments(
    ctx: BoardViewerContext, boards: dict[int, Board],
    assignments: list[BoardAssignment],
) -> None:
    for assignment in assignments:
        editable_board(ctx, boards, assignment.board_id)


async def replace_assignments(
    db: AsyncSession, ctx: BoardViewerContext, item: Marker,
    boards: dict[int, Board], links: list[BoardMarker],
    assignments: list[BoardAssignment],
) -> None:
    validate_assignments(ctx, boards, assignments)
    retained = [link for link in links if not can_edit_board(ctx.user, link.board)]
    if not retained and not assignments:
        raise HTTPException(422, "A Marker must belong to at least one Board")
    editable = {link.board_id: link for link in links if can_edit_board(ctx.user, link.board)}
    requested = {assignment.board_id for assignment in assignments}
    for board_id, link in editable.items():
        if board_id not in requested:
            await db.delete(link)
            # A pinned cover that is no longer a member reverts to the
            # first-member fallback.
            if link.board.cover_marker_id == item.id:
                link.board.cover_marker_id = None
    for assignment in assignments:
        link = editable.get(assignment.board_id)
        if link is None:
            board = boards[assignment.board_id]
            next_order = max((link.sort_order for link in board.marker_links), default=-1) + 1
            link = BoardMarker(
                board_id=board.id, marker_id=item.id, sort_order=next_order,
            )
            db.add(link)
        if assignment.sort_order is not None:
            link.sort_order = assignment.sort_order
    await bump_board_membership_versions(db, set(editable) | requested)


async def commit_write(
    db: AsyncSession, user: User, action: str, resource_id: int,
) -> None:
    await bump_browse_revision(db)
    await db.commit()
    logger.info(action, extra={"user_id": user.id, "resource_id": resource_id})


def thumbnail_target(item: Marker) -> tuple[Image, int]:
    return Image(tile_sources=item.image.tile_sources), item.id


async def cleanup_thumbnails(targets: Iterable[tuple[Image, int]]) -> None:
    for image, item_id in targets:
        try:
            await asyncio.to_thread(remove_marker_thumbnail, image, item_id)
        except Exception:
            logger.exception("marker.thumbnail_cleanup_failed", extra={"marker_id": item_id})


async def delete_orphans(db: AsyncSession, items: list[Marker]) -> list[tuple[Image, int]]:
    linked = set((await db.execute(
        select(BoardMarker.marker_id).where(BoardMarker.marker_id.in_([item.id for item in items]))
    )).scalars())
    orphans = [item for item in items if item.id not in linked]
    if orphans:
        await bump_board_membership_versions(db, marker_ids=[item.id for item in orphans])
        await db.execute(delete(Marker).where(Marker.id.in_([item.id for item in orphans])))
    return [thumbnail_target(item) for item in orphans]


async def regenerate_thumbnail(db: AsyncSession, item_id: int, version: int) -> None:
    try:
        items = await lock_markers(db, [item_id])
        if not items or items[0].version != version:
            await db.rollback()
            return
        item = items[0]
        await cleanup_thumbnails([thumbnail_target(item)])
        try:
            path = await asyncio.to_thread(
                generate_marker_thumbnail, item.image, item.id,
                item.x, item.y, item.zoom, item.rotation,
            )
        except Exception:
            path = None
            logger.exception("marker.thumbnail_failed", extra={"marker_id": item_id})
        if path is None:
            logger.info("marker.thumbnail_fallback", extra={"marker_id": item_id})
        item.thumb = path
        await db.commit()
    except Exception:
        await db.rollback()
        logger.exception("marker.thumbnail_failed", extra={"marker_id": item_id})
