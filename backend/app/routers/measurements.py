"""Measurement review API (docs/measurement-review.md).

Admins and instructors scan images into pending measurement findings,
review them sorted by confidence, and approve (optionally corrected) or
reject them. Only approval writes ``measurement_scale``/``measurement_unit``
into ``Image.metadata_``, using merge semantics so annotations survive.
"""

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_role
from ..auth_events import actor_log_fields
from ..browse_state import bump_browse_revision
from ..database import async_session, get_db
from ..measurement.service import (
    approve_finding,
    reject_finding,
    scan_candidates_stmt,
    scan_images,
)
from ..models import Image, MeasurementFinding, User
from ..schemas import (
    MeasurementApprove,
    MeasurementBulkApprove,
    MeasurementBulkApproveOut,
    MeasurementFindingOut,
    MeasurementFindingsPageOut,
    MeasurementScanOut,
    MeasurementScanRequest,
)
from ..worker import TaskQueueUnavailableError, enqueue_measurement_scan

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/measurement-findings", tags=["measurement-findings"])

_Reviewer = Annotated[User, Depends(require_role("admin", "instructor"))]

_SORTS = {
    "confidence_desc": (MeasurementFinding.confidence.desc(), MeasurementFinding.id),
    "confidence_asc": (MeasurementFinding.confidence.asc(), MeasurementFinding.id),
    "created_desc": (MeasurementFinding.id.desc(),),
}


def _out(finding: MeasurementFinding, image: Image) -> MeasurementFindingOut:
    return MeasurementFindingOut(
        id=finding.id,
        image_id=image.id,
        image_name=image.name,
        image_thumb=image.thumb,
        category_id=image.category_id,
        image_width=image.width,
        image_height=image.height,
        status=finding.status,
        source=finding.source,
        proposed_scale=finding.proposed_scale,
        proposed_unit=finding.proposed_unit,
        objective=finding.objective,
        confidence=finding.confidence,
        evidence=finding.evidence,
        detector_version=finding.detector_version,
        approved_scale=finding.approved_scale,
        approved_unit=finding.approved_unit,
        reviewed_by=finding.reviewed_by,
        reviewed_at=finding.reviewed_at,
        created_at=finding.created_at,
    )


@router.post("/scan", response_model=MeasurementScanOut, status_code=202)
async def scan(
    body: MeasurementScanRequest,
    background_tasks: BackgroundTasks,
    user: _Reviewer,
    db: AsyncSession = Depends(get_db),
) -> MeasurementScanOut:
    """Queue the next ``limit`` unscaled, unreviewed images for detection."""
    image_ids = list(
        (await db.execute(scan_candidates_stmt(body.limit, body.category_id))).scalars()
    )
    if not image_ids:
        return MeasurementScanOut(image_ids=[], mode="queued")
    try:
        result = await enqueue_measurement_scan(image_ids)
    except TaskQueueUnavailableError:
        raise HTTPException(status_code=503, detail="task_queue_unavailable")
    mode = "queued" if result.queued else "fallback"
    if mode == "fallback":
        background_tasks.add_task(scan_images, async_session, image_ids)
    logger.info(
        "Measurement scan requested",
        extra={
            "event": "measurement.scan_requested",
            "image_count": len(image_ids),
            "mode": mode,
            **actor_log_fields(user),
        },
    )
    return MeasurementScanOut(image_ids=image_ids, mode=mode)


@router.get("", response_model=MeasurementFindingsPageOut)
async def list_findings(
    _user: _Reviewer,
    db: AsyncSession = Depends(get_db),
    status: Literal["pending", "approved", "rejected", "superseded"] = "pending",
    category_id: int | None = None,
    min_confidence: float | None = Query(default=None, ge=0, le=1),
    sort: Literal["confidence_desc", "confidence_asc", "created_desc"] = "confidence_desc",
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> MeasurementFindingsPageOut:
    filters = [MeasurementFinding.status == status]
    if category_id is not None:
        filters.append(Image.category_id == category_id)
    if min_confidence is not None:
        filters.append(MeasurementFinding.confidence >= min_confidence)
    base = select(MeasurementFinding, Image).join(
        Image, Image.id == MeasurementFinding.image_id
    ).where(*filters)
    total = await db.scalar(
        select(func.count()).select_from(base.subquery())
    )
    rows = (
        await db.execute(base.order_by(*_SORTS[sort]).limit(limit).offset(offset))
    ).all()
    return MeasurementFindingsPageOut(
        items=[_out(f, img) for f, img in rows], total=total or 0
    )


async def _pending_with_image(
    db: AsyncSession, finding_id: int
) -> tuple[MeasurementFinding, Image]:
    finding = await db.get(MeasurementFinding, finding_id, with_for_update=True)
    if finding is None:
        raise HTTPException(status_code=404, detail="Finding not found")
    if finding.status != "pending":
        raise HTTPException(status_code=409, detail=f"Finding is {finding.status}")
    image = await db.get(Image, finding.image_id, with_for_update=True)
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found")
    return finding, image


async def _bump_if_browsable(db: AsyncSession, images: list[Image]) -> None:
    if any(img.category_id is not None for img in images):
        await bump_browse_revision(db)


@router.post("/approve", response_model=MeasurementBulkApproveOut)
async def bulk_approve(
    body: MeasurementBulkApprove,
    user: _Reviewer,
    db: AsyncSession = Depends(get_db),
) -> MeasurementBulkApproveOut:
    """Approve each pending finding at its proposed scale.

    Findings that are no longer pending, have no proposed scale, or whose
    image is gone are skipped rather than failing the batch.
    """
    approved: list[int] = []
    skipped: list[int] = []
    touched: list[Image] = []
    for finding_id in dict.fromkeys(body.ids):
        finding = await db.get(MeasurementFinding, finding_id, with_for_update=True)
        image = (
            await db.get(Image, finding.image_id, with_for_update=True)
            if finding is not None
            else None
        )
        if (
            finding is None
            or image is None
            or finding.status != "pending"
            or finding.proposed_scale is None
        ):
            skipped.append(finding_id)
            continue
        await approve_finding(db, finding, image, user.id)
        approved.append(finding_id)
        touched.append(image)
    if approved:
        await _bump_if_browsable(db, touched)
        await db.commit()
    logger.info(
        "Measurement findings bulk-approved",
        extra={
            "event": "measurement.bulk_approved",
            "approved_count": len(approved),
            "skipped_count": len(skipped),
            **actor_log_fields(user),
        },
    )
    return MeasurementBulkApproveOut(approved=approved, skipped=skipped)


@router.post("/{finding_id}/approve", response_model=MeasurementFindingOut)
async def approve(
    finding_id: int,
    user: _Reviewer,
    body: MeasurementApprove | None = None,
    db: AsyncSession = Depends(get_db),
) -> MeasurementFindingOut:
    """Approve one finding, optionally with a corrected scale."""
    finding, image = await _pending_with_image(db, finding_id)
    body = body or MeasurementApprove()
    try:
        await approve_finding(db, finding, image, user.id, body.scale, body.unit)
    except ValueError:
        raise HTTPException(
            status_code=422, detail="Finding has no proposed scale; supply one"
        )
    await _bump_if_browsable(db, [image])
    await db.commit()
    await db.refresh(finding)
    logger.info(
        "Measurement finding approved",
        extra={
            "event": "measurement.approved",
            "finding_id": finding.id,
            "image_id": image.id,
            "edited": body.scale is not None,
            **actor_log_fields(user),
        },
    )
    return _out(finding, image)


@router.post("/{finding_id}/reject", response_model=MeasurementFindingOut)
async def reject(
    finding_id: int,
    user: _Reviewer,
    db: AsyncSession = Depends(get_db),
) -> MeasurementFindingOut:
    finding, image = await _pending_with_image(db, finding_id)
    reject_finding(finding, user.id)
    await db.commit()
    await db.refresh(finding)
    return _out(finding, image)
