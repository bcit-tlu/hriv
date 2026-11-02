"""Scan images into pending measurement findings and promote approvals."""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone

from sqlalchemy import exists, select, update
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


def scan_candidates_stmt(limit: int, category_id: int | None = None):
    """Images with no scale and no live (pending/approved/rejected) finding.

    Rejected and approved findings stop an image being re-proposed; only
    superseded findings leave it eligible again.
    """
    reviewed = exists().where(
        MeasurementFinding.image_id == Image.id,
        MeasurementFinding.status != "superseded",
    )
    stmt = (
        select(Image.id)
        .where(
            ~reviewed,
            ~Image.metadata_.has_key(SCALE_KEY),
        )
        .order_by(Image.id)
        .limit(limit)
    )
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


async def scan_image(db: AsyncSession, image: Image) -> MeasurementFinding:
    """Run the RBC detector on one image and record a pending finding."""
    path = await _latest_source_path(db, image.id)
    estimate: ScaleEstimate | None = None
    evidence: dict = {}
    if not path or not await asyncio.to_thread(os.path.isfile, path):
        evidence["reason"] = "source_missing"
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

    await db.execute(
        update(MeasurementFinding)
        .where(
            MeasurementFinding.image_id == image.id,
            MeasurementFinding.status == "pending",
        )
        .values(status="superseded")
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


async def scan_images(session_factory, image_ids: list[int]) -> int:
    """Scan each image in its own transaction; returns findings created."""
    created = 0
    for image_id in image_ids:
        async with session_factory() as db:
            image = await db.get(Image, image_id)
            # A scale set after the scan was queued wins; never propose over it.
            if image is None or SCALE_KEY in (image.metadata_ or {}):
                continue
            await scan_image(db, image)
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
    edited = scale is not None and scale != finding.proposed_scale
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
