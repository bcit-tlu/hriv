"""Stitch a selection region out of an existing DZI tile pyramid (#1663).

Pure module — no database, no Redis, no request state. The API uses
:func:`plan_region` for cheap pre-flight validation; the counting worker
calls it again and then :func:`stitch_region` to decode only the tiles
intersecting the region (selection plus margin) at the chosen pyramid
level. The original source image and client-rendered pixels are never
involved.

Tile layout (produced by ``dzsave`` — see ``tile_provenance.py`` for the
generation parameters):

``<tiles_dir>/<source_image_id>/image.dzi``               — manifest
``<tiles_dir>/<source_image_id>/image_files/<level>/<col>_<row>.<format>``

Level ``max_level`` is full resolution; level ``L`` has dimensions
``ceil(W / 2**(max_level - L))`` x ``ceil(H / 2**(max_level - L))``
(verified against real ``dzsave`` output for odd sizes, e.g. 1001x777 ->
level 9 is 501x389). Tile ``(col, row)`` has its top-left corner at level
pixels ``(col*tile_size - (overlap if col > 0 else 0), ditto for row)``;
edge tiles are smaller, so per-tile extents come from each decoded tile's
own dimensions rather than from ``tile_size``.
"""

from __future__ import annotations

import math
import os
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

import pyvips

# Hard memory guard: refuse to decode a region larger than this many level
# pixels regardless of the configured budget (~75 MB of RGB uchar). The
# configured ``max_pixels`` can only shrink the limit, never grow past it.
MAX_DECODED_PIXELS = 25_000_000


class CountingRegionError(Exception):
    """Base error for selection/planning/tile problems.

    ``code`` is the stable machine-readable identifier surfaced to API
    clients (HTTP ``detail``) and mapped to worker result ``error`` codes.
    """

    code = "internal"

    def __init__(self, message: str = "") -> None:
        super().__init__(message)


class InvalidSelection(CountingRegionError):
    code = "invalid_selection"


class RegionTooLarge(CountingRegionError):
    code = "selection_too_large"


class MissingTiles(CountingRegionError):
    code = "no_tiles"


@dataclass(frozen=True)
class Rect:
    """Rectangle in level-0 image pixels (unless documented otherwise)."""

    x: int
    y: int
    width: int
    height: int


@dataclass(frozen=True)
class DziInfo:
    """Parsed ``image.dzi`` manifest plus the derived top pyramid level."""

    width: int
    height: int
    tile_size: int
    overlap: int
    format: str
    max_level: int


@dataclass(frozen=True)
class RegionPlan:
    """Everything the worker needs to stitch one selection region."""

    level: int  # DZI pyramid level to read
    downsample: int  # level-0 px per level px (power of two)
    selection: Rect  # requested selection, clamped to the image (level-0)
    region: Rect  # selection + margin, clamped to the image (level-0)
    level_rect: Rect  # region expressed in level pixels
    out_width: int
    out_height: int


def _ceil_div(value: int, divisor: int) -> int:
    return -(-value // divisor)


def read_dzi(tile_root: Path) -> DziInfo:
    """Parse ``image.dzi`` under *tile_root*.

    Raises :class:`MissingTiles` when the manifest is absent or
    unparsable — a tile tree without a valid manifest is unusable.
    """
    manifest = tile_root / "image.dzi"
    try:
        root = ET.parse(manifest).getroot()
        tile_size = int(root.attrib["TileSize"])
        overlap = int(root.attrib["Overlap"])
        fmt = root.attrib["Format"]
        size = root.find("{*}Size")
        if size is None:
            raise KeyError("Size")
        width = int(size.attrib["Width"])
        height = int(size.attrib["Height"])
    except (OSError, KeyError, ValueError, ET.ParseError) as exc:
        raise MissingTiles(f"unreadable DZI manifest: {manifest}") from exc
    if width <= 0 or height <= 0 or tile_size <= 0 or overlap < 0:
        raise MissingTiles(f"invalid DZI manifest: {manifest}")
    max_level = int(math.ceil(math.log2(max(width, height)))) if max(width, height) > 1 else 0
    return DziInfo(
        width=width,
        height=height,
        tile_size=tile_size,
        overlap=overlap,
        format=fmt,
        max_level=max_level,
    )


def resolve_tile_root(tiles_dir: str, source_image_id: int) -> Path:
    """Return the canonical tile directory for *source_image_id*.

    Mirrors the ``os.path.realpath`` + ``startswith(base + os.sep)``
    containment barrier in ``routers/tiles.py`` (the shape CodeQL's
    path-injection query recognises). Raises :class:`MissingTiles` when the
    directory would escape the tiles base or holds no ``image.dzi``.
    """
    base_real = os.path.realpath(tiles_dir)
    root_real = os.path.realpath(os.path.join(base_real, str(source_image_id)))
    if not root_real.startswith(base_real + os.sep):
        raise MissingTiles("tile root escapes tiles directory")
    root = Path(root_real)
    if not (root / "image.dzi").is_file():
        raise MissingTiles(f"no tile pyramid for source image {source_image_id}")
    return root


def plan_region(
    dzi: DziInfo,
    selection: Rect,
    *,
    margin_px: int,
    max_pixels: int,
    max_downsample: int,
) -> RegionPlan:
    """Pick the pyramid level and geometry for one count job.

    *margin_px* counts pixels **at the chosen level** (roughly one object
    diameter at processing resolution), so the level-0 margin grows with
    the downsample factor. The finest level whose stitched pixel count
    fits ``min(max_pixels, MAX_DECODED_PIXELS)`` wins; when even the
    coarsest permitted level is over budget the plan raises
    :class:`RegionTooLarge`. Selections must have positive size and
    intersect the image.
    """
    if selection.width <= 0 or selection.height <= 0:
        raise InvalidSelection("selection has no area")

    sx0 = max(0, selection.x)
    sy0 = max(0, selection.y)
    sx1 = min(dzi.width, selection.x + selection.width)
    sy1 = min(dzi.height, selection.y + selection.height)
    if sx1 <= sx0 or sy1 <= sy0:
        raise InvalidSelection("selection does not intersect the image")
    clamped_selection = Rect(sx0, sy0, sx1 - sx0, sy1 - sy0)

    pixel_cap = min(max_pixels, MAX_DECODED_PIXELS)
    level_w = dzi.width
    level_h = dzi.height
    downsample = 1
    while downsample <= max_downsample:
        level = dzi.max_level - (downsample.bit_length() - 1)
        if level < 0:
            break
        margin = margin_px * downsample
        rx0 = max(0, sx0 - margin)
        ry0 = max(0, sy0 - margin)
        rx1 = min(dzi.width, sx1 + margin)
        ry1 = min(dzi.height, sy1 + margin)

        lx0 = rx0 // downsample
        ly0 = ry0 // downsample
        lx1 = min(_ceil_div(rx1, downsample), level_w)
        ly1 = min(_ceil_div(ry1, downsample), level_h)
        out_w = lx1 - lx0
        out_h = ly1 - ly0
        if out_w * out_h <= pixel_cap:
            return RegionPlan(
                level=level,
                downsample=downsample,
                selection=clamped_selection,
                region=Rect(rx0, ry0, rx1 - rx0, ry1 - ry0),
                level_rect=Rect(lx0, ly0, out_w, out_h),
                out_width=out_w,
                out_height=out_h,
            )
        downsample *= 2
        level_w = _ceil_div(level_w, 2)
        level_h = _ceil_div(level_h, 2)
    raise RegionTooLarge(
        f"selection needs more than {pixel_cap} pixels at every permitted level"
    )


def _to_rgb_uchar(img: pyvips.Image) -> pyvips.Image:
    """Normalise a decoded tile to 3-band uchar RGB on a white backdrop."""
    if img.bands in (2, 4):
        img = img.flatten(background=[255, 255, 255])
    elif img.bands > 4:
        img = img.extract_band(0, n=3).flatten(background=[255, 255, 255])
    if img.bands == 1:
        img = img.bandjoin([img, img])
    if img.format != "uchar":
        img = img.cast("uchar")
    return img


def stitch_region(tile_root: Path, dzi: DziInfo, plan: RegionPlan) -> pyvips.Image:
    """Reconstruct ``plan.level_rect`` pixels from the tile pyramid.

    Reads only the tiles intersecting the region (never the whole level),
    composites them onto a white canvas and returns a 3-band uchar image of
    exactly ``plan.out_width`` x ``plan.out_height``. A tile file that
    should exist but does not raises :class:`MissingTiles`.
    """
    rect = plan.level_rect
    level_dir = tile_root / "image_files" / str(plan.level)
    canvas = pyvips.Image.black(rect.width, rect.height).new_from_image(
        [255, 255, 255]
    )

    col_first = rect.x // dzi.tile_size
    col_last = (rect.x + rect.width - 1) // dzi.tile_size
    row_first = rect.y // dzi.tile_size
    row_last = (rect.y + rect.height - 1) // dzi.tile_size
    for row in range(row_first, row_last + 1):
        for col in range(col_first, col_last + 1):
            tile_path = level_dir / f"{col}_{row}.{dzi.format}"
            if not tile_path.is_file():
                raise MissingTiles(f"missing tile {tile_path}")
            tile = _to_rgb_uchar(pyvips.Image.new_from_file(str(tile_path)))
            # Tile origin in level px: each tile covers its nominal
            # tile_size cell plus `overlap` px on every side that borders
            # another tile (edge tiles are clipped smaller). The DeepZoom
            # convention offsets the origin by `overlap` for col/row > 0.
            origin_x = col * dzi.tile_size - (dzi.overlap if col > 0 else 0)
            origin_y = row * dzi.tile_size - (dzi.overlap if row > 0 else 0)
            # ``insert`` clips the tile where it falls outside the canvas,
            # so edge tiles need no explicit cropping.
            canvas = canvas.insert(tile, origin_x - rect.x, origin_y - rect.y)
    return canvas
