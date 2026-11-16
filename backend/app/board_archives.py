"""Flag-independent, lossless admin archive records for saved views."""

from datetime import datetime

from sqlalchemy import DateTime, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    Board, BoardInuksuk, BoardSection, Inuksuk,
    board_groups, board_owners, board_programs, inuksuk_owners,
)

SAVED_VIEW_TABLES = (
    Board.__table__, Inuksuk.__table__, BoardSection.__table__,
    board_owners, board_programs, board_groups, inuksuk_owners,
    BoardInuksuk.__table__,
)
SAVED_VIEW_ID_TABLES = ("boards", "inuksuks", "board_sections")


async def export_saved_views(db: AsyncSession, image_ids: set[int]) -> dict[str, list[dict]]:
    result = {}
    for table in SAVED_VIEW_TABLES:
        rows = (await db.execute(select(table).order_by(*table.primary_key.columns))).mappings().all()
        result[table.name] = [
            {key: value.isoformat() if isinstance(value, datetime) else value
             for key, value in row.items()}
            for row in rows
            if table.name != "inuksuks" or row["image_id"] in image_ids
        ]
    item_ids = {row["id"] for row in result["inuksuks"]}
    for name in ("inuksuk_owners", "board_inuksuks"):
        result[name] = [row for row in result[name] if row["inuksuk_id"] in item_ids]
    return result


async def clear_saved_views(db: AsyncSession) -> None:
    for table in reversed(SAVED_VIEW_TABLES):
        await db.execute(table.delete())


async def import_saved_views(db: AsyncSession, dump: dict) -> None:
    for table in SAVED_VIEW_TABLES:
        rows = [
            {column.name: (
                datetime.fromisoformat(row[column.name])
                if isinstance(column.type, DateTime) and isinstance(row[column.name], str)
                else row[column.name]
            ) for column in table.columns if column.name in row}
            for row in dump.get(table.name, [])
        ]
        if rows:
            await db.execute(table.insert(), rows)
