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
        # Embedded calibration passes through unbounded — it predates the
        # derived path and EM sources legitimately sit below _MIN_MPP.
        return mpp
    scale = _positive_number(metadata.get("measurement_scale"))
    if scale is None:
        return None
    # An absent unit means "um" — the metadata contract writes it
    # alongside the scale, but a missing key defaults sanely anyway.
    # Metadata is free-form: a non-string unit is unusable, not an error.
    unit = metadata.get("measurement_unit") or "um"
    um_per_unit = _UNIT_TO_UM.get(unit) if isinstance(unit, str) else None
    if um_per_unit is None:
        return None
    derived = um_per_unit / scale
    return derived if _MIN_MPP <= derived <= _MAX_MPP else None


def nuclei_downsample(mpp: float | None, max_downsample: int) -> int:
    """The fixed nuclei level rule, shared by API pre-flight and the worker.

    With a known mpp, the coarsest ``d`` still inside the ~0.5 µm/px model
    sweet spot (``mpp * d <= 0.5``); with none, level 0 — the
    hematoxylin-mask diameter estimate merges dense tissue, so coarse
    levels are unsafe. The worker applies this unconditionally in
    ``pipeline._choose_downsample``; the router must plan the same level
    so an over-budget selection is a 422, not a doomed queued job.
    """
    if mpp and mpp > 0:
        d = max_downsample
        while d > 1 and mpp * d > 0.5:
            d //= 2
        return d
    return 1


def _num(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def detection_params_from_metadata(metadata: dict | None) -> dict | None:
    """Sanitized `DetectionTuning` dict from `metadata.detection_params` (#1870).

    Dependency-free (no pydantic/detector import): keeps only the semantic
    fields counting understands, field-wise — a malformed field is dropped
    rather than failing the whole tuning, and `advanced` raw overrides are
    detector-internal so they never reach the counting path. Returns None
    when nothing usable remains.
    """
    raw = (metadata or {}).get("detection_params")
    if not isinstance(raw, dict):
        return None
    out: dict = {}
    if (s := _num(raw.get("sensitivity"))) is not None and 0.0 <= s <= 1.0:
        out["sensitivity"] = s
    if (m := _num(raw.get("min_cell_size"))) is not None and 0.0 < m <= 100.0:
        out["min_cell_size"] = m
    if isinstance(raw.get("exclude_nuclei"), bool):
        out["exclude_nuclei"] = raw["exclude_nuclei"]
    return out or None
