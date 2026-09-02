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

    from app.database import settings
    from app import admin_ops

    monkeypatch.setattr(settings, "tiles_dir", str(tiles))
    monkeypatch.setattr(settings, "source_images_dir", str(source))
    monkeypatch.setattr(admin_ops, "_TASKS_DIR", str(tmp_path / "admin_tasks"))


async def test_run_reconciliation_sweep_calls_all_four_steps(monkeypatch) -> None:
    from app import reconciliation, admin_ops, processing
    from app.routers import bulk_import

    session_factory = _session_factory_returning(AsyncMock())
    monkeypatch.setattr(reconciliation, "get_async_session", MagicMock(return_value=session_factory))

    reconcile_tasks = AsyncMock()
    archive_retention = AsyncMock()
    reconcile_source_images = AsyncMock()
    reconcile_bulk_import = AsyncMock()
    monkeypatch.setattr(admin_ops, "reconcile_stale_tasks", reconcile_tasks)
    monkeypatch.setattr(admin_ops, "enforce_files_import_archive_retention", archive_retention)
    monkeypatch.setattr(processing, "reconcile_stale_source_images", reconcile_source_images)
    monkeypatch.setattr(bulk_import, "reconcile_stale_bulk_import_jobs", reconcile_bulk_import)

    await reconciliation.run_reconciliation_sweep()

    reconcile_tasks.assert_awaited_once()
    archive_retention.assert_awaited_once()
    reconcile_source_images.assert_awaited_once()
    reconcile_bulk_import.assert_awaited_once()


async def test_run_reconciliation_sweep_continues_when_one_step_fails(caplog, monkeypatch) -> None:
    """A failure in one reconciliation step must not prevent the others
    from running — each step is isolated in its own try/except."""
    from app import reconciliation, admin_ops, processing
    from app.routers import bulk_import

    session_factory = _session_factory_returning(AsyncMock())
    monkeypatch.setattr(reconciliation, "get_async_session", MagicMock(return_value=session_factory))

    monkeypatch.setattr(admin_ops, "reconcile_stale_tasks", AsyncMock())
    monkeypatch.setattr(admin_ops, "enforce_files_import_archive_retention", AsyncMock())
    monkeypatch.setattr(processing, "reconcile_stale_source_images", AsyncMock())
    reconcile_bulk_import = AsyncMock(side_effect=RuntimeError("database unavailable"))
    monkeypatch.setattr(bulk_import, "reconcile_stale_bulk_import_jobs", reconcile_bulk_import)

    await reconciliation.run_reconciliation_sweep()

    reconcile_bulk_import.assert_awaited_once()
    assert "Stale bulk-import reconciliation failed" in caplog.text
