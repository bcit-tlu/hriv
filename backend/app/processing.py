"""VIPS-based image processing pipeline for DZI tile generation."""

import asyncio
import json
import logging
import os
import time
from pathlib import Path

import pyvips
from sqlalchemy import select

from .database import async_session, settings
from .models import Image, Program, SourceImage

logger = logging.getLogger(__name__)


def generate_tiles(source_path: str, output_dir: str) -> tuple[str, str]:
    """Use pyvips to generate DZI tiles and a thumbnail from a source image.

    Returns (dzi_path, thumb_path) relative to the output directory.
    """
    os.makedirs(output_dir, exist_ok=True)

    image = pyvips.Image.new_from_file(source_path, access="sequential")

    logger.info(
        "Generating DZI tiles",
        extra={
            "event": "tiles.generation_started",
            "source_path": source_path,
            "image_width": image.width,
            "image_height": image.height,
        },
    )

    # Generate DZI tiles using dzsave
    dzi_basename = "image"
    dzi_output = os.path.join(output_dir, dzi_basename)
    image.dzsave(dzi_output, tile_size=254, overlap=1, suffix=".jpeg[Q=85]")
    # dzsave creates: <output>.dzi and <output>_files/ directory

    # Generate thumbnail from a fresh file handle (sequential stream was
    # consumed by dzsave above and cannot be rewound).
    thumb_path = os.path.join(output_dir, "thumbnail.jpeg")
    thumb = pyvips.Image.thumbnail(source_path, 256)
    thumb.jpegsave(thumb_path, Q=85)

    return f"{dzi_basename}.dzi", "thumbnail.jpeg"


async def process_source_image(source_image_id: int) -> None:
    """Background task: process an uploaded source image into DZI tiles.

    - Reads the source image from disk
    - Generates DZI tiles + thumbnail via pyvips
    - Creates an Image record in the database
    - Updates the SourceImage record with status and image_id
    """
    async with async_session() as db:
        src = await db.get(SourceImage, source_image_id)
        if src is None:
            logger.error(
                "SourceImage not found, skipping processing",
                extra={
                    "event": "processing.source_not_found",
                    "source_image_id": source_image_id,
                },
            )
            return

        src.status = "processing"
        src.progress = 5
        await db.commit()

        logger.info(
            "Processing started for source image",
            extra={
                "event": "processing.started",
                "source_image_id": src.id,
                "original_filename": src.original_filename,
                "category_id": src.category_id,
            },
        )
        t_start = time.monotonic()

        try:
            output_dir = os.path.join(settings.tiles_dir, str(src.id))

            # Mark tile generation started
            src.progress = 10
            await db.commit()

            dzi_rel, thumb_rel = await asyncio.to_thread(
                generate_tiles, src.stored_path, output_dir
            )

            t_tiles = time.monotonic()

            # Mark tile generation completed
            src.progress = 80
            await db.commit()

            logger.info(
                "Tile generation completed",
                extra={
                    "event": "processing.tiles_generated",
                    "source_image_id": src.id,
                    "original_filename": src.original_filename,
                    "duration_ms": round((t_tiles - t_start) * 1000),
                },
            )

            # Build URLs for serving tiles via the API
            tile_sources_url = f"/api/tiles/{src.id}/{dzi_rel}"
            thumb_url = f"/api/tiles/{src.id}/{thumb_rel}"

            src.progress = 90
            await db.commit()

            name = src.name or Path(src.original_filename).stem

            img = Image(
                name=name,
                thumb=thumb_url,
                tile_sources=tile_sources_url,
                category_id=src.category_id,
                copyright=src.copyright,
                note=src.note,
                active=src.active,
                metadata_={},
            )
            db.add(img)
            await db.flush()

            # Associate programs if stored on source image
            if src.program:
                try:
                    program_ids = json.loads(src.program)
                    if isinstance(program_ids, list) and program_ids:
                        result = await db.execute(
                            select(Program).where(Program.id.in_(program_ids))
                        )
                        programs = list(result.scalars().all())
                        await db.refresh(img, ["programs"])
                        img.programs = programs
                        await db.flush()
                except (json.JSONDecodeError, TypeError):
                    logger.warning(
                        "Could not parse program_ids from source image",
                        extra={
                            "event": "processing.program_parse_error",
                            "source_image_id": src.id,
                        },
                    )

            src.image_id = img.id
            src.status = "completed"
            src.progress = 100
            await db.commit()

            duration_ms = round((time.monotonic() - t_start) * 1000)
            logger.info(
                "Processing completed successfully",
                extra={
                    "event": "processing.completed",
                    "source_image_id": src.id,
                    "image_id": img.id,
                    "original_filename": src.original_filename,
                    "category_id": src.category_id,
                    "duration_ms": duration_ms,
                },
            )

        except Exception:
            duration_ms = round((time.monotonic() - t_start) * 1000)
            logger.exception(
                "Failed to process source image",
                extra={
                    "event": "processing.failed",
                    "source_image_id": src.id,
                    "original_filename": src.original_filename,
                    "duration_ms": duration_ms,
                },
            )
            await db.rollback()

            # Re-fetch after rollback to update status
            src = await db.get(SourceImage, source_image_id)
            if src is not None:
                src.status = "failed"
                src.error_message = "Tile generation failed. Check server logs."
                await db.commit()
