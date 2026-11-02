"""Per-outliner stitched-pixel budgets (epic #1661, #1719).

The classical scikit-image watershed and stub outliners are ~20x faster
per megapixel than ML outliners, so they get a larger pixel budget before
a selection is rejected as ``too_large``.

This module is deliberately dependency-free (no numpy): the API image
has no ``counting`` extras installed, and ``routers/counts.py`` imports
it for the pre-flight budget check.
"""

from __future__ import annotations

CHEAP_OUTLINERS = frozenset({"classical", "stub"})


def pixel_budget(
    outliner_name: str, *, max_pixels: int, classical_max_pixels: int
) -> int:
    """Stitched-pixel budget for *outliner_name* (an outliner ``name``)."""
    if outliner_name in CHEAP_OUTLINERS:
        return classical_max_pixels
    return max_pixels
