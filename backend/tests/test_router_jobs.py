"""Tests for the read-only jobs router endpoints."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import app.auth as auth
from app.database import get_db
from app.routers import jobs as jobs_router
from app.routers.jobs import get_job, list_jobs


def _mock_scalars(rows: list[object]) -> MagicMock:
    scalars = MagicMock()
    scalars.all.return_value = rows
    result = MagicMock()
    result.scalars.return_value = scalars
    return result


def _mock_scalar_one_or_none(row: object | None) -> MagicMock:
    result = MagicMock()
    result.scalar_one_or_none.return_value = row
    return result


async def test_list_jobs_returns_rows_newest_first() -> None:
    rows = [
        SimpleNamespace(id=2, job_type="rebuild", status="running"),
        SimpleNamespace(id=1, job_type="rebuild", status="completed"),
    ]
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalars(rows))

    result = await list_jobs(db, None)

    assert result == rows


async def test_get_job_returns_job_with_items() -> None:
    job = SimpleNamespace(
        id=5,
        job_type="rebuild",
        status="running",
        items=[SimpleNamespace(id=1, job_id=5, status="running")],
    )
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalar_one_or_none(job))

    result = await get_job(5, db, None)

    assert result is job


async def test_get_job_raises_404_when_missing() -> None:
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalar_one_or_none(None))

    with pytest.raises(HTTPException) as exc_info:
        await get_job(404, db, None)

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Job not found"


# ── Endpoint-level contract tests ──────────────────────────────────────────
#
# The tests above call the router functions directly, which is the fast,
# low-overhead convention used across this codebase — but that bypasses
# FastAPI's dependency wiring (role enforcement) and Pydantic response-model
# serialization (the `metadata_extra` alias, nested `JobItemOut` shaping).
# These tests exercise the router mounted on a real ASGI app via TestClient,
# matching the pattern in test_router_admin.py's `_version_test_client`, to
# cover exactly those contracts.


def _jobs_test_client(user_role: str, db: object) -> TestClient:
    app = FastAPI()
    app.include_router(jobs_router.router, prefix="/api")
    app.dependency_overrides[auth.get_current_user] = lambda: SimpleNamespace(
        id=1, role=user_role, email="u@example.com"
    )
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def _job_row(**overrides) -> SimpleNamespace:
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    defaults = dict(
        id=5,
        job_type="rebuild",
        status="running",
        progress=50,
        total_count=10,
        completed_count=5,
        failed_count=0,
        skipped_count=0,
        cancelled_count=0,
        error_message=None,
        metadata_={"note": "hello"},
        requested_by=1,
        started_at=now,
        completed_at=None,
        created_at=now,
        updated_at=now,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_list_jobs_endpoint_rejects_non_admin() -> None:
    db = AsyncMock()
    with _jobs_test_client("instructor", db) as client:
        response = client.get("/api/jobs/")
    assert response.status_code == 403


def test_list_jobs_endpoint_serializes_rows_for_admin() -> None:
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalars([_job_row()]))
    with _jobs_test_client("admin", db) as client:
        response = client.get("/api/jobs/")
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    # metadata_ is aliased to metadata_extra on the wire.
    assert body[0]["metadata_extra"] == {"note": "hello"}
    assert "metadata_" not in body[0]


def test_get_job_endpoint_rejects_non_admin() -> None:
    db = AsyncMock()
    with _jobs_test_client("student", db) as client:
        response = client.get("/api/jobs/5")
    assert response.status_code == 403


def test_get_job_endpoint_serializes_nested_items_for_admin() -> None:
    item = SimpleNamespace(
        id=1,
        job_id=5,
        resource_type="source_image",
        resource_id="42",
        status="completed",
        attempts=1,
        progress=100,
        error_message=None,
        heartbeat_at=None,
        lease_expires_at=None,
        arq_job_id=None,
        metadata_=None,
        started_at=None,
        completed_at=None,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    job = _job_row(items=[item])
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalar_one_or_none(job))
    with _jobs_test_client("admin", db) as client:
        response = client.get("/api/jobs/5")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == 5
    assert len(body["items"]) == 1
    assert body["items"][0]["resource_type"] == "source_image"


def test_get_job_endpoint_404_for_admin_when_missing() -> None:
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalar_one_or_none(None))
    with _jobs_test_client("admin", db) as client:
        response = client.get("/api/jobs/999")
    assert response.status_code == 404
