"""Tests for ``app.counting.stitch`` (#1663): DZI parsing, region planning
and tile compositing against real ``dzsave`` pyramids.

Pyramid fixtures are generated with pyvips ``dzsave`` from patterned
sources (``xyz`` encodes pixel coordinates in the first two bands, so any
misalignment in the stitch shows up as a value error). PNG tiles give
exact pixel comparisons; one JPEG case asserts a lossy tolerance instead.
"""

import math
import os
from pathlib import Path

import pyvips
import pytest

from app.counting.stitch import (
    MAX_DECODED_PIXELS,
    DziInfo,
    InvalidSelection,
    MissingTiles,
    Rect,
    RegionTooLarge,
    plan_region,
    read_dzi,
    resolve_tile_root,
    stitch_region,
)

TILE_SIZE = 254
OVERLAP = 1


def _pattern_source(width: int, height: int) -> pyvips.Image:
    """Deterministic 3-band uchar source where bands 0/1 encode x/y."""
    xyz = pyvips.Image.xyz(width, height)
    return xyz.bandjoin(xyz.extract_band(0) * 0 + 128).cast("uchar")


def _build_pyramid(
    base: Path, sid: int, src: pyvips.Image, *, suffix: str = ".png"
) -> Path:
    root = base / str(sid)
    root.mkdir(parents=True)
    src.dzsave(
        str(root / "image"),
        tile_size=TILE_SIZE,
        overlap=OVERLAP,
        suffix=suffix,
    )
    return root


def _shrink_to_level(src: pyvips.Image, downsample: int) -> pyvips.Image:
    """Expected level image: dzsave halves per level, so iterate shrink(2)."""
    img = src
    d = downsample
    while d > 1:
        img = img.shrink(2, 2)
        d //= 2
    return img


@pytest.fixture(scope="module")
def odd_pyramid(tmp_path_factory):
    """1001x777 pyramid — odd dims exercise level-size rounding."""
    base = tmp_path_factory.mktemp("tiles")
    src = _pattern_source(1001, 777)
    root = _build_pyramid(base, 42, src)
    return src, base, root


@pytest.fixture(scope="module")
def odd_pyramid_jpeg(tmp_path_factory):
    """JPEG-tiled copy of the odd pyramid for lossy comparisons."""
    base = tmp_path_factory.mktemp("tiles-jpeg")
    src = _pattern_source(1001, 777)
    root = _build_pyramid(base, 7, src, suffix=".jpeg[Q=95]")
    return src, base, root


# ── read_dzi / resolve_tile_root ──────────────────────────


def test_read_dzi_parses_manifest(odd_pyramid) -> None:
    _, _, root = odd_pyramid
    dzi = read_dzi(root)
    assert dzi.width == 1001
    assert dzi.height == 777
    assert dzi.tile_size == TILE_SIZE
    assert dzi.overlap == OVERLAP
    assert dzi.format == "png"
    assert dzi.max_level == math.ceil(math.log2(1001))


def test_read_dzi_missing_manifest(tmp_path: Path) -> None:
    with pytest.raises(MissingTiles):
        read_dzi(tmp_path)


def test_read_dzi_malformed_manifest(tmp_path: Path) -> None:
    (tmp_path / "image.dzi").write_text("<not xml")
    with pytest.raises(MissingTiles):
        read_dzi(tmp_path)


def test_resolve_tile_root_returns_canonical_path(odd_pyramid) -> None:
    _, base, _ = odd_pyramid
    root = resolve_tile_root(str(base), 42)
    assert root == Path(os.path.realpath(base / "42"))
    assert (root / "image.dzi").is_file()


def test_resolve_tile_root_missing_pyramid(tmp_path: Path) -> None:
    with pytest.raises(MissingTiles):
        resolve_tile_root(str(tmp_path), 999)


def test_resolve_tile_root_rejects_symlink_escape(tmp_path: Path) -> None:
    """A ``<sid>`` symlink pointing outside the tiles dir is refused."""
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "image.dzi").write_text("<Image/>")
    tiles = tmp_path / "tiles"
    tiles.mkdir()
    os.symlink(outside, tiles / "9")
    with pytest.raises(MissingTiles):
        resolve_tile_root(str(tiles), 9)


# ── plan_region ───────────────────────────────────────────


def _dzi(width: int, height: int) -> DziInfo:
    return DziInfo(
        width=width,
        height=height,
        tile_size=TILE_SIZE,
        overlap=OVERLAP,
        format="png",
        max_level=math.ceil(math.log2(max(width, height))),
    )


def test_plan_region_invalid_zero_area() -> None:
    with pytest.raises(InvalidSelection):
        plan_region(
            _dzi(1000, 800), Rect(10, 10, 0, 50),
            margin_px=0, max_pixels=1_000_000, max_downsample=4,
        )
    with pytest.raises(InvalidSelection):
        plan_region(
            _dzi(1000, 800), Rect(10, 10, 50, -3),
            margin_px=0, max_pixels=1_000_000, max_downsample=4,
        )


def test_plan_region_invalid_outside_image() -> None:
    with pytest.raises(InvalidSelection):
        plan_region(
            _dzi(1000, 800), Rect(2000, 0, 50, 50),
            margin_px=0, max_pixels=1_000_000, max_downsample=4,
        )
    with pytest.raises(InvalidSelection):
        plan_region(
            _dzi(1000, 800), Rect(-500, -500, 100, 100),
            margin_px=0, max_pixels=1_000_000, max_downsample=4,
        )


def test_plan_region_clamps_selection_to_image() -> None:
    plan = plan_region(
        _dzi(1000, 800), Rect(900, 700, 500, 500),
        margin_px=0, max_pixels=1_000_000, max_downsample=4,
    )
    assert plan.selection == Rect(900, 700, 100, 100)
    assert plan.downsample == 1
    assert plan.level == _dzi(1000, 800).max_level


def test_plan_region_picks_finest_level_within_budget() -> None:
    plan = plan_region(
        _dzi(1000, 800), Rect(100, 100, 200, 150),
        margin_px=0, max_pixels=100_000, max_downsample=4,
    )
    assert plan.downsample == 1
    assert plan.out_width == 200
    assert plan.out_height == 150


def test_plan_region_downsamples_to_fit_budget() -> None:
    # 400x300 selection: 120k px at d=1 > 40k cap; d=2 gives 200x150 = 30k.
    plan = plan_region(
        _dzi(1000, 800), Rect(0, 0, 400, 300),
        margin_px=0, max_pixels=40_000, max_downsample=4,
    )
    assert plan.downsample == 2
    assert plan.level == _dzi(1000, 800).max_level - 1
    assert plan.out_width * plan.out_height <= 40_000


def test_plan_region_margin_is_in_level_pixels() -> None:
    # margin_px counts level pixels: at d=2 it costs margin_px*2 level-0 px.
    plan = plan_region(
        _dzi(1000, 800), Rect(200, 200, 200, 200),
        margin_px=10, max_pixels=40_000, max_downsample=4,
    )
    assert plan.downsample == 2
    assert plan.region == Rect(180, 180, 240, 240)
    assert plan.out_width * plan.out_height <= 40_000


def test_plan_region_margin_clamped_at_image_bounds() -> None:
    plan = plan_region(
        _dzi(1000, 800), Rect(0, 0, 100, 100),
        margin_px=50, max_pixels=1_000_000, max_downsample=1,
    )
    assert plan.region == Rect(0, 0, 150, 150)


def test_plan_region_too_large_past_max_downsample() -> None:
    with pytest.raises(RegionTooLarge):
        plan_region(
            _dzi(8000, 6000), Rect(0, 0, 8000, 6000),
            margin_px=0, max_pixels=1_000_000, max_downsample=4,
        )


def test_plan_region_hard_memory_cap_beats_settings() -> None:
    """Even an absurd ``max_pixels`` cannot exceed MAX_DECODED_PIXELS."""
    # 8000x6000 at d=1 is 48M px > 25M hard cap; d=2 is 12M px and fits.
    plan = plan_region(
        _dzi(8000, 6000), Rect(0, 0, 8000, 6000),
        margin_px=0, max_pixels=10**9, max_downsample=4,
    )
    assert plan.downsample == 2
    assert plan.out_width * plan.out_height <= MAX_DECODED_PIXELS
    # And if nothing fits inside the hard cap it still raises.
    with pytest.raises(RegionTooLarge):
        plan_region(
            _dzi(8000, 6000), Rect(0, 0, 8000, 6000),
            margin_px=0, max_pixels=10**9, max_downsample=1,
        )


def test_plan_region_level_dims_match_dzsave(odd_pyramid) -> None:
    """Level dims are ceil-per-halving: 1001x777 -> 501x389 -> 251x195."""
    _, _, root = odd_pyramid
    dzi = read_dzi(root)
    plan = plan_region(
        dzi, Rect(0, 0, 1001, 777),
        margin_px=0, max_pixels=252 * 195, max_downsample=8,
    )
    assert (plan.out_width, plan.out_height) == (251, 195)
    assert plan.level == 8


# ── stitch_region ─────────────────────────────────────────


def _assert_rgb(stitched: object, plan) -> None:
    assert stitched.width == plan.out_width
    assert stitched.height == plan.out_height
    assert stitched.bands == 3
    assert stitched.format == "uchar"


def test_stitch_whole_image_top_level(odd_pyramid) -> None:
    src, base, _ = odd_pyramid
    root = resolve_tile_root(str(base), 42)
    dzi = read_dzi(root)
    plan = plan_region(
        dzi, Rect(0, 0, 1001, 777),
        margin_px=0, max_pixels=10**9, max_downsample=1,
    )
    stitched = stitch_region(root, dzi, plan)
    _assert_rgb(stitched, plan)
    assert (stitched - src).abs().max() == 0.0


def test_stitch_subregion_crossing_tile_boundaries(odd_pyramid) -> None:
    """A region straddling several tile seams composites exactly."""
    src, base, _ = odd_pyramid
    root = resolve_tile_root(str(base), 42)
    dzi = read_dzi(root)
    sel = Rect(200, 180, 400, 300)
    plan = plan_region(
        dzi, sel, margin_px=20, max_pixels=10**9, max_downsample=1,
    )
    stitched = stitch_region(root, dzi, plan)
    _assert_rgb(stitched, plan)
    region = plan.region
    expected = src.crop(region.x, region.y, region.width, region.height)
    assert (stitched - expected).abs().max() == 0.0


def test_stitch_region_touching_image_edges(odd_pyramid) -> None:
    src, base, _ = odd_pyramid
    root = resolve_tile_root(str(base), 42)
    dzi = read_dzi(root)
    # Covers the top-left and bottom-right edges (clipped margin).
    sel = Rect(0, 0, 300, 250)
    plan = plan_region(
        dzi, sel, margin_px=10, max_pixels=10**9, max_downsample=1,
    )
    stitched = stitch_region(root, dzi, plan)
    expected = src.crop(0, 0, plan.region.width, plan.region.height)
    assert (stitched - expected).abs().max() == 0.0

    sel = Rect(950, 720, 51, 57)
    plan = plan_region(
        dzi, sel, margin_px=10, max_pixels=10**9, max_downsample=1,
    )
    stitched = stitch_region(root, dzi, plan)
    expected = src.crop(
        plan.region.x, plan.region.y, plan.region.width, plan.region.height
    )
    assert (stitched - expected).abs().max() == 0.0


def test_stitch_lower_level_matches_shrunk_source(odd_pyramid) -> None:
    """Level-L pixels equal the doubly-halved source (dzsave's shrink)."""
    src, base, _ = odd_pyramid
    root = resolve_tile_root(str(base), 42)
    dzi = read_dzi(root)
    sel = Rect(300, 250, 300, 200)
    # d=1 needs 320x220=70.4k px; d=2 (margin 20 level-0 px) needs
    # 170x120=20.4k — a 21k budget lands on level 9.
    plan = plan_region(
        dzi, sel, margin_px=10, max_pixels=21_000, max_downsample=8,
    )
    assert plan.downsample == 2
    stitched = stitch_region(root, dzi, plan)
    level_img = _shrink_to_level(src, plan.downsample)
    expected = level_img.crop(
        plan.level_rect.x, plan.level_rect.y,
        plan.out_width, plan.out_height,
    )
    assert (stitched - expected).abs().max() == 0.0


def test_stitch_deepest_permitted_level(odd_pyramid) -> None:
    src, base, _ = odd_pyramid
    root = resolve_tile_root(str(base), 42)
    dzi = read_dzi(root)
    plan = plan_region(
        dzi, Rect(0, 0, 1001, 777),
        margin_px=0, max_pixels=252 * 195, max_downsample=8,
    )
    stitched = stitch_region(root, dzi, plan)
    expected = _shrink_to_level(src, plan.downsample)
    assert (stitched - expected).abs().max() == 0.0


def test_stitch_missing_tile_raises(odd_pyramid, tmp_path: Path) -> None:
    """A tile that should exist but doesn't raises MissingTiles."""
    src, base, _ = odd_pyramid
    broken = _build_pyramid(tmp_path, 5, src)
    victim = broken / "image_files" / "10" / "1_1.png"
    victim.unlink()
    root = resolve_tile_root(str(tmp_path), 5)
    dzi = read_dzi(root)
    plan = plan_region(
        dzi, Rect(300, 300, 200, 200),
        margin_px=0, max_pixels=10**9, max_downsample=1,
    )
    with pytest.raises(MissingTiles):
        stitch_region(root, dzi, plan)


def test_stitch_jpeg_tiles_within_tolerance(odd_pyramid_jpeg) -> None:
    """JPEG tiles are lossy: compare within codec tolerance, not exactly."""
    src, base, _ = odd_pyramid_jpeg
    root = resolve_tile_root(str(base), 7)
    dzi = read_dzi(root)
    assert dzi.format == "jpeg"
    plan = plan_region(
        dzi, Rect(100, 100, 400, 300),
        margin_px=0, max_pixels=10**9, max_downsample=1,
    )
    stitched = stitch_region(root, dzi, plan)
    expected = src.crop(100, 100, 400, 300)
    assert (stitched - expected).abs().avg() < 3.0
