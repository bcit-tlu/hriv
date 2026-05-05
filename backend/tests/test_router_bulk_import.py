"""Tests for the bulk_import router helper functions and endpoints.

Covers https://github.com/bcit-tlu/hriv/issues/23 — the previous suite only
exercised the simple list/lookup paths.  These tests drive ZIP extraction,
image-filtering, error handling, job-state transitions, and the background
processing helper.
"""

import io
import os
import sys
import zipfile
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

# Ensure pyvips can be imported even when libvips is not installed (CI)
if "pyvips" not in sys.modules:
    sys.modules["pyvips"] = MagicMock()
    sys.modules["pyvips.enums"] = MagicMock()

from app.routers.bulk_import import (
    _is_image_filename,
    _process_bulk_import,
    bulk_import_images,
    get_bulk_import_job,
    list_bulk_import_jobs,
)


# ── _is_image_filename ────────────────────────────────────────────────────


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
    src = SimpleNamespace(id=10, status="completed", error_message=None)

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
            program_ids=[1],
            active=True,
        )

    # Final status is "completed" and the completed_count was incremented
    assert job.status == "completed"


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
    src = SimpleNamespace(id=10, status="failed", error_message="bad header")

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
    src = SimpleNamespace(id=10, status="pending", error_message=None)

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
    src_rows = {10: SimpleNamespace(id=10, status="completed", error_message=None),
                11: SimpleNamespace(id=11, status="failed", error_message="oops")}
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
