#!/usr/bin/env python3
"""Counting regression corpus (epic #1865, #1870).

Diffs classical outliner counts/masks (IoU) across the shipped path,
preprocessing variants and persisted ``DetectionTuning`` values on a
small corpus — the safety net that turns tuning from guessing into
measuring. Real problem crops can be dropped into ``--image-dir`` (any
PNG/JPEG); without one, a built-in synthetic corpus is used.

    poetry run python ../scripts/counting_regress.py [--image-dir DIR]

Exit code 1 when a case regresses past ``--iou-min`` / ``--count-tol``.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np


def _corpus_synthetic() -> dict[str, np.ndarray]:
    """Deterministic low-quality fixtures mirroring reported failures."""
    rng = np.random.default_rng(0)
    cases: dict[str, np.ndarray] = {}

    def field(centers, radius, color, drift=0.0, period=45.0, noise=3):
        base = 230.0 + rng.normal(0, noise, (300, 300, 1))
        rgb = np.repeat(base, 3, axis=2)
        yy, xx = np.mgrid[:300, :300]
        if drift:
            rgb = rgb + (drift * np.sin(xx / period))[..., None]
        rgb = rgb.clip(0, 255).astype(np.uint8)
        for cx, cy in centers:
            rgb[(xx - cx) ** 2 + (yy - cy) ** 2 <= radius * radius] = color
        return rgb

    grid5 = [(60, 60), (150, 150), (240, 240), (60, 240), (240, 60)]
    cases["clean"] = field(grid5, 16, (200, 170, 185))
    cases["staining-drift"] = field(grid5, 16, (215, 190, 200), drift=160)
    cases["low-res-faint"] = field(grid5, 5, (215, 190, 200), noise=4)
    cases["nuclei"] = field(
        [(50, 50), (150, 150), (250, 80)], 15, (60, 40, 120)
    )
    return cases


def _load_dir(root: Path) -> dict[str, np.ndarray]:
    from PIL import Image

    out = {}
    for p in sorted(root.iterdir()):
        if p.suffix.lower() in {".png", ".jpg", ".jpeg"}:
            out[p.stem] = np.asarray(Image.open(p).convert("RGB"), np.uint8)
    return out


def _iou(a: np.ndarray, b: np.ndarray) -> float:
    union = np.logical_or(a > 0, b > 0).sum()
    if union == 0:
        return 1.0
    return float(np.logical_and(a > 0, b > 0).sum() / union)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--image-dir", type=Path)
    ap.add_argument("--iou-min", type=float, default=0.5)
    ap.add_argument("--count-tol", type=int, default=1)
    args = ap.parse_args()

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
    from app.counting.outliners import _mask_and_signal, classical_labels

    corpus = dict(_corpus_synthetic())
    if args.image_dir:
        corpus.update(_load_dir(args.image_dir))

    variants = [
        ("shipped", {"params": None, "preprocess": False}),
        ("preprocessed", {"params": None, "preprocess": True}),
        ("tuned-permissive", {
            "params": {"sensitivity": 1.0, "min_cell_size": 3.0},
            "preprocess": True,
        }),
        ("tuned-strict", {
            "params": {"sensitivity": 0.0, "min_cell_size": 6.0},
            "preprocess": True,
        }),
    ]
    failed = 0
    for case, rgb in sorted(corpus.items()):
        mode = "nuclei" if case == "nuclei" else "cells"
        masks: dict[str, np.ndarray] = {}
        counts: dict[str, int] = {}
        print(f"{case}:")
        for name, kw in variants:
            labels = classical_labels(rgb, mode, **kw)
            mask, _lab, n = _mask_and_signal(rgb, mode, **kw)
            masks[name] = mask
            counts[name] = n
            print(f"  {name:18s} objects={len(np.unique(labels)) - 1:4d} comps={n}")
        for name, kw in variants[1:]:
            iou = _iou(masks["shipped"], masks[name])
            n0, n1 = counts["shipped"], counts[name]
            if name == "preprocessed":
                # Only the same-params comparison gates: preprocessing must
                # not silently destroy what shipped detected. Tuned
                # variants intentionally diverge — a permissive mask that
                # finds more or a strict one that finds fewer is a *result*,
                # not a regression — so they are reported but never gate.
                if iou < args.iou_min or n0 - n1 > args.count_tol:
                    flag, failed = "  REGRESSED", failed + 1
                elif n1 != n0:
                    flag = "  changed"
                else:
                    flag = ""
            elif n0 > 0 and n1 == 0:
                # Tuned settings wiping out every object is worth a human
                # look but is still a legitimate extreme of the knobs.
                flag = "  changed(all lost)"
            else:
                flag = ""
            print(f"  vs shipped: {name:18s} IoU={iou:.3f}{flag}")
    print(json.dumps({"cases": len(corpus), "regressions": failed}))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
