"""Ephemeral object-count jobs API (epic #1661, issue #1664).

Any authenticated role may count objects in a selection on an image they
can view — the same gate as ``GET /api/images/{id}`` (404, never 403).
Jobs are Redis-only (no DB tables): a JSON record plus result with a short
TTL. The API only validates and enqueues; counting runs on the dedicated
counting worker, never in-process in the API pod.

The whole surface is dark-launched: ``CountingFeatureMiddleware`` answers
404 for ``/api/counts*`` and ``/api/images/{id}/counts`` while
``COUNTING_ENABLED`` is off, and ``require_counting_enabled`` keeps the
same 404 as a router-level second layer.
"""

import contextlib
import logging
import uuid
from typing import Annotated

from arq.constants import health_check_key_suffix
from arq.jobs import Job
from fastapi import APIRouter, Depends, Header, HTTPException, Response
from opentelemetry import trace
from opentelemetry.propagate import inject
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..auth_events import actor_log_fields
from ..counting import jobs
from ..counting.stitch import (
    InvalidSelection,
    MissingTiles,
    Rect,
    RegionTooLarge,
    plan_region,
    read_dzi,
    resolve_tile_root,
)
from ..database import get_db, settings
from ..counting.budgets import pixel_budget
from ..models import User
from ..processing import _tile_source_id_from_url, tiles_present_on_disk
from ..schemas import (
    CountCreate,
    CountJobCreatedOut,
    CountJobOut,
    CountSelection,
)
from ..tracing import record_exception_if_server_error
from ..worker import get_pool
from .images import _get_visible_image

logger = logging.getLogger(__name__)
tracer = trace.get_tracer(__name__)


def require_counting_enabled() -> None:
    """Router-wide gate for the ``COUNTING_ENABLED`` dark-launch flag.

    Same 404 as an unknown route while the feature is off, mirroring
    ``require_collections_enabled``. Evaluated per request so tests and
    operators can flip it without rebuilding the app.
    """
    if not settings.counting_enabled:
        raise HTTPException(status_code=404, detail="Not Found")


# A cached pool can outlive Redis; connection/timeout failures on counting
# operations surface as the stable 503 rather than a 500.
_REDIS_ERRORS = (RedisError, OSError)


def _unavailable() -> HTTPException:
    return HTTPException(status_code=503, detail="counting_unavailable")


router = APIRouter(
    tags=["counts"],
    dependencies=[Depends(require_counting_enabled)],
)


def _counting_health_key() -> str:
    return settings.counting_queue_name + health_check_key_suffix


def _reject(mode: str, reason: str, *, job_id: str | None = None,
            image_id: int | None = None) -> None:
    """Structured rejection log + metric before raising an HTTP error."""
    jobs.record_count_job(mode, _outcome_for_reason(reason), reason=reason)
    logger.info(
        "count job rejected",
        extra={
            "event": "count.rejected",
            "reason": reason,
            "job_id": job_id,
            "image_id": image_id,
            "mode": mode,
        },
    )


def _outcome_for_reason(reason: str) -> str:
    return {
        "selection_too_large": jobs.COUNT_OUTCOME_REJECTED_TOO_LARGE,
        "too_many_active_counts": jobs.COUNT_OUTCOME_REJECTED_RATE_LIMITED,
        "counting_unavailable": jobs.COUNT_OUTCOME_QUEUE_UNAVAILABLE,
    }.get(reason, "rejected")


@router.post("/images/{image_id}/counts", status_code=202,
             response_model=CountJobCreatedOut)
async def create_count(
    image_id: int,
    body: CountCreate,
    user: Annotated[User, Depends(get_current_user)],
    x_client_synthetic: Annotated[bool, Header(alias="X-Client-Synthetic")] = False,
    db: AsyncSession = Depends(get_db),
) -> CountJobCreatedOut:
    """Validate a selection and enqueue an ephemeral count job (202)."""
    with tracer.start_as_current_span("count.create") as span:
        try:
            span.set_attribute("image.id", image_id)
            span.set_attribute("count.mode", body.mode)
            img = await _get_visible_image(db, user, image_id)

            # Local tiles are required: external/catalogued DZI URLs and
            # not-yet-generated pyramids can't be stitched server-side.
            source_image_id = _tile_source_id_from_url(img.tile_sources)
            if (
                not img.active
                or source_image_id is None
                or not tiles_present_on_disk(settings.tiles_dir, source_image_id)
            ):
                _reject(body.mode, "tiles_not_ready", image_id=image_id)
                raise HTTPException(status_code=409, detail="tiles_not_ready")

            # Cheap pre-flight validation — the worker re-plans identically
            # before stitching, so both sides share ``plan_region``.
            try:
                tile_root = resolve_tile_root(
                    settings.tiles_dir, source_image_id
                )
                dzi = read_dzi(tile_root)
                plan_region(
                    dzi,
                    Rect(
                        x=body.selection.x,
                        y=body.selection.y,
                        width=body.selection.width,
                        height=body.selection.height,
                    ),
                    margin_px=settings.counting_margin_px,
                    # Mode-aware budget: the pre-flight uses the budget of
                    # the outliner configured for this mode, so a nuclei
                    # selection can't queue on the classical budget and
                    # then fail in the InstanSeg worker.
                    max_pixels=pixel_budget(
                        settings.counting_cells_outliner
                        if body.mode == "cells"
                        else settings.counting_nuclei_outliner,
                        max_pixels=settings.counting_max_pixels,
                        classical_max_pixels=settings.counting_classical_max_pixels,
                    ),
                    max_downsample=settings.counting_max_downsample,
                )
            except InvalidSelection as exc:
                raise HTTPException(
                    status_code=422, detail="invalid_selection"
                ) from exc
            except RegionTooLarge as exc:
                _reject(body.mode, "selection_too_large", image_id=image_id)
                raise HTTPException(
                    status_code=422, detail="selection_too_large"
                ) from exc
            except MissingTiles as exc:
                _reject(body.mode, "tiles_not_ready", image_id=image_id)
                raise HTTPException(
                    status_code=409, detail="tiles_not_ready"
                ) from exc

            pool = await get_pool()
            worker_live = False
            if pool is not None:
                try:
                    worker_live = (
                        await pool.ttl(_counting_health_key()) != -2
                    )
                except _REDIS_ERRORS:
                    worker_live = False
            if not worker_live:
                _reject(body.mode, "counting_unavailable", image_id=image_id)
                raise _unavailable()

            job_id = uuid.uuid4().hex
            # The record exists before the cap reservation and the enqueue:
            # the reservation's verification counts its own queued record
            # (otherwise it would prune itself as a dead member), and a fast
            # worker can never observe an enqueued job with no record.
            try:
                await jobs.create_record(
                    pool,
                    job_id=job_id,
                    user_id=user.id,
                    image_id=image_id,
                    source_image_id=source_image_id,
                    mode=body.mode,
                    selection=body.selection.model_dump(),
                    mpp=(
                        mpp_val
                        if isinstance(
                            (mpp_val := (getattr(img, "metadata_", None) or {}).get("mpp_x")),
                            (int, float),
                        )
                        and mpp_val > 0
                        else None
                    ),
                    ttl_seconds=settings.counting_result_ttl_seconds,
                )
                reserved = await jobs.reserve_active_slot(
                    pool,
                    user_id=user.id,
                    job_id=job_id,
                    cap=settings.counting_max_active_per_user,
                    ttl_seconds=settings.counting_result_ttl_seconds,
                )
            except _REDIS_ERRORS as exc:
                _reject(body.mode, "counting_unavailable",
                        job_id=job_id, image_id=image_id)
                raise _unavailable() from exc
            if not reserved:
                await jobs.delete_job(pool, job_id=job_id, user_id=user.id)
                _reject(body.mode, "too_many_active_counts",
                        job_id=job_id, image_id=image_id)
                raise HTTPException(
                    status_code=429,
                    detail="too_many_active_counts",
                    headers={"Retry-After": "10"},
                )
            carrier: dict[str, str] = {}
            inject(carrier)
            try:
                await pool.enqueue_job(
                    "count_objects_task",
                    job_id,
                    carrier,
                    _job_id=job_id,
                    _queue_name=settings.counting_queue_name,
                    _expires=settings.counting_result_ttl_seconds,
                )
            except Exception as exc:
                with contextlib.suppress(*_REDIS_ERRORS):
                    await jobs.delete_job(pool, job_id=job_id, user_id=user.id)
                _reject(body.mode, "counting_unavailable",
                        job_id=job_id, image_id=image_id)
                raise _unavailable() from exc

            jobs.record_count_job(body.mode, jobs.COUNT_OUTCOME_ENQUEUED)
            logger.info(
                "count job enqueued",
                extra={
                    "event": "count.enqueued",
                    "job_id": job_id,
                    "image_id": image_id,
                    "mode": body.mode,
                    **actor_log_fields(
                        user, client_synthetic=x_client_synthetic
                    ),
                },
            )
            try:
                position = await jobs.queue_position(
                    pool,
                    job_id=job_id,
                    queue_name=settings.counting_queue_name,
                )
            except _REDIS_ERRORS:
                position = None  # job is enqueued; the first poll reports it
            return CountJobCreatedOut(
                job_id=job_id, status="queued", queue_position=position
            )
        except Exception as exc:
            record_exception_if_server_error(span, exc)
            raise


@router.get("/counts/{job_id}", response_model=CountJobOut)
async def get_count(
    job_id: str,
    user: Annotated[User, Depends(get_current_user)],
) -> CountJobOut:
    """Poll a count job. Owner only — anyone else (or expiry) reads 404."""
    pool = await get_pool()
    if pool is None:
        raise _unavailable()
    try:
        record = await jobs.get_record(pool, job_id)
        if record is None or record.get("user_id") != user.id:
            raise HTTPException(status_code=404, detail="Not Found")

        position = None
        if record.get("status") == jobs.STATUS_QUEUED:
            position = await jobs.queue_position(
                pool, job_id=job_id, queue_name=settings.counting_queue_name
            )

        result: dict = {}
        if record.get("status") == jobs.STATUS_DONE:
            result = await jobs.get_result(pool, job_id) or {}
    except _REDIS_ERRORS as exc:
        raise _unavailable() from exc

    return CountJobOut(
        job_id=job_id,
        status=record.get("status", "queued"),
        queue_position=position,
        mode=record.get("mode", "cells"),
        selection=CountSelection(**record.get("selection", {})),
        total=result.get("total"),
        groups=result.get("groups") or [],
        objects=result.get("objects") or [],
        error=record.get("error"),
        preview=result.get("preview"),
    )


@router.delete("/counts/{job_id}", status_code=204)
async def delete_count(
    job_id: str,
    user: Annotated[User, Depends(get_current_user)],
    x_client_synthetic: Annotated[bool, Header(alias="X-Client-Synthetic")] = False,
) -> Response:
    """Cancel a count job and destroy its keys. Idempotent: 204 always.

    A missing record (expired or already deleted) still answers 204; a
    record owned by someone else answers 404, indistinguishable from never
    having existed.
    """
    pool = await get_pool()
    if pool is None:
        raise _unavailable()
    try:
        record = await jobs.get_record(pool, job_id)
        if record is None:
            return Response(status_code=204)
        if record.get("user_id") != user.id:
            raise HTTPException(status_code=404, detail="Not Found")

        # Abort the arq job first (best-effort — a finished or never-dequeued
        # job may already be gone), then destroy the keys so any late worker
        # write fails its ``XX KEEPTTL`` check.
        job = Job(job_id, pool, _queue_name=settings.counting_queue_name)
        try:
            await job.abort(timeout=0)
        except Exception:
            logger.debug(
                "count job abort did not confirm; deleting keys anyway",
                extra={"event": "count.abort_unconfirmed", "job_id": job_id},
                exc_info=True,
            )
        await jobs.delete_job(pool, job_id=job_id, user_id=user.id)
    except _REDIS_ERRORS as exc:
        raise _unavailable() from exc
    jobs.record_count_job(str(record.get("mode", "")), jobs.COUNT_OUTCOME_CANCELLED)
    logger.info(
        "count job cancelled",
        extra={
            "event": "count.cancelled",
            "job_id": job_id,
            "image_id": record.get("image_id"),
            "mode": record.get("mode"),
            **actor_log_fields(user, client_synthetic=x_client_synthetic),
        },
    )
    return Response(status_code=204)
