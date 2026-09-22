"""Tests for the upload router endpoints."""

import asyncio
import errno
import os
import sys
import time
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
from app.upload_staging import (
    reconcile_staging_artifacts,
    staging_path_for,
)
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
            file=file, background_tasks=bg, user=MagicMock(),
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
            file=file, background_tasks=bg, user=MagicMock(),
            db=db,
        )
    assert exc.value.status_code == 400
    assert "image" in exc.value.detail.lower()


async def test_upload_source_image_success(tmp_path) -> None:
    file = AsyncMock()
    file.filename = "test.png"
    file.content_type = "image/png"
    file.read = AsyncMock(side_effect=[b"fake-png-data", b""])

    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    bg = MagicMock()
    user = MagicMock()

    with patch("app.routers.upload.settings") as mock_settings:
        mock_settings.source_images_dir = str(tmp_path)
        result = await upload_source_image(
            file=file, background_tasks=bg, user=user,
            name="Test Image", category_id=1, copyright="CC0",
            note="A note", active=True,
            db=db,
        )

    db.add.assert_called_once()
    db.commit.assert_awaited_once()
    bg.add_task.assert_called_once()
    src = db.add.call_args.args[0]
    assert src.uploaded_by == user.id


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
            user=MagicMock(),
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
                user=MagicMock(),
                db=db,
            )

    db.rollback.assert_awaited_once()
    recovery_db.execute.assert_awaited_once()
    recovery_db.commit.assert_awaited_once()
    statement = recovery_db.execute.await_args.args[0]
    assert statement.compile().params["status_1"] == "pending"
    # The committed failed row owns stored_path, so the file is retained
    # (#1248): an owned file must never be unlinked.
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
                file=file, background_tasks=bg, user=MagicMock(), db=db,
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
                file=file, background_tasks=bg, user=MagicMock(), db=db,
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
            user=MagicMock(),
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
            user=MagicMock(),
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
            user=MagicMock(),
            db=db,
        )

    src = db.add.call_args.args[0]
    assert src.original_filename == f"slide.{long_suffix}"
    assert src.stored_path.endswith(".bin")
    assert len(os.path.basename(src.stored_path)) <= 255


def _mock_recovery_session(*, owned: bool | None = None, raises: bool = False):
    """Return a patched ``app.upload_staging.async_session`` context manager.

    *owned* controls the ownership probe's scalar result; *raises* simulates
    the database being unreachable during the check.
    """
    recovery_db = AsyncMock()
    if raises:
        recovery_db.scalar = AsyncMock(side_effect=RuntimeError("db unreachable"))
    else:
        recovery_db.scalar = AsyncMock(return_value=owned)
    recovery_db.__aenter__ = AsyncMock(return_value=recovery_db)
    recovery_db.__aexit__ = AsyncMock(return_value=False)
    return patch("app.upload_staging.async_session", return_value=recovery_db)


async def test_upload_source_image_cancellation_leaves_no_final_file(tmp_path) -> None:
    """A cancelled upload must not leave an apparently authoritative file."""
    file = AsyncMock()
    file.filename = "cancelled.png"
    file.content_type = "image/png"
    file.read = AsyncMock(side_effect=[b"partial", asyncio.CancelledError()])

    db = AsyncMock()
    with patch("app.routers.upload.settings") as mock_settings:
        mock_settings.source_images_dir = str(tmp_path)
        with pytest.raises(asyncio.CancelledError):
            await upload_source_image(
                file=file,
                background_tasks=MagicMock(),
                user=MagicMock(),
                db=db,
            )

    # No final-path file and no leftover staging artifact.
    assert os.listdir(tmp_path) == []
    db.add.assert_not_called()


async def test_upload_source_image_commit_failure_removes_unowned_file(tmp_path) -> None:
    """An unambiguous commit failure deletes the unowned final-path file."""
    file = AsyncMock()
    file.filename = "commitfail.png"
    file.content_type = "image/png"
    file.read = AsyncMock(side_effect=[b"fake-png-data", b""])

    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock(side_effect=RuntimeError("commit failed"))

    with (
        patch("app.routers.upload.settings") as mock_settings,
        _mock_recovery_session(owned=False),
    ):
        mock_settings.source_images_dir = str(tmp_path)
        with pytest.raises(RuntimeError, match="commit failed"):
            await upload_source_image(
                file=file,
                background_tasks=MagicMock(),
                user=MagicMock(),
                db=db,
            )

    # Final file deleted after proving no committed row owns it.
    assert os.listdir(tmp_path) == []


async def test_upload_source_image_ambiguous_commit_retains_owned_file(tmp_path) -> None:
    """When a row owns the path despite the raised error, retain the file."""
    file = AsyncMock()
    file.filename = "ambiguous.png"
    file.content_type = "image/png"
    file.read = AsyncMock(side_effect=[b"fake-png-data", b""])

    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock(side_effect=RuntimeError("ambiguous commit"))

    with (
        patch("app.routers.upload.settings") as mock_settings,
        _mock_recovery_session(owned=True),
    ):
        mock_settings.source_images_dir = str(tmp_path)
        with pytest.raises(RuntimeError, match="ambiguous commit"):
            await upload_source_image(
                file=file,
                background_tasks=MagicMock(),
                user=MagicMock(),
                db=db,
            )

    # A committed row owns the path: the file stays.
    remaining = os.listdir(tmp_path)
    assert len(remaining) == 1
    assert not remaining[0].startswith(".staging-")


async def test_upload_source_image_ownership_check_failure_retains_file(tmp_path) -> None:
    """If ownership cannot be determined, fail safe by retaining the file."""
    file = AsyncMock()
    file.filename = "unknown.png"
    file.content_type = "image/png"
    file.read = AsyncMock(side_effect=[b"fake-png-data", b""])

    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock(side_effect=RuntimeError("commit failed"))

    with (
        patch("app.routers.upload.settings") as mock_settings,
        _mock_recovery_session(raises=True),
    ):
        mock_settings.source_images_dir = str(tmp_path)
        with pytest.raises(RuntimeError, match="commit failed"):
            await upload_source_image(
                file=file,
                background_tasks=MagicMock(),
                user=MagicMock(),
                db=db,
            )

    assert len(os.listdir(tmp_path)) == 1


async def test_upload_source_image_cleanup_failure_propagates_original(tmp_path) -> None:
    """A cleanup unlink failure must not mask the original commit error."""
    file = AsyncMock()
    file.filename = "cleanupfail.png"
    file.content_type = "image/png"
    file.read = AsyncMock(side_effect=[b"fake-png-data", b""])

    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock(side_effect=RuntimeError("commit failed"))

    with (
        patch("app.routers.upload.settings") as mock_settings,
        _mock_recovery_session(owned=False),
        patch("os.unlink", side_effect=OSError(errno.EACCES, "denied")),
    ):
        mock_settings.source_images_dir = str(tmp_path)
        with pytest.raises(RuntimeError, match="commit failed"):
            await upload_source_image(
                file=file,
                background_tasks=MagicMock(),
                user=MagicMock(),
                db=db,
            )


async def test_upload_source_image_success_writes_via_staging(tmp_path) -> None:
    """The happy path streams to a staging name then renames into place."""
    file = AsyncMock()
    file.filename = "happy.png"
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
            user=MagicMock(),
            db=db,
        )

    src = db.add.call_args.args[0]
    final_name = os.path.basename(src.stored_path)
    assert staging_path_for(src.stored_path).endswith(f".staging-{final_name}")
    # File landed at the final path; no staging artifact remains.
    assert os.listdir(tmp_path) == [final_name]


async def test_reconcile_staging_artifacts_removes_only_aged_staging(tmp_path) -> None:
    """The sweep removes aged .staging-* files and nothing else."""
    old_staging = tmp_path / ".staging-old.png"
    fresh_staging = tmp_path / ".staging-fresh.png"
    normal_file = tmp_path / "committed.png"
    old_staging.write_bytes(b"partial")
    fresh_staging.write_bytes(b"inflight")
    normal_file.write_bytes(b"real")

    old_mtime = time.time() - 7200
    os.utime(old_staging, (old_mtime, old_mtime))

    removed = await reconcile_staging_artifacts(str(tmp_path))

    assert removed == 1
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        ".staging-fresh.png",
        "committed.png",
    ]
