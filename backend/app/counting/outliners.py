"""Object outliners for the counting pipeline (epic #1661, #1665).

An outliner turns a stitched RGB region (level ``plan.level``, downsample
``plan.downsample``) into an int32 **label image** — one integer id per
object, 0 for background — at the processing resolution. The pipeline
converts labels to level-0 outlines via ``objects.objects_from_labels``,
so outliners never deal with coordinate mapping.

Implementations:

- ``ClassicalCellsOutliner`` — scikit-image channel-extrema + darkness
  signal, Otsu, distance-transform watershed (#1662 spike port).
- ``ClassicalNucleiOutliner`` — same flow on the hematoxylin channel.
- ``InstanSegNucleiOutliner`` — InstanSeg ``brightfield_nuclei`` v0.1.1
  (Apache-2.0 code and weights); torch is an optional ``counting-ml``
  dependency, loaded lazily and warmed at worker startup.
- ``StubOutliner`` — deterministic synthetic discs; ignores pixels.

Cellpose ``cyto3`` is deliberately absent: cellpose 3.1 pins numpy<2.1,
has no Python 3.14 wheels, and its weights are trained partly on
CC-BY-NC data (owner decision pending). The ``Outliner`` seam stays the
plugin point if it ever returns.
"""

from __future__ import annotations

import hashlib
import math
import random
from typing import Protocol

import numpy as np

from .budgets import pixel_budget
from .stitch import RegionPlan

# Native object diameter (processing px) each mode targets when the level
# rule picks the downsample.
NATIVE_DIAMETER = {"cells": 30.0, "nuclei": 12.0}
# InstanSeg brightfield_nuclei's native resolution (µm/px).
INSTANSEG_PIXEL_SIZE = 0.5


class Outliner(Protocol):
    """Detect objects in a stitched RGB region; return an int32 label image.

    ``max_pixels`` is the stitched-pixel budget this outliner may process
    per job (classical outliners are ~20x faster per MP than ML ones and
    get a larger budget). ``build_outliners`` assigns it from settings.
    """

    name: str
    max_pixels: int

    def segment(
        self,
        rgb: np.ndarray,  # (H, W, 3) uint8 at processing resolution
        *,
        plan: RegionPlan,
        mpp: float | None,
        params: dict | None = None,
        preprocess: bool = True,
    ) -> np.ndarray:  # (H, W) int32 labels, 0 = background
        """Label every object in *rgb* — including the stitched margin."""


def _tuned_number(params: dict, key: str) -> float | None:
    """One numeric tuning field, or None when absent/malformed (#1870)."""
    value = params.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _mask_and_signal(
    rgb: np.ndarray,
    mode: str,
    *,
    params: dict | None = None,
    preprocess: bool = True,
):
    """Classical foreground mask + labelled components (before watershed).

    ``preprocess`` (the ``counting_preprocess`` kill-switch) applies a
    subtractive flat-field: ``signal − gaussian(signal, σ=25)`` removes
    low-frequency staining/illumination drift that can bury faint cells
    under Otsu's threshold — the generalization of detector.py's
    background-relative threshold (#1870). It is a subtraction, not a
    division: dividing by the background normalizes *and amplifies*
    background noise into foreground speckle. A percentile stretch was
    evaluated and deliberately omitted — Otsu's selection is invariant
    under monotone rescaling, so it changed nothing measurable.
    ``params`` is a persisted ``DetectionTuning`` dict; malformed fields
    are ignored individually.
    """
    from scipy import ndimage as ndi
    from skimage import color, filters, morphology

    if mode == "nuclei":
        signal = color.rgb2hed(rgb)[..., 0]  # hematoxylin channel
    else:
        rgbf = rgb.astype(np.float32)
        signal = rgbf.max(axis=2) - rgbf.min(axis=2) + (255.0 - rgbf.mean(axis=2)) * 0.5
    if preprocess:
        signal = signal - filters.gaussian(signal, sigma=25.0)
    signal = filters.gaussian(signal, sigma=1.5)
    threshold = filters.threshold_otsu(signal)
    min_size = 30
    if params is not None:
        # sensitivity: 0 → stricter, 0.6 (default) → ±0, 1 → permissive.
        # Additive, tied to the signal's own spread — a multiplicative
        # offset reverses ordering whenever the Otsu threshold goes
        # negative, which the flat-field makes common on dense fields
        # (#1870 review).
        if (s := _tuned_number(params, "sensitivity")) is not None:
            spread = float(np.percentile(signal, 99.0) - np.median(signal))
            threshold = threshold + (0.6 - min(1.0, max(0.0, s))) * 0.4 * spread
        # min_cell_size is a px radius; the shipped 30-px floor is the
        # area of a radius-3 disc, so radii scale quadratically (area ∝ r²).
        if (mcs := _tuned_number(params, "min_cell_size")) is not None and mcs > 0:
            min_size = max(1, round(30 * (mcs / 3.0) ** 2))
    mask = signal > threshold
    mask = ndi.binary_fill_holes(morphology.remove_small_objects(mask, min_size))
    lab, n = ndi.label(mask)
    return mask, lab, n


def classical_labels(
    rgb: np.ndarray,
    mode: str,
    *,
    params: dict | None = None,
    preprocess: bool = True,
) -> np.ndarray:
    """Shared watershed used by the classical outliners (#1662 bench port)."""
    from scipy import ndimage as ndi
    from skimage import feature, segmentation

    mask, lab0, n0 = _mask_and_signal(
        rgb, mode, params=params, preprocess=preprocess
    )
    dist = ndi.distance_transform_edt(mask)
    r = 6.0
    if n0:
        areas = np.bincount(lab0.ravel())[1:]
        r = max(4.0, float(np.sqrt(np.median(areas) / np.pi)))
    peaks = feature.peak_local_max(
        dist,
        min_distance=max(3, int(r * 0.7)),
        labels=lab0,
        exclude_border=False,
    )
    markers = np.zeros_like(lab0)
    markers[tuple(peaks.T)] = np.arange(1, len(peaks) + 1)
    return segmentation.watershed(-dist, markers, mask=mask).astype(np.int32)


def probe_object_stats(
    rgb: np.ndarray,
    mode: str,
    *,
    params: dict | None = None,
    preprocess: bool = True,
) -> tuple[float | None, int]:
    """Median component diameter (processing px) and component count.

    When a probe field merges into a few blobs, the count collapses and the
    diameter measures the blobs, not objects — the level rule should not
    trust it (#1670: a smear-photo crop had n=2 at d=4 and was coarsened
    until its cells vanished).
    """
    mask, lab, n = _mask_and_signal(
        rgb, mode, params=params, preprocess=preprocess
    )
    if not n:
        return None, 0
    areas = np.bincount(lab.ravel())[1:]
    return float(2.0 * np.sqrt(np.median(areas) / np.pi)), n


def estimate_object_diameter(
    rgb: np.ndarray,
    mode: str,
    *,
    params: dict | None = None,
    preprocess: bool = True,
) -> float | None:
    """Median component diameter (processing px) from the classical mask."""
    _mask, lab, n = _mask_and_signal(
        rgb, mode, params=params, preprocess=preprocess
    )
    if not n:
        return None
    areas = np.bincount(lab.ravel())[1:]
    return float(2.0 * np.sqrt(np.median(areas) / np.pi))


class ClassicalCellsOutliner:
    name = "classical"
    max_pixels = 0  # assigned by build_outliners

    def segment(
        self,
        rgb: np.ndarray,
        *,
        plan: RegionPlan,
        mpp: float | None,
        params: dict | None = None,
        preprocess: bool = True,
    ) -> np.ndarray:
        return classical_labels(
            rgb, "cells", params=params, preprocess=preprocess
        )


class ClassicalNucleiOutliner:
    name = "classical"
    max_pixels = 0  # assigned by build_outliners

    def segment(
        self,
        rgb: np.ndarray,
        *,
        plan: RegionPlan,
        mpp: float | None,
        params: dict | None = None,
        preprocess: bool = True,
    ) -> np.ndarray:
        return classical_labels(
            rgb, "nuclei", params=params, preprocess=preprocess
        )


class InstanSegNucleiOutliner:
    """InstanSeg ``brightfield_nuclei`` on CPU (torch, counting-ml group)."""

    name = "instanseg"
    max_pixels = 0  # assigned by build_outliners

    def __init__(self, torch_threads: int = 2) -> None:
        import os

        import torch
        from instanseg import InstanSeg

        from ..database import settings

        # Point InstanSeg's model store at the baked dir before it loads —
        # without this it would fall back to a site-packages path or try to
        # download the model at runtime.
        os.environ["INSTANSEG_BIOIMAGEIO_PATH"] = settings.counting_models_dir
        torch.set_num_threads(max(1, torch_threads))
        torch.set_num_interop_threads(1)
        self._model = InstanSeg("brightfield_nuclei", verbosity=0, device="cpu")

    def segment(
        self,
        rgb: np.ndarray,
        *,
        plan: RegionPlan,
        mpp: float | None,
        params: dict | None = None,
        preprocess: bool = True,
    ) -> np.ndarray:
        px = mpp if mpp else INSTANSEG_PIXEL_SIZE
        labels = self._model.eval_small_image(rgb, pixel_size=px, return_image_tensor=False)
        lab = labels.squeeze().cpu().numpy().astype(np.int32)
        if lab.ndim == 3:
            lab = lab[0]
        return lab


_TIER_SMALL, _TIER_MEDIUM, _TIER_LARGE = 0, 1, 2
_TIER_RADIUS_SCALE = {_TIER_SMALL: 0.45, _TIER_MEDIUM: 1.0, _TIER_LARGE: 1.9}


class StubOutliner:
    """Deterministic synthetic outliner — rasterises jittered round discs.

    Same placement scheme as the polygon-era stub (the seed derives from
    the plan geometry only), but emits a label image so it exercises the
    real ``objects_from_labels``/grouping path.
    """

    name = "stub"
    max_pixels = 0  # assigned by build_outliners

    _GRID_JITTER = 0.22
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
        return int.from_bytes(hashlib.sha256(repr(material).encode()).digest()[:8], "big")

    def segment(
        self,
        rgb: np.ndarray,
        *,
        plan: RegionPlan,
        mpp: float | None,
        params: dict | None = None,
        preprocess: bool = True,
    ) -> np.ndarray:
        rng = random.Random(self._seed(plan))
        d = plan.downsample
        sel = plan.selection
        region = plan.region
        h, w = rgb.shape[:2]
        labels = np.zeros((h, w), np.int32)

        base_r = max(6.0, min(160.0, min(sel.width, sel.height) / 12.0))
        spacing = base_r * 2.8
        index = 0
        yy = np.arange(h)[:, None]
        xx = np.arange(w)[None, :]
        y = float(region.y)
        while y <= region.y + region.height:
            x = float(region.x)
            while x <= region.x + region.width:
                index += 1
                tier = (
                    _TIER_LARGE
                    if index % 40 == 0
                    else _TIER_SMALL
                    if index % 15 == 0
                    else _TIER_MEDIUM
                )
                cx = x + rng.uniform(-1, 1) * spacing * self._GRID_JITTER
                cy = y + rng.uniform(-1, 1) * spacing * self._GRID_JITTER
                radius = base_r * _TIER_RADIUS_SCALE[tier] * rng.uniform(0.85, 1.15)
                # Disc centre/radius in level px relative to the stitch.
                lx = (cx - region.x) / d
                ly = (cy - region.y) / d
                lr = radius / d
                disc = (xx - lx) ** 2 + (yy - ly) ** 2 <= lr * lr
                labels[disc] = index
                x += spacing
            y += spacing
        return labels


def build_outliner(name: str, *, torch_threads: int) -> Outliner:
    """Construct one configured outliner; raises on missing dependencies."""
    if name == "stub":
        return StubOutliner()
    if name == "instanseg":
        return InstanSegNucleiOutliner(torch_threads=torch_threads)
    raise ValueError(f"unknown counting outliner {name!r}")


def build_outliners(
    *,
    cells: str,
    nuclei: str,
    torch_threads: int,
    max_pixels: int,
    classical_max_pixels: int,
) -> dict[str, Outliner]:
    """Build the per-mode outliner map for the worker.

    Each outliner carries its stitched-pixel ``max_pixels`` budget —
    ``classical_max_pixels`` for the cheap scikit-image/stub outliners,
    ``max_pixels`` for ML ones (InstanSeg).
    """
    outliners = {
        "cells": (
            ClassicalCellsOutliner() if cells == "classical" else build_outliner(cells, torch_threads=torch_threads)
        ),
        "nuclei": (
            ClassicalNucleiOutliner()
            if nuclei == "classical"
            else build_outliner(nuclei, torch_threads=torch_threads)
        ),
    }
    for outliner in outliners.values():
        outliner.max_pixels = pixel_budget(
            outliner.name,
            max_pixels=max_pixels,
            classical_max_pixels=classical_max_pixels,
        )
    return outliners
