"""End-to-end tests for the counting arq task (stub worker, #1664).

Runs ``count_objects_task`` against fakeredis plus a real small ``dzsave``
pyramid, covering the status machine, the result contract, cancellation
semantics and ``CountingWorkerSettings``.
"""

import asyncio
import base64
from unittest.mock import Mock

import pyvips
import pytest
from fakeredis import aioredis as fake_aioredis

from app.counting import jobs, pipeline
from app.counting.outliners import StubOutliner

STUB_OUTLINERS = {"cells": StubOutliner(), "nuclei": StubOutliner()}
from app.counting.worker import (
    CountingWorkerSettings,
    count_objects_task,
    on_startup,
)
from app.database import settings

SID = 9
SELECTION = {"x": 60, "y": 60, "width": 180, "height": 180}


@pytest.fixture(scope="module")
def worker_tiles(tmp_path_factory):
    """Real 400x400 pyramid for source image 9."""
    base = tmp_path_factory.mktemp("count-worker-tiles")
    src = pyvips.Image.black(400, 400).new_from_image([150, 170, 190])
    root = base / str(SID)
    root.mkdir()
    src.dzsave(
        str(root / "image"),
        tile_size=254,
        overlap=1,
        suffix=".png",
    )
    return base


@pytest.fixture
async def pool():
    pool = fake_aioredis.FakeRedis(decode_responses=True)
    yield pool
    await pool.aclose()


@pytest.fixture
def worker_settings(monkeypatch, worker_tiles):
    monkeypatch.setattr(settings, "tiles_dir", str(worker_tiles))
    monkeypatch.setattr(settings, "counting_margin_px", 32)
    monkeypatch.setattr(settings, "counting_max_pixels", 4_000_000)
    monkeypatch.setattr(settings, "counting_max_downsample", 4)
    monkeypatch.setattr(settings, "counting_max_objects", 3000)
    monkeypatch.setattr(settings, "counting_result_ttl_seconds", 600)


async def _record(pool, job_id: str, **overrides):
    fields = {
        "job_id": job_id,
        "user_id": 1,
        "image_id": 5,
        "source_image_id": SID,
        "mode": "cells",
        "selection": dict(SELECTION),
        "ttl_seconds": 600,
    }
    fields.update(overrides)
    return await jobs.create_record(pool, **fields)


async def _result(pool, job_id: str) -> dict:
    import json

    raw = await pool.get(f"count:result:{job_id}")
    return json.loads(raw) if raw else {}


# ── happy path ────────────────────────────────────────────


async def test_task_end_to_end_done(worker_settings, pool) -> None:
    await _record(pool, "job-ok")
    await count_objects_task(dict({"redis": pool}, outliners=STUB_OUTLINERS) , "job-ok", {})

    record = await jobs.get_record(pool, "job-ok")
    assert record["status"] == "done"
    assert record["started_at"] is not None
    assert record["finished_at"] is not None
    assert record["error"] is None

    result = await _result(pool, "job-ok")
    assert result["total"] > 0
    assert result["total"] == sum(g["count"] for g in result["groups"])
    assert result["total"] == len(result["objects"])
    # Groups are contiguous 0..n-1.
    assert sorted(g["group"] for g in result["groups"]) == list(
        range(len(result["groups"]))
    )
    # Every kept centroid lies inside the selection (edge rule).
    sx, sy = SELECTION["x"], SELECTION["y"]
    sw, sh = SELECTION["width"], SELECTION["height"]
    for obj in result["objects"]:
        cx, cy = obj["centroid"]
        assert sx <= cx < sx + sw
        assert sy <= cy < sy + sh
        assert len(obj["polygon"]) >= 3
        for px, py in obj["polygon"]:
            assert 0 <= px <= 400
            assert 0 <= py <= 400


async def test_task_groups_ordered_by_mean_area(worker_settings, pool) -> None:
    """Group indices are ordered by mean object area, ascending."""
    await _record(pool, "job-groups")
    await count_objects_task(dict({"redis": pool}, outliners=STUB_OUTLINERS) , "job-groups", {})
    result = await _result(pool, "job-groups")
    if len(result["groups"]) < 2:
        pytest.skip("stub produced a single group for this selection")

    def shoelace(poly):
        area = 0.0
        for i, (x0, y0) in enumerate(poly):
            x1, y1 = poly[(i + 1) % len(poly)]
            area += x0 * y1 - x1 * y0
        return abs(area) / 2

    means = {
        g["group"]: sum(
            shoelace(o["polygon"])
            for o in result["objects"]
            if o["group"] == g["group"]
        ) / g["count"]
        for g in result["groups"]
    }
    ordered = [means[i] for i in range(len(result["groups"]))]
    assert ordered == sorted(ordered)


async def test_task_preview_is_bounded_jpeg(worker_settings, pool) -> None:
    await _record(pool, "job-prev")
    await count_objects_task(dict({"redis": pool}, outliners=STUB_OUTLINERS) , "job-prev", {})
    result = await _result(pool, "job-prev")
    assert result["preview"].startswith("data:image/jpeg;base64,")
    raw = base64.b64decode(result["preview"].split(",", 1)[1])
    img = pyvips.Image.new_from_buffer(raw, "")
    assert max(img.width, img.height) <= 960
    # Selection was 180x180 at d=1 — no upscale.
    assert (img.width, img.height) == (180, 180)


async def test_task_deterministic_across_runs(worker_settings, pool) -> None:
    """Same selection -> identical outlines (seed derives from geometry)."""
    await _record(pool, "job-a")
    await _record(pool, "job-b")
    await count_objects_task(dict({"redis": pool}, outliners=STUB_OUTLINERS) , "job-a", {})
    await count_objects_task(dict({"redis": pool}, outliners=STUB_OUTLINERS) , "job-b", {})
    a = await _result(pool, "job-a")
    b = await _result(pool, "job-b")
    assert a == b


async def test_task_missing_record_returns_silently(worker_settings, pool) -> None:
    """Cancelled/expired before dequeue: no writes at all."""
    await count_objects_task(dict({"redis": pool}, outliners=STUB_OUTLINERS) , "ghost", {})
    assert await pool.get("count:job:ghost") is None
    assert await pool.get("count:result:ghost") is None


# ── failure / cancellation paths ──────────────────────────


async def test_task_cancelled_mid_run_writes_nothing(
    worker_settings, pool, monkeypatch
) -> None:
    """Deleting the record mid-run (user cancel) stops the pipeline."""
    await _record(pool, "job-cancel")
    loop = asyncio.get_running_loop()
    real_stitch = pipeline.stitch_region

    def deleting_stitch(*args, **kwargs):
        asyncio.run_coroutine_threadsafe(
            pool.delete("count:job:job-cancel"), loop
        ).result(timeout=10)
        return real_stitch(*args, **kwargs)

    monkeypatch.setattr(pipeline, "stitch_region", deleting_stitch)
    await count_objects_task(dict({"redis": pool}, outliners=STUB_OUTLINERS) , "job-cancel", {})

    assert await jobs.get_record(pool, "job-cancel") is None
    assert await pool.get("count:result:job-cancel") is None


async def test_task_missing_tiles_fails_no_tiles(worker_settings, pool) -> None:
    """No pyramid for the source image -> failed with ``no_tiles``."""
    await _record(pool, "job-notiles", source_image_id=404)
    await count_objects_task(dict({"redis": pool}, outliners=STUB_OUTLINERS) , "job-notiles", {})
    record = await jobs.get_record(pool, "job-notiles")
    assert record["status"] == "failed"
    assert record["error"] == "no_tiles"
    assert await pool.get("count:result:job-notiles") is None


async def test_task_object_cap_fails_too_many(
    worker_settings, pool, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "counting_max_objects", 2)
    await _record(pool, "job-capped")
    await count_objects_task(dict({"redis": pool}, outliners=STUB_OUTLINERS) , "job-capped", {})
    record = await jobs.get_record(pool, "job-capped")
    assert record["status"] == "failed"
    assert record["error"] == "too_many_objects"


async def test_task_unexpected_error_fails_internal(
    worker_settings, pool, monkeypatch
) -> None:
    monkeypatch.setattr(
        pipeline, "run_count", Mock(side_effect=RuntimeError("boom"))
    )
    await _record(pool, "job-boom")
    with pytest.raises(RuntimeError):
        await count_objects_task(dict({"redis": pool}, outliners=STUB_OUTLINERS) , "job-boom", {})
    record = await jobs.get_record(pool, "job-boom")
    assert record["status"] == "failed"
    assert record["error"] == "internal"


async def test_task_arq_timeout_marks_failed_timeout(
    worker_settings, pool, monkeypatch
) -> None:
    """CancelledError with the record still present = job timeout."""
    monkeypatch.setattr(
        pipeline, "run_count", Mock(side_effect=asyncio.CancelledError())
    )
    await _record(pool, "job-timeout")
    with pytest.raises(asyncio.CancelledError):
        await count_objects_task(dict({"redis": pool}, outliners=STUB_OUTLINERS) , "job-timeout", {})
    record = await jobs.get_record(pool, "job-timeout")
    assert record["status"] == "failed"
    assert record["error"] == "timeout"


async def test_task_timeout_holds_slot_until_pipeline_thread_exits(
    worker_settings, pool, monkeypatch
) -> None:
    """A cancelled task waits for its thread and signals it to stop, so
    timed-out work never overlaps the next job (review finding)."""
    import threading

    started = threading.Event()
    release = threading.Event()
    observed: list[bool] = []

    def slow_run_count(*_args, is_cancelled, **_kwargs):
        started.set()
        release.wait(timeout=10)
        observed.append(is_cancelled())
        raise pipeline.JobCancelled

    monkeypatch.setattr(pipeline, "run_count", slow_run_count)
    await _record(pool, "job-slow")
    task = asyncio.ensure_future(
        count_objects_task(
            {"redis": pool, "outliners": STUB_OUTLINERS}, "job-slow", {}
        )
    )
    await asyncio.to_thread(started.wait, 10)
    task.cancel()
    await asyncio.sleep(0.05)
    assert not task.done()  # still holding the slot while the thread runs
    release.set()
    with pytest.raises(asyncio.CancelledError):
        _ = await task
    assert observed == [True]  # the thread saw the stop signal
    record = await jobs.get_record(pool, "job-slow")
    assert record["status"] == "failed"
    assert record["error"] == "timeout"


async def test_task_arq_abort_with_deleted_record_writes_nothing(
    worker_settings, pool, monkeypatch
) -> None:
    """CancelledError + record already gone (user DELETE) -> silent."""
    await _record(pool, "job-abort")
    loop = asyncio.get_running_loop()

    def gone(*args, **kwargs):
        # The user's DELETE removes the record before the abort lands.
        asyncio.run_coroutine_threadsafe(
            pool.delete("count:job:job-abort"), loop
        ).result(timeout=10)
        raise asyncio.CancelledError

    monkeypatch.setattr(pipeline, "run_count", gone)
    with pytest.raises(asyncio.CancelledError):
        await count_objects_task(dict({"redis": pool}, outliners=STUB_OUTLINERS) , "job-abort", {})
    # Nothing resurrected.
    assert await jobs.get_record(pool, "job-abort") is None
    assert await pool.get("count:result:job-abort") is None


async def test_update_status_never_resurrects_cancelled_record(pool) -> None:
    """``XX KEEPTTL`` writes fail when the record is gone."""
    assert await jobs.update_status(pool, "ghost", jobs.STATUS_DONE) is False
    assert await pool.exists("count:job:ghost") == 0


async def test_status_updates_keep_record_ttl(worker_settings, pool) -> None:
    await _record(pool, "job-ttl")
    await count_objects_task(dict({"redis": pool}, outliners=STUB_OUTLINERS) , "job-ttl", {})
    assert 0 < await pool.ttl("count:job:job-ttl") <= 600


# ── worker settings / startup ─────────────────────────────


def test_counting_worker_settings_shape() -> None:
    ws = CountingWorkerSettings
    assert ws.queue_name == "arq:counting"
    assert ws.health_check_key == "arq:counting:health-check"
    assert ws.max_jobs == 1
    assert ws.allow_abort_jobs is True
    assert ws.keep_result == 0
    assert len(ws.functions) == 1
    fn = ws.functions[0]
    assert fn.coroutine is count_objects_task
    assert fn.max_tries == 1
    assert fn.timeout_s == settings.counting_job_timeout_seconds
    assert ws.health_check_interval > 0


async def test_on_startup_installs_stub_outliners(monkeypatch) -> None:
    monkeypatch.setattr(settings, "counting_cells_outliner", "stub")
    monkeypatch.setattr(settings, "counting_nuclei_outliner", "stub")
    ctx: dict = {}
    await on_startup(ctx)
    cells = ctx["outliners"]["cells"]
    nuclei = ctx["outliners"]["nuclei"]
    assert cells.name == "stub" and nuclei.name == "stub"


async def test_missing_outliner_fails_internal(worker_settings, pool) -> None:
    await _record(pool, "job-missing-outliner")
    ctx = {"redis": pool, "outliners": {}}
    await count_objects_task(ctx, "job-missing-outliner")
    raw = await pool.get("count:job:job-missing-outliner")
    assert "internal" in raw
