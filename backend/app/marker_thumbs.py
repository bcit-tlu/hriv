"""Viewport thumbnails derived only from local DZI tiles."""

import math
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import pyvips

from .counting.stitch import (
    MAX_DECODED_PIXELS, DziInfo, Rect, plan_region, read_dzi, stitch_region,
)
from .database import settings
from .models import Image

THUMB_WIDTH = 320
THUMB_HEIGHT = 240
VIEWER_BACKGROUND = [33, 33, 33]
_LOCAL_DZI = re.compile(r"/api/tiles/([0-9]+)/image\.dzi")


@dataclass(frozen=True)
class ThumbnailPlan:
    downsample: int
    window: Rect
    width: int
    height: int
    rotation: float


def plan_thumbnail(
    dzi: DziInfo, x: float, y: float, zoom: float, rotation: float,
) -> ThumbnailPlan:
    """Plan a centred viewport crop in level pixels, without shifting edges."""
    if not all(math.isfinite(v) for v in (x, y, zoom, rotation)) or zoom <= 0:
        raise ValueError("Viewport values must be finite and zoom positive")
    full_width = dzi.width / zoom
    if not math.isfinite(full_width):
        raise ValueError("Viewport is too large")
    downsample = 1
    while downsample < 2 ** dzi.max_level and full_width / (downsample * 2) >= THUMB_WIDTH:
        downsample *= 2
    width = max(1, round(full_width / downsample))
    height = max(1, round(full_width * THUMB_HEIGHT / THUMB_WIDTH / downsample))
    angle = rotation % 360
    # A square expanded by sqrt(2) covers the rotated 4:3 window at every angle.
    side = math.ceil(max(width, height) * math.sqrt(2)) if angle else 0
    pre_width, pre_height = (side, side) if angle else (width, height)
    if pre_width * pre_height > MAX_DECODED_PIXELS:
        raise ValueError("Viewport is too large")
    cx, cy = x * dzi.width / downsample, y * dzi.width / downsample
    if not math.isfinite(cx) or not math.isfinite(cy):
        raise ValueError("Viewport centre is too large")
    window = Rect(
        math.floor(cx - pre_width / 2), math.floor(cy - pre_height / 2),
        pre_width, pre_height,
    )
    return ThumbnailPlan(downsample, window, width, height, angle)


def local_tile_root(image: Image, tiles_dir: str | Path | None = None) -> Path | None:
    """Resolve only canonical local Image.tile_sources URLs beneath TILES_DIR."""
    url = urlsplit(image.tile_sources or "")
    match = _LOCAL_DZI.fullmatch(url.path)
    if url.scheme or url.netloc or not match:
        return None
    base = Path(tiles_dir if tiles_dir is not None else settings.tiles_dir).resolve()
    root = base / match[1]
    if root.is_symlink() or not root.resolve().is_relative_to(base):
        return None
    return root


def generate_viewport_thumbnail(
    image: Image, thumbnail_id: int, x: float, y: float, zoom: float,
    rotation: float = 0, *, namespace: str, tiles_dir: str | Path | None = None,
) -> str | None:
    """Write a 320x240 Q82 JPEG; return its local API path or None without DZI.

    Synchronous and request/session independent; callers may use asyncio.to_thread.
    Corrupt manifests or missing intersecting tiles propagate to the caller.
    """
    if type(thumbnail_id) is not int or thumbnail_id <= 0:
        raise ValueError("Thumbnail id must be a positive integer")
    if namespace not in {"markers", "collection_slots"}:
        raise ValueError("Invalid thumbnail namespace")
    root = local_tile_root(image, tiles_dir)
    if root is None or not (root / "image.dzi").is_file() or not (root / "image_files").is_dir():
        return None
    dzi = read_dzi(root)
    plan = plan_thumbnail(dzi, x, y, zoom, rotation)
    window = plan.window
    scale = plan.downsample
    left, top = max(0, window.x), max(0, window.y)
    right = min(math.ceil(dzi.width / scale), window.x + window.width)
    bottom = min(math.ceil(dzi.height / scale), window.y + window.height)
    canvas = pyvips.Image.black(window.width, window.height).new_from_image(VIEWER_BACKGROUND)
    if right > left and bottom > top:
        region = plan_region(
            dzi, Rect(left * scale, top * scale, (right - left) * scale, (bottom - top) * scale),
            margin_px=0, max_pixels=MAX_DECODED_PIXELS,
            max_downsample=scale, downsample=scale,
        )
        canvas = canvas.insert(stitch_region(root, dzi, region), left - window.x, top - window.y)
    if plan.rotation:
        canvas = canvas.rotate(plan.rotation, background=VIEWER_BACKGROUND)
    canvas = canvas.crop(
        (canvas.width - plan.width) // 2, (canvas.height - plan.height) // 2,
        plan.width, plan.height,
    )
    canvas = canvas.resize(THUMB_WIDTH / plan.width, vscale=THUMB_HEIGHT / plan.height)
    directory = root / namespace
    if directory.is_symlink():
        raise ValueError("Thumbnail directory must not be a symlink")
    directory.mkdir(exist_ok=True)
    target = directory / f"{thumbnail_id}.jpg"
    temporary = directory / f".{thumbnail_id}-{uuid4().hex}.jpg"
    try:
        canvas.jpegsave(str(temporary), Q=82)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    return f"/api/tiles/{root.name}/{namespace}/{thumbnail_id}.jpg"


def generate_marker_thumbnail(
    image: Image, marker_id: int, x: float, y: float, zoom: float,
    rotation: float = 0, *, tiles_dir: str | Path | None = None,
) -> str | None:
    return generate_viewport_thumbnail(
        image, marker_id, x, y, zoom, rotation,
        namespace="markers", tiles_dir=tiles_dir,
    )


def remove_marker_thumbnail(
    image: Image, marker_id: int, *, tiles_dir: str | Path | None = None,
) -> None:
    if type(marker_id) is not int or marker_id <= 0:
        raise ValueError("Marker id must be a positive integer")
    root = local_tile_root(image, tiles_dir)
    if root is not None and not (root / "markers").is_symlink():
        (root / "markers" / f"{marker_id}.jpg").unlink(missing_ok=True)


def rename_legacy_thumbnail_dirs(*, tiles_dir: str | Path | None = None) -> int:
    """Rename pre-Marker ``<image>/inuksuks`` thumbnail dirs to ``markers``.

    Returns the number of directories renamed. Symlinks and already-existing
    ``markers`` targets are left untouched.
    """
    base = Path(tiles_dir if tiles_dir is not None else settings.tiles_dir)
    if not base.is_dir():
        return 0
    renamed = 0
    for legacy in base.glob("*/inuksuks"):
        if legacy.is_symlink() or not legacy.is_dir():
            continue
        target = legacy.parent / "markers"
        if target.exists():
            continue
        legacy.rename(target)
        renamed += 1
    return renamed


def remove_image_marker_thumbnails(
    image: Image, *, tiles_dir: str | Path | None = None,
) -> None:
    root = local_tile_root(image, tiles_dir)
    if root is not None:
        directory = root / "markers"
        if directory.is_symlink():
            directory.unlink()
        else:
            shutil.rmtree(directory, ignore_errors=True)
