"""Red-blood-cell ruler: estimate the RBC diameter in source pixels.

Normal erythrocytes are ~7.5 µm across, so the dominant RBC size in a blood
film gives the image's pixels-per-µm. Pure libvips (no numpy/scipy) so it
runs in the main worker image: pink (non-nuclear) cells are masked from
HSV saturation/hue, holes (central pallor) are filled, and each connected
component's inscribed radius (max of the distance-to-background) is taken.
Touching cells still yield ~one cell's inscribed radius, so the area-weighted
mode of those radii is robust to clumps and rouleaux.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import pyvips

WORK_MAX_SIDE = 2000
# libvips HSV bands are 0–255.
_SAT_ABOVE_BACKGROUND = 15  # ~0.06 above the median (background) saturation
_PURPLE_HUE_MIN = 158  # ~0.62
_PURPLE_HUE_MAX = 217  # ~0.85
_PURPLE_SAT_MIN = 64  # ~0.25
_MIN_RADIUS_PX = 3.0  # at work resolution; smaller components are noise
_MIN_COMPONENTS = 10
_MODE_BINS = 40
_MODE_WINDOW = (0.8, 1.25)

_SQUARE3 = [[255] * 3 for _ in range(3)]
_SQUARE5 = [[255] * 5 for _ in range(5)]


@dataclass(frozen=True)
class DetectorParams:
    """Tunable knobs for the RBC detector (epic #1865, #1866).

    Defaults are exactly the shipped constants — ``DetectorParams()``
    reproduces the previous detection bit-for-bit, so existing findings
    stay valid and ``detector_version`` does not need a bump.
    """

    sat_above_background: int = _SAT_ABOVE_BACKGROUND
    purple_hue_min: int = _PURPLE_HUE_MIN
    purple_hue_max: int = _PURPLE_HUE_MAX
    purple_sat_min: int = _PURPLE_SAT_MIN
    min_radius_px: float = _MIN_RADIUS_PX
    mode_window_lo: float = _MODE_WINDOW[0]
    mode_window_hi: float = _MODE_WINDOW[1]

    def __post_init__(self) -> None:
        if not 0 < self.sat_above_background <= 255:
            raise ValueError("sat_above_background out of range")
        if not 0 <= self.purple_hue_min < self.purple_hue_max <= 255:
            raise ValueError("purple hue window out of range")
        if not 0 <= self.purple_sat_min <= 255:
            raise ValueError("purple_sat_min out of range")
        if not 0 < self.min_radius_px <= 100:
            raise ValueError("min_radius_px out of range")
        if not 0 < self.mode_window_lo < self.mode_window_hi:
            raise ValueError("mode window out of range")


@dataclass(frozen=True)
class RbcMeasurement:
    diameter_px: float  # in full-resolution source pixels
    component_count: int
    selected_count: int
    peak_fraction: float  # share of area-weighted mass inside the mode window
    work_scale: float
    # Category raster in work-image pixels, only when requested: 0 = not a
    # component, 1 = counted but outside the dominant size window, 2 =
    # selected (inside it). Filled components; the client renders tint +
    # edge. PNG-encoded.
    outline_png: bytes | None = None


def load_work_image(path: str) -> pyvips.Image:
    """Shrink-on-load thumbnail (never upscaled) as 8-bit sRGB, 3 bands."""
    img = pyvips.Image.thumbnail(path, WORK_MAX_SIDE, size="down")
    if img.interpretation != "srgb":
        img = img.colourspace("srgb")
    if img.hasalpha():
        img = img.flatten(background=[255, 255, 255])
    if img.bands > 3:
        img = img.extract_band(0, n=3)
    if img.format != "uchar":
        img = img.cast("uchar")
    # Thumbnails decode sequentially; the mask pipeline reads the pixels
    # several times, so materialise once (~12 MB at WORK_MAX_SIDE).
    return img.copy_memory()


def _fill_holes(mask: pyvips.Image) -> pyvips.Image:
    """Fill enclosed background (RBC central pallor) in a 0/255 mask."""
    bg = (mask == 0).ifthenelse(255, 0).cast("uchar")
    padded = bg.embed(1, 1, bg.width + 2, bg.height + 2, extend="background", background=[255])
    flooded = padded.copy_memory().draw_flood(128, 0, 0, equal=True)
    filled = (flooded != 128).ifthenelse(255, 0).cast("uchar")
    return filled.crop(1, 1, mask.width, mask.height)


def _label_components(mask: pyvips.Image) -> tuple[pyvips.Image, list[float]]:
    """Label regions and return ``(labels, radius per label)``.

    ``radii[i]`` is the inscribed radius of the component labelled ``i``.
    ``labelregions`` labels the background too — every background region's
    radius is 0 (all its pixels sit at distance 0 from the background
    itself), so ``min_radius_px`` filters it without an area lookup that
    could mistake a large foreground clump for background.
    """
    seeds = (mask == 0).ifthenelse(255, 0).cast("uchar")
    _, opts = seeds.fill_nearest(distance=True)
    dist = opts["distance"]
    labels = mask.labelregions()
    per_label = dist.hist_find_indexed(labels, combine="max")
    return labels, [float(r) for r in per_label.tolist()[0]]


def _outline_png(
    labels: pyvips.Image,
    radii: list[float],
    min_radius_px: float,
    lo: float,
    hi: float,
) -> bytes:
    """Rasterize the detected components as a labelled mask image (#1872).

    Returns a single-channel uchar PNG: 0 where no counted component lies,
    1 on a counted-but-rejected component (outside the dominant size
    window) and 2 on a selected one. The background and components below
    ``min_radius_px`` (noise) are invisible — background regions always
    have radius 0 — matching ``component_count`` semantics. Fills — not
    rings — so the mask stays meaningful when the client renders it
    downscaled to a thumbnail.
    """
    categories = [
        0 if r < min_radius_px else (2 if lo < r < hi else 1)
        for r in radii
    ]
    lut = pyvips.Image.new_from_list([categories]).cast("uchar")
    classified = labels.maplut(lut)
    return classified.write_to_buffer(".png", strip=True)


def _weighted_log_mode(radii: list[float]) -> float:
    logs = [math.log(r) for r in radii]
    lo, hi = min(logs), max(logs)
    if hi - lo < 1e-9:
        return radii[0]
    width = (hi - lo) / _MODE_BINS
    hist = [0.0] * _MODE_BINS
    for r, lr in zip(radii, logs):
        hist[min(_MODE_BINS - 1, int((lr - lo) / width))] += r * r
    kernel = (1, 2, 3, 2, 1)
    smooth = [
        sum(k * hist[i + j - 2] for j, k in enumerate(kernel) if 0 <= i + j - 2 < _MODE_BINS)
        for i in range(_MODE_BINS)
    ]
    best = max(range(_MODE_BINS), key=smooth.__getitem__)
    return math.exp(lo + (best + 0.5) * width)


def measure_rbc_diameter(
    work: pyvips.Image,
    full_width: int,
    params: DetectorParams | None = None,
    with_outline: bool = False,
) -> RbcMeasurement | None:
    """Measure the dominant RBC diameter; ``None`` when no RBC population is found."""
    p = params or DetectorParams()
    scale = work.width / full_width if full_width else 1.0
    hsv = work.colourspace("hsv")
    hue, sat = hsv[0], hsv[1]
    background = sat.percent(50)
    foreground = sat > background + p.sat_above_background
    purple = (
        (hue > p.purple_hue_min)
        & (hue < p.purple_hue_max)
        & (sat > p.purple_sat_min)
    )
    purple = purple.morph(_SQUARE5, "dilate")
    pink = purple.ifthenelse(0, foreground).cast("uchar")
    pink = pink.morph(_SQUARE3, "erode").morph(_SQUARE3, "dilate")
    pink = _fill_holes(pink)

    labels, per_label = _label_components(pink)
    radii = [r for r in per_label if r >= p.min_radius_px]
    if len(radii) < _MIN_COMPONENTS:
        return None
    mode = _weighted_log_mode(radii)
    lo, hi = mode * p.mode_window_lo, mode * p.mode_window_hi
    selected = sorted(r for r in radii if lo < r < hi)
    # A dominant blob or two (e.g. a landscape photo) is not an RBC population.
    if len(selected) < _MIN_COMPONENTS:
        return None
    median = selected[len(selected) // 2]
    total_mass = sum(r * r for r in radii)
    peak_mass = sum(r * r for r in selected)
    return RbcMeasurement(
        diameter_px=(2 * median + 1) / scale,
        component_count=len(radii),
        selected_count=len(selected),
        peak_fraction=peak_mass / total_mass if total_mass else 0.0,
        work_scale=scale,
        outline_png=(
            _outline_png(labels, per_label, p.min_radius_px, lo, hi)
            if with_outline
            else None
        ),
    )
