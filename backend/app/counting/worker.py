"""Dedicated arq worker for object-count jobs (epic #1661).

Run with:  opentelemetry-instrument arq app.counting.worker.CountingWorkerSettings

The counting worker is deliberately separate from ``app.worker``'s
``WorkerSettings``: it consumes its own queue (``COUNTING_QUEUE_NAME``)
with ``max_jobs=1`` so ML work never delays tile processing. Until the real
models land (#1665) the pipeline runs :class:`StubOutliner`, which produces
deterministic synthetic outlines — enough for the frontend job lifecycle
and the API contract to be exercised end-to-end.

Trace context propagation matches ``app.worker``: the API serialises the
W3C context into the arq job's *carrier* argument; here it is re-attached
so enqueue -> execute appears as one distributed trace.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from typing import Any

from arq.constants import health_check_key_suffix
from arq.worker import func
from opentelemetry import trace
from opentelemetry.context import attach, detach
from opentelemetry.propagate import extract

from ..component_versions import get_worker_version
from ..database import settings
from ..logging_config import setup_logging
from ..queue_metrics import HEALTH_CHECK_INTERVAL_SECONDS
from ..worker import _parse_redis_settings
from . import jobs, pipeline
from .outliners import Outliner, build_outliners
from .stitch import CountingRegionError

logger = logging.getLogger(__name__)
tracer = trace.get_tracer(__name__)

# Stitch-domain error codes -> result-contract ``error`` values. Unknown
# failures collapse to ``internal`` — stack traces never reach clients.
_ERROR_CODE_MAP = {
    "invalid_selection": "internal",
    "selection_too_large": "too_large",
    "no_tiles": "no_tiles",
    "too_many_objects": "too_many_objects",
}


async def count_objects_task(
    ctx: dict[str, Any], job_id: str, carrier: dict[str, str] | None = None
) -> None:
    """arq task: run one count job end-to-end."""
    parent_ctx = extract(carrier) if carrier else None
    token = attach(parent_ctx) if parent_ctx else None
    try:
        with tracer.start_as_current_span(
            "count_objects_task", attributes={"count.job_id": job_id}
        ):
            await _run(ctx, job_id)
    finally:
        if token is not None:
            detach(token)


async def _run(ctx: dict[str, Any], job_id: str) -> None:
    redis = ctx["redis"]
    record = await jobs.get_record(redis, job_id)
    if record is None:
        # Cancelled (record deleted) or expired before the worker dequeued.
        return

    mode = str(record.get("mode", ""))
    image_id = record.get("image_id")
    started = time.monotonic()
    outliners: dict[str, Outliner] = ctx.get("outliners") or {}
    outliner = outliners.get(record.get("mode", "cells"))
    if outliner is None:
        # No silent stub fallback — a misconfigured worker must fail the job
        # with `internal`, never return fabricated counts.
        logger.error(
            "count job has no configured outliner",
            extra={"event": "count.failed", "job_id": job_id,
                   "mode": record.get("mode")},
        )
        await _fail(
            redis, job_id, record, record.get("mode", "cells"),
            image_id, started, "internal",
        )
        return
    logger.info(
        "count job started",
        extra={
            "event": "count.started",
            "job_id": job_id,
            "image_id": image_id,
            "mode": mode,
        },
    )
    if not await jobs.update_status(redis, job_id, jobs.STATUS_RUNNING):
        return  # cancelled between dequeue and status flip

    loop = asyncio.get_running_loop()
    # Set when arq cancels the task (timeout/abort) so the pipeline thread
    # stops at its next stage boundary.
    stop = threading.Event()

    def is_cancelled() -> bool:
        """Blocking cancellation probe for the pipeline thread."""
        if stop.is_set():
            return True
        future = asyncio.run_coroutine_threadsafe(
            jobs.record_exists(redis, job_id), loop
        )
        return not future.result(timeout=10)

    work = asyncio.ensure_future(
        asyncio.to_thread(
            pipeline.run_count,
            record,
            tiles_dir=settings.tiles_dir,
            outliner=outliner,
            margin_px=settings.counting_margin_px,
            max_pixels=outliner.max_pixels,
            max_downsample=settings.counting_max_downsample,
            max_objects=settings.counting_max_objects,
            is_cancelled=is_cancelled,
        )
    )
    try:
        result = await asyncio.shield(work)
    except pipeline.JobCancelled:
        return
    except asyncio.CancelledError:
        # A thread can't be interrupted, so hold this job slot until the
        # pipeline thread exits; otherwise arq (max_jobs=1) would start the
        # next job while this one still burns CPU and memory.
        stop.set()
        await asyncio.wait({work})
        # arq timeout or abort: a user DELETE removes the record, so a still-
        # present record means the job timed out.
        if await jobs.record_exists(redis, job_id):
            await jobs.update_status(
                redis, job_id, jobs.STATUS_FAILED, error="timeout"
            )
        raise
    except CountingRegionError as exc:
        await _fail(redis, job_id, record, mode, image_id, started,
                    _ERROR_CODE_MAP.get(exc.code, "internal"))
        return
    except Exception:
        logger.exception(
            "count job failed unexpectedly",
            extra={"event": "count.failed", "job_id": job_id,
                   "image_id": image_id, "mode": mode},
        )
        await _fail(redis, job_id, record, mode, image_id, started, "internal")
        raise

    meta = result.pop("_meta", {})
    duration_ms = round((time.monotonic() - started) * 1000)
    await jobs.write_result(
        redis, job_id, result, settings.counting_result_ttl_seconds
    )
    if not await jobs.update_status(redis, job_id, jobs.STATUS_DONE):
        return  # cancelled between pipeline end and status flip
    jobs.record_count_job(mode, jobs.COUNT_OUTCOME_DONE)
    logger.info(
        "count job completed",
        extra={
            "event": "count.completed",
            "job_id": job_id,
            "image_id": image_id,
            "mode": mode,
            "total": result.get("total"),
            "duration_ms": duration_ms,
            "level": meta.get("level"),
            "downsample": meta.get("downsample"),
            "pixels": meta.get("pixels"),
            "outliner": meta.get("outliner"),
        },
    )


async def _fail(
    redis,
    job_id: str,
    record: dict[str, Any],
    mode: str,
    image_id: Any,
    started: float,
    code: str,
) -> None:
    """Mark the job failed with a public error code (never a trace)."""
    updated = await jobs.update_status(
        redis, job_id, jobs.STATUS_FAILED, error=code
    )
    if not updated:
        return  # record vanished — nothing left to mark
    jobs.record_count_job(mode, jobs.COUNT_OUTCOME_FAILED)
    logger.warning(
        "count job failed",
        extra={
            "event": "count.failed",
            "job_id": job_id,
            "image_id": image_id,
            "mode": mode,
            "error": code,
            "duration_ms": round((time.monotonic() - started) * 1000),
        },
    )


async def on_startup(ctx: dict[str, Any]) -> None:
    """Initialise logging and build the configured outliners once.

    A configured outliner that can't load (e.g. torch missing for
    ``instanseg``) fails startup LOUDLY: no heartbeat is published, so the
    API answers ``counting_unavailable`` — the correct signal for a
    broken worker rather than silently degraded counts.
    """
    setup_logging()
    import numpy as np

    from .stitch import Rect, RegionPlan

    ctx["outliners"] = build_outliners(
        cells=settings.counting_cells_outliner,
        nuclei=settings.counting_nuclei_outliner,
        torch_threads=settings.counting_torch_threads,
        max_pixels=settings.counting_max_pixels,
        classical_max_pixels=settings.counting_classical_max_pixels,
    )
    # Warm up each outliner once so first-job latency excludes model init.
    warmup = np.zeros((64, 64, 3), dtype=np.uint8)
    warm_plan = RegionPlan(
        level=0,
        downsample=1,
        selection=Rect(0, 0, 64, 64),
        region=Rect(0, 0, 64, 64),
        level_rect=Rect(0, 0, 64, 64),
        out_width=64,
        out_height=64,
    )
    for mode, outliner in ctx["outliners"].items():
        outliner.segment(warmup, plan=warm_plan, mpp=None)
    logger.info(
        "arq counting worker started",
        extra={
            "event": "worker.started",
            "service.name": os.environ.get(
                "OTEL_SERVICE_NAME", "hriv-counting-worker"
            ),
            "service.version": get_worker_version(),
            "outliners": {m: o.name for m, o in ctx["outliners"].items()},
            "queue_name": settings.counting_queue_name,
        },
    )


class CountingWorkerSettings:
    """Configuration class consumed by ``arq worker`` (#1664/#1665)."""

    functions = [
        func(
            count_objects_task,
            timeout=settings.counting_job_timeout_seconds,
            max_tries=1,
        ),
    ]
    redis_settings = _parse_redis_settings()
    queue_name = settings.counting_queue_name
    health_check_key = settings.counting_queue_name + health_check_key_suffix
    health_check_interval = int(HEALTH_CHECK_INTERVAL_SECONDS)
    on_startup = on_startup
    # One job per process: ML inference (#1665) pins torch threads, and the
    # burst-capacity requirement is met by scaling replicas, not per-process
    # concurrency.
    max_jobs = 1
    allow_abort_jobs = True
    keep_result = 0
