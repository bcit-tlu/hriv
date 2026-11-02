"""Objective-class calibration for the RBC ruler (docs/measurement-review.md).

Most of the library comes from one microscope camera, so the scale is one of
a few objective constants rather than a continuous unknown. Each profile maps
an objective to pixels per µm at that sensor size; the detector's RBC
diameter selects the nearest objective in log space.

PROVISIONAL: the constants are averages of RBC-size clusters on images whose
notes name the objective (±~10%). Replace them with stage-micrometer
measurements and bump ``DETECTOR_VERSION``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .detector import RbcMeasurement

DETECTOR_VERSION = "rbc-1"
# Apparent RBC diameter (µm) as measured by the detector (inscribed radius
# ×2 + 1 overstates the true ~7.5 µm slightly; this is what the clusters show).
RBC_APPARENT_DIAMETER_UM = 7.5

_CAMERA_2880_PX_PER_UM = {"10": 2.0, "40": 7.3, "100": 18.7}

# (width, height) -> {objective: px/µm}. 1440×1024 is the same camera binned 2×.
CAMERA_PROFILES: dict[tuple[int, int], dict[str, float]] = {
    (2880, 2048): _CAMERA_2880_PX_PER_UM,
    (1440, 1024): {k: v / 2 for k, v in _CAMERA_2880_PX_PER_UM.items()},
}

# Confidence components.
_FULL_COUNT = 100  # selected cells for full count credit
_FULL_MARGIN = 0.5  # log-space margin between nearest and runner-up objective
_OFF_CLASS_LOG = math.log(1.5)  # >1.5× or <1/1.5× the nearest objective is suspect
_UNPROFILED_CONFIDENCE_CAP = 0.3


@dataclass(frozen=True)
class ScaleEstimate:
    scale: float  # px/µm in source pixels
    confidence: float  # 0–1
    objective: str | None
    evidence: dict


def _count_factor(selected: int) -> float:
    if selected <= 1:
        return 0.0
    return min(1.0, math.log10(selected) / math.log10(_FULL_COUNT))


def estimate_scale(
    measurement: RbcMeasurement, width: int | None, height: int | None
) -> ScaleEstimate:
    measured = measurement.diameter_px / RBC_APPARENT_DIAMETER_UM
    base = measurement.peak_fraction * _count_factor(measurement.selected_count)
    evidence = {
        "rbc_diameter_px": round(measurement.diameter_px, 2),
        "rbc_selected": measurement.selected_count,
        "rbc_components": measurement.component_count,
        "peak_fraction": round(measurement.peak_fraction, 3),
        "measured_scale": round(measured, 4),
    }
    profile = CAMERA_PROFILES.get((width or 0, height or 0))
    if profile is None:
        evidence["camera_profile"] = None
        confidence = min(base, _UNPROFILED_CONFIDENCE_CAP)
        return ScaleEstimate(round(measured, 4), round(confidence, 3), None, evidence)

    distances = sorted(
        (abs(math.log(measured / px_per_um)), objective)
        for objective, px_per_um in profile.items()
    )
    nearest, objective = distances[0]
    margin = distances[1][0] - nearest if len(distances) > 1 else _FULL_MARGIN
    confidence = base * min(1.0, margin / _FULL_MARGIN)
    if nearest > _OFF_CLASS_LOG:
        confidence *= 0.5
    evidence |= {
        "camera_profile": f"{width}x{height}",
        "objective_distance_log": round(nearest, 3),
        "objective_margin_log": round(margin, 3),
    }
    return ScaleEstimate(profile[objective], round(confidence, 3), objective, evidence)
