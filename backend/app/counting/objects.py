"""Label image -> level-0 object conversion (epic #1661, #1665).

Shared by every outliner: labels at the processing level become objects
with level-0 centroids, areas and ≤32-vertex polygons plus mean CIELAB
a*/b* chroma for appearance grouping.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from .stitch import RegionPlan

MAX_POLYGON_VERTICES = 32


def _approx_polygon(contour: np.ndarray, tolerance: float) -> np.ndarray:
    from skimage.measure import approximate_polygon

    pts = approximate_polygon(contour, tolerance=tolerance)
    tol = tolerance
    while len(pts) > MAX_POLYGON_VERTICES and tol < 8:
        tol *= 2
        pts = approximate_polygon(contour, tolerance=tol)
    if len(pts) > MAX_POLYGON_VERTICES:
        # Evenly subsample around the contour — never truncate the outline.
        idx = np.linspace(0, len(pts) - 1, MAX_POLYGON_VERTICES)
        pts = pts[np.unique(np.round(idx).astype(int))]
    return pts


def objects_from_labels(
    labels: np.ndarray, rgb: np.ndarray, *, plan: RegionPlan
) -> list[dict[str, Any]]:
    """Convert an int32 label image to level-0 object records.

    ``labels`` and ``rgb`` cover ``plan.level_rect`` at ``plan.level``;
    level coordinates map to level-0 via ``plan.downsample`` and the level
    rect origin. One ``regionprops`` pass over the whole label image —
    per-label full-frame masks would make dense fields quadratic.
    """
    from skimage import color, measure

    d = plan.downsample
    rect = plan.level_rect
    lab_img = color.rgb2lab(rgb)
    objects: list[dict[str, Any]] = []
    for prop in measure.regionprops(labels, intensity_image=lab_img):
        row_c, col_c = prop.centroid
        area_level = float(prop.area)
        _L, a, b = (float(v) for v in prop.intensity_mean[:3])
        # Contour on the region's own bbox image (+1 pad so boundary pixels
        # close the loop), then offset back to frame coordinates.
        padded = np.pad(prop.image, 1)
        contours = measure.find_contours(padded.astype(float), 0.5)
        if not contours:
            continue
        contour = max(contours, key=len)
        pts = _approx_polygon(contour, tolerance=1.0)
        r0, c0 = prop.bbox[0] - 1, prop.bbox[1] - 1
        polygon = [
            ((rect.x + c0 + float(c)) * d, (rect.y + r0 + float(r)) * d)
            for r, c in pts
        ]
        objects.append(
            {
                "centroid": ((rect.x + col_c) * d, (rect.y + row_c) * d),
                "area": area_level * d * d,
                "polygon": polygon,
                "a": a,
                "b": b,
                "group": 0,
            }
        )
    return objects
