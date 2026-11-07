"""Scan images into pending measurement findings and promote approvals."""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone

from sqlalchemy import case, exists, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Image, MeasurementFinding, SourceImage
from .calibration import DETECTOR_VERSION, ScaleEstimate, estimate_scale
from .detector import load_work_image, measure_rbc_diameter

logger = logging.getLogger(__name__)

# Metadata keys written on approval (merge semantics; nothing else is touched).
SCALE_KEY = "measurement_scale"
UNIT_KEY = "measurement_unit"
SOURCE_KEY = "measurement_scale_source"
FINDING_KEY = "measurement_finding_id"

# Slide scans this large shrink cells below detection in the work thumbnail.
RBC_MAX_SIDE_PX = 8000


def has_scale(meta: dict | None) -> bool:
    """A usable stored scale (a cleared ``null`` or junk value doesn't count)."""
    value = (meta or {}).get(SCALE_KEY)
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0


def has_scale_sql():
    """SQL twin of :func:`has_scale`; CASE guards the cast to numbers only."""
    value = Image.metadata_[SCALE_KEY]
    return case(
        (func.jsonb_typeof(value) == "number", value.as_float() > 0),
        else_=False,
    )


LIVE_FINDING_STATUSES = ("pending", "approved", "rejected")


def scan_candidates_stmt(limit: int | None, category_id: int | None = None):
    """Images with no live (pending/approved/rejected) finding.

    Rejected and approved findings stop an image being re-proposed; only
    superseded findings leave it eligible again. Already-scaled images are
    included so their stored value is recorded as an authoritative finding.
    ``limit=None`` selects every candidate (whole-library scans).
    """
    reviewed = exists().where(
        MeasurementFinding.image_id == Image.id,
        MeasurementFinding.status != "superseded",
    )
    stmt = select(Image.id).where(~reviewed).order_by(Image.id)
    if limit is not None:
        stmt = stmt.limit(limit)
    if category_id is not None:
        stmt = stmt.where(Image.category_id == category_id)
    return stmt


def rescan_candidates_stmt(limit: int | None, category_id: int | None = None):
    """Unscaled images lacking a live finding from the current detector.

    Picks up never-scanned images plus images whose only findings were made
    by an older ``DETECTOR_VERSION`` (e.g. after a detector or calibration
    change); a rescan supersedes those findings and proposes again. Scaled
    images are excluded: detection never runs on them, so there is nothing
    new to detect.
    """
    current = exists().where(
        MeasurementFinding.image_id == Image.id,
        MeasurementFinding.status != "superseded",
        MeasurementFinding.detector_version == DETECTOR_VERSION,
    )
    stmt = (
        select(Image.id)
        .where(~current, ~has_scale_sql())
        .order_by(Image.id)
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    if category_id is not None:
        stmt = stmt.where(Image.category_id == category_id)
    return stmt


def _detect(path: str, width: int | None, height: int | None) -> ScaleEstimate | None:
    work = load_work_image(path)
    measurement = measure_rbc_diameter(work, width or work.width)
    if measurement is None:
        return None
    return estimate_scale(measurement, width, height)


async def _latest_source_path(db: AsyncSession, image_id: int) -> str | None:
    return await db.scalar(
        select(SourceImage.stored_path)
        .where(SourceImage.image_id == image_id, SourceImage.status == "completed")
        .order_by(SourceImage.id.desc())
        .limit(1)
    )


def record_existing(db: AsyncSession, image: Image) -> MeasurementFinding:
    """Record an image's stored scale as an approved, full-confidence finding.

    Metadata is not touched: the stored value is authoritative.
    """
    meta = image.metadata_ or {}
    scale = float(meta[SCALE_KEY])
    unit = str(meta.get(UNIT_KEY) or "um")[:10]
    finding = MeasurementFinding(
        image_id=image.id,
        status="approved",
        # Pyramid detection writes mpp_x alongside the scale it derives.
        source="embedded" if "mpp_x" in meta else "existing",
        proposed_scale=scale,
        proposed_unit=unit,
        objective=None,
        confidence=1.0,
        evidence={"reason": "existing_scale", "scale_source": meta.get(SOURCE_KEY)},
        detector_version=DETECTOR_VERSION,
        approved_scale=scale,
        approved_unit=unit,
        reviewed_at=datetime.now(timezone.utc),
    )
    db.add(finding)
    return finding


async def _retire_findings(
    db: AsyncSession, image_id: int, statuses: tuple[str, ...] = ("pending",)
) -> None:
    await db.execute(
        update(MeasurementFinding)
        .where(
            MeasurementFinding.image_id == image_id,
            MeasurementFinding.status.in_(statuses),
        )
        .values(status="superseded")
    )


async def _retire_pending(db: AsyncSession, image_id: int) -> None:
    await _retire_findings(db, image_id)


async def scan_image(
    db: AsyncSession, image: Image, rescan: bool = False
) -> MeasurementFinding | None:
    """Record a stored scale, or run the RBC detector and record a pending finding.

    ``rescan=True`` supersedes every live finding first, so the image is
    re-detected (or its stored scale re-recorded) even when a reviewer
    already approved or rejected an earlier proposal. Returns ``None`` when
    an overlapping scan already recorded the stored scale.
    """
    if has_scale(image.metadata_):
        # Serialize overlapping scans of this image; approved rows have no unique index.
        await db.execute(select(Image.id).where(Image.id == image.id).with_for_update())
        if rescan:
            await _retire_findings(db, image.id, LIVE_FINDING_STATUSES)
        elif await db.scalar(
            select(MeasurementFinding.id)
            .where(
                MeasurementFinding.image_id == image.id,
                MeasurementFinding.status == "approved",
            )
            .limit(1)
        ):
            return None
        # A proposal made before the scale was stored must not resurface later.
        await _retire_pending(db, image.id)
        return record_existing(db, image)
    path = await _latest_source_path(db, image.id)
    estimate: ScaleEstimate | None = None
    evidence: dict = {}
    if not path or not await asyncio.to_thread(os.path.isfile, path):
        evidence["reason"] = "source_missing"
    elif max(image.width or 0, image.height or 0) > RBC_MAX_SIDE_PX:
        evidence["reason"] = "slide_too_large_for_rbc"
    else:
        try:
            estimate = await asyncio.to_thread(_detect, path, image.width, image.height)
        except Exception as exc:  # pyvips decode errors are per-image, not fatal
            logger.warning(
                "Measurement detection failed",
                extra={"event": "measurement.detect_failed", "image_id": image.id},
                exc_info=True,
            )
            evidence["reason"] = "detect_failed"
            evidence["error"] = type(exc).__name__
        else:
            if estimate is None:
                evidence["reason"] = "no_rbc_population"

    await _retire_findings(
        db, image.id, LIVE_FINDING_STATUSES if rescan else ("pending",)
    )
    finding = MeasurementFinding(
        image_id=image.id,
        status="pending",
        source="rbc",
        proposed_scale=estimate.scale if estimate else None,
        proposed_unit="um",
        objective=estimate.objective if estimate else None,
        confidence=estimate.confidence if estimate else 0.0,
        evidence=(estimate.evidence if estimate else {}) | evidence,
        detector_version=DETECTOR_VERSION,
    )
    db.add(finding)
    return finding


async def scan_images(
    session_factory, image_ids: list[int], rescan: bool = False
) -> int:
    """Scan each image in its own transaction; returns findings created."""
    created = 0
    for image_id in image_ids:
        async with session_factory() as db:
            image = await db.get(Image, image_id)
            if image is None:
                continue
            if await scan_image(db, image, rescan) is None:
                await db.rollback()
                continue
            try:
                await db.commit()
            except IntegrityError:
                # An overlapping scan already holds this image's pending slot.
                await db.rollback()
                continue
            created += 1
    return created


def merged_measurement_metadata(
    current: dict | None, scale: float, unit: str, source: str, finding_id: int
) -> dict:
    """Return ``current`` with only the measurement keys set (merge, never replace)."""
    merged = dict(current or {})
    merged[SCALE_KEY] = scale
    merged[UNIT_KEY] = unit
    merged[SOURCE_KEY] = source
    merged[FINDING_KEY] = finding_id
    return merged


async def approve_finding(
    db: AsyncSession,
    finding: MeasurementFinding,
    image: Image,
    reviewer_id: int,
    scale: float | None = None,
    unit: str | None = None,
) -> None:
    """Promote a pending finding into the image's metadata (caller commits)."""
    edited = (scale is not None and scale != finding.proposed_scale) or (
        unit is not None and unit != finding.proposed_unit
    )
    final_scale = scale if scale is not None else finding.proposed_scale
    if final_scale is None or final_scale <= 0:
        raise ValueError("finding has no scale to approve")
    final_unit = unit or finding.proposed_unit
    image.metadata_ = merged_measurement_metadata(
        image.metadata_,
        final_scale,
        final_unit,
        "manual" if edited else finding.source,
        finding.id,
    )
    image.version = image.version + 1
    finding.status = "approved"
    finding.approved_scale = final_scale
    finding.approved_unit = final_unit
    finding.reviewed_by = reviewer_id
    finding.reviewed_at = datetime.now(timezone.utc)


def reject_finding(finding: MeasurementFinding, reviewer_id: int) -> None:
    finding.status = "rejected"
    finding.reviewed_by = reviewer_id
    finding.reviewed_at = datetime.now(timezone.utc)


_MEASUREMENT_METADATA_KEYS = frozenset({SCALE_KEY, UNIT_KEY, SOURCE_KEY, FINDING_KEY})


def reset_finding(finding: MeasurementFinding, image: Image) -> bool:
    """Move an approved or rejected finding back to pending (caller commits).

    Undoing an approval also removes the measurement keys it wrote, so a
    mistaken approval does not leave a wrong scale on the image. The strip
    only runs while the stored scale is still exactly the value this finding
    promoted — a scale since changed by anything else is authoritative and
    left alone (the finding still returns to pending, where the list hides
    it while a scale exists). Returns True when image metadata changed.
    """
    meta = image.metadata_ or {}
    stripped = False
    if (
        finding.status == "approved"
        and meta.get(FINDING_KEY) == finding.id
        and meta.get(SCALE_KEY) == finding.approved_scale
        and meta.get(UNIT_KEY) == finding.approved_unit
    ):
        image.metadata_ = {
            k: v for k, v in meta.items() if k not in _MEASUREMENT_METADATA_KEYS
        }
        image.version = image.version + 1
        stripped = True
    finding.status = "pending"
    finding.reviewed_by = None
    finding.reviewed_at = None
    return stripped
