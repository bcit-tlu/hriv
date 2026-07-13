"""VIPS-based image processing pipeline for DZI tile generation.

Provides granular progress reporting via pyvips eval signals and a
thread-safe progress tracker that allows the async processing loop
to periodically flush progress updates to the database.
"""

import asyncio
import logging
import math
import os
import shutil
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pyvips
from opentelemetry import metrics, trace
from opentelemetry.trace import StatusCode
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func

from .database import async_session, settings
from .models import Image, SourceImage
from .tile_provenance import (
    DZI_OVERLAP,
    DZI_TILE_SIZE,
    DZI_TILE_SUFFIX,
    compute_source_checksum,
    current_tile_settings_hash,
)

logger = logging.getLogger(__name__)
tracer = trace.get_tracer(__name__)

_meter = metrics.get_meter(__name__)
_processing_started_counter = _meter.create_counter(
    "hriv.image_processing.started",
    description="Number of image processing jobs started",
    unit="1",
)
_processing_completed_counter = _meter.create_counter(
    "hriv.image_processing.completed",
    description="Number of image processing jobs completed",
    unit="1",
)
_processing_duration_histogram = _meter.create_histogram(
    "hriv.image_processing.duration",
    description="Duration of image processing jobs",
    unit="s",
)


def _record_processing_started(task_type: str) -> None:
    _processing_started_counter.add(1, {"task_type": task_type})


def _record_processing_finished(
    task_type: str, duration_s: float, success: bool,
) -> None:
    _processing_completed_counter.add(
        1,
        {"task_type": task_type, "outcome": "success" if success else "failure"},
    )
    _processing_duration_histogram.record(duration_s, {"task_type": task_type})
    try:
        metrics.get_meter_provider().force_flush()
    except Exception:
        # Metric export is best-effort; never block tile generation completion.
        pass


# ── Pyramidal image detection ─────────────────────────────

def detect_pyramid_info(source_path: str) -> dict | None:
    """Inspect a source image for pre-existing pyramidal structure and metadata.

    Returns a metadata dict if the image is pyramidal (SVS, pyramidal TIFF),
    ``None`` otherwise.  The dict contains:

    - ``is_pyramidal``: always ``True`` when returned
    - ``loader``: the vips loader used (e.g. ``"openslideload"``, ``"tiffload"``)
    - ``level_count``: number of pyramid levels
    - ``mpp_x``, ``mpp_y``: microns per pixel (if available)
    - ``objective_power``: objective magnification (if available)
    - ``measurement_scale``: pixels per µm (derived from mpp_x), ready for
      the frontend measurement system
    - ``measurement_unit``: always ``"um"`` when mpp is available
    """
    try:
        img = pyvips.Image.new_from_file(source_path, access="sequential")

        loader = img.get("vips-loader") if "vips-loader" in img.get_fields() else None

        if loader == "openslideload":
            return _detect_openslide_pyramid(source_path, img)
        if loader == "tiffload":
            return _detect_tiff_pyramid(source_path, img)
    except Exception:
        return None
    return None


def _detect_openslide_pyramid(source_path: str, img: pyvips.Image) -> dict | None:
    """Detect pyramid info for OpenSlide-supported formats (SVS, MRXS, etc.)."""
    fields = img.get_fields()

    level_count_str = img.get("openslide.level-count") if "openslide.level-count" in fields else None
    if level_count_str is None:
        return None

    level_count = int(level_count_str)
    if level_count <= 1:
        return None

    info: dict = {
        "is_pyramidal": True,
        "loader": "openslideload",
        "level_count": level_count,
    }

    # Extract microns-per-pixel
    mpp_x = _get_float_field(img, fields, "openslide.mpp-x")
    mpp_y = _get_float_field(img, fields, "openslide.mpp-y")
    if mpp_x is not None:
        info["mpp_x"] = mpp_x
    if mpp_y is not None:
        info["mpp_y"] = mpp_y

    # Extract objective power
    objective_power = _get_float_field(img, fields, "openslide.objective-power")
    if objective_power is not None:
        info["objective_power"] = objective_power

    # Aperio-specific metadata (SVS files)
    app_mag = _get_float_field(img, fields, "aperio.AppMag")
    if app_mag is not None and objective_power is None:
        info["objective_power"] = app_mag
    aperio_mpp = _get_float_field(img, fields, "aperio.MPP")
    if aperio_mpp is not None and mpp_x is None:
        info["mpp_x"] = aperio_mpp
        mpp_x = aperio_mpp

    # Derive measurement config from MPP
    if mpp_x is not None and mpp_x > 0:
        info["measurement_scale"] = round(1.0 / mpp_x, 4)
        info["measurement_unit"] = "um"

    return info


def _detect_tiff_pyramid(source_path: str, img: pyvips.Image) -> dict | None:
    """Detect pyramid info for standard pyramidal TIFF files."""
    fields = img.get_fields()

    # Check for SubIFD-based pyramid first
    try:
        subifd_img = pyvips.Image.new_from_file(source_path, subifd=0, access="sequential")
        if subifd_img.width < img.width and subifd_img.height < img.height:
            # Count SubIFD levels
            level_count = 1  # base level
            for i in range(10):  # reasonable max
                try:
                    sub = pyvips.Image.new_from_file(source_path, subifd=i, access="sequential")
                    if sub.width < img.width:
                        level_count += 1
                    else:
                        break
                except Exception:
                    break

            info: dict = {
                "is_pyramidal": True,
                "loader": "tiffload",
                "level_count": level_count,
            }
            _extract_tiff_resolution(img, fields, info)
            return info
    except Exception:
        pass

    # Check for multi-page pyramid
    n_pages_str = img.get("n-pages") if "n-pages" in fields else None
    if n_pages_str is not None:
        n_pages = int(n_pages_str)
        if n_pages > 1:
            try:
                page1 = pyvips.Image.new_from_file(source_path, page=1, access="sequential")
                if page1.width < img.width and page1.height < img.height:
                    info = {
                        "is_pyramidal": True,
                        "loader": "tiffload",
                        "level_count": n_pages,
                    }
                    _extract_tiff_resolution(img, fields, info)
                    return info
            except Exception:
                pass

    return None


def _extract_tiff_resolution(img: pyvips.Image, fields: list[str], info: dict) -> None:
    """Extract resolution metadata from TIFF fields and derive measurement config."""
    xres = img.xres if img.xres > 0 else None
    yres = img.yres if img.yres > 0 else None

    # libvips stores resolution in pixels/mm by default for TIFF
    # Convert to microns-per-pixel: 1 px = (1/xres) mm = (1000/xres) µm
    if xres is not None and xres > 0:
        mpp_x = 1000.0 / xres
        # Only use if the value is in a reasonable range for microscopy (0.01 - 100 µm/px)
        if 0.01 <= mpp_x <= 100:
            info["mpp_x"] = round(mpp_x, 4)
            info["measurement_scale"] = round(xres / 1000.0, 4)
            info["measurement_unit"] = "um"

    if yres is not None and yres > 0:
        mpp_y = 1000.0 / yres
        if 0.01 <= mpp_y <= 100:
            info["mpp_y"] = round(mpp_y, 4)


async def _best_effort_source_checksum(source_path: str) -> str | None:
    """Compute the source checksum off the event loop, never raising.

    ``compute_source_checksum`` already swallows file I/O errors, but the
    ``asyncio.to_thread`` dispatch itself could in theory fail (e.g. thread
    pool exhaustion). Provenance must never abort a processing run whose tiles
    already generated successfully, so any error here degrades to ``None``.
    """
    try:
        return await asyncio.to_thread(compute_source_checksum, source_path)
    except Exception:
        logger.debug(
            "Source checksum dispatch failed (non-critical)",
            extra={
                "event": "tiles.checksum_dispatch_failed",
                "source_path": source_path,
            },
        )
        return None


def _get_float_field(img: pyvips.Image, fields: list[str], name: str) -> float | None:
    """Safely extract a numeric metadata field from a vips image."""
    if name not in fields:
        return None
    try:
        return float(img.get(name))
    except (ValueError, TypeError):
        return None


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


def _estimate_tile_count(width: int, height: int, tile_size: int = DZI_TILE_SIZE) -> int:
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
    image.dzsave(
        dzi_output,
        tile_size=DZI_TILE_SIZE,
        overlap=DZI_OVERLAP,
        suffix=DZI_TILE_SUFFIX,
    )
    t_dzsave_end = time.monotonic()

    dzsave_duration_ms = round((t_dzsave_end - t_dzsave_start) * 1000)

    span.add_event("tiles_generated", attributes={
        "tile_count": estimated_tiles,
        "duration_ms": dzsave_duration_ms,
    })

    logger.info(
        "DZI tile generation completed",
        extra={
            "event": "tiles.generation_completed",
            "source_path": source_path,
            "duration_ms": dzsave_duration_ms,
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

    span.add_event("thumbnail_saved")

    logger.info(
        "Thumbnail generated",
        extra={
            "event": "tiles.thumbnail_completed",
            "source_path": source_path,
        },
    )

    span.set_attribute("tiles.dzsave_duration_ms", dzsave_duration_ms)

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
        _record_processing_started("process")
        t_start = time.monotonic()

        span.set_attribute("source_image.filename", src.original_filename)

        try:
            # Detect pyramidal structure and extract metadata (non-blocking)
            pyramid_info = await asyncio.to_thread(detect_pyramid_info, src.stored_path)
            if pyramid_info is not None:
                span.set_attributes({
                    "pyramid.detected": True,
                    "pyramid.loader": pyramid_info.get("loader", ""),
                    "pyramid.level_count": pyramid_info.get("level_count", 0),
                })
                span.add_event("pyramid_detected", attributes={
                    "loader": pyramid_info.get("loader", ""),
                    "level_count": pyramid_info.get("level_count", 0),
                })
                logger.info(
                    "Pyramidal image detected",
                    extra={
                        "event": "processing.pyramid_detected",
                        "source_image_id": src.id,
                        "original_filename": src.original_filename,
                        "pyramid_info": pyramid_info,
                    },
                )

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

            # Compute the provenance checksum now, while the session is in a
            # committed (idle) state. This reads the full source file (multi-GB
            # for histology slides), so doing it here keeps that I/O out of the
            # later flush→commit window and avoids holding a transaction open.
            source_checksum = await _best_effort_source_checksum(src.stored_path)

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

                # Build metadata from pyramid detection results
                image_metadata: dict = {}
                if pyramid_info is not None:
                    if "measurement_scale" in pyramid_info:
                        image_metadata["measurement_scale"] = pyramid_info["measurement_scale"]
                    if "measurement_unit" in pyramid_info:
                        image_metadata["measurement_unit"] = pyramid_info["measurement_unit"]
                    if "objective_power" in pyramid_info:
                        image_metadata["objective_power"] = pyramid_info["objective_power"]
                    if "mpp_x" in pyramid_info:
                        image_metadata["mpp_x"] = pyramid_info["mpp_x"]
                    if "mpp_y" in pyramid_info:
                        image_metadata["mpp_y"] = pyramid_info["mpp_y"]
                    image_metadata["pyramid_detected"] = True
                    image_metadata["pyramid_level_count"] = pyramid_info.get("level_count")

                img = Image(
                    name=name,
                    thumb=thumb_url,
                    tile_sources=tile_sources_url,
                    category_id=src.category_id,
                    copyright=src.copyright,
                    note=src.note,
                    active=src.active,
                    metadata_=image_metadata,
                    width=img_width,
                    height=img_height,
                    file_size=file_size_mb,
                )
                db.add(img)
                await db.flush()

                # Record tile-cache provenance so currentness can be evaluated
                # later without filesystem inspection. The checksum was computed
                # above (outside this transaction) and is best-effort, so it
                # never blocks completion.
                src.source_checksum = source_checksum
                src.tile_settings_hash = current_tile_settings_hash()
                src.tiles_generated_at = datetime.now(timezone.utc)

                src.image_id = img.id
                src.status = "completed"
                src.progress = 100
                src.status_message = "Completed"
                await db.commit()

            duration_ms = round((time.monotonic() - t_start) * 1000)
            _record_processing_finished("process", duration_ms / 1000, True)
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

        except Exception as exc:
            span.record_exception(exc)
            span.set_status(StatusCode.ERROR, str(exc))
            duration_ms = round((time.monotonic() - t_start) * 1000)
            _record_processing_finished("process", duration_ms / 1000, False)
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
        _record_processing_started("replace")
        t_start = time.monotonic()

        try:
            # Detect pyramidal structure for the replacement file
            pyramid_info = await asyncio.to_thread(detect_pyramid_info, src.stored_path)
            if pyramid_info is not None:
                span.set_attributes({
                    "pyramid.detected": True,
                    "pyramid.loader": pyramid_info.get("loader", ""),
                    "pyramid.level_count": pyramid_info.get("level_count", 0),
                })
                span.add_event("pyramid_detected", attributes={
                    "loader": pyramid_info.get("loader", ""),
                    "level_count": pyramid_info.get("level_count", 0),
                })
                logger.info(
                    "Pyramidal image detected (replacement)",
                    extra={
                        "event": "replace.pyramid_detected",
                        "source_image_id": src.id,
                        "target_image_id": target_image_id,
                        "pyramid_info": pyramid_info,
                    },
                )

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

            # Compute the provenance checksum now, while the session is in a
            # committed (idle) state. This reads the full source file (multi-GB
            # for histology slides), so doing it here keeps that I/O out of the
            # later flush/commit window and avoids holding a transaction open.
            source_checksum = await _best_effort_source_checksum(src.stored_path)

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

                # Clear old pyramid metadata before merging new
                for key in ("pyramid_detected", "pyramid_level_count",
                            "mpp_x", "mpp_y", "objective_power",
                            "measurement_scale", "measurement_unit"):
                    current_meta.pop(key, None)

                # Merge pyramid metadata from the new source file
                if pyramid_info is not None:
                    if "measurement_scale" in pyramid_info:
                        current_meta["measurement_scale"] = pyramid_info["measurement_scale"]
                    if "measurement_unit" in pyramid_info:
                        current_meta["measurement_unit"] = pyramid_info["measurement_unit"]
                    if "objective_power" in pyramid_info:
                        current_meta["objective_power"] = pyramid_info["objective_power"]
                    if "mpp_x" in pyramid_info:
                        current_meta["mpp_x"] = pyramid_info["mpp_x"]
                    if "mpp_y" in pyramid_info:
                        current_meta["mpp_y"] = pyramid_info["mpp_y"]
                    current_meta["pyramid_detected"] = True
                    current_meta["pyramid_level_count"] = pyramid_info.get("level_count")

                img.metadata_ = current_meta if current_meta else {}

                # Record tile-cache provenance for the replacement source so
                # the new tile tree's currentness is tracked. The checksum was
                # computed above (outside this transaction) and is best-effort,
                # so it never blocks completion.
                src.source_checksum = source_checksum
                src.tile_settings_hash = current_tile_settings_hash()
                src.tiles_generated_at = datetime.now(timezone.utc)

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
            _record_processing_finished("replace", duration_ms / 1000, True)
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

        except Exception as exc:
            span.record_exception(exc)
            span.set_status(StatusCode.ERROR, str(exc))
            duration_ms = round((time.monotonic() - t_start) * 1000)
            _record_processing_finished("replace", duration_ms / 1000, False)
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


# ── Tile rebuild (issue #735) ─────────────────────────────
#
# Generated tiles are derived data: they can always be regenerated from the
# preserved source image. These helpers support an operator-safe rebuild flow
# for tile sets that are *missing* (e.g. a restore brought back the database
# but not the tile volume) or *stale* (generated under an older pipeline). They
# are deliberately filesystem-aware: tile-cache provenance in the database can
# report ``current`` after a DB-only restore, so on-disk presence is checked
# directly rather than trusting provenance alone.

# Valid rebuild scopes (see ``select_rebuild_targets``).
REBUILD_SCOPE_MISSING = "missing"
REBUILD_SCOPE_STALE = "stale"
REBUILD_SCOPE_MISSING_STALE = "missing_stale"
REBUILD_SCOPE_ALL = "all"
REBUILD_SCOPES = frozenset(
    {
        REBUILD_SCOPE_MISSING,
        REBUILD_SCOPE_STALE,
        REBUILD_SCOPE_MISSING_STALE,
        REBUILD_SCOPE_ALL,
    }
)


def _tile_source_id_from_url(tile_sources: str | None) -> int | None:
    """Extract the source-image id embedded in a tile-sources URL.

    Tile URLs look like ``/api/tiles/<source_image_id>/image.dzi``; the id is
    the third path segment. Returns ``None`` if the URL is empty or malformed.
    """
    if not tile_sources:
        return None
    parts = tile_sources.strip("/").split("/")
    # Expected: ["api", "tiles", "<id>", "image.dzi"]
    if len(parts) >= 3 and parts[0] == "api" and parts[1] == "tiles":
        try:
            return int(parts[2])
        except ValueError:
            return None
    return None


def tiles_present_on_disk(tiles_dir: str, source_image_id: int) -> bool:
    """Return ``True`` if a generated DZI manifest exists for *source_image_id*.

    The ``image.dzi`` manifest is written last-ish by ``dzsave`` and is the
    canonical marker that a tile tree exists for a source image. This is the
    only reliable way to distinguish a *missing* tile set (e.g. a restore that
    omitted the large tile volume) from a *current* one, because the database
    provenance can still report ``current`` after a DB-only restore.
    """
    manifest = os.path.join(tiles_dir, str(source_image_id), "image.dzi")
    return os.path.isfile(manifest)


async def select_rebuild_targets(
    session: AsyncSession,
    *,
    scope: str = REBUILD_SCOPE_MISSING_STALE,
    image_ids: list[int] | None = None,
) -> list[SourceImage]:
    """Resolve the set of source images whose tiles should be rebuilt.

    Only the *authoritative* source image for each linked :class:`Image` is
    considered — the one whose id is embedded in ``Image.tile_sources`` — so a
    rebuild never repoints an image at an older source left behind by a
    replacement. Selection is filesystem-aware:

    - ``missing`` — no tile manifest on disk.
    - ``stale`` — tiles present but generated under a different settings hash.
    - ``missing_stale`` — either of the above (the default).
    - ``all`` — every completed, linked source image (force rebuild).

    *image_ids* optionally narrows the population to those :class:`Image` ids.
    Already-current tile sets are skipped unless ``scope == "all"``, which keeps
    the operation idempotent and safe to rerun.
    """
    if scope not in REBUILD_SCOPES:
        raise ValueError(f"Unknown rebuild scope: {scope!r}")

    stmt = (
        select(SourceImage)
        .where(
            SourceImage.status == "completed",
            SourceImage.image_id.is_not(None),
        )
        .order_by(SourceImage.id)
    )
    if image_ids is not None:
        # An explicit (possibly empty) list narrows to those images; an empty
        # list therefore selects nothing rather than silently meaning "all".
        # ``None`` (the default) leaves the population unrestricted.
        stmt = stmt.where(SourceImage.image_id.in_(image_ids))

    sources = (await session.execute(stmt)).scalars().all()
    current_hash = current_tile_settings_hash()
    targets: list[SourceImage] = []

    for src in sources:
        img = await session.get(Image, src.image_id)
        if img is None:
            continue
        # Only rebuild the source that the image actually points at, so a
        # superseded source from a prior replacement is never resurrected.
        authoritative_id = _tile_source_id_from_url(img.tile_sources)
        if authoritative_id is not None and authoritative_id != src.id:
            continue

        present = tiles_present_on_disk(settings.tiles_dir, src.id)
        stale = src.tile_settings_hash != current_hash

        if scope == REBUILD_SCOPE_ALL:
            include = True
        elif scope == REBUILD_SCOPE_MISSING:
            include = not present
        elif scope == REBUILD_SCOPE_STALE:
            include = present and stale
        else:  # REBUILD_SCOPE_MISSING_STALE
            include = (not present) or stale

        if include:
            targets.append(src)

    return targets


async def rebuild_source_image_tiles(
    session: AsyncSession, src: SourceImage,
) -> None:
    """Regenerate the DZI tile tree for one existing source image.

    Tiles are generated into a temporary directory and then atomically swapped
    into place, so a failure mid-generation can never leave a half-written tile
    tree where good tiles used to be. On success the source's tile-cache
    provenance (``source_checksum``, ``tile_settings_hash``,
    ``tiles_generated_at``) and the linked image's geometry / tile URLs are
    updated and committed.

    Raises :class:`FileNotFoundError` when the preserved source file is missing
    so the batch runner can record a per-image failure and continue. Image
    metadata (annotations, overlays, measurement scale) is intentionally left
    untouched because the geometry is unchanged by a regeneration from the same
    source bytes.
    """
    span = trace.get_current_span()
    span.set_attribute("source_image.id", src.id)

    if not src.stored_path or not await asyncio.to_thread(
        os.path.isfile, src.stored_path,
    ):
        raise FileNotFoundError(
            f"Source image file not found for source #{src.id}: {src.stored_path!r}"
        )

    img = await session.get(Image, src.image_id) if src.image_id else None

    output_dir = os.path.join(settings.tiles_dir, str(src.id))
    tmp_dir = os.path.join(
        settings.tiles_dir, f".rebuild-{src.id}-{uuid4().hex}",
    )

    _record_processing_started("rebuild")
    t_start = time.monotonic()

    try:
        with tracer.start_as_current_span("rebuild_generate_tiles"):
            dzi_rel, thumb_rel, img_width, img_height = await asyncio.to_thread(
                generate_tiles, src.stored_path, tmp_dir,
            )

        def _swap() -> None:
            # Rename-based swap so the previous tile tree stays recoverable
            # until the new one is promoted: move any existing tree aside, then
            # rename the freshly generated tree into place (the target no longer
            # exists, so the directory rename succeeds), then delete the old
            # tree. If promotion fails, the old tree is restored so we never end
            # up serving no tiles at all. Each step is a single rename, so the
            # window where ``output_dir`` is absent is as small as possible.
            backup_dir = f"{output_dir}.old-{uuid4().hex}"
            had_existing = os.path.isdir(output_dir)
            if had_existing:
                os.replace(output_dir, backup_dir)
            try:
                os.replace(tmp_dir, output_dir)
            except Exception:
                if had_existing:
                    os.replace(backup_dir, output_dir)
                raise
            if had_existing:
                shutil.rmtree(backup_dir, ignore_errors=True)

        await asyncio.to_thread(_swap)
    except Exception:
        await asyncio.to_thread(shutil.rmtree, tmp_dir, True)
        raise

    source_checksum = await _best_effort_source_checksum(src.stored_path)

    src.source_checksum = source_checksum
    src.tile_settings_hash = current_tile_settings_hash()
    src.tiles_generated_at = datetime.now(timezone.utc)

    if img is not None:
        img.tile_sources = f"/api/tiles/{src.id}/{dzi_rel}"
        img.thumb = f"/api/tiles/{src.id}/{thumb_rel}"
        img.width = img_width
        img.height = img_height
        # Bump the version so viewers refetch tiles rather than serving a
        # browser-cached copy of the previous (missing/stale) tree.
        img.version = img.version + 1

    await session.commit()

    duration_ms = round((time.monotonic() - t_start) * 1000)
    _record_processing_finished("rebuild", duration_ms / 1000, True)

    logger.info(
        "Rebuilt tiles for source image",
        extra={
            "event": "tiles.rebuilt",
            "source_image_id": src.id,
            "image_id": src.image_id,
        },
    )
