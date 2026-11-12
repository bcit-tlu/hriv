"""Pixel-size (µm/px) derivation from image metadata (epic #1865, #1868).

Like :mod:`.budgets`, this module is deliberately dependency-free: the
API image has no ``counting`` extras installed and ``routers/counts.py``
imports it for the pre-flight plan.

``mpp_x`` is written for pyramidal uploads and TIFF resolution tags. An
instructor-approved measurement instead writes ``measurement_scale``
(pixels per ``measurement_unit``) — converting it back to µm/px lets an
approved scale calibrate counting without a second metadata key.
"""

from __future__ import annotations

# Unit → µm per unit. ``MeasurementApprove`` lets reviewers approve a
# scale in any of these; anything else is treated as unknown.
_UNIT_TO_UM = {"nm": 0.001, "um": 1.0, "mm": 1000.0, "cm": 10000.0}

# Plausible microscopy bounds — the same range processing.py accepts
# when reading TIFF resolution tags.
_MIN_MPP = 0.01
_MAX_MPP = 100.0


def _positive_number(value: object) -> float | None:
    """``float(value)`` for real positive numbers; ``None`` otherwise."""
    if (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and value > 0
    ):
        return float(value)
    return None


def mpp_from_metadata(metadata: dict | None) -> float | None:
    """µm per pixel for counting, or ``None`` when no usable scale exists.

    Precedence: ``mpp_x`` > ``unit / measurement_scale`` > ``None``.
    Free-form JSON is untrusted — a derived value outside the plausible
    microscopy range is treated as absent rather than fed to the level
    rule or ``InstanSeg.pixel_size``.
    """
    metadata = metadata or {}
    mpp = _positive_number(metadata.get("mpp_x"))
    if mpp is not None:
        return mpp
    scale = _positive_number(metadata.get("measurement_scale"))
    if scale is None:
        return None
    # An absent unit means "um" — the metadata contract writes it
    # alongside the scale, but a missing key defaults sanely anyway.
    um_per_unit = _UNIT_TO_UM.get(metadata.get("measurement_unit") or "um")
    if um_per_unit is None:
        return None
    derived = um_per_unit / scale
    return derived if _MIN_MPP <= derived <= _MAX_MPP else None
