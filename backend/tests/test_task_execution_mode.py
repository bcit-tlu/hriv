"""Regression coverage for required-mode queue boundaries."""

import inspect
import sys
from unittest.mock import MagicMock

# Ensure router imports do not require a system libvips installation.
if "pyvips" not in sys.modules:
    sys.modules["pyvips"] = MagicMock()
    sys.modules["pyvips.enums"] = MagicMock()

from app.admin_ops import _queue_rebuild_tiles_after_import
from app.routers import admin, bulk_import, images, upload


def test_required_mode_call_site_matrix_has_terminal_rejection_guards() -> None:
    """Every task-producing call site must handle required-mode rejection."""
    call_sites = (
        (upload.upload_source_image, "TaskQueueUnavailableError"),
        (images.replace_image, "TaskQueueUnavailableError"),
        (bulk_import.bulk_import_images, "TaskQueueUnavailableError"),
        (bulk_import._process_bulk_import, "TaskQueueUnavailableError"),
        (admin._kick_off, "TaskQueueUnavailableError"),
    )

    for call_site, rejection_type in call_sites:
        source = inspect.getsource(call_site)
        assert "enqueue_" in source
        assert rejection_type in source

    rebuild_source = inspect.getsource(_queue_rebuild_tiles_after_import)
    assert "enqueue_admin_task" in rebuild_source
    assert "task_execution_mode" in rebuild_source
    assert 'status="failed"' in rebuild_source
