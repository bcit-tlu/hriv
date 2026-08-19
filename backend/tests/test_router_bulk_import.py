"""Tests for the bulk_import router helper functions and endpoints.

Covers https://github.com/bcit-tlu/hriv/issues/23 — the previous suite only
exercised the simple list/lookup paths.  These tests drive ZIP extraction,
image-filtering, error handling, job-state transitions, and the background
processing helper.
"""

import errno
import io
import logging
import os
import sys
import time
import zipfile
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from arq.constants import abort_jobs_ss
from arq.jobs import JobStatus
from fastapi import HTTPException

# Ensure pyvips can be imported even when libvips is not installed (CI)
if "pyvips" not in sys.modules:
    sys.modules["pyvips"] = MagicMock()
    sys.modules["pyvips.enums"] = MagicMock()

from app.routers.bulk_import import (
    _BulkImportProgress,
    _bulk_import_has_capacity_starvation,
    _is_image_filename,
    _process_bulk_import,
    _wait_for_source_image_terminal_state,
    bulk_import_images,
    get_bulk_import_job,
    list_bulk_import_jobs,
    reconcile_stale_bulk_import_jobs,
)
from app.worker import EnqueueResult, TaskQueueUnavailableError, WorkerSettings


# ── Global fixture: default enqueue_bulk_import to False (no Redis) ───────
# The endpoint now prefers arq; patch it to return a fallback result by default so
# the BackgroundTasks fallback path (tested by existing tests) is exercised.

@pytest.fixture(autouse=True)
def _patch_enqueue_bulk_import():
    with (
        patch("app.routers.bulk_import.enqueue_bulk_import", new_callable=AsyncMock, return_value=EnqueueResult("fallback", "queue_unavailable")),
        patch("app.routers.bulk_import.enqueue_process_source_image", new_callable=AsyncMock, return_value=EnqueueResult("fallback", "queue_unavailable")),
        patch("app.routers.bulk_import._SOURCE_IMAGE_QUEUE_STATE_SAMPLE_POLLS", 1),
        patch(
            "app.routers.bulk_import.collect_queue_state",
            new_callable=AsyncMock,
            return_value={"queue_up": True, "worker_up": True},
        ),
    ):
        yield


# ── _is_image_filename ────────────────────────────────────────────────────


def test_pending_wait_ceiling_stays_below_coordinator_timeout() -> None:
    """The coordinator can record a pending-ceiling failure before arq kills it."""
    from app.routers.bulk_import import (
        _SOURCE_IMAGE_PENDING_WAIT_SAFETY_CAP_SECONDS,
    )

    assert (
        0
        < _SOURCE_IMAGE_PENDING_WAIT_SAFETY_CAP_SECONDS
        < WorkerSettings.job_timeout
    )


def test_processing_wait_ceiling_outlasts_child_timeout() -> None:
    """The processing backstop cannot fail a child before arq can time it out."""
    from app.routers.bulk_import import (
        _SOURCE_IMAGE_PROCESSING_WAIT_SAFETY_CAP_SECONDS,
    )

    assert _SOURCE_IMAGE_PROCESSING_WAIT_SAFETY_CAP_SECONDS > WorkerSettings.job_timeout


async def test_reconcile_stale_bulk_import_jobs_marks_processing_stale() -> None:
    row = MagicMock()
    row.__getitem__ = lambda self, index: 27
    result = MagicMock()
    result.all.return_value = [row]
    session = AsyncMock()
    session.execute = AsyncMock(return_value=result)

    count = await reconcile_stale_bulk_import_jobs(
        session,
        stale_after_seconds=900,
    )

    assert count == 1
    session.commit.assert_awaited_once()
    stmt = session.execute.await_args.args[0]
    assert stmt.compile().params["status_1"] == "processing"
    sql = str(stmt.compile())
    assert "errors" not in sql
    assert "failed_count" not in sql


def test_is_image_filename_valid() -> None:
    assert _is_image_filename("photo.jpg") is True
    assert _is_image_filename("photo.jpeg") is True
    assert _is_image_filename("photo.png") is True
    assert _is_image_filename("photo.tif") is True
    assert _is_image_filename("photo.tiff") is True
    assert _is_image_filename("photo.gif") is True
    assert _is_image_filename("photo.webp") is True
    assert _is_image_filename("photo.svs") is True


def test_is_image_filename_invalid() -> None:
    assert _is_image_filename("document.pdf") is False
    assert _is_image_filename("readme.txt") is False
    assert _is_image_filename("archive.zip") is False
    assert _is_image_filename("script.py") is False
    # BMP is intentionally rejected: no native libvips loader and the
    # ImageMagick delegate is disabled in the backend image.
    assert _is_image_filename("photo.bmp") is False


def test_is_image_filename_case_insensitive() -> None:
    assert _is_image_filename("PHOTO.JPG") is True
    assert _is_image_filename("Photo.PNG") is True
    assert _is_image_filename("image.TIF") is True


# ── list / get ────────────────────────────────────────────────────────────


async def test_list_bulk_import_jobs() -> None:
    jobs = [
        SimpleNamespace(id=1, status="completed", total_count=5),
        SimpleNamespace(id=2, status="pending", total_count=3),
    ]
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = jobs

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    result = await list_bulk_import_jobs(MagicMock(), db)
    assert len(result) == 2


async def test_get_bulk_import_job_found() -> None:
    job = SimpleNamespace(id=1, status="completed", total_count=5)
    db = AsyncMock()
    db.get = AsyncMock(return_value=job)

    result = await get_bulk_import_job(1, MagicMock(), db)
    assert result.status == "completed"


async def test_get_bulk_import_job_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await get_bulk_import_job(999, MagicMock(), db)
    assert exc.value.status_code == 404


# ── bulk_import_images endpoint ───────────────────────────────────────────


def _make_upload(
    filename: str,
    chunks: list[bytes] | None = None,
) -> AsyncMock:
    """Build a minimal ``UploadFile`` stand-in that returns ``chunks`` on read."""
    payload = chunks if chunks is not None else [b"some-bytes", b""]
    upload = AsyncMock()
    upload.filename = filename
    upload.read = AsyncMock(side_effect=payload)
    return upload


def _zip_bytes(entries: dict[str, bytes]) -> bytes:
    """Return an in-memory zip archive containing ``entries``."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


async def test_bulk_import_images_rejects_empty_file_list() -> None:
    db = AsyncMock()
    bg = MagicMock()
    with pytest.raises(HTTPException) as exc:
        await bulk_import_images(
            files=[],
            category_id=1,
            background_tasks=bg,
            _user=MagicMock(),
            db=db,
        )
    assert exc.value.status_code == 400
    assert "no files" in exc.value.detail.lower()


async def test_bulk_import_images_rejects_missing_category() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)  # Category not found
    bg = MagicMock()

    with pytest.raises(HTTPException) as exc:
        await bulk_import_images(
            files=[_make_upload("one.png")],
            category_id=999,
            background_tasks=bg,
            _user=MagicMock(),
            db=db,
        )
    assert exc.value.status_code == 400
    assert "category" in exc.value.detail.lower()


async def test_bulk_import_images_rejects_when_no_valid_images(tmp_path) -> None:
    """Non-image files in the upload are silently skipped, so a payload
    consisting entirely of non-images results in a 400."""
    db = AsyncMock()
    db.get = AsyncMock(return_value=SimpleNamespace(id=1))  # Category exists
    bg = MagicMock()

    with patch("app.routers.bulk_import.settings") as mock_settings:
        mock_settings.source_images_dir = str(tmp_path)
        with pytest.raises(HTTPException) as exc:
            await bulk_import_images(
                files=[_make_upload("readme.txt")],
                category_id=1,
                background_tasks=bg,
                _user=MagicMock(),
                db=db,
            )
    assert exc.value.status_code == 400
    assert "no valid image files" in exc.value.detail.lower()


async def test_bulk_import_images_accepts_plain_image(tmp_path) -> None:
    category = SimpleNamespace(id=1)
    created_job = SimpleNamespace(
        id=42,
        status="pending",
        total_count=1,
        category_id=1,
    )
    db = AsyncMock()
    db.get = AsyncMock(return_value=category)
    db.add = MagicMock()
    db.commit = AsyncMock()

    async def _refresh(obj) -> None:
        obj.id = created_job.id

    db.refresh = AsyncMock(side_effect=_refresh)
    bg = MagicMock()

    with patch("app.routers.bulk_import.settings") as mock_settings:
        mock_settings.source_images_dir = str(tmp_path)
        result = await bulk_import_images(
            files=[_make_upload("a.png", [b"png-bytes", b""])],
            category_id=1,
            background_tasks=bg,
            _user=MagicMock(),
            db=db,
        )

    # Created job row
    assert result.id == 42
    # Exactly one file was streamed to disk
    stored = list(tmp_path.iterdir())
    assert len(stored) == 1
    # Background processing task was scheduled
    assert bg.add_task.call_count == 1
    # The only positional arg is the job id
    _, args, _ = bg.add_task.mock_calls[0]
    assert args[1] == 42


async def test_bulk_import_images_accepts_no_category(tmp_path) -> None:
    """Bulk import with category_id=None uploads images to root level."""
    created_job = SimpleNamespace(
        id=50,
        status="pending",
        total_count=1,
        category_id=None,
    )
    db = AsyncMock()
    # category_id=None means db.get for Category is never called
    db.add = MagicMock()
    db.commit = AsyncMock()

    async def _refresh(obj) -> None:
        obj.id = created_job.id

    db.refresh = AsyncMock(side_effect=_refresh)
    bg = MagicMock()

    with patch("app.routers.bulk_import.settings") as mock_settings:
        mock_settings.source_images_dir = str(tmp_path)
        result = await bulk_import_images(
            files=[_make_upload("a.png", [b"png-bytes", b""])],
            category_id=None,
            background_tasks=bg,
            _user=MagicMock(),
            db=db,
        )

    assert result.id == 50
    stored = list(tmp_path.iterdir())
    assert len(stored) == 1
    assert bg.add_task.call_count == 1
    # db.get should NOT have been called (no category to validate)
    db.get.assert_not_called()


async def test_bulk_import_images_silently_skips_non_image_files(tmp_path) -> None:
    category = SimpleNamespace(id=1)
    db = AsyncMock()
    db.get = AsyncMock(return_value=category)
    db.add = MagicMock()
    db.commit = AsyncMock()

    async def _refresh(obj) -> None:
        obj.id = 7

    db.refresh = AsyncMock(side_effect=_refresh)
    bg = MagicMock()

    files = [
        _make_upload("readme.txt"),  # skipped
        _make_upload("good.png", [b"data", b""]),
    ]
    with patch("app.routers.bulk_import.settings") as mock_settings:
        mock_settings.source_images_dir = str(tmp_path)
        await bulk_import_images(
            files=files,
            category_id=1,
            background_tasks=bg,
            _user=MagicMock(),
            db=db,
        )

    # Only the png was written to disk
    stored = list(tmp_path.iterdir())
    assert len(stored) == 1


async def test_bulk_import_images_extracts_zip_entries(tmp_path) -> None:
    category = SimpleNamespace(id=1)
    db = AsyncMock()
    db.get = AsyncMock(return_value=category)
    db.add = MagicMock()
    db.commit = AsyncMock()

    async def _refresh(obj) -> None:
        obj.id = 3

    db.refresh = AsyncMock(side_effect=_refresh)
    bg = MagicMock()

    zip_payload = _zip_bytes({
        "cell_a.png": b"png-a",
        "cell_b.jpg": b"jpg-b",
        "notes.txt": b"should be skipped",
        "__MACOSX/ignored.png": b"mac metadata",
        ".hidden.png": b"hidden file",
    })
    upload = _make_upload("batch.zip", [zip_payload, b""])

    with patch("app.routers.bulk_import.settings") as mock_settings:
        mock_settings.source_images_dir = str(tmp_path)
        await bulk_import_images(
            files=[upload],
            category_id=1,
            background_tasks=bg,
            _user=MagicMock(),
            db=db,
        )

    # Only the two recognised images were extracted
    stored = list(tmp_path.iterdir())
    assert len(stored) == 2

    # And only those two are passed to the background task
    _, args, _ = bg.add_task.mock_calls[0]
    file_entries = args[2]  # (filename, stored_path) tuples
    basenames = {entry[0] for entry in file_entries}
    assert basenames == {"cell_a.png", "cell_b.jpg"}


async def test_bulk_import_images_streams_zip_extraction(tmp_path) -> None:
    """ZIP entries are copied incrementally instead of loaded in one read."""
    category = SimpleNamespace(id=1)
    db = AsyncMock()
    db.get = AsyncMock(return_value=category)
    db.add = MagicMock()
    db.commit = AsyncMock()

    async def _refresh(obj) -> None:
        obj.id = 4

    db.refresh = AsyncMock(side_effect=_refresh)
    bg = MagicMock()
    upload = _make_upload("batch.zip", [_zip_bytes({"large.tif": b"tif-data"}), b""])

    with (
        patch("app.routers.bulk_import.settings") as mock_settings,
        patch("app.routers.bulk_import.shutil.copyfileobj") as copyfileobj,
    ):
        mock_settings.source_images_dir = str(tmp_path)
        await bulk_import_images(
            files=[upload],
            category_id=1,
            background_tasks=bg,
            _user=MagicMock(),
            db=db,
        )

    copyfileobj.assert_called_once()
    assert copyfileobj.call_args.kwargs["length"] == 1024 * 1024


async def test_bulk_import_images_rejects_corrupt_zip(tmp_path) -> None:
    category = SimpleNamespace(id=1)
    db = AsyncMock()
    db.get = AsyncMock(return_value=category)
    bg = MagicMock()

    upload = _make_upload("corrupt.zip", [b"not-a-zip-at-all", b""])

    with patch("app.routers.bulk_import.settings") as mock_settings:
        mock_settings.source_images_dir = str(tmp_path)
        with pytest.raises(HTTPException) as exc:
            await bulk_import_images(
                files=[upload],
                category_id=1,
                background_tasks=bg,
                _user=MagicMock(),
                db=db,
            )
    assert exc.value.status_code == 400
    assert "valid zip" in exc.value.detail.lower()


async def test_bulk_import_images_skips_uploads_without_filename(tmp_path) -> None:
    """An UploadFile with an empty filename is skipped silently."""
    category = SimpleNamespace(id=1)
    db = AsyncMock()
    db.get = AsyncMock(return_value=category)
    db.add = MagicMock()
    db.commit = AsyncMock()

    async def _refresh(obj) -> None:
        obj.id = 99

    db.refresh = AsyncMock(side_effect=_refresh)
    bg = MagicMock()

    empty = _make_upload("")
    good = _make_upload("ok.png", [b"x", b""])

    with patch("app.routers.bulk_import.settings") as mock_settings:
        mock_settings.source_images_dir = str(tmp_path)
        await bulk_import_images(
            files=[empty, good],
            category_id=1,
            background_tasks=bg,
            _user=MagicMock(),
            db=db,
        )

    stored = list(tmp_path.iterdir())
    assert len(stored) == 1


# ── _process_bulk_import ──────────────────────────────────────────────────


class _SessionContext:
    """Re-usable async context manager that yields a given mock DB session.

    ``_process_bulk_import`` uses ``async with async_session() as db: ...``
    many times — this helper lets a single AsyncMock stand in for each call.
    """

    def __init__(self, db) -> None:
        self._db = db

    async def __aenter__(self):
        return self._db

    async def __aexit__(self, *args) -> None:
        return None


def _make_async_session_factory(db) -> MagicMock:
    """Return a callable ``async_session()`` that yields ``db`` each time."""
    factory = MagicMock()
    factory.side_effect = lambda: _SessionContext(db)
    return factory


async def test_process_bulk_import_completes_successful_job(tmp_path) -> None:
    job = SimpleNamespace(
        id=1,
        status="pending",
        total_count=1,
        completed_count=0,
        failed_count=0,
        category_id=1,
        errors=[],
    )
    src = SimpleNamespace(
        id=10,
        status="completed",
        error_message=None,
        status_message=None,
    )

    db = AsyncMock()
    # db.get() is called with (BulkImportJob, id) three times, interleaved
    # with (SourceImage, id) once.  Return the right object per model.
    def _get(model, pk):
        name = getattr(model, "__name__", "")
        if name == "BulkImportJob":
            return job
        return src

    db.get = AsyncMock(side_effect=_get)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "id", 10))
    db.execute = AsyncMock()

    with (
        patch(
            "app.routers.bulk_import.async_session",
            _make_async_session_factory(db),
        ),
        patch(
            "app.routers.bulk_import.process_source_image",
            new_callable=AsyncMock,
        ),
    ):
        await _process_bulk_import(
            job_id=1,
            file_entries=[("a.png", str(tmp_path / "a.png"))],
            copyright="CC0",
            note=None,
            active=True,
        )

    # Final status is "completed" and the completed_count was incremented
    assert job.status == "completed"


async def test_worker_hosted_bulk_import_registers_and_cleans_up_slot() -> None:
    """Only arq-hosted coordinators register worker-slot occupancy."""
    pool = MagicMock()
    pool.zadd = AsyncMock()
    pool.zrem = AsyncMock()
    pool.zremrangebyscore = AsyncMock()

    with (
        patch("app.routers.bulk_import.get_pool", new_callable=AsyncMock, return_value=pool),
        patch(
            "app.routers.bulk_import._process_bulk_import_impl",
            new_callable=AsyncMock,
        ) as process_impl,
    ):
        await _process_bulk_import(
            job_id=77,
            file_entries=[],
            worker_hosted=True,
        )

    process_impl.assert_awaited_once()
    pool.zadd.assert_awaited_once()
    pool.zrem.assert_awaited_once()
    pool.zremrangebyscore.assert_awaited_once()
    assert pool.zremrangebyscore.await_args.args[0] == (
        "hriv:bulk_import:coordinators"
    )
    assert pool.zremrangebyscore.await_args.args[1] == "-inf"


async def test_process_bulk_import_normalizes_empty_note(tmp_path) -> None:
    job = SimpleNamespace(
        id=1,
        status="pending",
        total_count=1,
        completed_count=1,
        failed_count=0,
        category_id=1,
        errors=[],
    )
    src = SimpleNamespace(
        id=10,
        status="completed",
        error_message=None,
        status_message=None,
    )

    db = AsyncMock()

    def _get(model, pk):
        name = getattr(model, "__name__", "")
        if name == "BulkImportJob":
            return job
        return src

    db.get = AsyncMock(side_effect=_get)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "id", 10))
    db.execute = AsyncMock()

    with (
        patch(
            "app.routers.bulk_import.async_session",
            _make_async_session_factory(db),
        ),
        patch(
            "app.routers.bulk_import.process_source_image",
            new_callable=AsyncMock,
        ),
    ):
        await _process_bulk_import(
            job_id=1,
            file_entries=[("a.png", str(tmp_path / "a.png"))],
            note="",
        )

    src_record = db.add.call_args_list[0].args[0]
    assert src_record.note is None


async def test_process_bulk_import_records_failure_for_failed_source(tmp_path) -> None:
    """When ``process_source_image`` completes but the SourceImage row is
    marked as ``failed``, the helper must bump ``failed_count`` and append to
    ``errors`` rather than treating the image as successful."""
    job = SimpleNamespace(
        id=1,
        status="pending",
        total_count=1,
        completed_count=0,
        failed_count=1,  # simulate what the execute(update(...)) will do
        category_id=1,
        errors=[{"filename": "a.png", "error": "bad header"}],
    )
    src = SimpleNamespace(
        id=10,
        status="failed",
        error_message="bad header",
        status_message=None,
    )

    db = AsyncMock()

    def _get(model, pk):
        return job if getattr(model, "__name__", "") == "BulkImportJob" else src

    db.get = AsyncMock(side_effect=_get)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "id", 10))
    db.execute = AsyncMock()

    with (
        patch(
            "app.routers.bulk_import.async_session",
            _make_async_session_factory(db),
        ),
        patch(
            "app.routers.bulk_import.process_source_image",
            new_callable=AsyncMock,
        ),
    ):
        await _process_bulk_import(
            job_id=1,
            file_entries=[("a.png", str(tmp_path / "a.png"))],
        )

    # All-failed -> overall status is "failed"
    assert job.status == "failed"


async def test_process_bulk_import_records_failure_when_processing_raises(tmp_path) -> None:
    """``process_source_image`` raising is the explicit per-image failure path."""
    job = SimpleNamespace(
        id=1,
        status="pending",
        total_count=1,
        completed_count=0,
        failed_count=1,  # mutated by the update(...) after processing raises
        category_id=1,
        errors=[{"filename": "a.png", "error": "boom"}],
    )
    src = SimpleNamespace(
        id=10,
        status="pending",
        error_message=None,
        status_message=None,
    )

    db = AsyncMock()
    db.get = AsyncMock(
        side_effect=lambda model, pk: job
        if getattr(model, "__name__", "") == "BulkImportJob"
        else src,
    )
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "id", 10))
    db.execute = AsyncMock()

    with (
        patch(
            "app.routers.bulk_import.async_session",
            _make_async_session_factory(db),
        ),
        patch(
            "app.routers.bulk_import.process_source_image",
            new_callable=AsyncMock,
            side_effect=RuntimeError("boom"),
        ),
    ):
        await _process_bulk_import(
            job_id=1,
            file_entries=[("a.png", str(tmp_path / "a.png"))],
        )

    assert job.status == "failed"


async def test_process_bulk_import_partial_success(tmp_path) -> None:
    """Two images, one succeeds and one fails -> overall status is
    ``completed`` (partial success)."""
    job = SimpleNamespace(
        id=1,
        status="pending",
        total_count=2,
        completed_count=1,  # one succeeded
        failed_count=1,  # one failed
        category_id=1,
        errors=[{"filename": "bad.png", "error": "oops"}],
    )

    # Two SourceImage objects; the second one is flagged as failed.
    src_rows = {
        10: SimpleNamespace(
            id=10,
            status="completed",
            error_message=None,
            status_message=None,
        ),
        11: SimpleNamespace(
            id=11,
            status="failed",
            error_message="oops",
            status_message=None,
        ),
    }
    next_id = [10]

    db = AsyncMock()

    def _get(model, pk):
        name = getattr(model, "__name__", "")
        if name == "BulkImportJob":
            return job
        return src_rows[pk]

    db.get = AsyncMock(side_effect=_get)
    db.add = MagicMock()
    db.commit = AsyncMock()

    def _refresh(obj) -> None:
        obj.id = next_id[0]
        next_id[0] += 1

    db.refresh = AsyncMock(side_effect=_refresh)
    db.execute = AsyncMock()

    with (
        patch(
            "app.routers.bulk_import.async_session",
            _make_async_session_factory(db),
        ),
        patch(
            "app.routers.bulk_import.process_source_image",
            new_callable=AsyncMock,
        ),
    ):
        await _process_bulk_import(
            job_id=1,
            file_entries=[
                ("good.png", str(tmp_path / "good.png")),
                ("bad.png", str(tmp_path / "bad.png")),
            ],
        )

    # Partial success keeps status = "completed" per the router's contract.
    assert job.status == "completed"


async def test_process_bulk_import_skips_when_job_missing(tmp_path) -> None:
    """If the job row disappears between scheduling and execution, the
    per-image handler returns early and never invokes ``process_source_image``."""
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)  # Job row missing
    db.add = MagicMock()
    db.commit = AsyncMock()

    process_mock = AsyncMock()
    with (
        patch(
            "app.routers.bulk_import.async_session",
            _make_async_session_factory(db),
        ),
        patch(
            "app.routers.bulk_import.process_source_image",
            process_mock,
        ),
    ):
        await _process_bulk_import(
            job_id=999,
            file_entries=[("a.png", str(tmp_path / "a.png"))],
        )

    process_mock.assert_not_awaited()


async def test_process_bulk_import_counter_update_survives_db_error(tmp_path) -> None:
    """If the outer ``update(BulkImportJob)`` itself raises, the helper must
    log and continue rather than propagate the exception out of the
    background task."""
    job = SimpleNamespace(
        id=1,
        status="pending",
        total_count=1,
        completed_count=0,
        failed_count=0,
        category_id=1,
        errors=[],
    )

    db = AsyncMock()
    db.get = AsyncMock(return_value=job)
    db.add = MagicMock(side_effect=RuntimeError("simulated outer failure"))
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.execute = AsyncMock(side_effect=RuntimeError("update also failed"))

    with (
        patch(
            "app.routers.bulk_import.async_session",
            _make_async_session_factory(db),
        ),
        patch(
            "app.routers.bulk_import.process_source_image",
            new_callable=AsyncMock,
        ),
    ):
        # Should not raise
        await _process_bulk_import(
            job_id=1,
            file_entries=[("a.png", str(tmp_path / "a.png"))],
        )


async def test_process_bulk_import_uses_queued_processing_when_available(tmp_path) -> None:
    """Bulk import should reuse the queued single-image worker path when available."""
    job = SimpleNamespace(
        id=1,
        status="pending",
        total_count=1,
        completed_count=1,
        failed_count=0,
        category_id=1,
        errors=[],
    )
    src = SimpleNamespace(
        id=10,
        status="completed",
        error_message=None,
        status_message=None,
    )

    db = AsyncMock()
    db.get = AsyncMock(side_effect=lambda model, pk: job if getattr(model, "__name__", "") == "BulkImportJob" else src)
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "id", 10))
    db.execute = AsyncMock()

    with (
        patch("app.routers.bulk_import.async_session", _make_async_session_factory(db)),
        patch("app.routers.bulk_import.enqueue_process_source_image", new_callable=AsyncMock, return_value=EnqueueResult("queued", "submitted")) as enqueue_mock,
        patch("app.routers.bulk_import._wait_for_source_image_terminal_state", new_callable=AsyncMock, return_value=src) as wait_mock,
        patch("app.routers.bulk_import.process_source_image", new_callable=AsyncMock) as direct_mock,
    ):
        await _process_bulk_import(
            job_id=1,
            file_entries=[("queued.png", str(tmp_path / "queued.png"))],
        )

    enqueue_mock.assert_awaited_once_with(10)
    wait_mock.assert_awaited_once_with(
        10,
        "queued.png",
        enqueue_result=EnqueueResult("queued", "submitted"),
    )
    direct_mock.assert_not_awaited()
    assert job.status == "completed"


async def test_wait_for_source_image_terminal_state_marks_stale_source_failed(
    caplog,
) -> None:
    """A queued child image that stops updating should be marked failed."""
    stale_time = datetime.now(timezone.utc) - timedelta(seconds=901)
    src = SimpleNamespace(
        id=10,
        status="processing",
        updated_at=stale_time,
        error_message=None,
        status_message="Generating tiles",
    )
    db = AsyncMock()
    db.get = AsyncMock(return_value=src)
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)

    with patch("app.routers.bulk_import.async_session", return_value=db):
        result = await _wait_for_source_image_terminal_state(10, "stuck.jpg", stale_after_seconds=900)

    assert result.status == "failed"
    assert "stalled during bulk import" in result.error_message
    assert result.status_message == "Failed"
    db.commit.assert_awaited_once()
    assert any(
        record.event == "bulk_import.source_stalled"
        for record in caplog.records
    )


async def test_wait_for_source_image_terminal_state_does_not_stale_queued_source() -> None:
    """Queued images may wait for a worker slot without being marked failed."""
    stale_time = datetime.now(timezone.utc) - timedelta(seconds=901)
    src = SimpleNamespace(
        id=12,
        status="pending",
        updated_at=stale_time,
        error_message=None,
        status_message="Queued",
    )
    completed = SimpleNamespace(
        id=12,
        status="completed",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message=None,
    )
    db = AsyncMock()
    db.get = AsyncMock(side_effect=[src, completed])
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("app.routers.bulk_import.async_session", return_value=db),
        patch("app.routers.bulk_import.asyncio.sleep", new_callable=AsyncMock),
    ):
        result = await _wait_for_source_image_terminal_state(
            12, "queued.jpg", stale_after_seconds=900,
        )

    assert result.status == "completed"
    db.commit.assert_not_awaited()


async def test_wait_for_source_image_terminal_state_does_not_fail_deep_queued_source(
    caplog,
) -> None:
    """A queued job remains valid regardless of how long it waits."""
    job = MagicMock()
    job.status = AsyncMock(return_value=JobStatus.queued)
    pending_time = datetime.now(timezone.utc) - timedelta(days=2)
    src = SimpleNamespace(
        id=13,
        status="pending",
        updated_at=pending_time,
        error_message=None,
        status_message="Queued",
    )
    db = AsyncMock()
    db.get = AsyncMock(side_effect=[src, SimpleNamespace(
        id=13,
        status="completed",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message=None,
    )])
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("app.routers.bulk_import.async_session", return_value=db),
        patch("app.routers.bulk_import.asyncio.sleep", new_callable=AsyncMock),
    ):
        result = await _wait_for_source_image_terminal_state(
            13,
            "deep-queue.jpg",
            enqueue_result=EnqueueResult(
                "queued",
                "submitted",
                job=job,
                queued_at=time.monotonic() - 3600,
            ),
            pending_grace_seconds=0,
            pending_wait_safety_cap_seconds=7200,
        )

    assert result.status == "completed"
    db.commit.assert_not_awaited()
    job.status.assert_awaited_once()


async def test_wait_for_source_image_unknown_status_hits_pending_backstop() -> None:
    """An inconclusive status probe cannot keep the pending wait unbounded."""
    job = MagicMock()
    job.status = AsyncMock(side_effect=RuntimeError("redis read stalled"))
    job.job_id = "job-19"
    pool = MagicMock()
    pool.zadd = AsyncMock()
    src = SimpleNamespace(
        id=19,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    db = AsyncMock()
    db.get = AsyncMock(return_value=src)
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)

    with patch(
        "app.routers.bulk_import.async_session",
        return_value=db,
    ), patch(
        "app.routers.bulk_import.get_pool",
        new_callable=AsyncMock,
        return_value=pool,
    ):
        result = await _wait_for_source_image_terminal_state(
            19,
            "unknown-status.jpg",
            enqueue_result=EnqueueResult(
                "queued",
                "submitted",
                job=job,
                queued_at=time.monotonic() - 1,
            ),
            pending_grace_seconds=0,
            pending_wait_safety_cap_seconds=0,
        )

    assert result.status == "failed"
    assert "exceeded the wait ceiling" in result.error_message
    pool.zadd.assert_awaited_once()
    db.commit.assert_awaited_once()


async def test_wait_for_source_image_detects_coordinator_capacity_starvation() -> None:
    """Coordinator saturation fails a child only with positive deadlock evidence."""
    job = MagicMock()
    job.status = AsyncMock(return_value=JobStatus.queued)
    job.job_id = "job-capacity"
    src = SimpleNamespace(
        id=40,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    db = AsyncMock()
    db.get = AsyncMock(return_value=src)
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)
    pool = MagicMock()
    pool.zadd = AsyncMock()
    pool.zrem = AsyncMock()
    pool.zcount = AsyncMock(return_value=4)
    progress = _BulkImportProgress(time.monotonic() - 901)

    with (
        patch("app.routers.bulk_import.async_session", return_value=db),
        patch("app.routers.bulk_import.get_pool", new_callable=AsyncMock, return_value=pool),
        patch(
            "app.routers.bulk_import.collect_queue_state",
            new_callable=AsyncMock,
            return_value={"queue_up": True, "worker_up": True},
        ),
    ):
        result = await _wait_for_source_image_terminal_state(
            40,
            "capacity-starved.jpg",
            enqueue_result=EnqueueResult("queued", "submitted", job=job),
            pending_grace_seconds=0,
            stale_after_seconds=900,
            pending_wait_safety_cap_seconds=7200,
            batch_progress=progress,
            coordinator_pool=pool,
            bulk_import_job_id=900,
        )

    assert result.status == "failed"
    assert "fully consumed by concurrent bulk imports" in result.error_message
    assert pool.zadd.await_count == 2
    pool.zrem.assert_awaited_once_with(abort_jobs_ss, "job-capacity")
    assert db.commit.await_count == 1


async def test_wait_for_source_image_does_not_fail_queued_child_behind_unrelated_jobs() -> None:
    """Unrelated worker work does not satisfy the coordinator deadlock detector."""
    job = MagicMock()
    job.status = AsyncMock(return_value=JobStatus.queued)
    job.job_id = "job-unrelated"
    src = SimpleNamespace(
        id=41,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    completed = SimpleNamespace(
        id=41,
        status="completed",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message=None,
    )
    db = AsyncMock()
    db.get = AsyncMock(side_effect=[src, completed])
    execute_result = MagicMock()
    execute_result.scalar_one.return_value = 3
    db.execute = AsyncMock(return_value=execute_result)
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)
    progress = _BulkImportProgress(time.monotonic() - 901)

    with (
        patch("app.routers.bulk_import.async_session", return_value=db),
        patch("app.routers.bulk_import.asyncio.sleep", new_callable=AsyncMock),
        patch(
            "app.routers.bulk_import.collect_queue_state",
            new_callable=AsyncMock,
            return_value={"queue_up": True, "worker_up": True},
        ),
    ):
        result = await _wait_for_source_image_terminal_state(
            41,
            "unrelated-queue.jpg",
            enqueue_result=EnqueueResult("queued", "submitted", job=job),
            pending_grace_seconds=0,
            stale_after_seconds=900,
            pending_wait_safety_cap_seconds=7200,
            batch_progress=progress,
        )

    assert result.status == "completed"
    db.commit.assert_not_awaited()


async def test_capacity_starvation_ignores_stale_abandoned_coordinators() -> None:
    """Old processing rows do not make a healthy queue appear starved."""
    job = MagicMock()
    job.status = AsyncMock(return_value=JobStatus.queued)
    job.job_id = "job-stale-coordinators"
    src = SimpleNamespace(
        id=45,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    completed = SimpleNamespace(
        id=45,
        status="completed",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message=None,
    )
    db = AsyncMock()
    db.get = AsyncMock(side_effect=[src, completed])
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)
    pool = MagicMock()
    pool.zcount = AsyncMock(return_value=0)
    progress = _BulkImportProgress(time.monotonic() - 1201)

    with (
        patch("app.routers.bulk_import.async_session", return_value=db),
        patch("app.routers.bulk_import.get_pool", new_callable=AsyncMock, return_value=pool),
        patch("app.routers.bulk_import.asyncio.sleep", new_callable=AsyncMock),
        patch(
            "app.routers.bulk_import.collect_queue_state",
            new_callable=AsyncMock,
            return_value={"queue_up": True, "worker_up": True},
        ),
    ):
        result = await _wait_for_source_image_terminal_state(
            45,
            "stale-coordinators.jpg",
            enqueue_result=EnqueueResult("queued", "submitted", job=job),
            pending_grace_seconds=0,
            stale_after_seconds=900,
            pending_wait_safety_cap_seconds=0,
            batch_progress=progress,
            coordinator_pool=pool,
        )

    assert result.status == "completed"
    db.commit.assert_not_awaited()


async def test_wait_for_source_image_batch_progress_resets_deadlock_window() -> None:
    """A child entering processing resets the batch pending window."""
    progress = _BulkImportProgress(100.0)
    with patch("app.routers.bulk_import.time.monotonic", return_value=200.0):
        progress.observe(42, "pending")
        progress.observe(42, "processing")
    assert progress.last_child_advanced_at == 200.0


async def test_capacity_starvation_latch_fails_remaining_pending_children() -> None:
    """Once established, capacity starvation remains active for the batch."""
    progress = _BulkImportProgress(time.monotonic())
    progress.capacity_starvation_detected = True
    pool = MagicMock()
    pool.zcount = AsyncMock(return_value=4)

    assert await _bulk_import_has_capacity_starvation(
        batch_progress=progress,
        stale_after_seconds=900,
        last_queue_confirmed_at=time.monotonic(),
        last_queue_worker_up=True,
        job_status=JobStatus.queued,
        coordinator_pool=pool,
    )


async def test_capacity_starvation_latch_rechecks_current_coordinator_capacity() -> None:
    """A prior starvation verdict cannot survive after coordinator slots free."""
    progress = _BulkImportProgress(time.monotonic())
    progress.capacity_starvation_detected = True
    pool = MagicMock()
    pool.zcount = AsyncMock(return_value=3)

    assert not await _bulk_import_has_capacity_starvation(
        batch_progress=progress,
        stale_after_seconds=900,
        last_queue_confirmed_at=time.monotonic(),
        last_queue_worker_up=True,
        job_status=JobStatus.queued,
        coordinator_pool=pool,
    )


async def test_capacity_starvation_ignores_api_hosted_coordinator() -> None:
    """API-hosted local fallback coordinators do not occupy arq slots."""
    progress = _BulkImportProgress(time.monotonic() - 901)

    assert not await _bulk_import_has_capacity_starvation(
        batch_progress=progress,
        stale_after_seconds=900,
        last_queue_confirmed_at=time.monotonic(),
        last_queue_worker_up=True,
        job_status=JobStatus.queued,
        coordinator_pool=None,
    )


async def test_wait_for_source_image_refreshes_queue_evidence_for_in_progress_job() -> None:
    """An executing arq child is positive evidence that the queue is healthy."""
    job = MagicMock()
    job.status = AsyncMock(return_value=JobStatus.in_progress)
    src = SimpleNamespace(
        id=43,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    completed = SimpleNamespace(
        id=43,
        status="completed",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message=None,
    )
    db = AsyncMock()
    db.get = AsyncMock(side_effect=[src, completed])
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)
    collect_queue = AsyncMock(
        return_value={"queue_up": True, "worker_up": True},
    )

    with (
        patch("app.routers.bulk_import.async_session", return_value=db),
        patch("app.routers.bulk_import.asyncio.sleep", new_callable=AsyncMock),
        patch("app.routers.bulk_import.collect_queue_state", collect_queue),
    ):
        result = await _wait_for_source_image_terminal_state(
            43,
            "in-progress.jpg",
            enqueue_result=EnqueueResult("queued", "submitted", job=job),
            pending_grace_seconds=0,
            pending_wait_safety_cap_seconds=7200,
        )

    assert result.status == "completed"
    collect_queue.assert_awaited_once()


async def test_wait_for_source_image_terminal_state_latches_queued_timeout() -> None:
    """The last-resort ceiling writes an abort latch before failing the row."""
    job = MagicMock()
    job.status = AsyncMock(return_value=JobStatus.queued)
    job.job_id = "job-20"
    pool = MagicMock()
    pool.zadd = AsyncMock()
    src = SimpleNamespace(
        id=20,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    db = AsyncMock()
    db.get = AsyncMock(return_value=src)
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("app.routers.bulk_import.async_session", return_value=db),
        patch("app.routers.bulk_import.get_pool", new_callable=AsyncMock, return_value=pool),
        patch(
            "app.routers.bulk_import.collect_queue_state",
            new_callable=AsyncMock,
            return_value={"queue_up": False, "worker_up": None},
        ),
    ):
        result = await _wait_for_source_image_terminal_state(
            20,
            "never-started.jpg",
            enqueue_result=EnqueueResult(
                "queued",
                "submitted",
                job=job,
                queued_at=time.monotonic() - 1,
            ),
            pending_grace_seconds=0,
            pending_wait_safety_cap_seconds=0,
        )

    assert result.status == "failed"
    assert "never started" in result.error_message
    pool.zadd.assert_awaited_once()
    assert pool.zadd.await_args.args[0] == abort_jobs_ss
    assert set(pool.zadd.await_args.args[1]) == {"job-20"}
    assert isinstance(pool.zadd.await_args.args[1]["job-20"], int)
    db.commit.assert_awaited_once()
    job.abort.assert_not_called()


async def test_wait_for_source_image_terminal_state_fails_without_worker() -> None:
    """A queued child is latched and failed after repeated absent heartbeats."""
    job = MagicMock()
    job.status = AsyncMock(return_value=JobStatus.queued)
    job.job_id = "job-21"
    pool = MagicMock()
    pool.zadd = AsyncMock()
    events: list[str] = []
    pool.zadd.side_effect = lambda *args, **kwargs: events.append("latch")
    pool.zrem = AsyncMock(side_effect=lambda *args, **kwargs: events.append("latch-removed"))
    src = SimpleNamespace(
        id=21,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    db = AsyncMock()
    db.get = AsyncMock(return_value=src)
    db.commit = AsyncMock(side_effect=lambda: events.append("commit"))
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("app.routers.bulk_import.async_session", return_value=db),
        patch("app.routers.bulk_import.get_pool", new_callable=AsyncMock, return_value=pool),
        patch("app.routers.bulk_import.asyncio.sleep", new_callable=AsyncMock),
        patch(
            "app.routers.bulk_import.collect_queue_state",
            new_callable=AsyncMock,
            return_value={"queue_up": True, "worker_up": False},
        ),
    ):
        result = await _wait_for_source_image_terminal_state(
            21,
            "no-worker.jpg",
            enqueue_result=EnqueueResult("queued", "submitted", job=job, queued_at=time.monotonic()),
            pending_grace_seconds=0,
            no_worker_window_seconds=0,
            pending_wait_safety_cap_seconds=7200,
        )

    assert result.status == "failed"
    assert "no dedicated worker" in result.error_message
    pool.zadd.assert_awaited_once()
    db.commit.assert_awaited_once()
    assert events == ["latch", "commit", "latch-removed"]
    job.abort.assert_not_called()


async def test_wait_for_source_image_no_worker_rereads_terminal_row() -> None:
    """A concurrent completion wins over the no-worker terminal branch."""
    job = MagicMock()
    job.status = AsyncMock(return_value=JobStatus.queued)
    job.job_id = "job-24"
    pending = SimpleNamespace(
        id=24,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    completed = SimpleNamespace(
        id=24,
        status="completed",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message=None,
    )
    db = AsyncMock()
    db.get = AsyncMock(side_effect=[pending, completed])
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)
    pool = MagicMock()
    pool.zadd = AsyncMock()
    pool.zrem = AsyncMock()

    with (
        patch("app.routers.bulk_import.async_session", return_value=db),
        patch("app.routers.bulk_import.get_pool", new_callable=AsyncMock, return_value=pool),
        patch("app.routers.bulk_import.collect_queue_state", new_callable=AsyncMock, return_value={
            "queue_up": True,
            "worker_up": False,
        }),
    ):
        result = await _wait_for_source_image_terminal_state(
            24,
            "concurrent-completion.jpg",
            enqueue_result=EnqueueResult(
                "queued",
                "submitted",
                job=job,
                queued_at=time.monotonic(),
            ),
            pending_grace_seconds=0,
            no_worker_window_seconds=0,
            pending_wait_safety_cap_seconds=7200,
        )

    assert result.status == "completed"
    pool.zadd.assert_awaited_once()
    pool.zrem.assert_awaited_once_with(abort_jobs_ss, "job-24")
    db.commit.assert_not_awaited()


async def test_wait_for_source_image_no_worker_removes_latch_when_worker_starts(
    caplog,
) -> None:
    """A worker starting during latch bookkeeping is allowed to continue."""
    caplog.set_level(logging.INFO)
    job = MagicMock()
    job.status = AsyncMock(return_value=JobStatus.queued)
    job.job_id = "job-27"
    pending = SimpleNamespace(
        id=27,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    processing = SimpleNamespace(
        id=27,
        status="processing",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Processing",
    )
    completed = SimpleNamespace(
        id=27,
        status="completed",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message=None,
    )
    db = AsyncMock()
    db.get = AsyncMock(side_effect=[pending, processing, completed])
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)
    pool = MagicMock()
    pool.zadd = AsyncMock()
    pool.zrem = AsyncMock()

    with (
        patch("app.routers.bulk_import.async_session", return_value=db),
        patch("app.routers.bulk_import.get_pool", new_callable=AsyncMock, return_value=pool),
        patch("app.routers.bulk_import.asyncio.sleep", new_callable=AsyncMock),
        patch(
            "app.routers.bulk_import.collect_queue_state",
            new_callable=AsyncMock,
            return_value={"queue_up": True, "worker_up": False},
        ),
    ):
        result = await _wait_for_source_image_terminal_state(
            27,
            "worker-recovered.jpg",
            enqueue_result=EnqueueResult(
                "queued",
                "submitted",
                job=job,
                queued_at=time.monotonic(),
            ),
            pending_grace_seconds=0,
            no_worker_window_seconds=0,
            pending_wait_safety_cap_seconds=7200,
        )

    assert result.status == "completed"
    pool.zadd.assert_awaited_once()
    pool.zrem.assert_awaited_once_with(abort_jobs_ss, "job-27")
    db.commit.assert_not_awaited()
    assert "worker recovered before no-worker failure" in caplog.text


async def test_wait_for_source_image_processing_timeout_latches_before_failure() -> None:
    """A processing-cap failure is latched before the row becomes terminal."""
    job = MagicMock()
    job.status = AsyncMock(return_value=JobStatus.queued)
    job.job_id = "job-26"
    src = SimpleNamespace(
        id=26,
        status="processing",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Processing",
    )
    db = AsyncMock()
    db.get = AsyncMock(return_value=src)
    events: list[str] = []
    db.commit = AsyncMock(side_effect=lambda: events.append("commit"))
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)
    pool = MagicMock()
    pool.zadd = AsyncMock(side_effect=lambda *args, **kwargs: events.append("latch"))
    pool.zrem = AsyncMock(side_effect=lambda *args, **kwargs: events.append("latch-removed"))

    with (
        patch("app.routers.bulk_import.async_session", return_value=db),
        patch("app.routers.bulk_import.get_pool", new_callable=AsyncMock, return_value=pool),
    ):
        result = await _wait_for_source_image_terminal_state(
            26,
            "slow-image.jpg",
            enqueue_result=EnqueueResult(
                "queued",
                "submitted",
                job=job,
                queued_at=time.monotonic(),
            ),
            processing_wait_safety_cap_seconds=0,
            pending_wait_safety_cap_seconds=7200,
        )

    assert result.status == "failed"
    assert "worker job timeout" in result.error_message
    pool.zadd.assert_awaited_once()
    assert events == ["latch", "commit", "latch-removed"]
    db.commit.assert_awaited_once()


async def test_wait_for_source_image_processing_timeout_removes_latch_when_pending() -> None:
    """A processing-cap race back to pending does not leave a cancellation latch."""
    job = MagicMock()
    job.status = AsyncMock(return_value=JobStatus.queued)
    job.job_id = "job-30"
    processing = SimpleNamespace(
        id=30,
        status="processing",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Processing",
    )
    pending = SimpleNamespace(
        id=30,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    completed = SimpleNamespace(
        id=30,
        status="completed",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message=None,
    )
    db = AsyncMock()
    db.get = AsyncMock(side_effect=[processing, pending, completed])
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)
    pool = MagicMock()
    pool.zadd = AsyncMock()
    pool.zrem = AsyncMock()

    with (
        patch("app.routers.bulk_import.async_session", return_value=db),
        patch("app.routers.bulk_import.get_pool", new_callable=AsyncMock, return_value=pool),
        patch("app.routers.bulk_import.asyncio.sleep", new_callable=AsyncMock),
    ):
        result = await _wait_for_source_image_terminal_state(
            30,
            "processing-recovered.jpg",
            enqueue_result=EnqueueResult(
                "queued",
                "submitted",
                job=job,
                queued_at=time.monotonic(),
            ),
            processing_wait_safety_cap_seconds=0,
            pending_wait_safety_cap_seconds=7200,
        )

    assert result.status == "completed"
    pool.zadd.assert_awaited_once()
    pool.zrem.assert_awaited_once_with(abort_jobs_ss, "job-30")
    db.commit.assert_not_awaited()


async def test_wait_for_source_image_processing_cap_resets_after_retry() -> None:
    """A retried processing attempt gets a fresh processing-cap window."""
    clock = [100.0]
    job = MagicMock()
    job.status = AsyncMock(return_value=JobStatus.queued)
    job.job_id = "job-31"
    processing = SimpleNamespace(
        id=31,
        status="processing",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Processing",
    )
    pending = SimpleNamespace(
        id=31,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    completed = SimpleNamespace(
        id=31,
        status="completed",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message=None,
    )
    db = AsyncMock()
    db.get = AsyncMock(side_effect=[processing, pending, processing, completed])
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)

    async def advance_clock(_seconds: float) -> None:
        clock[0] += 1

    with (
        patch("app.routers.bulk_import.async_session", return_value=db),
        patch("app.routers.bulk_import.asyncio.sleep", side_effect=advance_clock),
        patch(
            "app.routers.bulk_import.time.monotonic",
            side_effect=lambda: clock[0],
        ),
    ):
        result = await _wait_for_source_image_terminal_state(
            31,
            "processing-retry.jpg",
            enqueue_result=EnqueueResult(
                "queued",
                "submitted",
                job=job,
                queued_at=clock[0],
            ),
            pending_grace_seconds=7200,
            pending_wait_safety_cap_seconds=7200,
            processing_wait_safety_cap_seconds=1,
        )

    assert result.status == "completed"
    db.commit.assert_not_awaited()


async def test_wait_for_source_image_timeout_rereads_terminal_row() -> None:
    """A concurrent completion wins over the pending-ceiling branch."""
    job = MagicMock()
    job.status = AsyncMock(return_value=JobStatus.queued)
    job.job_id = "job-25"
    pending = SimpleNamespace(
        id=25,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    completed = SimpleNamespace(
        id=25,
        status="completed",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message=None,
    )
    db = AsyncMock()
    db.get = AsyncMock(side_effect=[pending, completed])
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)
    pool = MagicMock()
    pool.zadd = AsyncMock()
    pool.zrem = AsyncMock()

    with (
        patch("app.routers.bulk_import.async_session", return_value=db),
        patch("app.routers.bulk_import.get_pool", new_callable=AsyncMock, return_value=pool),
        patch("app.routers.bulk_import.collect_queue_state", new_callable=AsyncMock, return_value={
            "queue_up": False,
            "worker_up": None,
        }),
    ):
        result = await _wait_for_source_image_terminal_state(
            25,
            "concurrent-timeout.jpg",
            enqueue_result=EnqueueResult(
                "queued",
                "submitted",
                job=job,
                queued_at=time.monotonic(),
            ),
            pending_grace_seconds=0,
            pending_wait_safety_cap_seconds=0,
        )

    assert result.status == "completed"
    pool.zadd.assert_awaited_once()
    pool.zrem.assert_awaited_once_with(abort_jobs_ss, "job-25")
    db.commit.assert_not_awaited()


async def test_wait_for_source_image_pending_timeout_removes_latch_when_processing(
    caplog,
) -> None:
    """A child picked up during pending bookkeeping is allowed to continue."""
    caplog.set_level(logging.INFO)
    job = MagicMock()
    job.status = AsyncMock(return_value=JobStatus.queued)
    job.job_id = "job-29"
    pending = SimpleNamespace(
        id=29,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    processing = SimpleNamespace(
        id=29,
        status="processing",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Processing",
    )
    completed = SimpleNamespace(
        id=29,
        status="completed",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message=None,
    )
    db = AsyncMock()
    db.get = AsyncMock(side_effect=[pending, processing, completed])
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)
    pool = MagicMock()
    pool.zadd = AsyncMock()
    pool.zrem = AsyncMock()

    with (
        patch("app.routers.bulk_import.async_session", return_value=db),
        patch("app.routers.bulk_import.get_pool", new_callable=AsyncMock, return_value=pool),
        patch("app.routers.bulk_import.asyncio.sleep", new_callable=AsyncMock),
        patch(
            "app.routers.bulk_import.collect_queue_state",
            new_callable=AsyncMock,
            return_value={"queue_up": False, "worker_up": None},
        ),
    ):
        result = await _wait_for_source_image_terminal_state(
            29,
            "pending-recovered.jpg",
            enqueue_result=EnqueueResult(
                "queued",
                "submitted",
                job=job,
                queued_at=time.monotonic(),
            ),
            pending_grace_seconds=0,
            pending_wait_safety_cap_seconds=0,
        )

    assert result.status == "completed"
    pool.zadd.assert_awaited_once()
    pool.zrem.assert_awaited_once_with(abort_jobs_ss, "job-29")
    db.commit.assert_not_awaited()
    assert "advanced before pending wait failure" in caplog.text


async def test_wait_for_source_image_terminal_state_keeps_waiting_with_worker() -> None:
    """A live worker heartbeat prevents deep queued work from being failed."""
    job = MagicMock()
    job.status = AsyncMock(return_value=JobStatus.queued)
    job.job_id = "job-22"
    src = SimpleNamespace(
        id=22,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    completed = SimpleNamespace(
        id=22,
        status="completed",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message=None,
    )
    db = AsyncMock()
    db.get = AsyncMock(side_effect=[src, src, completed])
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)
    pool = MagicMock()
    pool.zadd = AsyncMock()

    with (
        patch("app.routers.bulk_import.async_session", return_value=db),
        patch("app.routers.bulk_import.get_pool", new_callable=AsyncMock, return_value=pool),
        patch("app.routers.bulk_import.asyncio.sleep", new_callable=AsyncMock),
        patch(
            "app.routers.bulk_import.collect_queue_state",
            new_callable=AsyncMock,
            return_value={"queue_up": True, "worker_up": True},
        ),
    ):
        result = await _wait_for_source_image_terminal_state(
            22,
            "deep-queue-live-worker.jpg",
            enqueue_result=EnqueueResult(
                "queued",
                "submitted",
                job=job,
                queued_at=time.monotonic() - 3600,
            ),
            pending_grace_seconds=0,
            no_worker_window_seconds=1,
            pending_wait_safety_cap_seconds=0,
        )

    assert result.status == "completed"
    pool.zadd.assert_not_awaited()
    db.commit.assert_not_awaited()
    assert job.status.await_count == 2


async def test_wait_for_source_image_inconclusive_probe_preserves_no_worker_window() -> None:
    """A status-probe error does not erase absent-worker wall-clock evidence."""
    job = MagicMock()
    job.status = AsyncMock(
        side_effect=[JobStatus.queued, RuntimeError("transient Redis error")]
    )
    job.job_id = "job-29"
    pool = MagicMock()
    pool.zadd = AsyncMock()
    src = SimpleNamespace(
        id=29,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    db = AsyncMock()
    db.get = AsyncMock(return_value=src)
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)
    clock = [100.0]

    async def advance_clock(_seconds: float) -> None:
        clock[0] += 1

    with (
        patch("app.routers.bulk_import.async_session", return_value=db),
        patch("app.routers.bulk_import.get_pool", new_callable=AsyncMock, return_value=pool),
        patch(
            "app.routers.bulk_import.collect_queue_state",
            new_callable=AsyncMock,
            return_value={"queue_up": True, "worker_up": False},
        ),
        patch("app.routers.bulk_import.asyncio.sleep", side_effect=advance_clock),
        patch("app.routers.bulk_import.time.monotonic", side_effect=lambda: clock[0]),
    ):
        result = await _wait_for_source_image_terminal_state(
            29,
            "intermittent-status.jpg",
            enqueue_result=EnqueueResult(
                "queued",
                "submitted",
                job=job,
                queued_at=clock[0],
            ),
            pending_grace_seconds=0,
            no_worker_window_seconds=1,
            pending_wait_safety_cap_seconds=7200,
        )

    assert result.status == "failed"
    assert "no dedicated worker" in result.error_message
    pool.zadd.assert_awaited_once()
    db.commit.assert_awaited_once()


async def test_wait_for_source_image_samples_worker_health_between_polls() -> None:
    """Worker health sampling is less frequent than child-status polling."""
    job = MagicMock()
    job.status = AsyncMock(return_value=JobStatus.queued)
    job.job_id = "job-28"
    pending = SimpleNamespace(
        id=28,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    completed = SimpleNamespace(
        id=28,
        status="completed",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message=None,
    )
    db = AsyncMock()
    db.get = AsyncMock(side_effect=[pending, pending, completed])
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)
    collect_queue = AsyncMock(
        return_value={"queue_up": True, "worker_up": True},
    )

    with (
        patch("app.routers.bulk_import.async_session", return_value=db),
        patch("app.routers.bulk_import.asyncio.sleep", new_callable=AsyncMock),
        patch("app.routers.bulk_import._SOURCE_IMAGE_QUEUE_STATE_SAMPLE_POLLS", 2),
        patch("app.routers.bulk_import.collect_queue_state", collect_queue),
    ):
        result = await _wait_for_source_image_terminal_state(
            28,
            "sampled-worker-health.jpg",
            enqueue_result=EnqueueResult(
                "queued",
                "submitted",
                job=job,
                queued_at=time.monotonic(),
            ),
            pending_grace_seconds=0,
            no_worker_window_seconds=120,
            pending_wait_safety_cap_seconds=7200,
        )

    assert result.status == "completed"
    collect_queue.assert_awaited_once()
    assert job.status.await_count == 2
    db.commit.assert_not_awaited()


async def test_wait_for_source_image_terminal_state_keeps_waiting_when_latch_fails() -> None:
    """A failed abort-latch write cannot make a pending row terminal."""
    job = MagicMock()
    job.status = AsyncMock(return_value=JobStatus.queued)
    job.job_id = "job-23"
    src = SimpleNamespace(
        id=23,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    completed = SimpleNamespace(
        id=23,
        status="completed",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message=None,
    )
    db = AsyncMock()
    db.get = AsyncMock(side_effect=[src, completed])
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)
    pool = MagicMock()
    pool.zadd = AsyncMock(side_effect=RuntimeError("Redis unavailable"))

    with (
        patch("app.routers.bulk_import.async_session", return_value=db),
        patch("app.routers.bulk_import.get_pool", new_callable=AsyncMock, return_value=pool),
        patch("app.routers.bulk_import.asyncio.sleep", new_callable=AsyncMock),
        patch(
            "app.routers.bulk_import.collect_queue_state",
            new_callable=AsyncMock,
            return_value={"queue_up": True, "worker_up": False},
        ),
    ):
        result = await _wait_for_source_image_terminal_state(
            23,
            "latch-failure.jpg",
            enqueue_result=EnqueueResult("queued", "submitted", job=job, queued_at=time.monotonic()),
            pending_grace_seconds=0,
            no_worker_window_seconds=0,
            pending_wait_safety_cap_seconds=7200,
        )

    assert result.status == "completed"
    pool.zadd.assert_awaited_once()
    db.commit.assert_not_awaited()


async def test_wait_for_source_image_terminal_state_respects_lost_job_grace(
    caplog,
) -> None:
    """A not-found job is ignored during the enqueue visibility grace period."""
    job = MagicMock()
    job.status = AsyncMock(return_value=JobStatus.not_found)
    src = SimpleNamespace(
        id=14,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    completed = SimpleNamespace(
        id=14,
        status="completed",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message=None,
    )
    db = AsyncMock()
    db.get = AsyncMock(side_effect=[src, completed])
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("app.routers.bulk_import.async_session", return_value=db),
        patch("app.routers.bulk_import.asyncio.sleep", new_callable=AsyncMock),
    ):
        result = await _wait_for_source_image_terminal_state(
            14,
            "grace.jpg",
            enqueue_result=EnqueueResult(
                "queued",
                "submitted",
                job=job,
                queued_at=time.monotonic(),
            ),
            pending_grace_seconds=60,
        )

    assert result.status == "completed"
    job.status.assert_not_awaited()
    db.commit.assert_not_awaited()


async def test_wait_for_source_image_terminal_state_fails_repeatedly_lost_job(
    caplog,
) -> None:
    """A lost child is failed only after consecutive not-found observations."""
    job = MagicMock()
    job.status = AsyncMock(
        side_effect=[JobStatus.not_found, JobStatus.not_found],
    )
    src = SimpleNamespace(
        id=15,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    db = AsyncMock()
    db.get = AsyncMock(return_value=src)
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)

    with patch("app.routers.bulk_import.async_session", return_value=db):
        result = await _wait_for_source_image_terminal_state(
            15,
            "lost.jpg",
            enqueue_result=EnqueueResult(
                "queued",
                "submitted",
                job=job,
                queued_at=time.monotonic() - 60,
            ),
            pending_grace_seconds=0,
            lost_observations=2,
        )

    assert result.status == "failed"
    assert "never started" in result.error_message
    assert "lost" in result.error_message
    assert result.status_message == "Failed"
    db.commit.assert_awaited_once()
    assert any(record.event == "bulk_import.source_job_lost" for record in caplog.records)


async def test_wait_for_source_image_terminal_state_resets_lost_observations() -> None:
    """A visible queued child interrupts consecutive lost-job observations."""
    job = MagicMock()
    job.status = AsyncMock(
        side_effect=[
            JobStatus.not_found,
            JobStatus.queued,
            JobStatus.not_found,
            JobStatus.not_found,
        ],
    )
    src = SimpleNamespace(
        id=16,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    db = AsyncMock()
    db.get = AsyncMock(return_value=src)
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)

    with patch("app.routers.bulk_import.async_session", return_value=db):
        result = await _wait_for_source_image_terminal_state(
            16,
            "reset.jpg",
            enqueue_result=EnqueueResult(
                "queued",
                "submitted",
                job=job,
                queued_at=time.monotonic() - 60,
            ),
            pending_grace_seconds=0,
            lost_observations=2,
        )

    assert result.status == "failed"
    assert job.status.await_count == 4


async def test_wait_for_source_image_terminal_state_keeps_count_on_probe_error() -> None:
    """A status probe error is inconclusive and does not erase prior evidence."""
    job = MagicMock()
    job.status = AsyncMock(
        side_effect=[JobStatus.not_found, RuntimeError("redis unavailable"), JobStatus.not_found],
    )
    src = SimpleNamespace(
        id=17,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    db = AsyncMock()
    db.get = AsyncMock(return_value=src)
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)

    with patch("app.routers.bulk_import.async_session", return_value=db):
        result = await _wait_for_source_image_terminal_state(
            17,
            "probe-error.jpg",
            enqueue_result=EnqueueResult(
                "queued",
                "submitted",
                job=job,
                queued_at=time.monotonic() - 60,
            ),
            pending_grace_seconds=0,
            lost_observations=2,
        )

    assert result.status == "failed"
    assert job.status.await_count == 3


async def test_wait_for_source_image_terminal_state_fails_complete_job_without_result() -> None:
    """A completed arq job with a pending row reports a missing result."""
    job = MagicMock()
    job.status = AsyncMock(return_value=JobStatus.complete)
    src = SimpleNamespace(
        id=18,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    db = AsyncMock()
    db.get = AsyncMock(return_value=src)
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)

    with patch("app.routers.bulk_import.async_session", return_value=db):
        result = await _wait_for_source_image_terminal_state(
            18,
            "complete-without-result.jpg",
            enqueue_result=EnqueueResult(
                "queued",
                "submitted",
                job=job,
                queued_at=time.monotonic() - 60,
            ),
            pending_grace_seconds=0,
        )

    assert result.status == "failed"
    assert "did not record a terminal" in result.error_message
    assert "never started" not in result.error_message
    db.commit.assert_awaited_once()


async def test_wait_for_source_image_not_found_rereads_before_failing() -> None:
    """A child that starts during lost-job detection is not overwritten."""
    job = MagicMock()
    job.status = AsyncMock(
        side_effect=[JobStatus.not_found, JobStatus.not_found],
    )
    pending = SimpleNamespace(
        id=44,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    processing = SimpleNamespace(
        id=44,
        status="processing",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Processing",
    )
    completed = SimpleNamespace(
        id=44,
        status="completed",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message=None,
    )
    db = AsyncMock()
    db.get = AsyncMock(side_effect=[pending, pending, processing, completed])
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("app.routers.bulk_import.async_session", return_value=db),
        patch("app.routers.bulk_import.asyncio.sleep", new_callable=AsyncMock),
    ):
        result = await _wait_for_source_image_terminal_state(
            44,
            "not-found-race.jpg",
            enqueue_result=EnqueueResult(
                "queued",
                "submitted",
                job=job,
                queued_at=time.monotonic() - 60,
            ),
            pending_grace_seconds=0,
        )

    assert result.status == "completed"
    db.commit.assert_not_awaited()


async def test_wait_for_source_image_terminal_state_rereads_after_complete_probe() -> None:
    """A terminal row observed after probing wins over a stale pending read."""
    job = MagicMock()
    job.status = AsyncMock(return_value=JobStatus.complete)
    pending = SimpleNamespace(
        id=20,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    completed = SimpleNamespace(
        id=20,
        status="completed",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message=None,
    )
    async def get_source(_model, _source_id, **kwargs):
        return completed if kwargs.get("populate_existing") else pending

    db = AsyncMock()
    db.get = AsyncMock(side_effect=get_source)
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)

    with patch("app.routers.bulk_import.async_session", return_value=db):
        result = await _wait_for_source_image_terminal_state(
            20,
            "complete-race.jpg",
            enqueue_result=EnqueueResult(
                "queued",
                "submitted",
                job=job,
                queued_at=time.monotonic() - 60,
            ),
            pending_grace_seconds=0,
        )

    assert result.status == "completed"
    db.commit.assert_not_awaited()


async def test_wait_for_source_image_terminal_state_has_safety_cap() -> None:
    """The safety cap starts when processing begins, not while pending."""
    job = MagicMock()
    job.status = AsyncMock(return_value=JobStatus.queued)
    job.job_id = "job-19"
    pending = SimpleNamespace(
        id=19,
        status="pending",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Queued",
    )
    processing = SimpleNamespace(
        id=19,
        status="processing",
        updated_at=datetime.now(timezone.utc),
        error_message=None,
        status_message="Generating tiles",
    )
    db = AsyncMock()
    db.get = AsyncMock(side_effect=[pending, processing, processing])
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)
    pool = MagicMock()
    pool.zadd = AsyncMock()

    with (
        patch("app.routers.bulk_import.async_session", return_value=db),
        patch("app.routers.bulk_import.get_pool", new_callable=AsyncMock, return_value=pool),
    ):
        result = await _wait_for_source_image_terminal_state(
            19,
            "safety-cap.jpg",
            enqueue_result=EnqueueResult(
                "queued",
                "submitted",
                job=job,
                queued_at=time.monotonic(),
            ),
            pending_wait_safety_cap_seconds=7200,
            processing_wait_safety_cap_seconds=0,
        )

    assert result.status == "failed"
    assert "worker job timeout" in result.error_message
    pool.zadd.assert_awaited_once()
    db.commit.assert_awaited_once()


async def test_wait_for_source_image_terminal_state_handles_naive_updated_at() -> None:
    """Naive datetimes should be coerced to UTC for stale cutoff checks."""
    stale_time_naive = datetime.now() - timedelta(seconds=901)
    src = SimpleNamespace(
        id=11,
        status="processing",
        updated_at=stale_time_naive,
        error_message=None,
        status_message="Generating tiles",
    )
    db = AsyncMock()
    db.get = AsyncMock(return_value=src)
    db.commit = AsyncMock()
    db.__aenter__ = AsyncMock(return_value=db)
    db.__aexit__ = AsyncMock(return_value=False)

    with patch("app.routers.bulk_import.async_session", return_value=db):
        result = await _wait_for_source_image_terminal_state(11, "naive.jpg", stale_after_seconds=900)

    assert result.status == "failed"
    assert "stalled during bulk import" in result.error_message
    db.commit.assert_awaited_once()


# ── _is_image_filename edge cases ─────────────────────────────────────────


def test_is_image_filename_handles_dotfile() -> None:
    """Dotfiles (e.g. ``.jpg``) have no extension per ``Path.suffix`` and are
    therefore rejected — this prevents a hidden file named after an extension
    from being treated as an image."""
    assert _is_image_filename(".jpg") is False


def test_is_image_filename_handles_no_extension() -> None:
    assert _is_image_filename("noextension") is False


def test_is_image_filename_handles_nested_path() -> None:
    assert _is_image_filename("dir/sub/photo.png") is True


# ── zip-extraction extras (exercise cleanup and deeply-nested paths) ──────


async def test_bulk_import_images_strips_directory_prefix_from_zip(tmp_path) -> None:
    """Images nested inside folders in the zip are extracted using only their
    basename.  Internal directory markers (entries ending in ``/``) are skipped."""
    category = SimpleNamespace(id=1)
    db = AsyncMock()
    db.get = AsyncMock(return_value=category)
    db.add = MagicMock()
    db.commit = AsyncMock()

    async def _refresh(obj) -> None:
        obj.id = 5

    db.refresh = AsyncMock(side_effect=_refresh)
    bg = MagicMock()

    zip_payload = _zip_bytes({
        "nested/dir/": b"",  # directory marker — should be skipped
        "nested/dir/inner.tif": b"tif-bytes",
    })
    upload = _make_upload("deep.zip", [zip_payload, b""])

    with patch("app.routers.bulk_import.settings") as mock_settings:
        mock_settings.source_images_dir = str(tmp_path)
        await bulk_import_images(
            files=[upload],
            category_id=1,
            background_tasks=bg,
            _user=MagicMock(),
            db=db,
        )

    _, args, _ = bg.add_task.mock_calls[0]
    file_entries = args[2]
    assert len(file_entries) == 1
    # Basename only — no "nested/dir/" prefix.
    assert file_entries[0][0] == "inner.tif"
    # Stored path is under the configured source-images directory.
    assert os.path.commonpath([file_entries[0][1], str(tmp_path)]) == str(
        tmp_path
    )


# ── arq routing tests ─────────────────────────────────────────────────────


async def test_bulk_import_uses_arq_when_redis_available(tmp_path) -> None:
    """When enqueue_bulk_import returns True, BackgroundTasks is NOT used."""
    category = SimpleNamespace(id=1)
    db = AsyncMock()
    db.get = AsyncMock(return_value=category)
    db.add = MagicMock()
    db.commit = AsyncMock()

    async def _refresh(obj) -> None:
        obj.id = 99

    db.refresh = AsyncMock(side_effect=_refresh)
    bg = MagicMock()

    mock_enqueue = AsyncMock(return_value=EnqueueResult("queued", "submitted"))
    with patch("app.routers.bulk_import.enqueue_bulk_import", mock_enqueue):
        with patch("app.routers.bulk_import.settings") as mock_settings:
            mock_settings.source_images_dir = str(tmp_path)
            result = await bulk_import_images(
                files=[_make_upload("a.png", [b"png-bytes", b""])],
                category_id=1,
                background_tasks=bg,
                _user=MagicMock(),
                db=db,
            )

    assert result.id == 99
    mock_enqueue.assert_awaited_once()
    # BackgroundTasks should NOT have been called (arq handled it)
    bg.add_task.assert_not_called()


async def test_bulk_import_falls_back_to_background_tasks(tmp_path) -> None:
    """When enqueue_bulk_import returns False, BackgroundTasks IS used."""
    category = SimpleNamespace(id=1)
    db = AsyncMock()
    db.get = AsyncMock(return_value=category)
    db.add = MagicMock()
    db.commit = AsyncMock()

    async def _refresh(obj) -> None:
        obj.id = 77

    db.refresh = AsyncMock(side_effect=_refresh)
    bg = MagicMock()

    mock_enqueue = AsyncMock(return_value=EnqueueResult("fallback", "queue_unavailable"))
    with patch("app.routers.bulk_import.enqueue_bulk_import", mock_enqueue):
        with patch("app.routers.bulk_import.settings") as mock_settings:
            mock_settings.source_images_dir = str(tmp_path)
            result = await bulk_import_images(
                files=[_make_upload("b.tiff", [b"tiff-data", b""])],
                category_id=1,
                background_tasks=bg,
                _user=MagicMock(),
                db=db,
            )

    assert result.id == 77
    mock_enqueue.assert_awaited_once()
    # BackgroundTasks should have been called as fallback
    assert bg.add_task.call_count == 1


@pytest.mark.parametrize("bookkeeping_succeeds", [True, False])
async def test_bulk_import_rejection_unlinks_only_after_bookkeeping(
    tmp_path,
    bookkeeping_succeeds: bool,
) -> None:
    """Queue rejection retains staged files when terminal bookkeeping fails."""
    category = SimpleNamespace(id=1)
    db = AsyncMock()
    db.get = AsyncMock(return_value=category)
    db.add = MagicMock()
    db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "id", 88))
    db.commit = AsyncMock(
        side_effect=(
            [None, None]
            if bookkeeping_succeeds
            else [None, RuntimeError("connection lost")]
        ),
    )
    bg = MagicMock()
    unlink = MagicMock()

    with (
        patch("app.routers.bulk_import.settings") as mock_settings,
        patch(
            "app.routers.bulk_import.enqueue_bulk_import",
            new=AsyncMock(
                side_effect=TaskQueueUnavailableError("queue_unavailable"),
            ),
        ),
        patch("app.routers.bulk_import.os.unlink", new=unlink),
    ):
        mock_settings.source_images_dir = str(tmp_path)
        with pytest.raises(TaskQueueUnavailableError):
            await bulk_import_images(
                files=[_make_upload("rejected.tiff", [b"tiff-data", b""])],
                category_id=1,
                background_tasks=bg,
                _user=MagicMock(),
                db=db,
            )

    if bookkeeping_succeeds:
        unlink.assert_called_once()
    else:
        unlink.assert_not_called()


# ── ENOSPC handling ──────────────────────────────────────────────────────


async def test_bulk_import_enospc_plain_image(tmp_path) -> None:
    """ENOSPC during plain image write returns 507 and cleans up files."""
    category = SimpleNamespace(id=1)
    db = AsyncMock()
    db.get = AsyncMock(return_value=category)
    bg = MagicMock()

    enospc = OSError(errno.ENOSPC, "No space left on device")

    with (
        patch("app.routers.bulk_import.settings") as mock_settings,
        patch("builtins.open", side_effect=enospc),
        patch("os.makedirs"),
        patch("os.unlink") as mock_unlink,
    ):
        mock_settings.source_images_dir = str(tmp_path)
        with pytest.raises(HTTPException) as exc:
            await bulk_import_images(
                files=[_make_upload("big.tiff", [b"data", b""])],
                category_id=1,
                background_tasks=bg,
                _user=MagicMock(),
                db=db,
            )

    assert exc.value.status_code == 507
    assert "storage" in exc.value.detail.lower()


async def test_bulk_import_enospc_zip_extraction(tmp_path) -> None:
    """ENOSPC during zip entry extraction returns 507."""
    category = SimpleNamespace(id=1)
    db = AsyncMock()
    db.get = AsyncMock(return_value=category)
    bg = MagicMock()

    zip_data = _zip_bytes({"slide.tiff": b"tiff-content"})

    # zipfile.ZipFile reads the temp file via builtins.open in "rb" mode;
    # the extraction destination is opened in "wb" mode.  Only fail on
    # write-mode opens so the zip read succeeds but extraction hits ENOSPC.
    real_open = open

    def _open_side_effect(*args, **kwargs):
        mode = args[1] if len(args) > 1 else kwargs.get("mode", "r")
        if "w" in str(mode):
            raise OSError(errno.ENOSPC, "No space left on device")
        return real_open(*args, **kwargs)

    upload = AsyncMock()
    upload.filename = "archive.zip"
    upload.content_type = "application/zip"
    upload.read = AsyncMock(side_effect=[zip_data, b""])

    with (
        patch("app.routers.bulk_import.settings") as mock_settings,
        patch("builtins.open", side_effect=_open_side_effect),
        patch("os.makedirs"),
        patch("os.unlink"),
    ):
        mock_settings.source_images_dir = str(tmp_path)
        with pytest.raises(HTTPException) as exc:
            await bulk_import_images(
                files=[upload],
                category_id=1,
                background_tasks=bg,
                _user=MagicMock(),
                db=db,
            )

    assert exc.value.status_code == 507
    assert "storage" in exc.value.detail.lower()
