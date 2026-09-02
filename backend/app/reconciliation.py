"""Shared best-effort reconciliation sweep.

Reconciles state left behind by a previous pod crash/rollout: orphaned
``AdminTask`` rows, retained files-import archives past their retention
window, orphaned ``SourceImage`` rows stuck in "processing", and orphaned
``BulkImportJob`` rows stuck "running".

This sweep has two homes depending on ``TASK_EXECUTION_MODE``:

* ``local`` (no dedicated worker pod, e.g. dev/compose) — run once at API
  startup via ``main.py``'s ``lifespan()`` handler. This is the only
  process running, so it must self-heal on boot.
* ``required`` (dedicated arq worker pod) — run periodically via an arq
  ``cron`` job on the worker (see ``worker.WorkerSettings.cron_jobs``).
  A periodic sweep catches staleness that accumulates between
  deployments/restarts, not just at boot, and keeps the reconciliation
  path off the API pod's startup critical section.

The reconcile functions themselves are imported lazily inside
``run_reconciliation_sweep`` (rather than at module import time) because
``admin_ops`` and ``routers.bulk_import`` both import from ``worker`` —
importing them eagerly here would create a circular import when
``worker.py`` imports this module.
"""

import logging

from .database import get_async_session

logger = logging.getLogger(__name__)


async def run_reconciliation_sweep() -> None:
    """Run the full best-effort reconciliation sweep.

    Each step opens its own session and is isolated in its own try/except
    so that a failure in one reconciliation step does not prevent the
    others from running.
    """
    # Local imports to avoid a circular import: admin_ops and
    # routers.bulk_import both import from worker, and worker imports
    # this module to wire up its cron job.
    from .admin_ops import enforce_files_import_archive_retention, reconcile_stale_tasks
    from .processing import reconcile_stale_source_images
    from .routers.bulk_import import reconcile_stale_bulk_import_jobs

    # Reconcile admin tasks orphaned by a previous pod crash/rollout so
    # their concurrency guard doesn't permanently block new imports or
    # exports.  Stale-timestamp protection keeps multi-replica deployments
    # safe (sibling pods still writing progress will not be clobbered).
    try:
        async with get_async_session()() as session:
            await reconcile_stale_tasks(session)
    except Exception as exc:  # pragma: no cover - best effort
        logger.warning(
            "Stale admin task reconciliation failed: %s",
            exc,
            extra={"event": "admin_task.reconcile_failed", "error": str(exc)},
        )

    # Apply the retained files-import archive retention policy so age-based
    # limits take effect even when no new import runs (no-op unless the
    # FILES_IMPORT_ARCHIVE_RETENTION_* settings opt in).
    try:
        async with get_async_session()() as session:
            await enforce_files_import_archive_retention(session)
    except Exception as exc:  # pragma: no cover - best effort
        logger.warning(
            "Files-import archive retention enforcement failed: %s",
            exc,
            extra={
                "event": "admin_task.archive_retention_failed",
                "error": str(exc),
            },
        )

    # Reconcile SourceImages orphaned by a previous pod crash/rollout
    # so they don't appear stuck in "processing" in the UI forever.
    try:
        async with get_async_session()() as session:
            await reconcile_stale_source_images(session)
    except Exception as exc:  # pragma: no cover - best effort
        logger.warning(
            "Stale source image reconciliation failed: %s",
            exc,
            extra={"event": "processing.reconcile_failed", "error": str(exc)},
        )

    try:
        async with get_async_session()() as session:
            await reconcile_stale_bulk_import_jobs(session)
    except Exception as exc:  # pragma: no cover - best effort
        logger.warning(
            "Stale bulk-import reconciliation failed: %s",
            exc,
            extra={
                "event": "bulk_import.reconcile_failed",
                "error": str(exc),
            },
        )
