"""Regression coverage for required-mode queue boundaries."""

import inspect
from io import BytesIO
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

# Ensure router imports do not require a system libvips installation.
if "pyvips" not in sys.modules:
    sys.modules["pyvips"] = MagicMock()
    sys.modules["pyvips.enums"] = MagicMock()

from fastapi import UploadFile

from app.database import settings
from app.admin_ops import _queue_rebuild_tiles_after_import
from app.routers import admin, bulk_import, images, upload
from app.worker import TaskQueueUnavailableError


def test_required_mode_call_site_matrix_has_terminal_rejection_guards() -> None:
    """Every task-producing call site must handle required-mode rejection."""
    call_sites = (
        (upload.upload_source_image, "TaskQueueUnavailableError"),
        (images.replace_image, "TaskQueueUnavailableError"),
        (bulk_import._process_bulk_import_impl, "TaskQueueUnavailableError"),
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


def _upload_file(filename: str = "image.jpg") -> UploadFile:
    return UploadFile(
        file=BytesIO(b"image-data"),
        filename=filename,
        headers=MagicMock(
            get=lambda key, default=None: (
                "image/jpeg" if key == "content-type" else default
            ),
        ),
    )


async def test_required_mode_call_site_matrix_rejects_without_runners(tmp_path) -> None:
    """Exercise every queue-producing router path in required mode."""
    queue_error = TaskQueueUnavailableError("queue_unavailable")

    upload_db = MagicMock()
    upload_db.commit = AsyncMock()
    upload_db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "id", 1))
    upload_bg = MagicMock()
    with (
        patch.object(settings, "task_execution_mode", "required"),
        patch.object(settings, "source_images_dir", str(tmp_path)),
        patch("app.routers.upload.is_valid_image", return_value=True),
        patch(
            "app.routers.upload.enqueue_process_source_image",
            new_callable=AsyncMock,
            side_effect=queue_error,
        ),
    ):
        try:
            await upload.upload_source_image(
                _upload_file(),
                upload_bg,
                MagicMock(),
                db=upload_db,
            )
        except TaskQueueUnavailableError:
            pass
        else:
            raise AssertionError("upload accepted a rejected queue submission")
    upload_src = upload_db.add.call_args.args[0]
    assert upload_src.status == "failed"
    upload_bg.add_task.assert_not_called()

    image = SimpleNamespace(
        id=1,
        name="image",
        category_id=None,
        copyright=None,
        note=None,
        active=True,
        metadata_=None,
        version=1,
    )
    replace_db = MagicMock()
    replace_db.get = AsyncMock(return_value=image)
    replace_db.commit = AsyncMock()
    replace_db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "id", 2))
    replace_bg = MagicMock()
    with (
        patch.object(settings, "task_execution_mode", "required"),
        patch.object(settings, "source_images_dir", str(tmp_path)),
        patch("app.routers.images.is_valid_image", return_value=True),
        patch(
            "app.worker.enqueue_replace_image",
            new_callable=AsyncMock,
            side_effect=queue_error,
        ),
    ):
        try:
            await images.replace_image(
                1,
                _upload_file("replacement.jpg"),
                replace_bg,
                MagicMock(),
                db=replace_db,
            )
        except TaskQueueUnavailableError:
            pass
        else:
            raise AssertionError("replacement accepted a rejected queue submission")
    replace_src = replace_db.add.call_args.args[0]
    assert replace_src.status == "failed"
    replace_bg.add_task.assert_not_called()

    job = SimpleNamespace(
        id=4,
        category_id=None,
        status="pending",
        failed_count=1,
        completed_count=0,
        total_count=1,
    )
    persisted_source = SimpleNamespace(
        id=5,
        category_id=None,
        status="pending",
        status_message=None,
        error_message=None,
    )
    session = MagicMock()
    session.commit = AsyncMock()
    session.execute = AsyncMock()
    session.get = AsyncMock(
        side_effect=lambda model, _id: (
            job if model is bulk_import.BulkImportJob else persisted_source
        ),
    )
    session.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "id", 5))
    session_factory = MagicMock()
    context = MagicMock()
    context.__aenter__ = AsyncMock(return_value=session)
    context.__aexit__ = AsyncMock(return_value=False)
    session_factory.return_value = context
    staged = tmp_path / "per-file.jpg"
    staged.write_bytes(b"data")
    with (
        patch.object(settings, "task_execution_mode", "required"),
        patch("app.routers.bulk_import.async_session", session_factory),
        patch(
            "app.routers.bulk_import.enqueue_process_source_image",
            new_callable=AsyncMock,
            side_effect=queue_error,
        ),
    ):
        await bulk_import._process_bulk_import(4, [("per-file.jpg", str(staged))])
    assert persisted_source.status == "failed"
    assert persisted_source.error_message == (
        "Task queue unavailable; image processing was not started."
    )
    assert not staged.exists()

    retained_input = tmp_path / "retained.tar.gz"
    retained_input.write_bytes(b"retained archive")
    admin_task = SimpleNamespace(
        id=6,
        task_type="db_export",
        log="",
        input_path=str(retained_input),
    )
    admin_bg = MagicMock()
    admin_session = MagicMock()
    admin_session.execute = AsyncMock()
    admin_session.commit = AsyncMock()
    admin_context = MagicMock()
    admin_context.__aenter__ = AsyncMock(return_value=admin_session)
    admin_context.__aexit__ = AsyncMock(return_value=False)
    with (
        patch.object(settings, "task_execution_mode", "required"),
        patch("app.routers.admin.async_session", MagicMock(return_value=admin_context)),
        patch(
            "app.routers.admin.enqueue_admin_task",
            new_callable=AsyncMock,
            side_effect=queue_error,
        ),
    ):
        try:
            await admin._kick_off(admin_task, admin_bg)
        except TaskQueueUnavailableError:
            pass
        else:
            raise AssertionError("admin kickoff accepted a rejected submission")
    admin_bg.add_task.assert_not_called()
    assert admin_session.execute.await_count == 1
    assert retained_input.exists()

    rebuild_session = MagicMock()
    existing_result = MagicMock()
    existing_result.scalars.return_value.first.return_value = None
    insert_result = MagicMock()
    insert_result.scalar.return_value = 7
    rebuild_session.execute = AsyncMock(
        side_effect=[existing_result, insert_result, MagicMock()],
    )
    rebuild_session.commit = AsyncMock()
    rebuild_context = MagicMock()
    rebuild_context.__aenter__ = AsyncMock(return_value=rebuild_session)
    rebuild_context.__aexit__ = AsyncMock(return_value=False)
    rebuild_factory = MagicMock(return_value=rebuild_context)
    import_task = SimpleNamespace(created_by=1)
    with (
        patch.object(settings, "task_execution_mode", "required"),
        patch("app.admin_ops.get_async_session", return_value=rebuild_factory),
        patch("app.admin_ops._ensure_tasks_dir", return_value=str(tmp_path)),
        patch(
            "app.admin_ops.enqueue_admin_task",
            new_callable=AsyncMock,
            side_effect=queue_error,
        ),
    ):
        message = await _queue_rebuild_tiles_after_import(import_task)
    assert "Could not queue automatic tile rebuild" in message
    assert rebuild_session.execute.await_count == 3
    assert rebuild_session.commit.await_count == 2


def bulk_import_upload(filename: str) -> AsyncMock:
    upload = AsyncMock()
    upload.filename = filename
    upload.read = AsyncMock(side_effect=[b"image-data", b""])
    return upload
