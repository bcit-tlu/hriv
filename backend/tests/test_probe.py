"""Tests for the routed readiness probe (``/api/_probe``).

The endpoint exists so Kubernetes readiness probes exercise the same
middleware and included-router dispatch path as real API routes — a
regression there must mark pods unready rather than pass silently (#1473).
"""

import sys
from unittest.mock import AsyncMock, MagicMock

import pytest


@pytest.fixture(autouse=True)
def _fake_data_dir(tmp_path, monkeypatch):
    """Patch settings so app.main can import without needing /data."""
    tiles = tmp_path / "tiles"
    tiles.mkdir()
    source = tmp_path / "source_images"
    source.mkdir()

    from app.database import settings
    from app import admin_ops

    monkeypatch.setattr(settings, "tiles_dir", str(tiles))
    monkeypatch.setattr(settings, "source_images_dir", str(source))
    monkeypatch.setattr(admin_ops, "_TASKS_DIR", str(tmp_path / "admin_tasks"))


@pytest.fixture(autouse=True)
def _stub_pyvips(monkeypatch):
    """Insert a stub for pyvips so app.main can be imported without libvips."""
    if "pyvips" not in sys.modules:
        monkeypatch.setitem(sys.modules, "pyvips", MagicMock())


async def test_routed_probe_ok() -> None:
    """routed_probe returns ready when the database and storage are reachable."""
    from app.main import app
    from app.routers.probe import routed_probe

    db = AsyncMock()
    result = await routed_probe(db=db)
    assert result == {"status": "ready", "version": app.version}


async def test_routed_probe_storage_unwritable(monkeypatch) -> None:
    """routed_probe raises 503 when the storage volume is not writable."""
    from fastapi import HTTPException

    from app.routers.probe import routed_probe

    monkeypatch.setattr(
        "app.main._check_storage_ready", AsyncMock(return_value=False)
    )

    db = AsyncMock()
    with pytest.raises(HTTPException) as exc_info:
        await routed_probe(db=db)
    assert exc_info.value.status_code == 503


def test_routed_probe_excluded_from_schema() -> None:
    """/api/_probe is internal-only and must not appear in OpenAPI."""
    from app.main import app

    paths = app.openapi().get("paths", {})
    assert "/api/_probe" not in paths


def _mock_db() -> AsyncMock:
    return AsyncMock()


def test_routed_probe_dispatch() -> None:
    """An instrumented request to /api/_probe resolves through app routing.

    Wraps the app with ``FastAPIInstrumentor`` so the request traverses the
    same route-detail resolution that crashed under ``_IncludedRouter``
    route trees in the backend 0.64.0 incident — an incompatibility
    between FastAPI's route model and the installed
    opentelemetry-instrumentation-fastapi fails here rather than in
    production. Also proves the canary is registered via include_router
    and reachable through the middleware stack.
    """
    from unittest.mock import patch

    from fastapi.testclient import TestClient
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    from app.database import get_db
    from app.main import app as main_app

    main_app.dependency_overrides[get_db] = _mock_db
    FastAPIInstrumentor().instrument_app(main_app)
    try:
        with patch(
            "app.main._check_storage_ready", AsyncMock(return_value=True)
        ):
            with TestClient(main_app, raise_server_exceptions=False) as client:
                response = client.get("/api/_probe")
    finally:
        FastAPIInstrumentor().uninstrument_app(main_app)
        main_app.dependency_overrides.pop(get_db, None)

    assert response.status_code == 200
    assert response.json()["status"] == "ready"
