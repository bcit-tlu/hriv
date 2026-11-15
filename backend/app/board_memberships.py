"""Board revision invalidation for membership changes and cascading deletes."""

from collections.abc import Iterable

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Board, BoardInuksuk, Inuksuk


async def bump_board_membership_versions(
    db: AsyncSession, board_ids: Iterable[int] = (), *,
    inuksuk_ids: Iterable[int] = (), image_ids: Iterable[int] = (),
) -> None:
    board_ids, inuksuk_ids, image_ids = set(board_ids), set(inuksuk_ids), set(image_ids)
    affected = []
    if board_ids:
        affected.append(Board.id.in_(board_ids))
    if inuksuk_ids:
        affected.append(Board.id.in_(
            select(BoardInuksuk.board_id).where(BoardInuksuk.inuksuk_id.in_(inuksuk_ids))
        ))
    if image_ids:
        affected.append(Board.id.in_(
            select(BoardInuksuk.board_id).join(Inuksuk, Inuksuk.id == BoardInuksuk.inuksuk_id)
            .where(Inuksuk.image_id.in_(image_ids))
        ))
    if not affected:
        return
    locked = (
        select(Board.id).where(or_(*affected)).order_by(Board.id).with_for_update()
        .cte("membership_boards")
    )
    await db.execute(
        update(Board).where(Board.id.in_(select(locked.c.id)))
        .values(version=Board.version + 1).execution_options(synchronize_session=False)
    )
