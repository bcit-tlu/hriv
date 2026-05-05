"""VIPS-based image processing pipeline for DZI tile generation.

Provides granular progress reporting via pyvips eval signals and a
thread-safe progress tracker that allows the async processing loop
to periodically flush progress updates to the database.
"""

import asyncio
import json
import logging
import math
import os
import shutil
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pyvips
from opentelemetry import trace
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func

from .database import async_session, settings
from .models import Image, Program, SourceImage

logger = logging.getLogger(__name__)
tracer = trace.get_tracer(__name__)


# ── Progress tracker ──────────────────────────────────────

class ProgressTracker:
    """Thread-safe progress tracker for sync thread -> async bridge."""

    def __init__(self) -> None:
        self._progress: int = 0
        self._message: str = ""
        self._lock = threading.Lock()

    def set(self, progress: int, message: str = "") -> None:
        with self._lock:
            self._progress = progress
            if message:
                self._message = message

    def get(self) -> tuple[int, str]:
        with self._lock:
            return self._progress, self._message


def _estimate_tile_count(width: int, height: int, tile_size: int = 254) -> int:
    """Estimate the total number of DZI tiles across all pyramid levels."""
    total = 0
    w, h = width, height
    while w > 1 or h > 1:
        total += math.ceil(w / tile_size) * math.ceil(h / tile_size)
        w = max(1, (w + 1) // 2)
        h = max(1, (h + 1) // 2)
    total += 1  # level 0 (1x1 pixel)
    return total


def generate_tiles(
    source_path: str,
    output_dir: str,
    tracker: ProgressTracker | None = None,
) -> tuple[str, str, int, int]:
    """Use pyvips to generate DZI tiles and a thumbnail from a source image.

    When a *tracker* is provided, pyvips progress signals are used to report
    fine-grained tile-generation progress (mapped to the 10-78 % range of
    the overall pipeline).

    Returns (dzi_path, thumb_path, width, height) relative to the output directory.
    """
    span = trace.get_current_span()
    os.makedirs(output_dir, exist_ok=True)

    image = pyvips.Image.new_from_file(source_path, access="sequential")

    estimated_tiles = _estimate_tile_count(image.width, image.height)
    span.set_attributes({
        "image.width": image.width,
        "image.height": image.height,
        "image.bands": image.bands,
        "tiles.estimated_count": estimated_tiles,
    })

    logger.info(
        "Source image loaded",
        extra={
            "event": "tiles.image_loaded",
            "source_path": source_path,
            "image_width": image.width,
            "image_height": image.height,
            "image_bands": image.bands,
            "estimated_tiles": estimated_tiles,
        },
    )

    if tracker:
        tracker.set(10, "Generating tiles")

    # ── Tile generation with progress signals ──────────────
    last_logged_pct = -10  # track last logged percentage for 10 % intervals

    def _on_eval(_img: pyvips.Image, progress: pyvips.GValue) -> None:
        nonlocal last_logged_pct
        try:
            pct = progress.percent
            # Map pyvips 0-100 % -> overall pipeline 10-78 %
            mapped = 10 + int(pct * 0.68)
            if tracker:
                tracker.set(mapped, "Generating tiles")
            # Log at every 10 % interval
            rounded = int(pct // 10) * 10
            if rounded > last_logged_pct:
                last_logged_pct = rounded
                logger.info(
                    "Tile generation progress: %d%%",
                    rounded,
                    extra={
                        "event": "tiles.generation_progress",
                        "source_path": source_path,
                        "vips_percent": rounded,
                        "mapped_progress": mapped,
                    },
                )
        except Exception:
            # Never let a callback error abort tile generation.
            pass

    try:
        image.set_progress(True)
        image.signal_connect("eval", _on_eval)
    except Exception:
        # Older pyvips builds may lack progress support -- proceed without.
        logger.debug(
            "pyvips progress signals unavailable; progress will use milestones only",
            extra={"event": "tiles.progress_unavailable"},
        )

    logger.info(
        "Starting DZI tile generation (dzsave)",
        extra={
            "event": "tiles.generation_started",
            "source_path": source_path,
            "image_width": image.width,
            "image_height": image.height,
            "estimated_tiles": estimated_tiles,
        },
    )

    dzi_basename = "image"
    dzi_output = os.path.join(output_dir, dzi_basename)
    t_dzsave_start = time.monotonic()
    image.dzsave(dzi_output, tile_size=254, overlap=1, suffix=".jpeg[Q=85]")
    t_dzsave_end = time.monotonic()

    logger.info(
        "DZI tile generation completed",
        extra={
            "event": "tiles.generation_completed",
            "source_path": source_path,
            "duration_ms": round((t_dzsave_end - t_dzsave_start) * 1000),
            "estimated_tiles": estimated_tiles,
        },
    )

    # ── Thumbnail generation ──────────────────────────────
    if tracker:
        tracker.set(80, "Creating thumbnail")

    logger.info(
        "Generating thumbnail",
        extra={
            "event": "tiles.thumbnail_started",
            "source_path": source_path,
        },
    )

    # Generate a center-cropped thumbnail so the card preview always shows
    # a recognisable portion of the image regardless of aspect ratio.
    # A fresh file handle is needed because the sequential stream was
    # consumed by dzsave above and cannot be rewound.
    thumb_path = os.path.join(output_dir, "thumbnail.jpeg")
    thumb = pyvips.Image.thumbnail(
        source_path, 256, height=256, crop="centre",
    )
    thumb.jpegsave(thumb_path, Q=85)

    if tracker:
        tracker.set(85, "Thumbnail created")

    logger.info(
        "Thumbnail generated",
        extra={
            "event": "tiles.thumbnail_completed",
            "source_path": source_path,
        },
    )

    span.set_attribute("tiles.dzsave_duration_ms", round((t_dzsave_end - t_dzsave_start) * 1000))

    return f"{dzi_basename}.dzi", "thumbnail.jpeg", image.width, image.height


async def process_source_image(source_image_id: int) -> None:
    """Background task: process an uploaded source image into DZI tiles.

    - Reads the source image from disk
    - Generates DZI tiles + thumbnail via pyvips (with granular progress)
    - Creates an Image record in the database
    - Updates the SourceImage record with status and image_id
    """
    span = trace.get_current_span()
    span.set_attribute("source_image.id", source_image_id)

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
        src.status_message = "Preparing image"
        await db.commit()

        logger.info(
            "Processing started for source image",
            extra={
                "event": "processing.started",
                "source_image_id": src.id,
                "original_filename": src.original_filename,
                "category_id": src.category_id,
                "file_size": getattr(src, "file_size", None),
            },
        )
        t_start = time.monotonic()

        span.set_attribute("source_image.filename", src.original_filename)

        try:
            output_dir = os.path.join(settings.tiles_dir, str(src.id))

            # Mark tile generation started
            src.progress = 10
            src.status_message = "Generating tiles"
            await db.commit()

            # Set up the progress tracker for thread <-> async communication
            tracker = ProgressTracker()
            tracker.set(10, "Generating tiles")
            stop_event = asyncio.Event()

            async def _flush_progress() -> None:
                """Periodically write tracker progress to the database."""
                last_progress = 0
                last_message = ""
                while not stop_event.is_set():
                    try:
                        await asyncio.wait_for(stop_event.wait(), timeout=1.5)
                        break  # event was set
                    except asyncio.TimeoutError:
                        pass  # normal timeout -- check progress

                    current_progress, current_message = tracker.get()
                    if current_progress != last_progress or current_message != last_message:
                        try:
                            async with async_session() as progress_db:
                                progress_src = await progress_db.get(
                                    SourceImage, source_image_id,
                                )
                                if progress_src is not None:
                                    progress_src.progress = current_progress
                                    if current_message:
                                        progress_src.status_message = current_message
                                    await progress_db.commit()
                            last_progress = current_progress
                            last_message = current_message
                        except Exception:
                            logger.debug(
                                "Progress flush failed (non-critical)",
                                extra={
                                    "event": "processing.progress_flush_failed",
                                    "source_image_id": source_image_id,
                                },
                            )

            # Run tile generation and progress flusher concurrently
            progress_task = asyncio.create_task(_flush_progress())
            try:
                with tracer.start_as_current_span("generate_tiles"):
                    dzi_rel, thumb_rel, img_width, img_height = await asyncio.to_thread(
                        generate_tiles, src.stored_path, output_dir, tracker,
                    )
            finally:
                stop_event.set()
                await progress_task

            t_tiles = time.monotonic()
            span.set_attribute("tiles.duration_ms", round((t_tiles - t_start) * 1000))

            # Mark tile generation completed
            src.progress = 80
            src.status_message = "Tiles generated"
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
            src.status_message = "Saving image record"
            await db.commit()

            with tracer.start_as_current_span("save_image_record"):
                logger.info(
                    "Creating Image database record",
                    extra={
                        "event": "processing.creating_record",
                        "source_image_id": src.id,
                        "original_filename": src.original_filename,
                    },
                )

                name = src.name or Path(src.original_filename).stem

                # Compute file size in MB from the source image on disk
                file_size_mb: float | None = None
                if src.file_size is not None:
                    file_size_mb = round(src.file_size / (1024 * 1024), 2)
                else:
                    try:
                        file_size_mb = round(
                            os.path.getsize(src.stored_path) / (1024 * 1024), 2
                        )
                    except OSError:
                        pass

                img = Image(
                    name=name,
                    thumb=thumb_url,
                    tile_sources=tile_sources_url,
                    category_id=src.category_id,
                    copyright=src.copyright,
                    note=src.note,
                    active=src.active,
                    metadata_={},
                    width=img_width,
                    height=img_height,
                    file_size=file_size_mb,
                )
                db.add(img)
                await db.flush()

                # Associate programs if stored on source image
                if src.program:
                    src.progress = 93
                    src.status_message = "Associating programs"
                    await db.commit()

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

                            logger.info(
                                "Programs associated with image",
                                extra={
                                    "event": "processing.programs_associated",
                                    "source_image_id": src.id,
                                    "image_id": img.id,
                                    "program_count": len(programs),
                                },
                            )
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
                src.status_message = "Completed"
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
                src.status_message = "Failed"
                await db.commit()


async def process_replace_image(
    source_image_id: int, target_image_id: int,
) -> None:
    """Background task: replace an existing image with a new source file.

    - Generates DZI tiles + thumbnail from the new source image
    - Removes old tile directory from disk
    - Updates the existing Image record (tile_sources, thumb, width, height,
      file_size) and clears canvas_annotations / locked_overlays from metadata
    - Updates the SourceImage record with status and image_id
    """
    span = trace.get_current_span()
    span.set_attributes({
        "source_image.id": source_image_id,
        "target_image.id": target_image_id,
    })

    async with async_session() as db:
        src = await db.get(SourceImage, source_image_id)
        if src is None:
            logger.error(
                "SourceImage not found for replacement, skipping",
                extra={
                    "event": "replace.source_not_found",
                    "source_image_id": source_image_id,
                },
            )
            return

        img = await db.get(Image, target_image_id)
        if img is None:
            logger.error(
                "Target Image not found for replacement, skipping",
                extra={
                    "event": "replace.target_not_found",
                    "target_image_id": target_image_id,
                },
            )
            src.status = "failed"
            src.error_message = "Target image no longer exists."
            src.status_message = "Failed"
            await db.commit()
            return

        src.status = "processing"
        src.progress = 5
        src.status_message = "Preparing replacement"
        await db.commit()

        logger.info(
            "Replacement processing started",
            extra={
                "event": "replace.started",
                "source_image_id": src.id,
                "target_image_id": target_image_id,
                "original_filename": src.original_filename,
            },
        )
        t_start = time.monotonic()

        try:
            output_dir = os.path.join(settings.tiles_dir, str(src.id))

            src.progress = 10
            src.status_message = "Generating tiles"
            await db.commit()

            tracker = ProgressTracker()
            tracker.set(10, "Generating tiles")
            stop_event = asyncio.Event()

            async def _flush_progress() -> None:
                last_progress = 0
                last_message = ""
                while not stop_event.is_set():
                    try:
                        await asyncio.wait_for(stop_event.wait(), timeout=1.5)
                        break
                    except asyncio.TimeoutError:
                        pass
                    current_progress, current_message = tracker.get()
                    if current_progress != last_progress or current_message != last_message:
                        try:
                            async with async_session() as progress_db:
                                progress_src = await progress_db.get(
                                    SourceImage, source_image_id,
                                )
                                if progress_src is not None:
                                    progress_src.progress = current_progress
                                    if current_message:
                                        progress_src.status_message = current_message
                                    await progress_db.commit()
                            last_progress = current_progress
                            last_message = current_message
                        except Exception:
                            logger.debug(
                                "Progress flush failed (non-critical)",
                                extra={
                                    "event": "replace.progress_flush_failed",
                                    "source_image_id": source_image_id,
                                },
                            )

            progress_task = asyncio.create_task(_flush_progress())
            try:
                with tracer.start_as_current_span("generate_tiles"):
                    dzi_rel, thumb_rel, img_width, img_height = await asyncio.to_thread(
                        generate_tiles, src.stored_path, output_dir, tracker,
                    )
            finally:
                stop_event.set()
                await progress_task

            t_tiles = time.monotonic()
            span.set_attribute("tiles.duration_ms", round((t_tiles - t_start) * 1000))

            src.progress = 80
            src.status_message = "Tiles generated"
            await db.commit()

            # Capture old tile directory path before updating Image record
            old_tile_dir: str | None = None
            old_tile_sources = img.tile_sources  # e.g. /api/tiles/42/image.dzi
            if old_tile_sources:
                parts = old_tile_sources.strip("/").split("/")
                # Expected format: api/tiles/<old_src_id>/image.dzi
                if len(parts) >= 3:
                    old_src_id = parts[2]
                    candidate = os.path.join(settings.tiles_dir, old_src_id)
                    tiles_root = Path(settings.tiles_dir).resolve()
                    if Path(candidate).resolve().is_relative_to(tiles_root):
                        old_tile_dir = candidate

            tile_sources_url = f"/api/tiles/{src.id}/{dzi_rel}"
            thumb_url = f"/api/tiles/{src.id}/{thumb_rel}"

            src.progress = 90
            src.status_message = "Updating image record"
            await db.commit()

            with tracer.start_as_current_span("update_image_record"):
                file_size_mb: float | None = None
                if src.file_size is not None:
                    file_size_mb = round(src.file_size / (1024 * 1024), 2)
                else:
                    try:
                        file_size_mb = round(
                            os.path.getsize(src.stored_path) / (1024 * 1024), 2,
                        )
                    except OSError:
                        pass

                # Re-fetch to pick up any concurrent metadata changes
                await db.refresh(img)

                img.tile_sources = tile_sources_url
                img.thumb = thumb_url
                img.width = img_width
                img.height = img_height
                img.file_size = file_size_mb
                img.version = img.version + 1

                # Clear edit canvas metadata (annotations and overlays)
                current_meta = dict(img.metadata_ or {})
                current_meta.pop("canvas_annotations", None)
                current_meta.pop("locked_overlays", None)
                img.metadata_ = current_meta if current_meta else {}

                src.image_id = img.id
                src.status = "completed"
                src.progress = 100
                src.status_message = "Completed"
                await db.commit()

            # Remove old tiles only after the commit succeeds, so a
            # failure cannot leave the Image record pointing at deleted files.
            if old_tile_dir and os.path.isdir(old_tile_dir):
                shutil.rmtree(old_tile_dir, ignore_errors=True)
                logger.info(
                    "Removed old tile directory",
                    extra={
                        "event": "replace.old_tiles_removed",
                        "old_tile_dir": old_tile_dir,
                    },
                )

            duration_ms = round((time.monotonic() - t_start) * 1000)
            logger.info(
                "Replacement processing completed",
                extra={
                    "event": "replace.completed",
                    "source_image_id": src.id,
                    "target_image_id": img.id,
                    "original_filename": src.original_filename,
                    "duration_ms": duration_ms,
                },
            )

        except Exception:
            duration_ms = round((time.monotonic() - t_start) * 1000)
            logger.exception(
                "Failed to process replacement image",
                extra={
                    "event": "replace.failed",
                    "source_image_id": src.id,
                    "original_filename": src.original_filename,
                    "duration_ms": duration_ms,
                },
            )
            await db.rollback()

            src = await db.get(SourceImage, source_image_id)
            if src is not None:
                src.status = "failed"
                src.error_message = "Image replacement failed. Check server logs."
                src.status_message = "Failed"
                await db.commit()


# ── Stale SourceImage reconciliation ──────────────────────

# Threshold after which an in-flight SourceImage with no updated_at
# progress is considered abandoned.  Processing writes progress every
# 1.5 s, so 15 min is generously large.  Matches the admin-task
# threshold for consistency.
_STALE_SOURCE_IMAGE_SECONDS = int(
    os.environ.get("SOURCE_IMAGE_STALE_SECONDS", "900")
)


async def reconcile_stale_source_images(
    session: AsyncSession,
    stale_after_seconds: int = _STALE_SOURCE_IMAGE_SECONDS,
) -> int:
    """Mark orphaned in-flight SourceImages as ``failed``.

    A SourceImage is considered stale when its status is ``pending`` or
    ``processing`` but its ``updated_at`` timestamp is older than
    *stale_after_seconds*.  This runs on backend startup so images whose
    processing task died (pod crash, OOM kill, rollout) are cleaned up
    rather than appearing stuck in the UI forever.

    Returns the number of rows updated.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=stale_after_seconds)
    stmt = (
        update(SourceImage)
        .where(
            SourceImage.status.in_(["pending", "processing"]),
            SourceImage.updated_at < cutoff,
        )
        .values(
            status="failed",
            error_message=(
                "Marked as failed on backend startup — no progress "
                f"update for more than {stale_after_seconds}s; the "
                "processing task likely crashed before completion."
            ),
            status_message="Failed",
            updated_at=func.now(),
        )
        .returning(SourceImage.id)
    )
    result = await session.execute(stmt)
    ids = [row[0] for row in result.all()]
    await session.commit()
    if ids:
        logger.warning(
            "Reconciled %d stale source image(s) to 'failed' on startup",
            len(ids),
            extra={
                "event": "processing.reconciled_stale",
                "source_image_ids": ids,
                "stale_after_seconds": stale_after_seconds,
            },
        )
    return len(ids)
