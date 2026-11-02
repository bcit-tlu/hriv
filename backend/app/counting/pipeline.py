"""Count pipeline: stitch -> outline -> edge rule -> group -> result.

Runs synchronously inside a worker thread (the arq task calls it via
``asyncio.to_thread``). Job state stays in Redis; this module is pure
computation plus the result payload. Error mapping to the public ``error``
codes (``timeout``, ``too_large``, ``too_many_objects``, ``no_tiles``,
``internal``) happens in ``worker.py`` — stack traces never reach clients.
"""

from __future__ import annotations

import base64
from collections import defaultdict
from typing import Any, Callable

import numpy as np
import pyvips

from .grouping import assign_groups
from .objects import objects_from_labels
from .outliners import NATIVE_DIAMETER, Outliner, estimate_object_diameter
from .stitch import (
    CountingRegionError,
    Rect,
    RegionTooLarge,
    plan_region,
    read_dzi,
    resolve_tile_root,
    stitch_region,
)

# Longest-side bound for the JPEG preview embedded in the result; the
# preview is only ever downscaled, never upscaled.
PREVIEW_MAX_SIDE = 960
PREVIEW_JPEG_QUALITY = 80


class JobCancelled(Exception):
    """Internal sentinel: the job record vanished mid-run."""


class TooManyObjects(CountingRegionError):
    code = "too_many_objects"


def _check_cancelled(is_cancelled: Callable[[], bool]) -> None:
    try:
        cancelled = is_cancelled()
    except Exception:
        # A failing cancellation probe (e.g. transient Redis error) must not
        # kill a healthy job — treat it as still active.
        cancelled = False
    if cancelled:
        raise JobCancelled


def _centroid_in_selection(obj: dict[str, Any], selection: Rect) -> bool:
    """Edge rule: keep objects whose centroid lies inside the selection."""
    cx, cy = obj["centroid"]
    return (
        selection.x <= cx < selection.x + selection.width
        and selection.y <= cy < selection.y + selection.height
    )


def _reindex_groups(
    objects: list[dict[str, Any]],
) -> tuple[list[dict[str, int]], list[dict[str, Any]]]:
    """Re-map group ids to contiguous 0..n-1 ordered by mean object area."""
    members: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for obj in objects:
        members[obj["group"]].append(obj)
    mean_area = {
        group: sum(o["area"] for o in objs) / len(objs)
        for group, objs in members.items()
    }
    order = sorted(members, key=lambda g: (mean_area[g], g))
    remap = {old: new for new, old in enumerate(order)}
    groups = [
        {"group": new, "count": len(members[old])}
        for old, new in sorted(remap.items(), key=lambda kv: kv[1])
    ]
    for obj in objects:
        obj["group"] = remap[obj["group"]]
    return groups, objects


# Coarse-stage pixel budget for the diameter-estimation stitch (~0.25 MP).
_DIAMETER_PROBE_PIXELS = 250_000
# Nuclei-only stain post-filter: drop objects whose mean CIELAB b* is not
# sufficiently blue (tissue/debris, not hematoxylin-stained nuclei).
_NUCLEI_B_STAR_MAX = -5.0


def _choose_downsample(
    tile_root,
    dzi,
    selection: Rect,
    *,
    mode: str,
    mpp: float | None,
    margin_px: int,
    max_pixels: int,
    max_downsample: int,
) -> int:
    """Size-driven level rule (#1662): pick the largest d such that the
    estimated median object is at least ``NATIVE_DIAMETER`` px at that
    level — or, for nuclei with a known mpp, ``mpp * d <= 0.5``. Never
    upscale (d >= 1), never above ``max_downsample``.
    """
    if mode == "nuclei" and mpp and mpp > 0:
        d = max_downsample
        while d > 1 and mpp * d > 0.5:
            d //= 2
        return d

    native = NATIVE_DIAMETER[mode]
    # Probe at a coarse level bounded by ~0.25 MP; a probe that still can't
    # fit falls back to the finest level (d=1 keeps the real plan's own
    # budget decision).
    # Probe at ≤ ~0.25 MP; if that still can't fit at max_downsample, retry
    # with the real budget — only then is the selection genuinely too big.
    probe_plan = None
    for budget in (min(_DIAMETER_PROBE_PIXELS, max_pixels), max_pixels):
        try:
            probe_plan = plan_region(
                dzi,
                selection,
                margin_px=margin_px,
                max_pixels=budget,
                max_downsample=max_downsample,
            )
            break
        except RegionTooLarge:
            continue
    if probe_plan is None:
        raise RegionTooLarge(
            "selection cannot fit the processing budget at any permitted level"
        )
    probe_rgb = stitch_region(tile_root, dzi, probe_plan).numpy()
    diameter = estimate_object_diameter(probe_rgb, mode)
    if diameter is None or diameter <= 0:
        return 1
    # The estimate is in probe-level px — convert to level-0 before
    # comparing against the native target.
    diameter_level0 = diameter * probe_plan.downsample
    d = 1
    while d < max_downsample and diameter_level0 / (d * 2) >= native:
        d *= 2
    return d


def _selection_preview(stitched: pyvips.Image, plan) -> str:
    """JPEG data-URI of the selection pixels (margin excluded)."""
    rect = plan.level_rect
    d = plan.downsample
    sel = plan.selection
    x0 = max(0, sel.x // d - rect.x)
    y0 = max(0, sel.y // d - rect.y)
    x1 = min(rect.width, -(-(sel.x + sel.width) // d) - rect.x)
    y1 = min(rect.height, -(-(sel.y + sel.height) // d) - rect.y)
    preview = stitched.crop(x0, y0, max(1, x1 - x0), max(1, y1 - y0))
    longest = max(preview.width, preview.height)
    if longest > PREVIEW_MAX_SIDE:
        preview = preview.resize(PREVIEW_MAX_SIDE / longest)
    buf = preview.jpegsave_buffer(Q=PREVIEW_JPEG_QUALITY)
    return "data:image/jpeg;base64," + base64.b64encode(buf).decode("ascii")


def run_count(
    record: dict[str, Any],
    *,
    tiles_dir: str,
    outliner: Outliner,
    margin_px: int,
    max_pixels: int,
    max_downsample: int,
    max_objects: int,
    is_cancelled: Callable[[], bool],
) -> dict[str, Any]:
    """Execute one count job; returns the result-contract payload.

    Raises :class:`JobCancelled` when ``is_cancelled`` reports the record
    gone between stages, :class:`TooManyObjects` past the object cap, and
    :class:`CountingRegionError` subclasses for planning/tile failures.
    """
    sel = record["selection"]
    tile_root = resolve_tile_root(tiles_dir, int(record["source_image_id"]))
    dzi = read_dzi(tile_root)
    mode = record.get("mode", "cells")
    mpp = record.get("mpp")
    sel_rect = Rect(
        x=int(sel["x"]),
        y=int(sel["y"]),
        width=int(sel["width"]),
        height=int(sel["height"]),
    )
    # Size-driven level rule: probe the object scale on a coarse stitch,
    # then plan at the fixed downsample it dictates.
    downsample = _choose_downsample(
        tile_root,
        dzi,
        sel_rect,
        mode=mode,
        mpp=float(mpp) if mpp else None,
        margin_px=margin_px,
        max_pixels=max_pixels,
        max_downsample=max_downsample,
    )
    plan = plan_region(
        dzi,
        sel_rect,
        margin_px=margin_px,
        max_pixels=max_pixels,
        max_downsample=max_downsample,
        downsample=downsample,
    )
    _check_cancelled(is_cancelled)
    stitched = stitch_region(tile_root, dzi, plan)
    _check_cancelled(is_cancelled)
    rgb = stitched.numpy()
    labels = outliner.segment(rgb, plan=plan, mpp=float(mpp) if mpp else None)
    _check_cancelled(is_cancelled)
    objects = [
        obj
        for obj in objects_from_labels(labels, rgb, plan=plan)
        if _centroid_in_selection(obj, plan.selection)
    ]
    if mode == "nuclei":
        # Stain post-filter: keep only hematoxylin-blue objects.
        objects = [o for o in objects if o["b"] <= _NUCLEI_B_STAR_MAX]
    if len(objects) > max_objects:
        raise TooManyObjects(
            f"{len(objects)} objects exceeds the {max_objects} cap"
        )
    _check_cancelled(is_cancelled)

    for obj, group in zip(objects, assign_groups(objects)):
        obj["group"] = group
    groups, reindexed = _reindex_groups(objects)
    return {
        "total": len(reindexed),
        "groups": groups,
        "objects": [
            {
                "group": obj["group"],
                "centroid": [
                    round(obj["centroid"][0], 1),
                    round(obj["centroid"][1], 1),
                ],
                "polygon": [
                    [round(px, 1), round(py, 1)] for px, py in obj["polygon"]
                ],
            }
            for obj in reindexed
        ],
        "preview": _selection_preview(stitched, plan),
        # Planning context for the worker's completion log; popped before
        # the result is persisted so it never reaches the client.
        "_meta": {
            "level": plan.level,
            "downsample": downsample,
            "pixels": plan.out_width * plan.out_height,
            "outliner": outliner.name,
        },
    }
