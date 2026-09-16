"""Tests for the jobs router endpoints (read surface + rebuild controls)."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import app.auth as auth
from app.database import get_db, settings
from app.routers import jobs as jobs_router
from app.routers.jobs import (
    cancel_rebuild_job,
    get_job,
    get_rebuild_tiles_capability,
    list_job_items,
    list_jobs,
    retry_failed_rebuild_job_items,
    retry_rebuild_job_item,
    start_rebuild_tiles_job,
)
from app.schemas import RebuildTilesRequest
from app.tile_rebuild_jobs import (
    TileRebuildAlreadyActiveError,
    TileRebuildParallelDisabledError,
    TileRebuildStateError,
)

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


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


def _mock_count_rows(rows: list[tuple[int, str, int]]) -> MagicMock:
    result = MagicMock()
    result.all.return_value = rows
    return result


def _job_row(**overrides) -> SimpleNamespace:
    defaults = dict(
        id=5,
        job_type="rebuild_tiles",
        status="running",
        progress=50,
        total_count=10,
        completed_count=5,
        failed_count=0,
        skipped_count=0,
        cancelled_count=0,
        error_message=None,
        metadata_={"scope": "missing_stale"},
        requested_by=1,
        started_at=NOW,
        completed_at=None,
        created_at=NOW,
        updated_at=NOW,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _item_row(**overrides) -> SimpleNamespace:
    defaults = dict(
        id=1,
        job_id=5,
        resource_type="source_image",
        resource_id="42",
        status="failed",
        attempts=2,
        progress=0,
        error_message="operational error",
        claim_token="secret-token",
        heartbeat_at=None,
        lease_expires_at=None,
        retry_not_before=None,
        arq_job_id="rebuild:5:1:2",
        metadata_={"image_id": 42},
        started_at=NOW,
        completed_at=NOW,
        created_at=NOW,
        updated_at=NOW,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _full_counts(**overrides) -> dict[str, int]:
    counts = {
        "queued": 0,
        "running": 0,
        "completed": 0,
        "skipped": 0,
        "failed": 0,
        "cancelled": 0,
        "total_count": 0,
        "completed_count": 0,
        "skipped_count": 0,
        "failed_count": 0,
        "cancelled_count": 0,
        "progress": 0,
    }
    counts.update(overrides)
    return counts


def _patch_counts(monkeypatch: pytest.MonkeyPatch, **counts: int) -> AsyncMock:
    mock = AsyncMock(return_value=_full_counts(**counts))
    monkeypatch.setattr(jobs_router, "aggregate_job_items", mock)
    return mock


# ── Direct-call tests ────────────────────────────────────────────────────


async def test_list_jobs_returns_rows_newest_first(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rows = [
        _job_row(id=2, status="running"),
        _job_row(id=1, status="completed"),
    ]
    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _mock_scalars(rows),
            _mock_count_rows([(2, "running", 3), (2, "queued", 7)]),
        ]
    )

    result = await list_jobs(db, None)

    assert [job.id for job in result] == [2, 1]
    assert result[0].queued_count == 7
    assert result[0].running_count == 3
    assert result[1].queued_count == 0


async def test_get_job_returns_bounded_job_out(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_counts(monkeypatch, queued=2, running=1)
    job = _job_row()
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalar_one_or_none(job))

    result = await get_job(5, db, None)

    assert result.id == 5
    assert result.queued_count == 2
    assert result.running_count == 1
    assert not hasattr(result, "items")


async def test_get_job_raises_404_when_missing() -> None:
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalar_one_or_none(None))

    with pytest.raises(HTTPException) as exc_info:
        await get_job(404, db, None)

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Job not found"


async def test_capability_reports_flag_and_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "rebuild_parallel_enabled", True)
    monkeypatch.setattr(settings, "task_execution_mode", "required")
    monkeypatch.setattr(settings, "rebuild_parallelism", 4)

    result = await get_rebuild_tiles_capability(None)

    assert result.enabled is True
    assert result.parallelism == 4


async def test_capability_disabled_when_flag_off_or_local_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "rebuild_parallel_enabled", False)
    monkeypatch.setattr(settings, "task_execution_mode", "required")
    assert (await get_rebuild_tiles_capability(None)).enabled is False

    monkeypatch.setattr(settings, "rebuild_parallel_enabled", True)
    monkeypatch.setattr(settings, "task_execution_mode", "local")
    assert (await get_rebuild_tiles_capability(None)).enabled is False


async def test_create_rebuild_job_commits_then_requests_pump(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_counts(monkeypatch, queued=10)
    job = _job_row(status="running", queued_count=0)
    create = AsyncMock(return_value=job)
    pump = AsyncMock(return_value=True)
    monkeypatch.setattr(jobs_router, "create_tile_rebuild_job", create)
    monkeypatch.setattr(jobs_router, "enqueue_tile_rebuild_pump", pump)
    db = AsyncMock()
    user = SimpleNamespace(id=7)

    result = await start_rebuild_tiles_job(
        RebuildTilesRequest(scope="all", image_ids=[1, 2]), user, db
    )

    create.assert_awaited_once_with(
        db, scope="all", image_ids=[1, 2], requested_by=7
    )
    pump.assert_awaited_once_with(job.id, f"create:{job.id}")
    assert result.id == job.id
    assert result.queued_count == 10


async def test_create_rebuild_job_maps_disabled_to_409(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create = AsyncMock(side_effect=TileRebuildParallelDisabledError("off"))
    monkeypatch.setattr(jobs_router, "create_tile_rebuild_job", create)

    with pytest.raises(HTTPException) as exc_info:
        await start_rebuild_tiles_job(
            RebuildTilesRequest(), SimpleNamespace(id=1), AsyncMock()
        )

    assert exc_info.value.status_code == 409
    assert "off" in exc_info.value.detail


async def test_create_rebuild_job_maps_active_to_409(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create = AsyncMock(side_effect=TileRebuildAlreadyActiveError("busy"))
    monkeypatch.setattr(jobs_router, "create_tile_rebuild_job", create)

    with pytest.raises(HTTPException) as exc_info:
        await start_rebuild_tiles_job(
            RebuildTilesRequest(), SimpleNamespace(id=1), AsyncMock()
        )

    assert exc_info.value.status_code == 409


async def test_list_job_items_pages_with_next_after_id() -> None:
    items = [_item_row(id=i) for i in range(1, 4)]
    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _mock_scalar_one_or_none(5),  # job exists check
            _mock_scalars(items),
        ]
    )

    result = await list_job_items(5, db, None, status="failed", limit=2)

    assert [item.id for item in result.items] == [1, 2]
    assert result.next_after_id == 2


async def test_list_job_items_exhausted_returns_null_cursor() -> None:
    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _mock_scalar_one_or_none(5),
            _mock_scalars([_item_row(id=7)]),
        ]
    )

    result = await list_job_items(5, db, None, after_id=3, limit=50)

    assert [item.id for item in result.items] == [7]
    assert result.next_after_id is None


async def test_list_job_items_404_for_unknown_job() -> None:
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalar_one_or_none(None))

    with pytest.raises(HTTPException) as exc_info:
        await list_job_items(999, db, None)

    assert exc_info.value.status_code == 404


@pytest.mark.parametrize(
    "status", ["queued", "running", "cancelling", "cancelled"]
)
async def test_cancel_rebuild_job_idempotent_for_active_and_cancelled(
    monkeypatch: pytest.MonkeyPatch, status: str
) -> None:
    _patch_counts(monkeypatch)
    job = _job_row(status=status)
    cancel = AsyncMock(return_value=0)
    pump = AsyncMock(return_value=True)
    monkeypatch.setattr(jobs_router, "request_job_cancellation", cancel)
    monkeypatch.setattr(jobs_router, "enqueue_tile_rebuild_pump", pump)
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalar_one_or_none(job))

    result = await cancel_rebuild_job(5, db, None)

    cancel.assert_awaited_once_with(db, 5)
    db.commit.assert_awaited_once()
    pump.assert_awaited_once_with(5, "cancel:5")
    assert result.id == 5


@pytest.mark.parametrize(
    "status", ["completed", "completed_with_errors", "failed"]
)
async def test_cancel_rebuild_job_409_for_terminal_success_states(
    monkeypatch: pytest.MonkeyPatch, status: str
) -> None:
    cancel = AsyncMock()
    monkeypatch.setattr(jobs_router, "request_job_cancellation", cancel)
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_mock_scalar_one_or_none(_job_row(status=status))
    )

    with pytest.raises(HTTPException) as exc_info:
        await cancel_rebuild_job(5, db, None)

    assert exc_info.value.status_code == 409
    cancel.assert_not_awaited()


async def test_cancel_rebuild_job_404_for_missing_or_wrong_type() -> None:
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalar_one_or_none(None))

    with pytest.raises(HTTPException) as exc_info:
        await cancel_rebuild_job(999, db, None)

    assert exc_info.value.status_code == 404


async def test_retry_job_item_returns_count_and_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_counts(monkeypatch)
    job = _job_row()
    retry = AsyncMock(return_value=1)
    pump = AsyncMock(return_value=True)
    monkeypatch.setattr(jobs_router, "retry_failed_job_items", retry)
    monkeypatch.setattr(jobs_router, "enqueue_tile_rebuild_pump", pump)
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalar_one_or_none(job))

    result = await retry_rebuild_job_item(5, 11, db, None)

    retry.assert_awaited_once_with(db, 5, [11])
    db.commit.assert_awaited_once()
    assert pump.await_count == 1
    assert result.requeued_count == 1
    assert result.job.id == 5


async def test_retry_job_item_404_for_item_outside_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    retry = AsyncMock(side_effect=ValueError("no such item"))
    monkeypatch.setattr(jobs_router, "retry_failed_job_items", retry)
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalar_one_or_none(_job_row()))

    with pytest.raises(HTTPException) as exc_info:
        await retry_rebuild_job_item(5, 11, db, None)

    assert exc_info.value.status_code == 404


async def test_retry_job_item_409_for_ineligible_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    retry = AsyncMock(side_effect=TileRebuildStateError("not failed"))
    monkeypatch.setattr(jobs_router, "retry_failed_job_items", retry)
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalar_one_or_none(_job_row()))

    with pytest.raises(HTTPException) as exc_info:
        await retry_rebuild_job_item(5, 11, db, None)

    assert exc_info.value.status_code == 409


async def test_retry_failed_items_loops_bounded_batches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_counts(monkeypatch)
    job = _job_row(status="completed_with_errors", failed_count=250)
    retry = AsyncMock(side_effect=[100, 100, 50, 0])
    pump = AsyncMock(return_value=True)
    monkeypatch.setattr(jobs_router, "retry_failed_job_items", retry)
    monkeypatch.setattr(jobs_router, "enqueue_tile_rebuild_pump", pump)
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalar_one_or_none(job))

    result = await retry_failed_rebuild_job_items(5, db, None)

    assert retry.await_count == 4
    assert result.requeued_count == 250
    assert result.job.id == 5


async def test_retry_failed_items_no_pump_when_nothing_requeued(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_counts(monkeypatch)
    retry = AsyncMock(return_value=0)
    pump = AsyncMock(return_value=True)
    monkeypatch.setattr(jobs_router, "retry_failed_job_items", retry)
    monkeypatch.setattr(jobs_router, "enqueue_tile_rebuild_pump", pump)
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalar_one_or_none(_job_row()))

    result = await retry_failed_rebuild_job_items(5, db, None)

    assert result.requeued_count == 0
    pump.assert_not_awaited()


async def test_retry_failed_items_409_for_ineligible_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    retry = AsyncMock(side_effect=TileRebuildStateError("cancelling"))
    monkeypatch.setattr(jobs_router, "retry_failed_job_items", retry)
    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=_mock_scalar_one_or_none(_job_row(status="cancelling"))
    )

    with pytest.raises(HTTPException) as exc_info:
        await retry_failed_rebuild_job_items(5, db, None)

    assert exc_info.value.status_code == 409


# ── Endpoint-level contract tests ──────────────────────────────────────────
#
# The tests above call the router functions directly, which is the fast,
# low-overhead convention used across this codebase — but that bypasses
# FastAPI's dependency wiring (role enforcement), request validation (422s),
# and Pydantic response-model serialization (the `metadata_extra` alias).
# These tests exercise the router mounted on a real ASGI app via TestClient,
# matching the pattern in test_router_admin.py's `_version_test_client`.


def _jobs_test_client(user_role: str, db: object) -> TestClient:
    app = FastAPI()
    app.include_router(jobs_router.router, prefix="/api")
    app.dependency_overrides[auth.get_current_user] = lambda: SimpleNamespace(
        id=1, role=user_role, email="u@example.com"
    )
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def test_list_jobs_endpoint_rejects_non_admin() -> None:
    db = AsyncMock()
    with _jobs_test_client("instructor", db) as client:
        response = client.get("/api/jobs/")
    assert response.status_code == 403


def test_list_jobs_endpoint_serializes_rows_for_admin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _mock_scalars([_job_row()]),
            _mock_count_rows([(5, "running", 2), (5, "queued", 8)]),
        ]
    )
    with _jobs_test_client("admin", db) as client:
        response = client.get("/api/jobs/")
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    # metadata_ is aliased to metadata_extra on the wire.
    assert body[0]["metadata_extra"] == {"scope": "missing_stale"}
    assert "metadata_" not in body[0]
    assert body[0]["queued_count"] == 8
    assert body[0]["running_count"] == 2


def test_get_job_endpoint_rejects_non_admin() -> None:
    db = AsyncMock()
    with _jobs_test_client("student", db) as client:
        response = client.get("/api/jobs/5")
    assert response.status_code == 403


def test_get_job_endpoint_returns_bounded_shape_without_items(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_counts(monkeypatch, running=1)
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalar_one_or_none(_job_row()))
    with _jobs_test_client("admin", db) as client:
        response = client.get("/api/jobs/5")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == 5
    assert "items" not in body
    assert body["running_count"] == 1


def test_get_job_endpoint_404_for_admin_when_missing() -> None:
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalar_one_or_none(None))
    with _jobs_test_client("admin", db) as client:
        response = client.get("/api/jobs/999")
    assert response.status_code == 404


def test_items_endpoint_rejects_non_admin() -> None:
    db = AsyncMock()
    with _jobs_test_client("student", db) as client:
        response = client.get("/api/jobs/5/items")
    assert response.status_code == 403


def test_items_endpoint_validates_filters() -> None:
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalar_one_or_none(5))
    with _jobs_test_client("admin", db) as client:
        assert client.get("/api/jobs/5/items?status=bogus").status_code == 422
        assert client.get("/api/jobs/5/items?limit=101").status_code == 422
        assert client.get("/api/jobs/5/items?after_id=0").status_code == 422
        assert client.get("/api/jobs/5/items?after_id=abc").status_code == 422


def test_items_endpoint_serializes_without_claim_token() -> None:
    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _mock_scalar_one_or_none(5),
            _mock_scalars([_item_row()]),
        ]
    )
    with _jobs_test_client("admin", db) as client:
        response = client.get("/api/jobs/5/items?status=failed")
    assert response.status_code == 200
    body = response.json()
    assert body["next_after_id"] is None
    item = body["items"][0]
    assert item["resource_type"] == "source_image"
    assert item["metadata_extra"] == {"image_id": 42}
    assert "claim_token" not in item


def test_items_endpoint_404_for_unknown_job() -> None:
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalar_one_or_none(None))
    with _jobs_test_client("admin", db) as client:
        response = client.get("/api/jobs/999/items")
    assert response.status_code == 404


def test_capability_endpoint_rejects_instructor() -> None:
    with _jobs_test_client("instructor", AsyncMock()) as client:
        response = client.get("/api/jobs/rebuild-tiles")
    assert response.status_code == 403


def test_capability_endpoint_serializes_flag(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "rebuild_parallel_enabled", True)
    monkeypatch.setattr(settings, "task_execution_mode", "required")
    with _jobs_test_client("admin", AsyncMock()) as client:
        response = client.get("/api/jobs/rebuild-tiles")
    assert response.status_code == 200
    assert response.json() == {"enabled": True, "parallelism": 2}


def test_create_endpoint_rejects_non_admin() -> None:
    with _jobs_test_client("student", AsyncMock()) as client:
        response = client.post("/api/jobs/rebuild-tiles", json={})
    assert response.status_code == 403


def test_create_endpoint_201_and_pumps(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_counts(monkeypatch, queued=10)
    job = _job_row()
    create = AsyncMock(return_value=job)
    pump = AsyncMock(return_value=True)
    monkeypatch.setattr(jobs_router, "create_tile_rebuild_job", create)
    monkeypatch.setattr(jobs_router, "enqueue_tile_rebuild_pump", pump)
    with _jobs_test_client("admin", AsyncMock()) as client:
        response = client.post(
            "/api/jobs/rebuild-tiles", json={"scope": "missing_stale"}
        )
    assert response.status_code == 201
    assert response.json()["id"] == 5
    pump.assert_awaited_once_with(5, "create:5")


def test_create_endpoint_409_when_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create = AsyncMock(side_effect=TileRebuildParallelDisabledError("off"))
    monkeypatch.setattr(jobs_router, "create_tile_rebuild_job", create)
    with _jobs_test_client("admin", AsyncMock()) as client:
        response = client.post("/api/jobs/rebuild-tiles", json={})
    assert response.status_code == 409


def test_create_endpoint_422_for_bad_scope() -> None:
    with _jobs_test_client("admin", AsyncMock()) as client:
        response = client.post(
            "/api/jobs/rebuild-tiles", json={"scope": "bogus"}
        )
    assert response.status_code == 422


def test_cancel_endpoint_rejects_instructor() -> None:
    with _jobs_test_client("instructor", AsyncMock()) as client:
        response = client.post("/api/jobs/5/cancel")
    assert response.status_code == 403


def test_retry_endpoints_reject_non_admin() -> None:
    db = AsyncMock()
    with _jobs_test_client("student", db) as client:
        assert client.post("/api/jobs/5/items/1/retry").status_code == 403
        assert client.post("/api/jobs/5/retry-failed").status_code == 403
