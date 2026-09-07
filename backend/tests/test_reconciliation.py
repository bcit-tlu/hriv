"""Tests for the shared best-effort reconciliation sweep."""

from unittest.mock import AsyncMock, MagicMock

import pytest


def _session_factory_returning(session) -> MagicMock:
    context = MagicMock()
    context.__aenter__ = AsyncMock(return_value=session)
    context.__aexit__ = AsyncMock(return_value=False)
    return MagicMock(return_value=context)


@pytest.fixture(autouse=True)
def _fake_data_dir(tmp_path, monkeypatch):
    """Patch settings so app.reconciliation's lazy imports don't need /data."""
    tiles = tmp_path / "tiles"
    tiles.mkdir()
    source = tmp_path / "source_images"
    source.mkdir()

    from app import admin_ops
    from app.database import settings

    monkeypatch.setattr(settings, "tiles_dir", str(tiles))
    monkeypatch.setattr(settings, "source_images_dir", str(source))
    monkeypatch.setattr(admin_ops, "_TASKS_DIR", str(tmp_path / "admin_tasks"))


async def test_run_reconciliation_sweep_calls_all_five_steps(monkeypatch) -> None:
    from app import admin_ops, processing, reconciliation, tile_rebuild_jobs
    from app.routers import bulk_import

    session_factory = _session_factory_returning(AsyncMock())
    monkeypatch.setattr(reconciliation, "get_async_session", MagicMock(return_value=session_factory))

    reconcile_tasks = AsyncMock()
    archive_retention = AsyncMock()
    reconcile_source_images = AsyncMock()
    reconcile_bulk_import = AsyncMock()
    reconcile_rebuilds = AsyncMock()
    rebuild_submit = AsyncMock()
    monkeypatch.setattr(admin_ops, "reconcile_stale_tasks", reconcile_tasks)
    monkeypatch.setattr(admin_ops, "enforce_files_import_archive_retention", archive_retention)
    monkeypatch.setattr(processing, "reconcile_stale_source_images", reconcile_source_images)
    monkeypatch.setattr(bulk_import, "reconcile_stale_bulk_import_jobs", reconcile_bulk_import)
    monkeypatch.setattr(
        tile_rebuild_jobs,
        "reconcile_tile_rebuild_jobs",
        reconcile_rebuilds,
    )

    await reconciliation.run_reconciliation_sweep(
        rebuild_submit=rebuild_submit
    )

    reconcile_tasks.assert_awaited_once()
    archive_retention.assert_awaited_once()
    reconcile_source_images.assert_awaited_once()
    reconcile_bulk_import.assert_awaited_once()
    reconcile_rebuilds.assert_awaited_once_with(rebuild_submit)


async def test_run_reconciliation_sweep_forwards_current_job_id(monkeypatch) -> None:
    """The sweep's own arq job ID (when running as the required-mode cron
    job) is forwarded to reconcile_stale_source_images so it can exclude its
    own in-flight queue entry from the pending-row idleness check."""
    from app import admin_ops, processing, reconciliation, tile_rebuild_jobs
    from app.routers import bulk_import

    session_factory = _session_factory_returning(AsyncMock())
    monkeypatch.setattr(reconciliation, "get_async_session", MagicMock(return_value=session_factory))

    monkeypatch.setattr(admin_ops, "reconcile_stale_tasks", AsyncMock())
    monkeypatch.setattr(admin_ops, "enforce_files_import_archive_retention", AsyncMock())
    reconcile_source_images = AsyncMock()
    monkeypatch.setattr(processing, "reconcile_stale_source_images", reconcile_source_images)
    monkeypatch.setattr(bulk_import, "reconcile_stale_bulk_import_jobs", AsyncMock())
    monkeypatch.setattr(
        tile_rebuild_jobs,
        "reconcile_tile_rebuild_jobs",
        AsyncMock(),
    )

    await reconciliation.run_reconciliation_sweep(current_job_id="reconciliation_sweep_task:123")

    _args, kwargs = reconcile_source_images.await_args
    assert kwargs["current_job_id"] == "reconciliation_sweep_task:123"


async def test_run_reconciliation_sweep_continues_when_one_step_fails(caplog, monkeypatch) -> None:
    """A failure in one reconciliation step must not prevent the others
    from running — each step is isolated in its own try/except."""
    from app import admin_ops, processing, reconciliation, tile_rebuild_jobs
    from app.routers import bulk_import

    session_factory = _session_factory_returning(AsyncMock())
    monkeypatch.setattr(reconciliation, "get_async_session", MagicMock(return_value=session_factory))

    monkeypatch.setattr(admin_ops, "reconcile_stale_tasks", AsyncMock())
    monkeypatch.setattr(admin_ops, "enforce_files_import_archive_retention", AsyncMock())
    monkeypatch.setattr(processing, "reconcile_stale_source_images", AsyncMock())
    reconcile_bulk_import = AsyncMock(side_effect=RuntimeError("database unavailable"))
    rebuild_submit = AsyncMock()
    monkeypatch.setattr(bulk_import, "reconcile_stale_bulk_import_jobs", reconcile_bulk_import)
    reconcile_rebuilds = AsyncMock()
    monkeypatch.setattr(
        tile_rebuild_jobs,
        "reconcile_tile_rebuild_jobs",
        reconcile_rebuilds,
    )

    await reconciliation.run_reconciliation_sweep(
        rebuild_submit=rebuild_submit
    )

    reconcile_bulk_import.assert_awaited_once()
    reconcile_rebuilds.assert_awaited_once_with(rebuild_submit)
    assert "Stale bulk-import reconciliation failed" in caplog.text


async def test_rebuild_reconciliation_failure_is_isolated(
    caplog,
    monkeypatch,
) -> None:
    from app import admin_ops, processing, reconciliation, tile_rebuild_jobs
    from app.routers import bulk_import

    session_factory = _session_factory_returning(AsyncMock())
    monkeypatch.setattr(
        reconciliation,
        "get_async_session",
        MagicMock(return_value=session_factory),
    )
    monkeypatch.setattr(admin_ops, "reconcile_stale_tasks", AsyncMock())
    monkeypatch.setattr(
        admin_ops,
        "enforce_files_import_archive_retention",
        AsyncMock(),
    )
    monkeypatch.setattr(
        processing,
        "reconcile_stale_source_images",
        AsyncMock(),
    )
    monkeypatch.setattr(
        bulk_import,
        "reconcile_stale_bulk_import_jobs",
        AsyncMock(),
    )
    monkeypatch.setattr(
        tile_rebuild_jobs,
        "reconcile_tile_rebuild_jobs",
        AsyncMock(side_effect=RuntimeError("pump unavailable")),
    )

    await reconciliation.run_reconciliation_sweep(
        rebuild_submit=AsyncMock()
    )

    assert "Durable tile-rebuild reconciliation failed" in caplog.text
