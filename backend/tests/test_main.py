"""Tests for the main FastAPI application module."""

import os
import sys
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


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


async def test_health_endpoint() -> None:
    from app.main import app, health

    result = await health()
    assert result == {"status": "ok", "version": app.version}


async def test_lifespan_runs_reconciliation_sweep_in_local_mode(monkeypatch) -> None:
    """In ``local`` mode (no dedicated worker pod) the API process is the
    only one running, so it must self-heal by running the reconciliation
    sweep directly at startup."""
    from app import main
    from app.database import settings

    monkeypatch.setattr(settings, "task_execution_mode", "local")
    monkeypatch.setattr(main, "setup_logging", MagicMock())
    monkeypatch.setattr(main, "_check_oidc_connectivity", AsyncMock())
    sweep = AsyncMock()
    monkeypatch.setattr(main, "run_reconciliation_sweep", sweep)

    async with main.lifespan(main.app):
        pass

    sweep.assert_awaited_once()


async def test_lifespan_skips_reconciliation_sweep_in_required_mode(monkeypatch) -> None:
    """In ``required`` mode a dedicated arq worker pod runs the sweep
    periodically via a cron job instead (see ``worker.WorkerSettings``), so
    the API process must not also run it at startup."""
    from app import main
    from app.database import settings

    monkeypatch.setattr(settings, "task_execution_mode", "required")
    monkeypatch.setattr(main, "setup_logging", MagicMock())
    monkeypatch.setattr(main, "_check_oidc_connectivity", AsyncMock())
    monkeypatch.setattr(main, "get_pool", AsyncMock(return_value=MagicMock()))
    sweep = AsyncMock()
    monkeypatch.setattr(main, "run_reconciliation_sweep", sweep)

    async with main.lifespan(main.app):
        pass

    sweep.assert_not_awaited()


async def test_lifespan_precreates_archive_lock_file(monkeypatch) -> None:
    """The backup service locks the same file from a non-root uid, so the
    backend must leave a world-writable lock behind at startup."""
    from app import main
    from app.database import settings
    from app.rebuild_fixture import FIXTURE_ARCHIVE_LOCK_FILENAME

    monkeypatch.setattr(settings, "task_execution_mode", "required")
    monkeypatch.setattr(main, "setup_logging", MagicMock())
    monkeypatch.setattr(main, "_check_oidc_connectivity", AsyncMock())
    monkeypatch.setattr(main, "get_pool", AsyncMock(return_value=MagicMock()))

    async with main.lifespan(main.app):
        pass

    lock_path = os.path.join(settings.source_images_dir, FIXTURE_ARCHIVE_LOCK_FILENAME)
    assert os.path.isfile(lock_path)
    assert os.stat(lock_path).st_mode & 0o777 == 0o666


async def test_lifespan_survives_archive_lock_precreate_failure(monkeypatch) -> None:
    from app import main
    from app.database import settings

    monkeypatch.setattr(settings, "task_execution_mode", "required")
    monkeypatch.setattr(main, "setup_logging", MagicMock())
    monkeypatch.setattr(main, "_check_oidc_connectivity", AsyncMock())
    monkeypatch.setattr(main, "get_pool", AsyncMock(return_value=MagicMock()))
    monkeypatch.setattr(
        main, "ensure_archive_lock_file", MagicMock(side_effect=PermissionError)
    )

    async with main.lifespan(main.app):
        pass


async def test_queue_health_returns_minimal_status(monkeypatch) -> None:
    from app.main import queue_health_endpoint
    from app.database import settings

    monkeypatch.setattr(
        "app.main.queue_health",
        AsyncMock(
            return_value={
                "queue_up": True,
                "depth": 4,
                "oldest_pending_age_seconds": 3.0,
                "worker_heartbeat_age_seconds": 1.0,
                "worker_up": True,
                "degraded": False,
                "mode": "required",
            },
        ),
    )
    monkeypatch.setattr(settings, "task_execution_mode", "required")

    assert await queue_health_endpoint() == {"status": "ok"}


async def test_queue_health_returns_minimal_503_when_required_mode_is_degraded(
    monkeypatch,
) -> None:
    from fastapi import HTTPException

    from app.main import queue_health_endpoint
    from app.database import settings

    monkeypatch.setattr(
        "app.main.queue_health",
        AsyncMock(return_value={"degraded": True}),
    )
    monkeypatch.setattr(settings, "task_execution_mode", "required")

    with pytest.raises(HTTPException) as exc_info:
        await queue_health_endpoint()

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == {"status": "degraded"}


def test_task_queue_unavailable_handler_asgi_contract() -> None:
    from app.main import task_queue_unavailable_handler
    from app.worker import TaskQueueUnavailableError

    test_app = FastAPI()
    test_app.add_exception_handler(
        TaskQueueUnavailableError,
        task_queue_unavailable_handler,
    )

    @test_app.get("/queue")
    async def raise_queue_unavailable():
        raise TaskQueueUnavailableError("submission_failed")

    with TestClient(test_app) as client:
        response = client.get("/queue")

    assert response.status_code == 503
    assert response.json() == {"detail": "Task queue unavailable"}
    assert response.headers["Retry-After"] == "30"


# ── _check_oidc_connectivity tests ──────────────────────


async def test_check_oidc_connectivity_success(monkeypatch) -> None:
    """Logs info when the OIDC metadata endpoint is reachable."""
    from app.database import settings as _settings

    monkeypatch.setattr(_settings, "oidc_issuer", "https://vault.example.com/v1/oidc")

    mock_response = AsyncMock()
    mock_response.raise_for_status = lambda: None

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.main.httpx.AsyncClient", return_value=mock_client):
        from app.main import _check_oidc_connectivity

        await _check_oidc_connectivity()  # Should not raise

    mock_client.get.assert_awaited_once_with(
        "https://vault.example.com/v1/oidc/.well-known/openid-configuration"
    )


async def test_check_oidc_connectivity_connect_error(monkeypatch) -> None:
    """Logs error when the OIDC provider is unreachable (ConnectError)."""
    from app.database import settings as _settings

    monkeypatch.setattr(_settings, "oidc_issuer", "https://vault.example.com/v1/oidc")

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(
        side_effect=httpx.ConnectError("All connection attempts failed")
    )
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.main.httpx.AsyncClient", return_value=mock_client):
        from app.main import _check_oidc_connectivity

        await _check_oidc_connectivity()  # Should not raise — logs error instead


async def test_check_oidc_connectivity_http_error(monkeypatch) -> None:
    """Logs warning when the metadata endpoint returns an HTTP error."""
    from app.database import settings as _settings

    monkeypatch.setattr(_settings, "oidc_issuer", "https://vault.example.com/v1/oidc")

    mock_response = AsyncMock()
    mock_response.status_code = 404
    mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "Not Found",
        request=httpx.Request("GET", "https://example.com"),
        response=mock_response,
    )

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.main.httpx.AsyncClient", return_value=mock_client):
        from app.main import _check_oidc_connectivity

        await _check_oidc_connectivity()  # Should not raise — logs warning instead


async def test_check_oidc_connectivity_timeout(monkeypatch) -> None:
    """Logs error when the OIDC provider times out (TimeoutException)."""
    from app.database import settings as _settings

    monkeypatch.setattr(_settings, "oidc_issuer", "https://vault.example.com/v1/oidc")

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=httpx.ConnectTimeout("timed out"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.main.httpx.AsyncClient", return_value=mock_client):
        from app.main import _check_oidc_connectivity

        await _check_oidc_connectivity()  # Should not raise — logs error instead


async def test_check_oidc_connectivity_generic_error(monkeypatch) -> None:
    """Logs warning for unexpected errors (e.g. SSL, protocol)."""
    from app.database import settings as _settings

    monkeypatch.setattr(_settings, "oidc_issuer", "https://vault.example.com/v1/oidc")

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(side_effect=RuntimeError("something unexpected"))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("app.main.httpx.AsyncClient", return_value=mock_client):
        from app.main import _check_oidc_connectivity

        await _check_oidc_connectivity()  # Should not raise — logs warning instead


# ── Storage health checks ─────────────────────────────────


async def test_storage_health_ok() -> None:
    """storage_health returns ok when the admin_tasks directory is writable."""
    from app.main import app, storage_health

    result = await storage_health()
    assert result == {"status": "ok", "version": app.version}


async def test_storage_health_unwritable(monkeypatch) -> None:
    """storage_health raises 503 when the storage volume is not writable."""
    from fastapi import HTTPException

    from app.main import storage_health

    monkeypatch.setattr(
        "app.main._check_storage_ready", AsyncMock(return_value=False)
    )

    with pytest.raises(HTTPException) as exc_info:
        await storage_health()
    assert exc_info.value.status_code == 503


async def test_readiness_ok(monkeypatch) -> None:
    """readiness returns ready when the database and storage are reachable."""
    from app.main import app, readiness

    monkeypatch.setattr("app.main._check_db_ready", AsyncMock(return_value=True))
    result = await readiness()
    assert result == {"status": "ready", "version": app.version}


async def test_readiness_db_unreachable(monkeypatch) -> None:
    """readiness raises 503 when no fresh database connection can be made."""
    from fastapi import HTTPException

    from app.main import readiness

    monkeypatch.setattr("app.main._check_db_ready", AsyncMock(return_value=False))

    with pytest.raises(HTTPException) as exc_info:
        await readiness()
    assert exc_info.value.status_code == 503


async def test_readiness_storage_unwritable(monkeypatch) -> None:
    """readiness raises 503 when the storage volume is not writable."""
    from fastapi import HTTPException

    from app.main import readiness

    monkeypatch.setattr("app.main._check_db_ready", AsyncMock(return_value=True))
    monkeypatch.setattr(
        "app.main._check_storage_ready", AsyncMock(return_value=False)
    )

    with pytest.raises(HTTPException) as exc_info:
        await readiness()
    assert exc_info.value.status_code == 503


def _mock_probe_engine(*, connect_error: Exception | None = None) -> MagicMock:
    """Build a mock ``get_probe_engine`` engine with a connect() context manager."""
    engine = MagicMock()
    if connect_error is not None:
        engine.connect.side_effect = connect_error
    else:
        engine.connect.return_value.__aenter__.return_value = AsyncMock()
    return engine


async def test_check_db_ready_ok(monkeypatch) -> None:
    """_check_db_ready returns True when a fresh connection runs SELECT 1."""
    from app.main import _check_db_ready

    engine = _mock_probe_engine()
    monkeypatch.setattr(
        "app.main.get_probe_engine", MagicMock(return_value=engine)
    )

    assert await _check_db_ready() is True
    conn_cm = engine.connect.return_value
    conn = conn_cm.__aenter__.return_value
    conn.execute.assert_awaited_once()
    conn_cm.__aexit__.assert_awaited_once()


async def test_check_db_ready_connect_failure(monkeypatch) -> None:
    """_check_db_ready returns False when the fresh connection is refused."""
    from app.main import _check_db_ready

    monkeypatch.setattr(
        "app.main.get_probe_engine",
        MagicMock(return_value=_mock_probe_engine(connect_error=OSError("refused"))),
    )

    assert await _check_db_ready() is False


async def test_check_db_ready_query_failure(monkeypatch) -> None:
    """_check_db_ready returns False when SELECT 1 fails on a fresh connection."""
    from app.main import _check_db_ready

    engine = _mock_probe_engine()
    conn = engine.connect.return_value.__aenter__.return_value
    conn.execute = AsyncMock(side_effect=OSError("connection reset"))
    monkeypatch.setattr(
        "app.main.get_probe_engine", MagicMock(return_value=engine)
    )

    assert await _check_db_ready() is False


async def test_check_db_ready_timeout(monkeypatch) -> None:
    """_check_db_ready returns False when the round-trip exceeds the bound."""
    import asyncio

    from app.main import _check_db_ready

    engine = _mock_probe_engine()
    conn = engine.connect.return_value.__aenter__.return_value

    async def _hang(_stmt) -> None:
        await asyncio.sleep(60)

    conn.execute = AsyncMock(side_effect=_hang)
    monkeypatch.setattr(
        "app.main.get_probe_engine", MagicMock(return_value=engine)
    )

    assert await _check_db_ready(timeout=0.05) is False


def test_check_storage_writable_ok() -> None:
    """_check_storage_writable succeeds when the admin_tasks directory is writable."""
    from app.main import _check_storage_writable

    assert _check_storage_writable() is True


def test_check_storage_writable_fails(tmp_path, monkeypatch) -> None:
    """_check_storage_writable returns False when the directory is read-only."""
    import stat

    from app import main

    read_only_dir = tmp_path / "admin_tasks"
    read_only_dir.mkdir()
    read_only_dir.chmod(stat.S_IRUSR | stat.S_IXUSR)
    monkeypatch.setattr(main, "_ensure_tasks_dir", lambda: str(read_only_dir))

    from app.main import _check_storage_writable

    try:
        assert _check_storage_writable() is False
    finally:
        read_only_dir.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)


# ── _resolve_cors_config ──────────────────────────────────


def test_resolve_cors_config_explicit_origins() -> None:
    from app.main import _resolve_cors_config

    origins, credentials = _resolve_cors_config(
        "https://hriv.example.ca, https://hriv-dev.example.ca ", "required"
    )
    assert origins == [
        "https://hriv.example.ca",
        "https://hriv-dev.example.ca",
    ]
    assert credentials is True


def test_resolve_cors_config_wildcard_local_disables_credentials() -> None:
    """A bare ``*`` must never carry credentials — even in local mode."""
    from app.main import _resolve_cors_config

    origins, credentials = _resolve_cors_config("*", "local")
    assert origins == ["*"]
    assert credentials is False


def test_resolve_cors_config_unset_local_disables_credentials(
    caplog,
) -> None:
    """Unset CORS_ORIGINS in local mode warns loudly and drops credentials."""
    import logging

    from app.main import _resolve_cors_config

    with caplog.at_level(logging.WARNING):
        origins, credentials = _resolve_cors_config("", "local")
    assert origins == ["*"]
    assert credentials is False
    assert "credentials DISABLED" in caplog.text


def test_resolve_cors_config_mixed_wildcard_treated_as_wildcard() -> None:
    """``*`` anywhere in the list collapses to wildcard semantics."""
    from app.main import _resolve_cors_config

    origins, credentials = _resolve_cors_config(
        "*, https://hriv.example.ca", "local"
    )
    assert origins == ["*"]
    assert credentials is False


def test_resolve_cors_config_wildcard_required_fails_fast() -> None:
    from app.main import _resolve_cors_config

    with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
        _resolve_cors_config("*", "required")


def test_resolve_cors_config_unset_required_fails_fast() -> None:
    from app.main import _resolve_cors_config

    with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
        _resolve_cors_config("", "required")


def test_maintenance_wins_over_disabled_collections(monkeypatch) -> None:
    """Maintenance 503 takes priority over the collections dark-launch 404."""
    from app.database import settings
    from app.main import app as main_app

    monkeypatch.setattr(settings, "collections_enabled", False)
    with patch("app.middleware.is_maintenance_mode", return_value=True):
        with TestClient(main_app, raise_server_exceptions=False) as client:
            assert client.get("/api/collections").status_code == 503
    with patch("app.middleware.is_maintenance_mode", return_value=False):
        with TestClient(main_app, raise_server_exceptions=False) as client:
            assert client.get("/api/collections").status_code == 404


_SYNTHETIC_RESULT_BODY = {
    "event_version": 1,
    "started_at": "2026-07-14T08:00:00Z",
    "completed_at": "2026-07-14T08:00:03Z",
    "success": False,
    "duration_ms": 3000,
    "failure_code": "login_failed",
    "component_version": "1.2.3",
    "steps": [
        {"name": "frontend", "success": True, "duration_ms": 200},
        {"name": "login", "success": False, "duration_ms": 300},
    ],
}


def test_synthetic_result_ingest_token_through_http_stack(monkeypatch) -> None:
    """A valid X-Synthetic-Ingest-Token posts a result through the full
    middleware + dependency stack during maintenance — no user JWT and no
    database access on the credential path (#1495)."""
    from app.database import settings
    from app.main import app as main_app
    from app.synthetic_result import (
        StoredSyntheticJourneyState,
        SyntheticJourneyResult,
    )

    monkeypatch.setattr(settings, "synthetic_ingest_token", "sekrit")
    result = SyntheticJourneyResult.model_validate(_SYNTHETIC_RESULT_BODY)
    stored = StoredSyntheticJourneyState(
        latest_result=result,
        last_success_completed_at=result.completed_at,
        updated_at=result.completed_at,
    )
    store = AsyncMock(return_value=stored)
    with (
        patch("app.middleware.is_maintenance_mode", return_value=True),
        patch("app.routers.telemetry.check_rate_limit", AsyncMock(return_value=None)),
        patch("app.routers.telemetry.store_synthetic_result", store),
    ):
        with TestClient(main_app, raise_server_exceptions=False) as client:
            response = client.post(
                "/api/telemetry/synthetic-result",
                headers={"X-Synthetic-Ingest-Token": "sekrit"},
                json=_SYNTHETIC_RESULT_BODY,
            )

    assert response.status_code == 202
    store.assert_awaited_once()


def test_synthetic_result_still_requires_credential_during_maintenance(
    monkeypatch,
) -> None:
    """The maintenance exemption does not bypass the endpoint's own auth."""
    from app.main import app as main_app

    with patch("app.middleware.is_maintenance_mode", return_value=True):
        with TestClient(main_app, raise_server_exceptions=False) as client:
            response = client.post(
                "/api/telemetry/synthetic-result",
                json=_SYNTHETIC_RESULT_BODY,
            )

    assert response.status_code == 401


async def test_features_endpoint_reports_collections_flag(monkeypatch) -> None:
    from app.database import settings
    from app.main import features

    monkeypatch.setattr(settings, "collections_enabled", False)
    assert (await features()).collections is False

    monkeypatch.setattr(settings, "collections_enabled", True)
    assert (await features()).collections is True


def test_otel_route_details_resolves_included_routes() -> None:
    """``_get_route_details`` must resolve routes from the real app tree.

    FastAPI 0.137 nests ``include_router`` routes under ``_IncludedRouter``
    nodes that expose no ``.path``; opentelemetry-instrumentation-fastapi
    <0.64b0 raised ``AttributeError: '_IncludedRouter' object has no
    attribute 'path'`` on every routed request — the 2026-09-28 stable
    outage. Calling the installed helper against the real ``app.routes``
    fails CI if that dependency combination ever returns.
    """
    from app.main import app as main_app
    from opentelemetry.instrumentation.fastapi import _get_route_details

    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.5"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "https",
        "path": "/api/auth/oidc/enabled",
        "raw_path": b"/api/auth/oidc/enabled",
        "query_string": b"",
        "root_path": "",
        "headers": [],
        "client": ("127.0.0.1", 50000),
        "server": ("hriv.ltc.bcit.ca", 443),
        "app": main_app,
    }
    assert _get_route_details(scope) == "/api/auth/oidc/enabled"
