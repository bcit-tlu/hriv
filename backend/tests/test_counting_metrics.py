"""#1669: counting observability — OTel instruments, pipeline spans,
and the /api/metrics counting-queue gauges."""

import time
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest
from fakeredis import aioredis as fake_aioredis

from app.counting import jobs
from app.counting import metrics as count_metrics
from app.counting import pipeline as count_pipeline
from app.counting import worker as count_worker
from app.counting.outliners import StubOutliner
from app.counting.stitch import DziInfo
from app.database import settings
from app.queue_metrics import collect_queue_state, render_queue_metrics


class _FakeVips:
    def __init__(self, arr):
        self._arr = arr

    def numpy(self):
        return self._arr


def _run_count(mode="cells"):
    """Drive run_count with the stitch path stubbed out."""
    dzi = DziInfo(width=512, height=512, tile_size=256, overlap=0,
                  format="png", max_level=8)
    with (
        patch.object(count_pipeline, "resolve_tile_root", return_value="r"),
        patch.object(count_pipeline, "read_dzi", return_value=dzi),
        patch.object(count_pipeline, "probe_object_stats", return_value=(30.0, 12)),
        patch.object(count_pipeline, "stitch_region",
                     return_value=_FakeVips(np.zeros((64, 64, 3), np.uint8))),
        patch.object(count_pipeline, "_selection_preview",
                     return_value="data:image/jpeg;base64,x"),
    ):
        outliner = StubOutliner()
        outliner.max_pixels = 4_000_000
        return count_pipeline.run_count(
            {"source_image_id": 5, "mode": mode, "mpp": None,
             "selection": {"x": 0, "y": 0, "width": 64, "height": 64}},
            tiles_dir="/tmp", outliner=outliner, margin_px=4,
            max_pixels=4_000_000, max_downsample=8, max_objects=3000,
            is_cancelled=lambda: False,
        )


def test_count_jobs_counter_attrs_with_reason() -> None:
    counter = MagicMock()
    with patch.object(jobs, "_count_jobs_counter", counter):
        jobs.record_count_job("cells", "done")
        counter.add.assert_called_once_with(1, {"mode": "cells", "outcome": "done"})
        counter.reset_mock()
        jobs.record_count_job("nuclei", "failed", reason="too_large")
        counter.add.assert_called_once_with(
            1, {"mode": "nuclei", "outcome": "failed", "reason": "too_large"}
        )


@pytest.mark.parametrize("outcome", [
    jobs.COUNT_OUTCOME_ENQUEUED, jobs.COUNT_OUTCOME_DONE,
    jobs.COUNT_OUTCOME_FAILED, jobs.COUNT_OUTCOME_CANCELLED,
    jobs.COUNT_OUTCOME_EXPIRED, jobs.COUNT_OUTCOME_REJECTED_TOO_LARGE,
    jobs.COUNT_OUTCOME_REJECTED_RATE_LIMITED, jobs.COUNT_OUTCOME_QUEUE_UNAVAILABLE,
    "rejected",
])
def test_every_count_outcome_increments_counter(outcome) -> None:
    with patch.object(jobs, "_count_jobs_counter") as counter:
        jobs.record_count_job("cells", outcome)
    counter.add.assert_called_once_with(1, {"mode": "cells", "outcome": outcome})


@pytest.mark.parametrize("mode,image_id", [("cells", 5), ("unknown", None)])
@pytest.mark.parametrize("expired_record", [False, True])
async def test_missing_record_records_expired(mode, image_id, expired_record, caplog) -> None:
    pool = fake_aioredis.FakeRedis(decode_responses=True)
    try:
        if expired_record:
            await jobs.create_record(
                pool, job_id="gone", user_id=1, image_id=5, source_image_id=3,
                mode="cells", selection={"x": 0, "y": 0, "width": 1, "height": 1},
                ttl_seconds=600,
            )
            await pool.expire("count:job:gone", 0)
        with patch.object(jobs, "_count_jobs_counter") as counter, caplog.at_level("INFO"):
            await count_worker.count_objects_task(
                {"redis": pool}, "gone", mode=mode, image_id=image_id
            )
        counter.add.assert_called_once_with(1, {"mode": mode, "outcome": "expired"})
        event = next(r for r in caplog.records if getattr(r, "event", None) == "count.expired")
        assert (event.job_id, event.mode, event.image_id) == ("gone", mode, image_id)
        assert await jobs.get_record(pool, "gone") is None
        assert await jobs.get_result(pool, "gone") is None
    finally:
        await pool.aclose()


@pytest.mark.parametrize("total", [0, 2])
async def test_worker_records_done_serialise_and_wait(total, caplog) -> None:
    pool = fake_aioredis.FakeRedis(decode_responses=True)
    try:
        await jobs.create_record(
            pool, job_id="j", user_id=1, image_id=2, source_image_id=3,
            mode="cells", selection={"x": 0, "y": 0, "width": 1, "height": 1},
            ttl_seconds=600,
        )
        with (
            patch.object(count_worker.pipeline, "run_count", return_value={"total": total}),
            patch.object(jobs, "_count_jobs_counter") as counter,
            patch.object(count_metrics, "_run_step") as histogram,
            caplog.at_level("INFO"),
        ):
            await count_worker.count_objects_task(
                {"redis": pool, "outliners": {"cells": StubOutliner()}}, "j"
            )
        counter.add.assert_called_once_with(1, {"mode": "cells", "outcome": "done"})
        seconds, attrs = histogram.record.call_args.args
        assert seconds >= 0
        assert attrs == {"mode": "cells", "step": "serialise"}
        started = next(r for r in caplog.records if getattr(r, "event", None) == "count.started")
        completed = next(r for r in caplog.records if getattr(r, "event", None) == "count.completed")
        assert started.wait_seconds >= 0
        assert completed.timings_ms["serialise"] >= 0
        assert await jobs.get_result(pool, "j") == {"total": total}
    finally:
        await pool.aclose()


async def test_serialise_failure_still_records_timing() -> None:
    pool = AsyncMock()
    record = {"mode": "cells", "image_id": 2}
    with (
        patch.object(jobs, "get_record", AsyncMock(return_value=record)),
        patch.object(jobs, "update_status", AsyncMock(return_value=True)),
        patch.object(count_worker.pipeline, "run_count", return_value={"total": 0}),
        patch.object(jobs, "write_result", AsyncMock(side_effect=RuntimeError("write failed"))),
        patch.object(jobs, "_count_jobs_counter") as counter,
        patch.object(count_metrics, "_run_step") as histogram,
        pytest.raises(RuntimeError, match="write failed"),
    ):
        await count_worker.count_objects_task(
            {"redis": pool, "outliners": {"cells": StubOutliner()}}, "j"
        )
    assert histogram.record.call_args.args[1] == {"mode": "cells", "step": "serialise"}
    counter.add.assert_not_called()


async def test_worker_failure_increments_failed_counter() -> None:
    pool = AsyncMock()
    with (
        patch.object(jobs, "get_record", AsyncMock(return_value={"mode": "cells"})),
        patch.object(jobs, "update_status", AsyncMock(return_value=True)),
        patch.object(jobs, "_count_jobs_counter") as counter,
    ):
        await count_worker.count_objects_task({"redis": pool}, "j")
    counter.add.assert_called_once_with(
        1, {"mode": "cells", "outcome": "failed", "reason": "internal"}
    )


async def test_enqueued_at_epoch_float_in_record() -> None:
    pool = fake_aioredis.FakeRedis(decode_responses=True)
    await jobs.create_record(
        pool, job_id="j", user_id=1, image_id=2, source_image_id=3,
        mode="cells", selection={"x": 0, "y": 0, "width": 1, "height": 1},
        ttl_seconds=600,
    )
    rec = await jobs.get_record(pool, "j")
    await pool.aclose()
    assert isinstance(rec["enqueued_at"], float)
    assert rec["enqueued_at"] <= time.time()


def test_histograms_record_attrs() -> None:
    wait, step, objects, pixels = (MagicMock() for _ in range(4))
    with (
        patch.object(count_metrics, "_wait", wait),
        patch.object(count_metrics, "_run_step", step),
        patch.object(count_metrics, "_objects", objects),
        patch.object(count_metrics, "_pixels", pixels),
    ):
        count_metrics.record_wait("cells", 1.5)
        wait.record.assert_called_once_with(1.5, {"mode": "cells"})
        count_metrics.record_run_step("nuclei", "stitch", 0.25)
        step.record.assert_called_once_with(
            0.25, {"mode": "nuclei", "step": "stitch"}
        )
        step.reset_mock()
        count_metrics.record_run_step("cells", "bogus", 1.0)
        step.record.assert_not_called()
        count_metrics.record_objects("cells", 42)
        objects.record.assert_called_once_with(42, {"mode": "cells"})
        count_metrics.record_pixels("cells", 750_000)
        pixels.record.assert_called_once_with(750_000, {"mode": "cells"})


def test_pipeline_records_step_spans_and_timings() -> None:
    spans = []

    class FakeSpan:
        def __init__(self, name, attrs):
            self.name = name
            self.attrs = dict(attrs or {})
        def set_attribute(self, k, v):
            self.attrs[k] = v
        def set_attributes(self, d):
            self.attrs.update(d)
        def __enter__(self):
            spans.append(self)
            return self
        def __exit__(self, *a):
            return False

    class FakeTracer:
        def start_as_current_span(self, name, attributes=None, **kw):
            return FakeSpan(name, attributes)

    step_hist = MagicMock()
    with (
        patch.object(count_pipeline, "_tracer", FakeTracer()),
        patch.object(count_metrics, "_run_step", step_hist),
    ):
        result = _run_count()
    names = [s.name for s in spans]
    assert names == [
        "count.total", "count.plan", "count.stitch",
        "count.outline", "count.objects", "count.group", "count.preview",
    ]
    plan = spans[1]
    assert plan.attrs["count.mode"] == "cells"
    assert plan.attrs["count.outliner"] == "stub"
    assert "count.level" in plan.attrs and "count.downsample" in plan.attrs
    assert "count.pixels" in plan.attrs
    assert "count.objects" in spans[4].attrs
    assert "count.groups" in spans[5].attrs
    timings = result["_meta"]["timings_ms"]
    for step in ("plan", "stitch", "outline", "objects", "group", "preview", "total"):
        assert step in timings
    assert step_hist.record.call_count == 7


async def _count_pool() -> AsyncMock:
    pool = AsyncMock()
    pool.zcard.return_value = 2
    pool.zrange.return_value = [("job", 1000.0)]
    pool.ttl.return_value = 10
    return pool


async def test_render_counting_gauges_when_enabled(monkeypatch) -> None:
    pool = await _count_pool()
    monkeypatch.setattr(settings, "counting_enabled", True)
    monkeypatch.setattr(settings, "counting_queue_name", "arq:counting")
    with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=pool):
        payload, _ = await render_queue_metrics()
    text = payload.decode()
    assert "hriv_count_queue_depth 2.0" in text
    assert "hriv_count_queue_oldest_pending_age_seconds" in text
    assert "hriv_count_worker_up 1.0" in text
    assert "hriv_count_worker_heartbeat_age_seconds" in text
    # Task-queue gauges still present and unchanged.
    assert "hriv_task_queue_depth 2.0" in text
    assert "hriv_task_queue_worker_up 1.0" in text
    # The counting read used the counting queue + health key.
    assert pool.zcard.await_args_list[-1].args[0] == "arq:counting"
    assert pool.ttl.await_args_list[-1].args[0] == "arq:counting:health-check"


async def test_no_counting_gauges_when_disabled(monkeypatch) -> None:
    pool = await _count_pool()
    monkeypatch.setattr(settings, "counting_enabled", False)
    with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=pool):
        payload, _ = await render_queue_metrics()
    text = payload.decode()
    assert "hriv_count_" not in text
    assert "hriv_task_queue_depth" in text


async def test_collect_queue_state_counting_queue_params() -> None:
    pool = await _count_pool()
    pool.ttl.return_value = -2  # heartbeat key missing
    with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=pool):
        state = await collect_queue_state(
            queue_name="arq:counting",
            health_check_key="arq:counting:health-check",
        )
    assert state["worker_up"] is False
    assert state["worker_heartbeat_age_seconds"] is None
    pool.zcard.assert_awaited_once_with("arq:counting")
    pool.ttl.assert_awaited_once_with("arq:counting:health-check")


async def test_render_counting_worker_up_nan_on_redis_error(monkeypatch) -> None:
    pool = AsyncMock()
    pool.zcard.side_effect = ConnectionError("redis down")
    monkeypatch.setattr(settings, "counting_enabled", True)
    monkeypatch.setattr(settings, "counting_queue_name", "arq:counting")
    with patch("app.worker.get_pool", new_callable=AsyncMock, return_value=pool):
        payload, _ = await render_queue_metrics()
    assert "hriv_count_worker_up NaN" in payload.decode()


async def test_render_queue_metrics_never_imports_counting_worker(monkeypatch):
    """The API image lacks numpy/ML deps: rendering the counting gauges must
    not import app.counting.worker (review finding on #1724)."""
    import sys

    monkeypatch.setattr(settings, "counting_enabled", True)
    monkeypatch.setitem(sys.modules, "app.counting.worker", None)  # import -> ImportError
    with patch(
        "app.queue_metrics.collect_queue_state",
        AsyncMock(return_value={
            "queue_up": True, "depth": 0, "oldest_pending_age_seconds": None,
            "worker_heartbeat_age_seconds": None, "worker_up": False,
        }),
    ):
        body, _ = await render_queue_metrics()
    assert b"hriv_count_worker_up 0.0" in body
