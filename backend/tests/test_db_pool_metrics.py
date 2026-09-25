"""Tests for the SQLAlchemy connection-pool observability contract (#1072)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app import db_pool_metrics
from app.db_pool_metrics import OBSERVERS, render_db_pool_metrics


def _live_engine(pool_size: int = 5, max_overflow: int = 3) -> AsyncEngine:
    """Build a real async engine; QueuePool introspection never opens a
    connection, so no live database is needed."""
    return create_async_engine(
        "postgresql+asyncpg://hriv:hriv@db.invalid:5432/hriv",
        pool_size=pool_size,
        max_overflow=max_overflow,
        pool_pre_ping=True,
    )


def _observed_values() -> dict[str, list[int]]:
    """Collect one observation from every registered OTel observer."""
    return {
        name: [observation.value for observation in observer(None)]
        for name, observer in OBSERVERS.items()
    }


def test_otel_observers_cover_the_contract_names() -> None:
    """The observers registered on the meter are the published
    ``hriv.db.pool.*`` contract — Prometheus sees ``hriv_db_pool_*``."""
    assert set(OBSERVERS) == {
        "hriv.db.pool.size",
        "hriv.db.pool.checked_out",
        "hriv.db.pool.overflow",
        "hriv.db.pool.checked_in",
    }


def test_otel_observers_report_live_pool_values() -> None:
    engine = _live_engine()
    try:
        with patch.object(
            db_pool_metrics, "get_engine_pool", return_value=engine.pool
        ):
            observed = _observed_values()
    finally:
        engine.sync_engine.dispose()

    assert observed == {
        # size() is the configured pool_size; overflow is negative while
        # fewer than pool_size connections exist.
        "hriv.db.pool.size": [5],
        "hriv.db.pool.checked_out": [0],
        "hriv.db.pool.overflow": [-5],
        "hriv.db.pool.checked_in": [0],
    }


def test_otel_observers_reflect_a_saturated_pool() -> None:
    pool = MagicMock()
    pool.size.return_value = 10
    pool.checkedout.return_value = 30
    pool.overflow.return_value = 20
    pool.checkedin.return_value = 0
    with patch.object(db_pool_metrics, "get_engine_pool", return_value=pool):
        observed = _observed_values()

    assert observed == {
        "hriv.db.pool.size": [10],
        "hriv.db.pool.checked_out": [30],
        "hriv.db.pool.overflow": [20],
        "hriv.db.pool.checked_in": [0],
    }


def test_otel_observers_report_nothing_before_engine_exists() -> None:
    """Telemetry must not create the engine it observes."""
    with patch.object(db_pool_metrics, "get_engine_pool", return_value=None):
        assert _observed_values() == {
            name: [] for name in OBSERVERS
        }


def test_otel_observers_swallow_introspection_errors() -> None:
    pool = MagicMock()
    pool.size.side_effect = RuntimeError("pool gone")
    with patch.object(db_pool_metrics, "get_engine_pool", return_value=pool):
        assert list(OBSERVERS["hriv.db.pool.size"](None)) == []


def test_render_db_pool_metrics_reports_gauges() -> None:
    engine = _live_engine()
    try:
        with patch.object(
            db_pool_metrics, "get_engine_pool", return_value=engine.pool
        ):
            content, media_type = render_db_pool_metrics()
    finally:
        engine.sync_engine.dispose()

    assert media_type == "text/plain; version=0.0.4; charset=utf-8"
    assert b"hriv_db_pool_size 5.0" in content
    assert b"hriv_db_pool_checked_in 0.0" in content
    assert b"hriv_db_pool_checked_out 0.0" in content
    assert b"hriv_db_pool_overflow -5.0" in content


def test_render_db_pool_metrics_degrades_to_nan_without_engine() -> None:
    with patch.object(db_pool_metrics, "get_engine_pool", return_value=None):
        content, _ = render_db_pool_metrics()

    assert b"hriv_db_pool_size NaN" in content
    assert b"hriv_db_pool_checked_in NaN" in content
    assert b"hriv_db_pool_checked_out NaN" in content
    assert b"hriv_db_pool_overflow NaN" in content


def test_render_db_pool_metrics_degrades_to_nan_on_introspection_error() -> None:
    pool = MagicMock()
    pool.size.side_effect = RuntimeError("pool gone")
    with patch.object(db_pool_metrics, "get_engine_pool", return_value=pool):
        content, _ = render_db_pool_metrics()

    assert b"hriv_db_pool_size NaN" in content
