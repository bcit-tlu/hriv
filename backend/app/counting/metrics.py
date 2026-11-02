"""Object-counting observability: OTel instruments (#1661/#1669).

Emits the ``hriv.count.*`` contract: histograms are OpenTelemetry
instruments recorded in whichever process runs the code path — the arq
counting worker for wait/run/objects/pixels and the API for rejections —
exported via OTLP. Queue-state gauges for ``/api/metrics`` live in
``queue_metrics.py`` alongside the task-queue gauges.

Label discipline follows ``docs/observability-conventions.md``: only
bounded ``mode`` / ``outcome`` / ``reason`` / ``step`` attributes. Job,
image and user IDs stay in span attributes and structured logs — never in
metric labels.
"""

from __future__ import annotations

from opentelemetry import metrics

COUNT_STEPS = frozenset(
    {"plan", "stitch", "outline", "objects", "group", "preview", "total"}
)

_meter = metrics.get_meter(__name__)

_wait = _meter.create_histogram(
    "hriv.count.wait",
    description="Time from job enqueue to worker start",
    unit="s",
)
_run_step = _meter.create_histogram(
    "hriv.count.run",
    description="Per-step pipeline execution time",
    unit="s",
)
_objects = _meter.create_histogram(
    "hriv.count.objects",
    description="Objects counted per done job",
    unit="1",
)
_pixels = _meter.create_histogram(
    "hriv.count.pixels",
    description="Stitched pixels processed per done job",
    unit="1",
)


def record_wait(mode: str, seconds: float) -> None:
    """Enqueue→start latency for one job."""
    _wait.record(seconds, {"mode": mode})


def record_run_step(mode: str, step: str, seconds: float) -> None:
    """Duration of one pipeline step (``step`` ∈ COUNT_STEPS)."""
    if step not in COUNT_STEPS:
        return
    _run_step.record(seconds, {"mode": mode, "step": step})


def record_objects(mode: str, count: int) -> None:
    """Object count of one done job."""
    _objects.record(count, {"mode": mode})


def record_pixels(mode: str, pixels: int) -> None:
    """Processed pixel count of one done job."""
    _pixels.record(pixels, {"mode": mode})
