"""Seed local media assets for docker-compose development.

The SQL seed creates portable demo metadata, but synthetic monitoring needs a
real local DZI tile tree under ``/api/tiles``. This module runs as a one-shot
compose service after ``db/seed.sql`` and before the backend starts. It copies a
repo-provided source image into the shared data volume, generates DZI tiles with
the same processing helper used by uploads, and upserts the DB records that point
at those local files.
"""

import asyncio
import shutil
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from .database import get_async_session, get_engine, settings
from .models import Category, Image, SourceImage
from .processing import generate_tiles
from .tile_provenance import compute_source_checksum, current_tile_settings_hash

SEED_ASSET_PATH = Path("/seed-assets/synthetic-monitoring-image.jpeg")
SOURCE_FILENAME = "synthetic-monitoring-image.jpeg"
CATEGORY_LABEL = "Synthetic Monitoring"
IMAGE_NAME = "Synthetic Monitoring Image"
IMAGE_COPYRIGHT = "Synthetic monitoring fixture"
IMAGE_NOTE = "Local seed image used by the synthetic monitoring Playwright journey."


def _copy_source_asset() -> tuple[Path, int]:
    if not SEED_ASSET_PATH.is_file():
        raise FileNotFoundError(
            f"Seed media asset not found: {SEED_ASSET_PATH}. "
            "Add the synthetic monitoring source image at "
            "db/seed-assets/synthetic-monitoring-image.jpeg before running docker compose."
        )

    source_dir = Path(settings.source_images_dir)
    source_dir.mkdir(parents=True, exist_ok=True)
    stored_path = source_dir / SOURCE_FILENAME
    shutil.copyfile(SEED_ASSET_PATH, stored_path)
    return stored_path, stored_path.stat().st_size


def _regenerate_tiles(source_path: Path, source_image_id: int) -> tuple[str, str, int, int]:
    tiles_root = Path(settings.tiles_dir)
    tiles_root.mkdir(parents=True, exist_ok=True)

    final_dir = tiles_root / str(source_image_id)
    tmp_dir = tiles_root / f".{source_image_id}.tmp"
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    tmp_dir.mkdir(parents=True, exist_ok=True)

    try:
        dzi_rel, thumb_rel, width, height = generate_tiles(str(source_path), str(tmp_dir))
        if final_dir.exists():
            shutil.rmtree(final_dir)
        tmp_dir.rename(final_dir)
        return dzi_rel, thumb_rel, width, height
    except Exception:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise


async def _get_or_create_source(
    session,
    category_id: int,
    stored_path: Path,
    file_size: int,
) -> SourceImage:
    result = await session.execute(
        select(SourceImage).where(SourceImage.original_filename == SOURCE_FILENAME)
    )
    source = result.scalar_one_or_none()
    if source is None:
        source = SourceImage(
            original_filename=SOURCE_FILENAME,
            stored_path=str(stored_path),
            status="processing",
            progress=5,
            status_message="Preparing seeded image",
            name=IMAGE_NAME,
            category_id=category_id,
            copyright=IMAGE_COPYRIGHT,
            note=IMAGE_NOTE,
            active=True,
            file_size=file_size,
        )
        session.add(source)
        await session.flush()
    else:
        source.stored_path = str(stored_path)
        source.status = "processing"
        source.progress = 5
        source.status_message = "Preparing seeded image"
        source.name = IMAGE_NAME
        source.category_id = category_id
        source.copyright = IMAGE_COPYRIGHT
        source.note = IMAGE_NOTE
        source.active = True
        source.file_size = file_size
    return source


async def seed_media() -> None:
    stored_path, file_size = _copy_source_asset()

    async_session = get_async_session()
    async with async_session() as session:
        result = await session.execute(
            select(Category).where(Category.parent_id.is_(None), Category.label == CATEGORY_LABEL)
        )
        category = result.scalar_one_or_none()
        if category is None:
            category = Category(label=CATEGORY_LABEL, parent_id=None, status="active", sort_order=100)
            session.add(category)
            await session.flush()
        else:
            category.status = "active"

        source = await _get_or_create_source(session, category.id, stored_path, file_size)
        await session.commit()
        source_id = source.id
        category_id = category.id

    dzi_rel, thumb_rel, width, height = await asyncio.to_thread(
        _regenerate_tiles,
        stored_path,
        source_id,
    )
    checksum = await asyncio.to_thread(compute_source_checksum, str(stored_path))
    generated_at = datetime.now(timezone.utc)

    async with async_session() as session:
        source = await session.get(SourceImage, source_id)
        if source is None:
            raise RuntimeError(f"Seed SourceImage disappeared before final update: {source_id}")

        result = await session.execute(
            select(Image).where(Image.name == IMAGE_NAME, Image.category_id == category_id)
        )
        image = result.scalar_one_or_none()

        tile_sources_url = f"/api/tiles/{source_id}/{dzi_rel}"
        thumb_url = f"/api/tiles/{source_id}/{thumb_rel}"

        if image is None:
            image = Image(
                name=IMAGE_NAME,
                thumb=thumb_url,
                tile_sources=tile_sources_url,
                category_id=category_id,
                copyright=IMAGE_COPYRIGHT,
                note=IMAGE_NOTE,
                active=True,
                metadata_={},
                sort_order=0,
                width=width,
                height=height,
                file_size=file_size,
            )
            session.add(image)
            await session.flush()
        else:
            image.thumb = thumb_url
            image.tile_sources = tile_sources_url
            image.category_id = category_id
            image.copyright = IMAGE_COPYRIGHT
            image.note = IMAGE_NOTE
            image.active = True
            image.width = width
            image.height = height
            image.file_size = file_size

        source.image_id = image.id
        source.status = "completed"
        source.progress = 100
        source.status_message = "Completed"
        source.error_message = None
        source.source_checksum = checksum
        source.tile_settings_hash = current_tile_settings_hash()
        source.tiles_generated_at = generated_at
        source.file_size = file_size
        await session.commit()

    print(
        "Seeded synthetic monitoring media: "
        f"category='{CATEGORY_LABEL}', image='{IMAGE_NAME}', source_image_id={source_id}"
    )


async def main() -> None:
    try:
        await seed_media()
    finally:
        await get_engine().dispose()


if __name__ == "__main__":
    asyncio.run(main())
