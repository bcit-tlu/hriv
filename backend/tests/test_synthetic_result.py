"""Tests for authoritative synthetic journey result storage and metrics."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from app.synthetic_metrics import render_synthetic_metrics
from app.synthetic_result import (
    StaleSyntheticResultError,
    StoredSyntheticJourneyState,
    SyntheticJourneyResult,
    SyntheticJourneyStep,
    load_stored_synthetic_result_state,
    store_synthetic_result,
)


class _FakePipeline:
    def __init__(self, store: dict[str, str]):
        self._store = store
        self._pending: tuple[str, str] | None = None

    async def watch(self, _key: str) -> None:
        return None

    async def get(self, key: str) -> str | None:
        return self._store.get(key)

    def multi(self) -> None:
        return None

    def set(self, key: str, value: str) -> None:
        self._pending = (key, value)

    async def execute(self) -> list[bool]:
        if self._pending is not None:
            key, value = self._pending
            self._store[key] = value
        return [True]

    async def reset(self) -> None:
        self._pending = None


class _FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    def pipeline(self) -> _FakePipeline:
        return _FakePipeline(self.store)

    async def get(self, key: str) -> str | None:
        return self.store.get(key)


def _make_result(
    *,
    completed_at: datetime | None = None,
    success: bool = True,
    failure_code: str | None = None,
    steps: list[SyntheticJourneyStep] | None = None,
) -> SyntheticJourneyResult:
    completed = completed_at or datetime.now(timezone.utc)
    started = completed - timedelta(seconds=3)
    return SyntheticJourneyResult(
        event_version=1,
        started_at=started,
        completed_at=completed,
        success=success,
        duration_ms=3000,
        failure_code=failure_code,
        component_version="1.2.3",
        steps=steps
        or [
            SyntheticJourneyStep(name="frontend", success=True, duration_ms=200),
            SyntheticJourneyStep(name="login", success=True, duration_ms=400),
        ],
    )


def test_synthetic_result_requires_failure_code_for_failures() -> None:
    with pytest.raises(ValidationError):
        _make_result(success=False)


def test_synthetic_result_rejects_duplicate_steps() -> None:
    with pytest.raises(ValidationError):
        _make_result(
            steps=[
                SyntheticJourneyStep(name="frontend", success=True, duration_ms=200),
                SyntheticJourneyStep(name="frontend", success=True, duration_ms=300),
            ]
        )


def test_synthetic_result_rejects_naive_timestamps() -> None:
    naive = datetime(2026, 7, 14, 12, 0, 0)
    with pytest.raises(ValidationError):
        SyntheticJourneyResult(
            event_version=1,
            started_at=naive,
            completed_at=naive,
            success=True,
            duration_ms=0,
            steps=[SyntheticJourneyStep(name="frontend", success=True, duration_ms=0)],
        )


async def test_store_synthetic_result_serializes_and_loads_latest_state() -> None:
    redis = _FakeRedis()
    result = _make_result()

    stored = await store_synthetic_result(result, redis_client=redis)
    loaded = await load_stored_synthetic_result_state(redis_client=redis)

    assert stored.latest_result.completed_at == result.completed_at
    assert stored.last_success_completed_at == result.completed_at
    assert loaded == stored


async def test_store_synthetic_result_preserves_last_success_on_failure() -> None:
    redis = _FakeRedis()
    success_completed_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    failure_completed_at = datetime.now(timezone.utc)

    await store_synthetic_result(
        _make_result(completed_at=success_completed_at),
        redis_client=redis,
    )
    stored = await store_synthetic_result(
        _make_result(
            completed_at=failure_completed_at,
            success=False,
            failure_code="tile_failed",
            steps=[
                SyntheticJourneyStep(name="frontend", success=True, duration_ms=200),
                SyntheticJourneyStep(name="login", success=True, duration_ms=400),
                SyntheticJourneyStep(name="tile", success=False, duration_ms=1200),
            ],
        ),
        redis_client=redis,
    )

    assert stored.latest_result.completed_at == failure_completed_at
    assert stored.last_success_completed_at == success_completed_at


async def test_store_synthetic_result_rejects_stale_completion_time() -> None:
    redis = _FakeRedis()
    latest = datetime.now(timezone.utc)
    await store_synthetic_result(_make_result(completed_at=latest), redis_client=redis)

    with pytest.raises(StaleSyntheticResultError):
        await store_synthetic_result(
            _make_result(completed_at=latest - timedelta(seconds=1)),
            redis_client=redis,
        )


async def test_render_synthetic_metrics_exposes_latest_result() -> None:
    state = StoredSyntheticJourneyState(
        latest_result=_make_result(
            completed_at=datetime.now(timezone.utc) - timedelta(seconds=10),
            success=False,
            failure_code="tile_failed",
            steps=[
                SyntheticJourneyStep(name="frontend", success=True, duration_ms=200),
                SyntheticJourneyStep(name="login", success=True, duration_ms=400),
                SyntheticJourneyStep(name="tile", success=False, duration_ms=1200),
            ],
        ),
        last_success_completed_at=datetime.now(timezone.utc) - timedelta(hours=1),
        updated_at=datetime.now(timezone.utc),
    )

    from unittest.mock import patch

    with patch(
        "app.synthetic_metrics.load_stored_synthetic_result_state",
        return_value=state,
    ):
        content, _ = await render_synthetic_metrics()

    assert b"hriv_synthetic_journey_success 0.0" in content
    assert b'hriv_synthetic_step_success{step="tile"} 0.0' in content
    assert b'hriv_synthetic_step_duration_seconds{step="tile"} 1.2' in content
    assert b"hriv_synthetic_last_success_timestamp_seconds" in content


async def test_render_synthetic_metrics_without_state_is_stale() -> None:
    from unittest.mock import patch

    with patch(
        "app.synthetic_metrics.load_stored_synthetic_result_state",
        return_value=None,
    ):
        content, _ = await render_synthetic_metrics()

    assert b"hriv_synthetic_last_run_timestamp_seconds 0.0" in content
    assert b"hriv_synthetic_result_age_seconds +Inf" in content


async def test_render_synthetic_metrics_with_explicit_none_skips_reload() -> None:
    from unittest.mock import AsyncMock, patch

    loader = AsyncMock(return_value=_make_result())
    with patch("app.synthetic_metrics.load_stored_synthetic_result_state", loader):
        content, _ = await render_synthetic_metrics(None)

    loader.assert_not_awaited()
    assert b"hriv_synthetic_last_run_timestamp_seconds 0.0" in content
    assert b"hriv_synthetic_result_age_seconds +Inf" in content
