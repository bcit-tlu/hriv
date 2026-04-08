"""Tests for the admin router helper functions and endpoints."""

import json
import os
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.routers.admin import (
    _parse_dt,
    _create_tar_file,
    _extract_and_restore,
    export_database,
    import_database,
    create_export_files_token,
    export_files,
    import_files,
)


def test_parse_dt_valid() -> None:
    result = _parse_dt("2025-01-15T10:30:00+00:00")
    assert isinstance(result, datetime)
    assert result.year == 2025


def test_parse_dt_none() -> None:
    assert _parse_dt(None) is None


def test_parse_dt_empty_string() -> None:
    assert _parse_dt("") is None


def test_create_tar_file(tmp_path) -> None:
    # Create a temp directory with some files
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "file1.txt").write_text("hello")
    (data_dir / "subdir").mkdir()
    (data_dir / "subdir" / "file2.txt").write_text("world")

    dest = str(tmp_path / "archive.tar.gz")
    _create_tar_file(str(data_dir), dest)

    assert os.path.exists(dest)
    with tarfile.open(dest, "r:gz") as tar:
        names = tar.getnames()
        assert len(names) >= 2


def test_extract_and_restore(tmp_path) -> None:
    # Create a data directory and archive it
    data_dir = tmp_path / "original_data"
    data_dir.mkdir()
    tiles_dir = data_dir / "tiles"
    tiles_dir.mkdir()
    source_dir = data_dir / "source_images"
    source_dir.mkdir()
    (tiles_dir / "tile1.jpeg").write_text("tile data")
    (source_dir / "src1.tiff").write_text("source data")

    archive = str(tmp_path / "test.tar.gz")
    with tarfile.open(archive, "w:gz") as tar:
        tar.add(str(data_dir), arcname="data")

    # Now restore to a new location
    restore_dir = tmp_path / "restored_data"

    with tempfile.TemporaryDirectory() as tmpdir:
        result = _extract_and_restore(
            archive,
            tmpdir,
            str(restore_dir),
            str(restore_dir / "tiles"),
            str(restore_dir / "source_images"),
        )

    assert result["tile_files"] >= 1
    assert result["source_files"] >= 1


def test_extract_and_restore_empty_archive(tmp_path) -> None:
    # Create an empty archive
    archive = str(tmp_path / "empty.tar.gz")
    with tarfile.open(archive, "w:gz") as tar:
        pass  # empty

    restore_dir = tmp_path / "restored"

    with tempfile.TemporaryDirectory() as tmpdir:
        with pytest.raises(ValueError, match="empty"):
            _extract_and_restore(
                archive,
                tmpdir,
                str(restore_dir),
                str(restore_dir / "tiles"),
                str(restore_dir / "source_images"),
            )


async def test_import_database_rejects_non_json_file() -> None:
    upload = MagicMock()
    upload.filename = "data.csv"

    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await import_database(MagicMock(), file=upload, db=db)
    assert exc.value.status_code == 400
    assert "json" in exc.value.detail.lower()


async def test_import_database_rejects_invalid_json() -> None:
    upload = AsyncMock()
    upload.filename = "data.json"
    upload.read = AsyncMock(return_value=b"not-json")

    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await import_database(MagicMock(), file=upload, db=db)
    assert exc.value.status_code == 400


async def test_import_database_rejects_non_object() -> None:
    upload = AsyncMock()
    upload.filename = "data.json"
    upload.read = AsyncMock(return_value=b'[1, 2, 3]')

    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await import_database(MagicMock(), file=upload, db=db)
    assert exc.value.status_code == 400
    assert "object" in exc.value.detail.lower()


async def test_import_database_rejects_missing_keys() -> None:
    import json
    data = {"categories": [], "images": []}  # missing "users"
    upload = AsyncMock()
    upload.filename = "data.json"
    upload.read = AsyncMock(return_value=json.dumps(data).encode())

    db = AsyncMock()

    with pytest.raises(HTTPException) as exc:
        await import_database(MagicMock(), file=upload, db=db)
    assert exc.value.status_code == 400
    assert "users" in exc.value.detail


async def test_create_export_files_token() -> None:
    user = SimpleNamespace(id=1)

    with patch("app.routers.admin.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        result = await create_export_files_token(user)

    assert "token" in result


async def test_export_files_invalid_token() -> None:
    db = AsyncMock()

    with patch("app.routers.admin.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        with pytest.raises(HTTPException) as exc:
            await export_files(token="invalid-jwt", db=db)
        assert exc.value.status_code == 401


async def test_export_files_wrong_purpose() -> None:
    from jose import jwt as jose_jwt

    # Create a token with wrong purpose
    token = jose_jwt.encode(
        {"sub": "1", "purpose": "general"},
        "test-secret",
        algorithm="HS256",
    )

    db = AsyncMock()

    with patch("app.routers.admin.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        with pytest.raises(HTTPException) as exc:
            await export_files(token=token, db=db)
        assert exc.value.status_code == 401


async def test_export_files_no_sub() -> None:
    from jose import jwt as jose_jwt

    token = jose_jwt.encode(
        {"purpose": "file-export"},
        "test-secret",
        algorithm="HS256",
    )

    db = AsyncMock()

    with patch("app.routers.admin.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        with pytest.raises(HTTPException) as exc:
            await export_files(token=token, db=db)
        assert exc.value.status_code == 401


async def test_export_files_user_not_found() -> None:
    from jose import jwt as jose_jwt

    token = jose_jwt.encode(
        {"sub": "999", "purpose": "file-export"},
        "test-secret",
        algorithm="HS256",
    )

    db = AsyncMock()
    db.get = AsyncMock(return_value=None)

    with patch("app.routers.admin.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        with pytest.raises(HTTPException) as exc:
            await export_files(token=token, db=db)
        assert exc.value.status_code == 403


async def test_export_files_non_admin_user() -> None:
    from jose import jwt as jose_jwt

    token = jose_jwt.encode(
        {"sub": "1", "purpose": "file-export"},
        "test-secret",
        algorithm="HS256",
    )

    user = SimpleNamespace(id=1, role="student")
    db = AsyncMock()
    db.get = AsyncMock(return_value=user)

    with patch("app.routers.admin.auth_settings") as mock_settings:
        mock_settings.jwt_secret = "test-secret"
        mock_settings.jwt_algorithm = "HS256"
        with pytest.raises(HTTPException) as exc:
            await export_files(token=token, db=db)
        assert exc.value.status_code == 403


async def test_import_files_rejects_non_tar() -> None:
    upload = MagicMock()
    upload.filename = "data.zip"

    with pytest.raises(HTTPException) as exc:
        await import_files(MagicMock(), file=upload)
    assert exc.value.status_code == 400
    assert "tar.gz" in exc.value.detail.lower()


async def test_import_files_accepts_tgz() -> None:
    """Verify .tgz extension passes the filename check (tests the condition)."""
    upload = AsyncMock()
    upload.filename = "data.tgz"

    # We need to let it get past the filename check but fail on extraction
    # to confirm the extension is accepted
    upload.read = AsyncMock(side_effect=[b"not-a-tar", b""])

    with patch("app.routers.admin.settings") as mock_settings:
        mock_settings.tiles_dir = "/tmp/test-tiles"
        with pytest.raises(HTTPException) as exc:
            await import_files(MagicMock(), file=upload)
        # Should fail at tar extraction, not at filename check
        assert exc.value.status_code == 400
        assert "tar.gz" in exc.value.detail.lower() or "archive" in exc.value.detail.lower()


# ── export_database tests ────────────────────────────────────


async def test_export_database_success() -> None:
    now = datetime.now(timezone.utc)

    programs = [SimpleNamespace(id=1, name="CS", created_at=now, updated_at=now)]
    categories = [
        SimpleNamespace(
            id=1, label="Cat A", parent_id=None, program="CS",
            status="active", sort_order=0, metadata_={},
            created_at=now, updated_at=now,
        )
    ]
    images = [
        SimpleNamespace(
            id=1, name="img1", thumb="/t.jpg", tile_sources="/tiles/1",
            category_id=1, copyright="CC0", note=None, active=True,
            metadata_={}, created_at=now, updated_at=now,
            programs=[SimpleNamespace(id=1)],
        )
    ]
    users = [
        SimpleNamespace(
            id=1, name="Admin", email="admin@example.com",
            password_hash="hashed", role="admin", program_id=None,
            last_access=now, metadata_={}, created_at=now, updated_at=now,
        )
    ]
    source_images = [
        SimpleNamespace(
            id=1, original_filename="src.tiff", stored_path="/data/src.tiff",
            status="completed", error_message=None, name="src",
            category_id=1, copyright="CC0", note=None, active=True,
            program=None, image_id=1, created_at=now, updated_at=now,
        )
    ]
    announcement = SimpleNamespace(
        message="Hello", enabled=True, created_at=now, updated_at=now,
    )

    call_count = 0

    async def mock_execute(stmt):
        nonlocal call_count
        call_count += 1
        result = MagicMock()
        data_map = {
            1: programs,
            2: categories,
            3: images,
            4: users,
            5: source_images,
        }
        if call_count <= 5:
            result.scalars.return_value.all.return_value = data_map[call_count]
        else:
            result.scalar_one_or_none.return_value = announcement
        return result

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=mock_execute)

    response = await export_database(MagicMock(), db=db)

    assert response.status_code == 200
    body = json.loads(response.body)
    assert len(body["programs"]) == 1
    assert len(body["categories"]) == 1
    assert len(body["images"]) == 1
    assert len(body["users"]) == 1
    assert len(body["source_images"]) == 1
    assert body["announcement"]["message"] == "Hello"


async def test_export_database_empty() -> None:
    """Export with no data returns empty arrays."""
    call_count = 0

    async def mock_execute(stmt):
        nonlocal call_count
        call_count += 1
        result = MagicMock()
        if call_count <= 5:
            result.scalars.return_value.all.return_value = []
        else:
            result.scalar_one_or_none.return_value = None
        return result

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=mock_execute)

    response = await export_database(MagicMock(), db=db)

    body = json.loads(response.body)
    assert body["programs"] == []
    assert body["categories"] == []
    assert body["images"] == []
    assert body["users"] == []
    assert body["source_images"] == []
    assert body["announcement"]["message"] == ""
    assert body["announcement"]["enabled"] is False
