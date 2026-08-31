"""Tests for the upload router endpoints."""

import errno
import os
import sys
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

# Ensure pyvips can be imported even when libvips is not installed (CI)
if "pyvips" not in sys.modules:
    sys.modules["pyvips"] = MagicMock()
    sys.modules["pyvips.enums"] = MagicMock()

from app.image_validation import is_valid_image
from app.routers.upload import list_source_images, get_source_image, upload_source_image
from app.worker import TaskQueueUnavailableError


def test_is_valid_image_by_extension() -> None:
    assert is_valid_image("photo.jpg", None) is True
    assert is_valid_image("photo.jpeg", None) is True
    assert is_valid_image("photo.png", None) is True
    assert is_valid_image("photo.tif", None) is True
    assert is_valid_image("photo.tiff", None) is True
    assert is_valid_image("photo.gif", None) is True
    assert is_valid_image("photo.webp", None) is True
    assert is_valid_image("photo.svs", None) is True
    # BMP is intentionally rejected: no native libvips loader and the
    # ImageMagick delegate is disabled in the backend image.
    assert is_valid_image("photo.bmp", None) is False
    assert is_valid_image("photo.txt", None) is False
    assert is_valid_image("photo.pdf", None) is False


def test_is_valid_image_by_content_type() -> None:
    assert is_valid_image("noext", "image/png") is True
    assert is_valid_image("noext", "image/jpeg") is True
    assert is_valid_image("noext", "image/tiff") is True
    assert is_valid_image("noext", "image/gif") is True
    assert is_valid_image("noext", "image/webp") is True
    assert is_valid_image("noext", "application/pdf") is False
    # BMP is rejected even via MIME type (libvips BMP loader absent).
    assert is_valid_image("noext", "image/bmp") is False
    assert is_valid_image("photo.bmp", "image/bmp") is False
    # ``image/svg+xml`` is not in the allow-list (not a pathology-slide
    # format and we don't compile librsvg into the libvips build).
    assert is_valid_image("noext", "image/svg+xml") is False


def test_is_valid_image_case_insensitive_extension() -> None:
    assert is_valid_image("photo.JPG", None) is True
    assert is_valid_image("photo.PNG", None) is True
    assert is_valid_image("photo.TIF", None) is True


async def test_list_source_images() -> None:
    now = datetime.now(timezone.utc)
    srcs = [
        SimpleNamespace(id=1, original_filename="a.tiff", status="completed",
                        created_at=now, updated_at=now),
        SimpleNamespace(id=2, original_filename="b.png", status="pending",
                        created_at=now, updated_at=now),
    ]
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = srcs

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    result = await list_source_images(MagicMock(), db=db)
    assert len(result) == 2
    stmt = str(db.execute.await_args.args[0])
    assert "ORDER BY source_images.created_at DESC" in stmt
    assert "WHERE" not in stmt
    assert "LIMIT" not in stmt


async def test_list_source_images_filters_by_status_and_limit() -> None:
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = []

    db = AsyncMock()
    db.execute = AsyncMock(return_value=mock_result)

    await list_source_images(MagicMock(), status="failed", limit=20, db=db)
    stmt = db.execute.await_args.args[0]
    assert "source_images.status = " in str(stmt)
    assert "LIMIT" in str(stmt)
    assert stmt.compile().params["status_1"] == "failed"


async def test_get_source_image_found() -> None:
    now = datetime.now(timezone.utc)
    src = SimpleNamespace(id=1, original_filename="a.tiff", status="completed",
                          created_at=now, updated_at=now)
    db = AsyncMock()
    db.get = AsyncMock(return_value=src)

    result = await get_source_image(1, MagicMock(), db)
    assert result.original_filename == "a.tiff"


async def test_get_source_image_not_found() -> None:
    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as exc:
        await get_source_image(999, MagicMock(), db)
    assert exc.value.status_code == 404


async def test_upload_source_image_no_filename() -> None:
    file = AsyncMock()
    file.filename = ""

    db = AsyncMock()
    bg = MagicMock()

    with pytest.raises(HTTPException) as exc:
        await upload_source_image(
            file=file, background_tasks=bg, _user=MagicMock(),
            db=db,
        )
    assert exc.value.status_code == 400
    assert "no file" in exc.value.detail.lower()


async def test_upload_source_image_invalid_type() -> None:
    file = AsyncMock()
    file.filename = "readme.txt"
    file.content_type = "text/plain"

    db = AsyncMock()
    bg = MagicMock()

    with pytest.raises(HTTPException) as exc:
        await upload_source_image(
            file=file, background_tasks=bg, _user=MagicMock(),
            db=db,
        )
    assert exc.value.status_code == 400
    assert "image" in exc.value.detail.lower()


async def test_upload_source_image_success(tmp_path) -> None:
    file = AsyncMock()
    file.filename = "test.png"
    file.content_type = "image/png"
    file.read = AsyncMock(side_effect=[b"fake-png-data", b""])

    src = SimpleNamespace(
        id=1, original_filename="test.png", stored_path="/tmp/test.png",
        status="pending", created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )

    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    bg = MagicMock()

    with patch("app.routers.upload.settings") as mock_settings:
        mock_settings.source_images_dir = str(tmp_path)
        result = await upload_source_image(
            file=file, background_tasks=bg, _user=MagicMock(),
            name="Test Image", category_id=1, copyright="CC0",
            note="A note", active=True,
            db=db,
        )

    db.add.assert_called_once()
    db.commit.assert_awaited_once()
    bg.add_task.assert_called_once()


async def test_upload_source_image_normalizes_empty_note(tmp_path) -> None:
    file = AsyncMock()
    file.filename = "test.png"
    file.content_type = "image/png"
    file.read = AsyncMock(side_effect=[b"fake-png-data", b""])

    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    with patch("app.routers.upload.settings") as mock_settings:
        mock_settings.source_images_dir = str(tmp_path)
        await upload_source_image(
            file=file,
            background_tasks=MagicMock(),
            _user=MagicMock(),
            note="",
            db=db,
        )

    src = db.add.call_args.args[0]
    assert src.note is None


@pytest.mark.parametrize("recovery_succeeds", [True, False])
async def test_upload_source_image_rejection_uses_fresh_session_when_bookkeeping_fails(
    tmp_path,
    recovery_succeeds,
) -> None:
    """A failed original-session write still terminalizes the source row."""
    file = AsyncMock()
    file.filename = "rejected.png"
    file.content_type = "image/png"
    file.read = AsyncMock(side_effect=[b"fake-png-data", b""])

    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock(side_effect=[None, RuntimeError("connection lost")])
    db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "id", 7))
    db.rollback = AsyncMock()

    recovery_db = AsyncMock()
    recovery_db.execute = AsyncMock()
    recovery_db.commit = AsyncMock(
        side_effect=None if recovery_succeeds else RuntimeError("recovery lost"),
    )
    recovery_db.__aenter__ = AsyncMock(return_value=recovery_db)
    recovery_db.__aexit__ = AsyncMock(return_value=False)

    background_tasks = MagicMock()
    unlink = MagicMock()

    with (
        patch("app.routers.upload.settings") as mock_settings,
        patch(
            "app.routers.upload.enqueue_process_source_image",
            new=AsyncMock(
                side_effect=TaskQueueUnavailableError("queue_unavailable"),
            ),
        ),
        patch("app.routers.upload.async_session", return_value=recovery_db),
        patch("app.routers.upload.os.unlink", new=unlink),
    ):
        mock_settings.source_images_dir = str(tmp_path)
        with pytest.raises(TaskQueueUnavailableError):
            await upload_source_image(
                file=file,
                background_tasks=background_tasks,
                _user=MagicMock(),
                db=db,
            )

    db.rollback.assert_awaited_once()
    recovery_db.execute.assert_awaited_once()
    recovery_db.commit.assert_awaited_once()
    statement = recovery_db.execute.await_args.args[0]
    assert statement.compile().params["status_1"] == "pending"
    if recovery_succeeds:
        unlink.assert_called_once()
    else:
        unlink.assert_not_called()
    background_tasks.add_task.assert_not_called()


async def test_upload_source_image_enospc(tmp_path) -> None:
    """ENOSPC during file write returns 507 and cleans up partial file."""
    file = AsyncMock()
    file.filename = "huge.tiff"
    file.content_type = "image/tiff"
    file.read = AsyncMock(side_effect=[b"chunk1", b"chunk2"])

    db = AsyncMock()
    bg = MagicMock()

    enospc = OSError(errno.ENOSPC, "No space left on device")

    with (
        patch("app.routers.upload.settings") as mock_settings,
        patch("builtins.open", side_effect=enospc),
        patch("os.makedirs"),
        patch("os.unlink") as mock_unlink,
    ):
        mock_settings.source_images_dir = str(tmp_path)
        with pytest.raises(HTTPException) as exc:
            await upload_source_image(
                file=file, background_tasks=bg, _user=MagicMock(), db=db,
            )

    assert exc.value.status_code == 507
    assert "storage" in exc.value.detail.lower()
    mock_unlink.assert_called_once()


async def test_upload_source_image_other_os_error(tmp_path) -> None:
    """Non-ENOSPC OSErrors propagate without conversion to 507."""
    file = AsyncMock()
    file.filename = "test.png"
    file.content_type = "image/png"

    db = AsyncMock()
    bg = MagicMock()

    perm_error = OSError(errno.EACCES, "Permission denied")

    with (
        patch("app.routers.upload.settings") as mock_settings,
        patch("builtins.open", side_effect=perm_error),
        patch("os.makedirs"),
        patch("os.unlink"),
    ):
        mock_settings.source_images_dir = str(tmp_path)
        with pytest.raises(OSError) as exc:
            await upload_source_image(
                file=file, background_tasks=bg, _user=MagicMock(), db=db,
            )

    assert exc.value.errno == errno.EACCES


async def test_upload_source_image_normalizes_original_filename(tmp_path) -> None:
    """Path components, control characters, and markup are normalized."""
    file = AsyncMock()
    file.filename = "../evil\ndir/<img src=x onerror=alert(1)>.png"
    file.content_type = "image/png"
    file.read = AsyncMock(side_effect=[b"fake-png-data", b""])

    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    with patch("app.routers.upload.settings") as mock_settings:
        mock_settings.source_images_dir = str(tmp_path)
        await upload_source_image(
            file=file,
            background_tasks=MagicMock(),
            _user=MagicMock(),
            db=db,
        )

    src = db.add.call_args.args[0]
    assert src.original_filename == "<img src=x onerror=alert(1)>.png"
    assert src.stored_path.endswith(".png")


async def test_upload_source_image_keeps_ordinary_filename(tmp_path) -> None:
    file = AsyncMock()
    file.filename = "Liver biopsy échantillon.tiff"
    file.content_type = "image/tiff"
    file.read = AsyncMock(side_effect=[b"fake-tiff-data", b""])

    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    with patch("app.routers.upload.settings") as mock_settings:
        mock_settings.source_images_dir = str(tmp_path)
        await upload_source_image(
            file=file,
            background_tasks=MagicMock(),
            _user=MagicMock(),
            db=db,
        )

    src = db.add.call_args.args[0]
    assert src.original_filename == "Liver biopsy échantillon.tiff"


async def test_upload_source_image_bounds_stored_extension(tmp_path) -> None:
    """A long client suffix must not produce an over-long on-disk name."""
    long_suffix = "t" * 300
    file = AsyncMock()
    file.filename = f"slide.{long_suffix}"
    file.content_type = "image/png"
    file.read = AsyncMock(side_effect=[b"fake-png-data", b""])

    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    with patch("app.routers.upload.settings") as mock_settings:
        mock_settings.source_images_dir = str(tmp_path)
        await upload_source_image(
            file=file,
            background_tasks=MagicMock(),
            _user=MagicMock(),
            db=db,
        )

    src = db.add.call_args.args[0]
    assert src.original_filename == f"slide.{long_suffix}"
    assert src.stored_path.endswith(".bin")
    assert len(os.path.basename(src.stored_path)) <= 255
