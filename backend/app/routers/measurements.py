"""Measurement review API (docs/measurement-review.md).

Admins and instructors scan images into pending measurement findings,
review them sorted by confidence, and approve (optionally corrected) or
reject them. Only approval writes ``measurement_scale``/``measurement_unit``
into ``Image.metadata_``, using merge semantics so annotations survive.
"""

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import CTE, ColumnElement, Float, Text, cast, func, literal, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from ..auth import require_role
from ..auth_events import actor_log_fields
from ..browse_state import bump_browse_revision
from ..collection_views import image_ids_in_collections
from ..database import async_session, get_db
from ..measurement.calibration import CAMERA_PROFILES
from ..measurement.service import (
    approve_finding,
    has_scale,
    has_scale_sql,
    preview_detection,
    reject_finding,
    rescan_candidates_stmt,
    reset_finding,
    scan_candidates_stmt,
    scan_images,
)
from ..models import Category, Image, MeasurementFinding, User
from ..schemas import (
    DetectionPreviewOut,
    MeasurementFindingCategoryOut,
    MeasurementApprove,
    MeasurementBulkApprove,
    MeasurementBulkApproveOut,
    MeasurementFindingOut,
    MeasurementFindingsPageOut,
    MeasurementFindingUpdate,
    MeasurementPreviewRequest,
    MeasurementScanOut,
    MeasurementScanProgressOut,
    MeasurementScanRemainingOut,
    MeasurementScanRequest,
)
from ..worker import TaskQueueUnavailableError, enqueue_measurement_scan

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/measurement-findings", tags=["measurement-findings"])

_Reviewer = Annotated[User, Depends(require_role("admin", "instructor"))]

# Whole-library scans are split into jobs of this size so one queued job never
# holds a worker slot for hours and progress stays resumable.
_SCAN_JOB_CHUNK = 50

FindingSort = Literal[
    "confidence_desc",
    "confidence_asc",
    "created_desc",
    "name_asc",
    "name_desc",
    "category_asc",
    "category_desc",
    "objective_asc",
    "objective_desc",
    "proposed_asc",
    "proposed_desc",
]

CATEGORY_PATH_SEPARATOR = " › "


def _category_paths() -> CTE:
    """Recursive CTE of ``(id, path)``, e.g. ``Hematology › Blood films``."""
    root = (
        select(Category.id.label("id"), cast(Category.label, Text).label("path"))
        .where(Category.parent_id.is_(None))
        .cte("category_paths", recursive=True)
    )
    child = aliased(Category)
    return root.union_all(
        select(
            child.id,
            cast(root.c.path + literal(CATEGORY_PATH_SEPARATOR) + child.label, Text),
        ).join(root, child.parent_id == root.c.id)
    )


def _order_by(
    sort: str, path: CTE, status: str = "pending"
) -> tuple[ColumnElement, ...]:
    """Sort columns; ties fall back to image name so related rows stay together."""
    key, direction = sort.rsplit("_", 1)
    if key == "created":
        return (MeasurementFinding.id.desc(),)
    column = {
        "confidence": MeasurementFinding.confidence,
        "name": func.lower(Image.name),
        "category": func.lower(path.c.path),
        # Approved rows show the objective the approval wrote, so sort on that.
        "objective": cast(
            MeasurementFinding.approved_objective
            if status == "approved"
            else MeasurementFinding.objective,
            Float,
        ),
        "proposed": MeasurementFinding.proposed_scale,
    }[key]
    ordered = column.asc() if direction == "asc" else column.desc()
    return (ordered.nulls_last(), func.lower(Image.name), MeasurementFinding.id)


async def _category_path(db: AsyncSession, image: Image) -> str | None:
    if image.category_id is None:
        return None
    paths = _category_paths()
    return await db.scalar(select(paths.c.path).where(paths.c.id == image.category_id))


def _out(
    finding: MeasurementFinding, image: Image, category_path: str | None = None
) -> MeasurementFindingOut:
    return MeasurementFindingOut(
        id=finding.id,
        image_id=image.id,
        image_name=image.name,
        image_thumb=image.thumb,
        category_id=image.category_id,
        category_path=category_path,
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
        approved_objective=finding.approved_objective,
        objective_scales=CAMERA_PROFILES.get((image.width or 0, image.height or 0)),
        params=finding.params,
        reviewed_by=finding.reviewed_by,
        reviewed_at=finding.reviewed_at,
        created_at=finding.created_at,
    )


async def _enqueue_scan(
    image_ids: list[int],
    background_tasks: BackgroundTasks,
    user: User,
    rescan: bool,
) -> MeasurementScanOut:
    """Queue ``image_ids`` for scanning, chunked so no job runs for hours.

    Queue-unavailable chunks run in-process (local mode) so a Redis blip
    mid-enqueue never drops images; ``required`` mode surfaces 503 instead.
    """
    if not image_ids:
        return MeasurementScanOut(image_ids=[], mode="queued")
    chunks = [
        image_ids[i : i + _SCAN_JOB_CHUNK]
        for i in range(0, len(image_ids), _SCAN_JOB_CHUNK)
    ]
    fallback_ids: list[int] = []
    accepted = 0
    try:
        for chunk in chunks:
            result = await enqueue_measurement_scan(chunk, rescan)
            if result.queued:
                accepted += len(chunk)
            else:
                fallback_ids.extend(chunk)
    except TaskQueueUnavailableError as exc:
        # Required-mode contract: never run scans on the API process during
        # a queue outage. Earlier chunks stay queued — disclose that partial
        # acceptance so a retry isn't assumed to start from zero (re-scan
        # work is idempotent per image: it just supersedes again).
        detail = "task_queue_unavailable"
        if accepted or fallback_ids:
            detail += f"; {accepted + len(fallback_ids)} images already accepted"
        raise HTTPException(status_code=503, detail=detail) from exc
    mode = "fallback" if not accepted else "queued"
    if fallback_ids:
        background_tasks.add_task(scan_images, async_session, fallback_ids, rescan)
    logger.info(
        "Measurement scan requested",
        extra={
            "event": "measurement.scan_requested",
            "image_count": len(image_ids),
            "mode": mode,
            "rescan": rescan,
            "job_count": len(chunks),
            **actor_log_fields(user),
        },
    )
    return MeasurementScanOut(image_ids=image_ids, mode=mode)


@router.post("/scan", response_model=MeasurementScanOut, status_code=202)
async def scan(
    body: MeasurementScanRequest,
    background_tasks: BackgroundTasks,
    user: _Reviewer,
    db: AsyncSession = Depends(get_db),
) -> MeasurementScanOut:
    """Queue images for detection.

    Default: the next ``limit`` images with no live finding. ``rescan``
    instead picks unscaled images lacking a current-detector finding (and
    supersedes their old findings when they are processed). ``all`` queues
    every candidate, ignoring ``limit``.
    """
    stmt = rescan_candidates_stmt if body.rescan else scan_candidates_stmt
    image_ids = list(
        (await db.execute(stmt(None if body.all else body.limit, body.category_id)))
        .scalars()
    )
    return await _enqueue_scan(image_ids, background_tasks, user, body.rescan)


@router.get("/scan-remaining", response_model=MeasurementScanRemainingOut)
async def scan_remaining(
    _user: _Reviewer,
    db: AsyncSession = Depends(get_db),
    rescan: bool = False,
    category_id: int | None = None,
    max_image_id: int | None = None,
) -> MeasurementScanRemainingOut:
    """How many scan candidates are still unprocessed (whole-scan progress).

    ``max_image_id`` bounds the count to the images a scan submission
    actually covered — newer uploads must not hold its progress open.
    """
    stmt = rescan_candidates_stmt if rescan else scan_candidates_stmt
    stmt = stmt(None, category_id)
    if max_image_id is not None:
        stmt = stmt.where(Image.id <= max_image_id)
    remaining = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    return MeasurementScanRemainingOut(remaining=remaining or 0)


@router.get("/scan-progress", response_model=MeasurementScanProgressOut)
async def scan_progress(
    _user: _Reviewer,
    db: AsyncSession = Depends(get_db),
    image_ids: list[int] = Query(..., min_length=1, max_length=200),
    min_finding_id: int | None = None,
) -> MeasurementScanProgressOut:
    """How many of a scan's images have been processed (a live finding, or deleted).

    ``min_finding_id`` counts only findings newer than that row, which lets a
    re-scan be tracked past the finding it supersedes.
    """
    ids = set(image_ids)
    filters = [
        MeasurementFinding.image_id.in_(ids),
        MeasurementFinding.status != "superseded",
    ]
    if min_finding_id is not None:
        filters.append(MeasurementFinding.id > min_finding_id)
    scanned = set(
        (
            await db.execute(
                select(MeasurementFinding.image_id).where(*filters).distinct()
            )
        ).scalars()
    )
    present = set((await db.execute(select(Image.id).where(Image.id.in_(ids)))).scalars())
    return MeasurementScanProgressOut(total=len(ids), done=len(scanned | (ids - present)))


@router.get("", response_model=MeasurementFindingsPageOut)
async def list_findings(
    _user: _Reviewer,
    db: AsyncSession = Depends(get_db),
    status: Literal["pending", "approved", "rejected", "superseded"] = "pending",
    category_id: int | None = None,
    min_confidence: float | None = Query(default=None, ge=0, le=1),
    sort: FindingSort = "confidence_desc",
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> MeasurementFindingsPageOut:
    filters = [MeasurementFinding.status == status]
    if status == "pending":
        # Approval is refused once an image has a scale, so hide those rows.
        filters.append(~has_scale_sql())
    if category_id is not None:
        filters.append(Image.category_id == category_id)
    if min_confidence is not None:
        filters.append(MeasurementFinding.confidence >= min_confidence)
    paths = _category_paths()
    base = (
        select(MeasurementFinding, Image, paths.c.path)
        .join(Image, Image.id == MeasurementFinding.image_id)
        .outerjoin(paths, paths.c.id == Image.category_id)
        .where(*filters)
    )
    total = await db.scalar(
        select(func.count()).select_from(base.subquery())
    )
    rows = (
        await db.execute(
            base.order_by(*_order_by(sort, paths, status)).limit(limit).offset(offset)
        )
    ).all()
    return MeasurementFindingsPageOut(
        items=[_out(f, img, path) for f, img, path in rows], total=total or 0
    )


@router.get("/categories", response_model=list[MeasurementFindingCategoryOut])
async def list_finding_categories(
    _user: _Reviewer,
    db: AsyncSession = Depends(get_db),
    status: Literal["pending", "approved", "rejected", "superseded"] = "pending",
) -> list[MeasurementFindingCategoryOut]:
    """Categories holding findings in ``status``, for the review page's filter."""
    filters = [MeasurementFinding.status == status, Image.category_id.is_not(None)]
    if status == "pending":
        filters.append(~has_scale_sql())
    paths = _category_paths()
    rows = (
        await db.execute(
            select(paths.c.id, paths.c.path, func.count(MeasurementFinding.id))
            .select_from(MeasurementFinding)
            .join(Image, Image.id == MeasurementFinding.image_id)
            .join(paths, paths.c.id == Image.category_id)
            .where(*filters)
            .group_by(paths.c.id, paths.c.path)
            .order_by(func.lower(paths.c.path))
        )
    ).all()
    return [
        MeasurementFindingCategoryOut(id=cid, path=path, count=count)
        for cid, path, count in rows
    ]


async def _pending_with_image(
    db: AsyncSession, finding_id: int
) -> tuple[MeasurementFinding, Image]:
    finding, image = await _lock_finding_and_image(db, finding_id)
    if finding is None:
        raise HTTPException(status_code=404, detail="Finding not found")
    if finding.status != "pending":
        raise HTTPException(status_code=409, detail=f"Finding is {finding.status}")
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found")
    return finding, image


async def _lock_finding_and_image(
    db: AsyncSession, finding_id: int
) -> tuple[MeasurementFinding | None, Image | None]:
    """Lock image before finding, the same order as image replacement."""
    finding = await db.get(MeasurementFinding, finding_id)
    if finding is None:
        return None, None
    image = await db.get(Image, finding.image_id, with_for_update=True)
    finding = await db.get(
        MeasurementFinding, finding_id, with_for_update=True, populate_existing=True
    )
    return finding, image


async def _bump_if_browsable(db: AsyncSession, images: list[Image]) -> None:
    # Mirrors update_image: uncategorized images still render via collections.
    if any(img.category_id is not None for img in images) or await image_ids_in_collections(
        db, {img.id for img in images}
    ):
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
    superseded = False
    for finding_id in dict.fromkeys(body.ids):
        finding, image = await _lock_finding_and_image(db, finding_id)
        if (
            finding is None
            or image is None
            or finding.status != "pending"
            or finding.proposed_scale is None
        ):
            skipped.append(finding_id)
            continue
        if has_scale(image.metadata_):
            finding.status = "superseded"
            superseded = True
            skipped.append(finding_id)
            continue
        await approve_finding(db, finding, image, user.id, objective=finding.objective)
        approved.append(finding_id)
        touched.append(image)
    if approved:
        await _bump_if_browsable(db, touched)
    if approved or superseded:
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
    if has_scale(image.metadata_):
        # The stored value is authoritative; retire the stale proposal.
        finding.status = "superseded"
        await db.commit()
        raise HTTPException(status_code=409, detail="Image already has a scale")
    body = body or MeasurementApprove()
    try:
        objective = (
            body.objective
            if "objective" in body.model_fields_set
            else finding.objective
        )
        await approve_finding(
            db, finding, image, user.id, body.scale, body.unit, objective
        )
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
            "edited": image.metadata_.get("measurement_scale_source") == "manual",
            **actor_log_fields(user),
        },
    )
    return _out(finding, image, await _category_path(db, image))


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
    return _out(finding, image, await _category_path(db, image))


@router.post("/{finding_id}/reset", response_model=MeasurementFindingOut)
async def reset(
    finding_id: int,
    user: _Reviewer,
    db: AsyncSession = Depends(get_db),
) -> MeasurementFindingOut:
    """Return an approved or rejected finding to pending.

    Reverting an approval also strips the scale it wrote; see
    :func:`reset_finding` for when metadata is and is not touched.
    """
    finding, image = await _lock_finding_and_image(db, finding_id)
    if finding is None:
        raise HTTPException(status_code=404, detail="Finding not found")
    if finding.status not in ("approved", "rejected"):
        raise HTTPException(status_code=409, detail=f"Finding is {finding.status}")
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found")
    if await db.scalar(
        select(MeasurementFinding.id)
        .where(
            MeasurementFinding.image_id == image.id,
            MeasurementFinding.status == "pending",
            MeasurementFinding.id != finding.id,
        )
        .limit(1)
    ):
        # A newer proposal is already waiting; this row stays history.
        raise HTTPException(
            status_code=409, detail="Image already has a pending finding"
        )
    stripped = reset_finding(finding, image)
    if stripped:
        await _bump_if_browsable(db, [image])
    try:
        await db.commit()
    except IntegrityError:
        # A pending finding slipped in concurrently; unique index held.
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="Image already has a pending finding"
        )
    await db.refresh(finding)
    logger.info(
        "Measurement finding reset to pending",
        extra={
            "event": "measurement.reset",
            "finding_id": finding.id,
            "image_id": image.id,
            "metadata_stripped": stripped,
            **actor_log_fields(user),
        },
    )
    return _out(finding, image, await _category_path(db, image))


@router.post("/{finding_id}/rescan", response_model=MeasurementScanOut, status_code=202)
async def rescan(
    finding_id: int,
    background_tasks: BackgroundTasks,
    user: _Reviewer,
    db: AsyncSession = Depends(get_db),
) -> MeasurementScanOut:
    """Re-run detection on the finding's image; its live findings are superseded."""
    finding = await db.get(MeasurementFinding, finding_id)
    if finding is None:
        raise HTTPException(status_code=404, detail="Finding not found")
    return await _enqueue_scan(
        [finding.image_id], background_tasks, user, rescan=True
    )


@router.post("/{finding_id}/preview", response_model=DetectionPreviewOut)
async def preview(
    finding_id: int,
    user: _Reviewer,
    body: MeasurementPreviewRequest | None = None,
    db: AsyncSession = Depends(get_db),
) -> DetectionPreviewOut:
    """Re-run RBC detection under candidate tuning — read-only (#1867).

    Powers the tuning dialog's live feedback; works on any non-superseded
    finding whose image still exists. Nothing is written — saving the
    tuning is PATCH's job.
    """
    finding = await db.get(MeasurementFinding, finding_id)
    if finding is None:
        raise HTTPException(status_code=404, detail="Finding not found")
    if finding.status == "superseded":
        raise HTTPException(status_code=409, detail="Finding is superseded")
    image = await db.get(Image, finding.image_id)
    if image is None:
        raise HTTPException(status_code=404, detail="Image not found")
    body = body or MeasurementPreviewRequest()
    measurement, estimate, reason = await preview_detection(
        db, image, body.tuning.to_detector_params()
    )
    return DetectionPreviewOut(
        diameter_px=measurement.diameter_px if measurement else None,
        component_count=measurement.component_count if measurement else None,
        selected_count=measurement.selected_count if measurement else None,
        peak_fraction=measurement.peak_fraction if measurement else None,
        proposed_scale=estimate.scale if estimate else None,
        proposed_unit="um",
        objective=estimate.objective if estimate else None,
        confidence=estimate.confidence if estimate else 0.0,
        reason=reason,
    )


@router.patch("/{finding_id}", response_model=MeasurementFindingOut)
async def update_finding(
    finding_id: int,
    body: MeasurementFindingUpdate,
    user: _Reviewer,
    db: AsyncSession = Depends(get_db),
) -> MeasurementFindingOut:
    """Persist tuned detection params on a pending finding (#1867).

    Reviewed findings are immutable — retuning history means nothing, so
    approved/rejected/superseded rows 409. Approval later promotes the
    params into ``Image.metadata_.detection_params`` (#1869).

    The proposal is re-run under the saved tuning in the same write: a
    stored proposal that predates the params would let approval promote a
    scale the reviewer never previewed (#1871 review).
    """
    finding, image = await _pending_with_image(db, finding_id)
    finding.params = (
        body.params.model_dump() if body.params is not None else None
    )
    _measurement, estimate, reason = await preview_detection(
        db,
        image,
        body.params.to_detector_params() if body.params is not None else None,
    )
    evidence: dict = {}
    if reason is not None:
        evidence["reason"] = reason
    finding.proposed_scale = estimate.scale if estimate else None
    finding.objective = estimate.objective if estimate else None
    finding.confidence = estimate.confidence if estimate else 0.0
    finding.evidence = (estimate.evidence if estimate else {}) | evidence
    await db.commit()
    await db.refresh(finding)
    logger.info(
        "Measurement finding params updated",
        extra={
            "event": "measurement.params_update",
            "finding_id": finding.id,
            "image_id": image.id,
            "has_params": finding.params is not None,
            **actor_log_fields(user),
        },
    )
    return _out(finding, image, await _category_path(db, image))
