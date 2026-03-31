"""VIPS-based image processing pipeline for DZI tile generation."""

import asyncio
import logging
import os
from pathlib import Path

import pyvips

from .database import async_session, settings
from .models import Image, SourceImage

logger = logging.getLogger(__name__)


def generate_tiles(source_path: str, output_dir: str) -> tuple[str, str]:
    """Use pyvips to generate DZI tiles and a thumbnail from a source image.

    Returns (dzi_path, thumb_path) relative to the output directory.
    """
    os.makedirs(output_dir, exist_ok=True)

    image = pyvips.Image.new_from_file(source_path, access="sequential")

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
            logger.error("SourceImage %d not found", source_image_id)
            return

        src.status = "processing"
        await db.commit()

        try:
            output_dir = os.path.join(settings.tiles_dir, str(src.id))
            dzi_rel, thumb_rel = await asyncio.to_thread(
                generate_tiles, src.stored_path, output_dir
            )

            # Build URLs for serving tiles via the API
            tile_sources_url = f"/api/tiles/{src.id}/{dzi_rel}"
            thumb_url = f"/api/tiles/{src.id}/{thumb_rel}"

            label = src.label or Path(src.original_filename).stem

            img = Image(
                label=label,
                thumb=thumb_url,
                tile_sources=tile_sources_url,
                category_id=src.category_id,
                copyright=src.copyright,
                origin=src.origin,
                active=True,
                metadata_={},
            )
            db.add(img)
            await db.flush()

            src.image_id = img.id
            src.status = "completed"
            await db.commit()

            logger.info(
                "Processed source image %d -> image %d", src.id, img.id
            )

        except Exception:
            logger.exception("Failed to process source image %d", src.id)
            await db.rollback()

            # Re-fetch after rollback to update status
            src = await db.get(SourceImage, source_image_id)
            if src is not None:
                src.status = "failed"
                src.error_message = "Tile generation failed. Check server logs."
                await db.commit()
