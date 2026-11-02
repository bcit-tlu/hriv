"""Pluggable object outliners for the counting pipeline (epic #1661).

The real outliners land with the ML pipeline issue (#1665) after the
spike (#1662) picks models — the design locks Cells -> Cellpose ``cyto3``
and Nuclei -> InstanSeg brightfield nuclei, both behind the
:class:`Outliner` protocol so models are swappable per mode.

Until then :class:`StubOutliner` synthesises deterministic round objects
so the API contract, job lifecycle, centroid edge rule, grouping and the
frontend integration can be exercised end-to-end. It is a stand-in: it
ignores pixel content entirely.
"""

from __future__ import annotations

import hashlib
import math
import random
from dataclasses import dataclass
from typing import Protocol

import pyvips

from .stitch import RegionPlan


@dataclass(frozen=True)
class OutlinedObject:
    """One detected object, all coordinates in level-0 image pixels."""

    polygon: list[tuple[float, float]]
    centroid: tuple[float, float]
    area: float
    group: int


class Outliner(Protocol):
    """Detect objects in a stitched RGB region and return their outlines."""

    name: str

    def outline(self, rgb: pyvips.Image, plan: RegionPlan) -> list[OutlinedObject]:
        """Outline every object visible in *rgb* (covers ``plan.region``).

        Implementations return objects for the whole stitched region —
        including the margin — in level-0 coordinates; the pipeline applies
        the centroid-in-selection edge rule afterwards.
        """


def _polygon_area(points: list[tuple[float, float]]) -> float:
    """Shoelace area of a closed polygon (first point need not repeat)."""
    area = 0.0
    for i, (x0, y0) in enumerate(points):
        x1, y1 = points[(i + 1) % len(points)]
        area += x0 * y1 - x1 * y0
    return abs(area) / 2.0


# Size tiers -> stub group ids. The pipeline re-indexes groups by mean
# object area ascending, so these map to small=0, medium=1, large=2 after
# re-indexing regardless of the raw ids used here.
_TIER_SMALL, _TIER_MEDIUM, _TIER_LARGE = 0, 1, 2
_TIER_RADIUS_SCALE = {_TIER_SMALL: 0.45, _TIER_MEDIUM: 1.0, _TIER_LARGE: 1.9}


class StubOutliner:
    """Deterministic synthetic outliner (stand-in until #1662/#1665).

    Places jittered ~16-vertex round objects on a grid covering the whole
    stitched *region* (selection + margin) so objects in the margin exist
    and the centroid-in-selection rule is exercised. Object radius scales
    with the selection size within sane pixel bounds; roughly every 15th
    object is a small outlier and every 40th a large one so the grouping
    stage sees heterogeneous populations.

    The seed derives from the plan geometry only — two identical requests
    produce identical output, and the global ``random`` state is never
    touched.
    """

    name = "stub"

    _GRID_JITTER = 0.22  # fraction of spacing applied as positional jitter
    _VERTEX_JITTER = 0.08  # fraction of radius applied per vertex
    _VERTICES = 16

    def _seed(self, plan: RegionPlan) -> int:
        material = (
            plan.level,
            plan.downsample,
            plan.selection.x,
            plan.selection.y,
            plan.selection.width,
            plan.selection.height,
            plan.region.x,
            plan.region.y,
            plan.region.width,
            plan.region.height,
        )
        digest = hashlib.sha256(repr(material).encode()).digest()
        return int.from_bytes(digest[:8], "big")

    def outline(self, rgb: pyvips.Image, plan: RegionPlan) -> list[OutlinedObject]:
        rng = random.Random(self._seed(plan))
        sel = plan.selection
        region = plan.region

        # Radius scales with the selection: ~one object per 1/12 of the
        # smaller selection side, clamped to sane level-0 pixel bounds.
        base_r = max(6.0, min(160.0, min(sel.width, sel.height) / 12.0))
        spacing = base_r * 2.8

        objects: list[OutlinedObject] = []
        index = 0
        y = float(region.y)
        while y <= region.y + region.height:
            x = float(region.x)
            while x <= region.x + region.width:
                index += 1
                if index % 40 == 0:
                    tier = _TIER_LARGE
                elif index % 15 == 0:
                    tier = _TIER_SMALL
                else:
                    tier = _TIER_MEDIUM

                cx = x + rng.uniform(-1, 1) * spacing * self._GRID_JITTER
                cy = y + rng.uniform(-1, 1) * spacing * self._GRID_JITTER
                radius = (
                    base_r
                    * _TIER_RADIUS_SCALE[tier]
                    * rng.uniform(0.85, 1.15)
                )
                polygon = [
                    (
                        cx
                        + math.cos(2 * math.pi * k / self._VERTICES)
                        * radius
                        * rng.uniform(1 - self._VERTEX_JITTER, 1 + self._VERTEX_JITTER),
                        cy
                        + math.sin(2 * math.pi * k / self._VERTICES)
                        * radius
                        * rng.uniform(1 - self._VERTEX_JITTER, 1 + self._VERTEX_JITTER),
                    )
                    for k in range(self._VERTICES)
                ]
                objects.append(
                    OutlinedObject(
                        polygon=polygon,
                        centroid=(cx, cy),
                        area=_polygon_area(polygon),
                        group=tier,
                    )
                )
                x += spacing
            y += spacing
        return objects
