"""Collection slot planning and independent thumbnail snapshots."""

import asyncio
from dataclasses import dataclass
import logging
from pathlib import Path
import re
import shutil
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .board_views import (
    BoardViewerContext,
    board_load_options,
    inuksuk_load_options,
    load_memberships,
)
from .collection_views import _ViewerContext
from .database import settings
from .inuksuk_thumbs import generate_viewport_thumbnail, local_tile_root
from .models import (
    STUDENT_SEQUENCE_MAX_IMAGES,
    SYNCHRONIZED_COLLECTION_MAX_IMAGES,
    Board,
    Collection,
    CollectionImage,
    Image,
    Inuksuk,
    User,
)
from .schemas import CollectionSlotInput, CollectionSlotSources

logger = logging.getLogger(__name__)


def export_slots(collection: Collection, image_ids: set[int]) -> list[dict]:
    return [
        {
            "image_id": link.image_id,
            "viewport_state": link.viewport_state,
            "thumb": link.thumb,
            "label": link.label,
        }
        for link in collection.image_links
        if link.image_id in image_ids
    ]


def import_slots(data: dict) -> list[CollectionImage]:
    if "slots" in data:
        links = []
        for position, raw in enumerate(data["slots"]):
            entry = CollectionSlotInput.model_validate(raw)
            thumb = raw.get("thumb")
            if thumb is not None and (
                not isinstance(thumb, str) or slot_thumb_file(thumb) is None
            ):
                raise ValueError("Invalid slot thumbnail path")
            links.append(
                CollectionImage(
                    image_id=entry.image_id,
                    sort_order=position,
                    viewport_state=(
                        entry.viewport_state.model_dump(exclude_none=True)
                        if entry.viewport_state else None
                    ),
                    label=entry.label,
                    thumb=thumb,
                )
            )
        return links
    image_ids = data.get("image_ids", [])
    return [
        CollectionImage(image_id=image_id, sort_order=position)
        for position, image_id in enumerate(image_ids)
    ]


def slot_thumb_file(path: str | None) -> Path | None:
    match = re.fullmatch(
        r"/api/tiles/([0-9]+)/collection_slots/([1-9][0-9]*)\.jpg", path or ""
    )
    if not match:
        return None
    base = Path(settings.tiles_dir).resolve()
    target = base / match[1] / "collection_slots" / f"{match[2]}.jpg"
    if (
        target.is_symlink() or target.parent.is_symlink()
        or target.parent.parent.is_symlink()
        or not target.resolve().is_relative_to(base)
    ):
        return None
    return target


async def cleanup_slot_thumbs(paths: list[str | None]) -> None:
    for path in paths:
        target = slot_thumb_file(path)
        if target is not None:
            try:
                await asyncio.to_thread(target.unlink, missing_ok=True)
            except OSError:
                logger.exception("collection.slot_thumbnail_cleanup_failed")


def snapshot_thumbnail(
    image: Image, slot: CollectionImage, source: str | None,
) -> str | None:
    root = local_tile_root(image)
    if root is None or not slot.viewport_state:
        return None
    match = re.fullmatch(
        r"/api/tiles/([0-9]+)/inuksuks/([1-9][0-9]*)\.jpg", source or ""
    )
    if match and match[1] == root.name:
        original = root / "inuksuks" / f"{match[2]}.jpg"
        directory = root / "collection_slots"
        if directory.is_symlink():
            raise ValueError("Slot thumbnail directory must not be a symlink")
        if (
            original.is_file() and not original.is_symlink()
            and original.resolve().is_relative_to(root)
        ):
            directory.mkdir(exist_ok=True)
            target = directory / f"{slot.id}.jpg"
            temporary = directory / f".{slot.id}-{uuid4().hex}.jpg"
            try:
                shutil.copyfile(original, temporary)
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)
            return f"/api/tiles/{root.name}/collection_slots/{slot.id}.jpg"
    viewport = slot.viewport_state
    return generate_viewport_thumbnail(
        image, slot.id, viewport["x"], viewport["y"], viewport["zoom"],
        viewport.get("rotation") or 0, namespace="collection_slots",
    )


async def write_slot_thumbs(
    db: AsyncSession,
    jobs: list[tuple[int, int, dict | None, str | None, str | None]],
) -> None:
    for slot_id, image_id, viewport, source, old_thumb in jobs:
        image = (await db.execute(
            select(Image).where(Image.id == image_id).with_for_update()
            .execution_options(populate_existing=True)
        )).scalars().one_or_none()
        slot = (await db.execute(
            select(CollectionImage).where(CollectionImage.id == slot_id)
            .with_for_update().execution_options(populate_existing=True)
        )).scalars().one_or_none()
        if image is not None and slot is not None and slot.viewport_state == viewport:
            match = re.fullmatch(
                r"/api/tiles/[0-9]+/inuksuks/([1-9][0-9]*)\.jpg", source or ""
            )
            if match:
                item = (await db.execute(
                    select(Inuksuk).where(Inuksuk.id == int(match[1]))
                    .with_for_update().execution_options(populate_existing=True)
                )).scalars().one_or_none()
                if item is None or item.thumb != source or item.image_id != image_id or {
                    "x": item.x, "y": item.y, "zoom": item.zoom, "rotation": item.rotation,
                } != viewport:
                    source = None
            await cleanup_slot_thumbs([old_thumb])
            try:
                slot.thumb = (
                    await asyncio.to_thread(snapshot_thumbnail, image, slot, source)
                    if viewport else None
                )
            except Exception:
                slot.thumb = None
                logger.exception(
                    "collection.slot_thumbnail_failed", extra={"slot_id": slot_id}
                )
        await db.commit()


@dataclass
class SlotPlan:
    link: CollectionImage
    viewport: dict | None
    label: str | None
    render: bool = False
    source: str | None = None
    old_thumb: str | None = None


async def resolve_slots(
    db: AsyncSession,
    ctx: _ViewerContext,
    body: CollectionSlotSources,
    image_ids: list[int],
    collection: Collection | None = None,
) -> list[SlotPlan]:
    existing = list(collection.image_links) if collection is not None else []
    used: set[int] = set()
    plans: list[SlotPlan] = []
    board_ctx = await BoardViewerContext.build(db, ctx.user)

    async def visible_inuksuk(item_id: int, explicit: bool = True) -> Inuksuk | None:
        item = (await db.execute(
            select(Inuksuk).where(Inuksuk.id == item_id)
            .options(*inuksuk_load_options())
        )).scalars().unique().one_or_none()
        if item is not None:
            memberships = (await load_memberships(db, [item.id])).get(item.id, [])
            if board_ctx.can_view_inuksuk(item, board_ctx.visible_boards(memberships)):
                return item
        if explicit:
            raise HTTPException(404, "Inuksuk not found")
        return None

    async def add(entry: CollectionSlotInput, legacy: bool = False) -> None:
        link = None
        if entry.id is not None:
            link = next((row for row in existing if row.id == entry.id), None)
            if link is None or link.image_id != entry.image_id or link.id in used:
                raise HTTPException(422, "Invalid collection slot")
        elif legacy:
            link = next((
                row for row in existing
                if row.image_id == entry.image_id and row.id not in used
            ), None)
        image = await db.get(Image, entry.image_id, with_for_update=True)
        item = (
            await visible_inuksuk(entry.inuksuk_id)
            if entry.inuksuk_id is not None else None
        )
        if image is None or not ctx.can_view_image(image):
            raise HTTPException(422, "Invalid image IDs")
        if link is None:
            link = CollectionImage(image_id=image.id, image=image)
        elif link.id is not None:
            used.add(link.id)
        plan = SlotPlan(link, link.viewport_state, link.label)
        if item is not None:
            if item.image_id != image.id:
                raise HTTPException(422, "Inuksuk does not match slot image")
            plan.viewport = {
                "x": item.x, "y": item.y,
                "zoom": item.zoom, "rotation": item.rotation,
            }
            plan.label, plan.source, plan.render = item.title, item.thumb, True
        if "viewport_state" in entry.model_fields_set:
            plan.viewport = (
                entry.viewport_state.model_dump(exclude_none=True)
                if entry.viewport_state else None
            )
            plan.source, plan.render = None, True
        if "label" in entry.model_fields_set:
            plan.label = entry.label
        plans.append(plan)

    for image_id in image_ids:
        await add(CollectionSlotInput(image_id=image_id), legacy=True)
    for entry in body.slots or []:
        await add(entry)
    if body.source_board_id is not None:
        board = (await db.execute(
            select(Board).where(Board.id == body.source_board_id)
            .options(*board_load_options())
        )).scalars().unique().one_or_none()
        if board is None or not board_ctx.can_view_board(board):
            raise HTTPException(404, "Board not found")
        links = sorted(board.inuksuk_links, key=lambda row: (row.sort_order, row.inuksuk_id))
        for link in links:
            item = await visible_inuksuk(link.inuksuk_id, explicit=False)
            if item is not None:
                await add(CollectionSlotInput(image_id=item.image_id, inuksuk_id=item.id))
    for item_id in body.inuksuk_ids or []:
        item = await visible_inuksuk(item_id)
        await add(CollectionSlotInput(image_id=item.image_id, inuksuk_id=item.id))
    for link in existing:
        if not ctx.can_view_image(link.image):
            plans.append(SlotPlan(link, link.viewport_state, link.label))
    return plans


def apply_slots(
    collection: Collection, plans: list[SlotPlan],
) -> tuple[list[str | None], list[SlotPlan]]:
    retained = {id(plan.link) for plan in plans}
    removed = [link.thumb for link in collection.image_links if id(link) not in retained]
    for position, plan in enumerate(plans):
        link = plan.link
        if plan.render:
            plan.old_thumb = link.thumb
            link.thumb = None
        link.viewport_state, link.label, link.sort_order = plan.viewport, plan.label, position
    collection.image_links = [plan.link for plan in plans]
    return removed, [plan for plan in plans if plan.render]


def validate_slot_caps(
    user: User,
    collection_type: str,
    plans: list[SlotPlan],
    existing: list[CollectionImage],
    *,
    seeded_create: bool = False,
) -> None:
    if collection_type == "synchronized" and seeded_create and len(plans) < 2:
        raise HTTPException(422, "synchronized collections require at least 2 slots")
    if (
        collection_type == "synchronized"
        and len(plans) > SYNCHRONIZED_COLLECTION_MAX_IMAGES
    ):
        raise HTTPException(422, "synchronized collections hold at most 4 slots")
    existing_ids = {link.id for link in existing}
    if (
        user.role == "student" and collection_type == "sequence"
        and len(plans) > STUDENT_SEQUENCE_MAX_IMAGES
    ):
        if any(plan.link.id is None or plan.link.id not in existing_ids for plan in plans):
            raise HTTPException(
                422, "Students may add at most 20 slots to a sequence collection"
            )


async def finish_slot_changes(
    db: AsyncSession, removed: list[str | None], plans: list[SlotPlan],
) -> None:
    await cleanup_slot_thumbs(removed)
    await write_slot_thumbs(db, [
        (plan.link.id, plan.link.image_id, plan.viewport, plan.source, plan.old_thumb)
        for plan in plans
    ])


async def image_slot_thumbs(
    db: AsyncSession, image_ids: list[int], *, clear: bool = False,
) -> list[str | None]:
    links = (await db.execute(
        select(CollectionImage).where(CollectionImage.image_id.in_(image_ids))
    )).scalars().all()
    paths = [link.thumb for link in links]
    if clear:
        collection_ids = {link.collection_id for link in links}
        if collection_ids:
            await db.execute(
                select(Collection.id).where(Collection.id.in_(collection_ids))
                .order_by(Collection.id).with_for_update()
            )
            links = (await db.execute(
                select(CollectionImage)
                .where(CollectionImage.image_id.in_(image_ids))
                .execution_options(populate_existing=True)
            )).scalars().all()
            paths = [link.thumb for link in links]
            await db.execute(
                update(Collection).where(Collection.id.in_(collection_ids))
                .values(version=Collection.version + 1, updated_at=func.now())
            )
            await db.execute(
                update(CollectionImage)
                .where(CollectionImage.image_id.in_(image_ids))
                .values(viewport_state=None, thumb=None)
            )
    return paths
