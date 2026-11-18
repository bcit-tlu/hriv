"""Flag-independent, lossless admin archive records for saved views."""

from datetime import datetime
import re

from sqlalchemy import DateTime, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    Board, BoardMarker, Marker,
    board_groups, board_owners, board_programs, marker_owners,
)

SAVED_VIEW_TABLES = (
    Board.__table__, Marker.__table__,
    board_owners, board_programs, board_groups, marker_owners,
    BoardMarker.__table__,
)
SAVED_VIEW_ID_TABLES = ("boards", "markers")

# Archives written before the Marker rename keyed saved-view tables and their
# FK column by the former names; keep them importable.
LEGACY_TABLE_KEYS = {
    "markers": "inuksuks",
    "board_markers": "board_inuksuks",
    "marker_owners": "inuksuk_owners",
}
LEGACY_COLUMN_KEYS = {"inuksuk_id": "marker_id"}
# Persisted thumb URLs in those dumps still point at the former tiles path.
LEGACY_THUMB_URL = re.compile(r"^(/api/tiles/[0-9]+/)inuksuks(/[1-9][0-9]*\.jpg)$")


async def export_saved_views(db: AsyncSession, image_ids: set[int]) -> dict[str, list[dict]]:
    result = {}
    for table in SAVED_VIEW_TABLES:
        rows = (await db.execute(select(table).order_by(*table.primary_key.columns))).mappings().all()
        result[table.name] = [
            {key: value.isoformat() if isinstance(value, datetime) else value
             for key, value in row.items()}
            for row in rows
            if table.name != "markers" or row["image_id"] in image_ids
        ]
    item_ids = {row["id"] for row in result["markers"]}
    for name in ("marker_owners", "board_markers"):
        result[name] = [row for row in result[name] if row["marker_id"] in item_ids]
    return result


async def clear_saved_views(db: AsyncSession) -> None:
    for table in reversed(SAVED_VIEW_TABLES):
        await db.execute(table.delete())


async def import_saved_views(db: AsyncSession, dump: dict) -> None:
    for table in SAVED_VIEW_TABLES:
        dump_rows = dump.get(table.name)
        if dump_rows is None:
            dump_rows = dump.get(LEGACY_TABLE_KEYS.get(table.name, ""), [])
        rows = [
            {column.name: (
                datetime.fromisoformat(row[column.name])
                if isinstance(column.type, DateTime) and isinstance(row[column.name], str)
                else row[column.name]
            ) for column in table.columns if column.name in row}
            for row in (
                {LEGACY_COLUMN_KEYS.get(key, key): value for key, value in dump_row.items()}
                for dump_row in dump_rows
            )
        ]
        if table.name == "markers":
            for row in rows:
                thumb = row.get("thumb")
                if isinstance(thumb, str):
                    row["thumb"] = LEGACY_THUMB_URL.sub(r"\g<1>markers\g<2>", thumb)
        if rows:
            await db.execute(table.insert(), rows)
