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

import pyvips

from .outliners import OutlinedObject, Outliner
from .stitch import (
    CountingRegionError,
    Rect,
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


def _centroid_in_selection(obj: OutlinedObject, selection: Rect) -> bool:
    """Edge rule: keep objects whose centroid lies inside the selection."""
    cx, cy = obj.centroid
    return (
        selection.x <= cx < selection.x + selection.width
        and selection.y <= cy < selection.y + selection.height
    )


def _reindex_groups(
    objects: list[OutlinedObject],
) -> tuple[list[dict[str, int]], list[OutlinedObject]]:
    """Re-map group ids to contiguous 0..n-1 ordered by mean object area.

    Deterministic ordering (mean area ascending, then original id as a
    stable tiebreak) keeps group -> colour assignments roughly consistent
    across selections.
    """
    members: dict[int, list[OutlinedObject]] = defaultdict(list)
    for obj in objects:
        members[obj.group].append(obj)
    mean_area = {
        group: sum(o.area for o in objs) / len(objs)
        for group, objs in members.items()
    }
    order = sorted(members, key=lambda g: (mean_area[g], g))
    remap = {old: new for new, old in enumerate(order)}
    groups = [
        {"group": new, "count": len(members[old])}
        for old, new in sorted(remap.items(), key=lambda kv: kv[1])
    ]
    reindexed = [
        OutlinedObject(
            polygon=obj.polygon,
            centroid=obj.centroid,
            area=obj.area,
            group=remap[obj.group],
        )
        for obj in objects
    ]
    return groups, reindexed


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
    plan = plan_region(
        dzi,
        Rect(
            x=int(sel["x"]),
            y=int(sel["y"]),
            width=int(sel["width"]),
            height=int(sel["height"]),
        ),
        margin_px=margin_px,
        max_pixels=max_pixels,
        max_downsample=max_downsample,
    )
    _check_cancelled(is_cancelled)
    stitched = stitch_region(tile_root, dzi, plan)
    _check_cancelled(is_cancelled)
    objects = [
        obj
        for obj in outliner.outline(stitched, plan)
        if _centroid_in_selection(obj, plan.selection)
    ]
    if len(objects) > max_objects:
        raise TooManyObjects(
            f"{len(objects)} objects exceeds the {max_objects} cap"
        )
    _check_cancelled(is_cancelled)

    groups, reindexed = _reindex_groups(objects)
    return {
        "total": len(reindexed),
        "groups": groups,
        "objects": [
            {
                "group": obj.group,
                "centroid": [
                    round(obj.centroid[0], 1),
                    round(obj.centroid[1], 1),
                ],
                "polygon": [
                    [round(px, 1), round(py, 1)] for px, py in obj.polygon
                ],
            }
            for obj in reindexed
        ],
        "preview": _selection_preview(stitched, plan),
        # Planning context for the worker's completion log; popped before
        # the result is persisted so it never reaches the client.
        "_meta": {
            "level": plan.level,
            "pixels": plan.out_width * plan.out_height,
        },
    }
