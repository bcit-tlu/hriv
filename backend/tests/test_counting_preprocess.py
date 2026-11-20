"""Preprocessing + per-image detection_params in the counting path (#1870)."""

from __future__ import annotations

import numpy as np
import pytest
from fakeredis import aioredis as fake_aioredis

from app.counting import jobs
from app.counting.mpp import detection_params_from_metadata
from app.counting.outliners import (
    _mask_and_signal,
    probe_object_stats,
)


def _field(centers, radius, h=300, w=300, color=(200, 170, 185), drift=0.0, period=45.0):
    """Pale-pink discs on a noisy background; `drift` adds a sinusoidal
    low-frequency staining variation — the real failure mode (#1870)."""
    rng = np.random.default_rng(0)
    base = 230.0 + rng.normal(0, 3, (h, w, 1))
    rgb = np.repeat(base, 3, axis=2)
    yy, xx = np.mgrid[:h, :w]
    if drift:
        rgb = rgb + (drift * np.sin(xx / period))[..., None]
    rgb = rgb.clip(0, 255).astype(np.uint8)
    for cx, cy in centers:
        rgb[(xx - cx) ** 2 + (yy - cy) ** 2 <= radius * radius] = color
    return rgb


# ── preprocessing ────────────────────────────────────────────


def test_flat_field_recovers_discs_lost_to_staining_drift() -> None:
    """A staining drift bumps raw Otsu's threshold past the faint discs;
    the subtractive flat-field removes the drift and recovers them."""
    centers = [(60, 60), (150, 150), (240, 240), (60, 240), (240, 60)]
    rgb = _field(centers, 16, color=(215, 190, 200), drift=160, period=45)
    _, _, n_raw = _mask_and_signal(rgb, "cells", preprocess=False)
    _, _, n_pre = _mask_and_signal(rgb, "cells", preprocess=True)
    assert n_raw < 5
    assert n_pre == 5


def test_preprocess_off_is_the_shipped_path() -> None:
    rgb = _field([(80, 80), (200, 200)], 20)
    mask_off, _, _ = _mask_and_signal(rgb, "cells", preprocess=False)
    assert mask_off.sum() > 0
    _, _, n_off = _mask_and_signal(rgb, "cells", preprocess=False)
    _, _, n_on = _mask_and_signal(rgb, "cells", preprocess=True)
    assert n_off == n_on == 2


def test_preprocess_on_clean_field_matches_off() -> None:
    rgb = _field([(60, 60), (240, 60), (150, 220)], 18)
    _, _, n_off = _mask_and_signal(rgb, "cells", preprocess=False)
    _, _, n_on = _mask_and_signal(rgb, "cells", preprocess=True)
    assert n_off == n_on == 3


# ── per-image detection_params ────────────────────────────────


def test_sensitivity_loosens_the_threshold() -> None:
    centers = [(60, 60), (150, 150), (240, 240)]
    rgb = _field(centers, 16)
    _, _, n_strict = _mask_and_signal(
        rgb, "cells", params={"sensitivity": 0.0}
    )
    _, _, n_soft = _mask_and_signal(rgb, "cells", params={"sensitivity": 1.0})
    assert n_soft >= n_strict


def test_min_cell_size_scales_the_small_object_floor() -> None:
    rgb = _field([(60, 60), (240, 240)], 8)
    _, _, n_default = _mask_and_signal(rgb, "cells")
    _, _, n_big = _mask_and_signal(rgb, "cells", params={"min_cell_size": 12.0})
    # radius-8 discs (area ~200px) survive the shipped 30-px floor but not
    # the area-scaled floor of radius 12 (30·(12/3)² = 480px).
    assert n_default >= 2
    assert n_big == 0


def test_default_tuning_is_equivalent_to_untuned() -> None:
    """An approval storing untouched DetectionTuning defaults must not
    change counting — the same image before and after approval counts
    the same (#1870 review: default `exclude_nuclei=True` used to drop
    purple objects only after approval)."""
    rgb = _field([(60, 60), (240, 240)], 16, color=(95, 55, 140))
    defaults = {"sensitivity": 0.6, "min_cell_size": 3.0, "exclude_nuclei": True}
    mask_none, _, n_none = _mask_and_signal(rgb, "cells", params=None)
    mask_def, _, n_def = _mask_and_signal(rgb, "cells", params=defaults)
    assert n_none == n_def
    assert (mask_none == mask_def).all()


def test_sensitivity_never_shrinks_the_mask() -> None:
    """On fields where the Otsu threshold is negative, multiplying it
    reverses the ordering — the offset must be additive so higher
    sensitivity never selects fewer pixels (#1870 review)."""
    centers = [(60, 60), (150, 150), (240, 240), (60, 240), (240, 60)]
    rgb = _field(centers, 16, color=(215, 190, 200), drift=160, period=45)
    areas = [
        _mask_and_signal(rgb, "cells", params={"sensitivity": s})[0].sum()
        for s in (0.0, 0.6, 1.0)
    ]
    assert areas[0] <= areas[1] <= areas[2]


def test_malformed_params_fields_are_ignored() -> None:
    rgb = _field([(80, 80), (200, 200)], 20)
    _, lab_none, n_none = _mask_and_signal(rgb, "cells")
    _, _, n_bad = _mask_and_signal(
        rgb,
        "cells",
        params={"sensitivity": "high", "min_cell_size": -1, "exclude_nuclei": "yes"},
    )
    assert n_bad == n_none
    mask_none, _, _ = _mask_and_signal(rgb, "cells")
    mask_bad, _, _ = _mask_and_signal(
        rgb, "cells", params={"sensitivity": [0.5]}
    )
    assert (mask_none == mask_bad).all()


def test_probe_sees_the_same_preprocessed_signal() -> None:
    """The level-picker probe must run the identical signal path — a fix in
    segment-only preprocessing would leave #1670's collapse intact."""
    centers = [(60, 60), (150, 150), (240, 240), (60, 240), (240, 60)]
    rgb = _field(centers, 16, color=(215, 190, 200), drift=160, period=45)
    _, n_probe = probe_object_stats(rgb, "cells", preprocess=True)
    _, _, n_mask = _mask_and_signal(rgb, "cells", preprocess=True)
    assert n_probe == n_mask == 5


# ── metadata → record plumbing ────────────────────────────────


def test_detection_params_from_metadata_sanitizes() -> None:
    meta = {
        "detection_params": {
            "sensitivity": 0.9,
            "min_cell_size": 5.0,
            "exclude_nuclei": True,
            # Detector-internal; counting must never see it.
            "advanced": {"sat_above_background": 4},
            "surprise": 42,
        }
    }
    out = detection_params_from_metadata(meta)
    # `exclude_nuclei=True` is the DetectionTuning default → dropped.
    assert out == {"sensitivity": 0.9, "min_cell_size": 5.0}


@pytest.mark.parametrize(
    "raw",
    [
        None,
        {},
        {"detection_params": "tuned"},
        {"detection_params": {"sensitivity": "x"}},
        {"detection_params": {"sensitivity": 1.5}},
        # An untouched-default tuning is no tuning at all.
        {"detection_params": {"sensitivity": 0.6, "min_cell_size": 3.0, "exclude_nuclei": True}},
    ],
)
def test_detection_params_from_metadata_rejects_garbage(raw) -> None:
    assert detection_params_from_metadata(raw) is None


def test_detection_params_partial_fields_kept() -> None:
    out = detection_params_from_metadata(
        {"detection_params": {"sensitivity": "bad", "exclude_nuclei": False}}
    )
    assert out == {"exclude_nuclei": False}


async def test_create_record_round_trips_params() -> None:
    pool = fake_aioredis.FakeRedis(decode_responses=True)
    record = await jobs.create_record(
        pool,
        job_id="j1",
        user_id=1,
        image_id=2,
        source_image_id=3,
        mode="cells",
        selection={"x": 0, "y": 0, "width": 10, "height": 10},
        mpp=0.25,
        params={"sensitivity": 0.9},
        ttl_seconds=60,
    )
    assert record["params"] == {"sensitivity": 0.9}
    got = await jobs.get_record(pool, "j1")
    assert got["params"] == {"sensitivity": 0.9}
