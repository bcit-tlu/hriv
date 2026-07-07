"""Tests for the Azure-backed backup access helpers."""

from __future__ import annotations

import hashlib
import io
import json
import tarfile
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from azure.core.exceptions import ResourceNotFoundError

from app import backup_access
from app.backup_access import (
    BackupRestoreNotConfiguredError,
    BackupSnapshotMemberError,
    get_snapshot_manifest,
    list_snapshots,
    restore_snapshot_file,
)


class _FakeDownloader:
    def __init__(self, payload: bytes) -> None:
        self._payload = payload

    def readall(self) -> bytes:
        return self._payload

    def chunks(self):
        for idx in range(0, len(self._payload), 256):
            yield self._payload[idx : idx + 256]


class _FakeContainer:
    def __init__(self, blobs: list[SimpleNamespace], downloads: dict[str, bytes]) -> None:
        self._blobs = blobs
        self._downloads = downloads

    def list_blobs(self, name_starts_with: str = ""):
        return [blob for blob in self._blobs if blob.name.startswith(name_starts_with)]

    def download_blob(self, blob_name: str):
        try:
            payload = self._downloads[blob_name]
        except KeyError as exc:
            raise ResourceNotFoundError(message=f"{blob_name} not found") from exc
        return _FakeDownloader(payload)


def _configure(monkeypatch, tmp_path: Path, fake_container: _FakeContainer) -> None:
    monkeypatch.setattr(backup_access.settings, "azure_read_sas_url", "https://example/container?sig=read")
    monkeypatch.setattr(backup_access.settings, "azure_backup_prefix", "hriv-backups")
    monkeypatch.setattr(backup_access.settings, "data_dir", str(tmp_path / "data"))
    monkeypatch.setattr(backup_access.ContainerClient, "from_container_url", lambda _url: fake_container)


def _snapshot_manifest(snapshot_name: str, files: dict[str, tuple[bytes, str]]):
    return {
        "snapshot_name": snapshot_name,
        "created_at": "2026-01-01T00:00:00+00:00",
        "backup_mode": "production",
        "tiles_excluded": True,
        "files": {
            member: {"size": len(payload), "sha256": sha256}
            for member, (payload, sha256) in files.items()
        },
    }


def _tar_bytes(snapshot_name: str, manifest: dict, files: dict[str, bytes], *, symlink: str | None = None) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for rel_path, payload in files.items():
            info = tarfile.TarInfo(f"{snapshot_name}/{rel_path}")
            info.size = len(payload)
            tar.addfile(info, io.BytesIO(payload))
        if symlink is not None:
            info = tarfile.TarInfo(f"{snapshot_name}/{symlink}")
            info.type = tarfile.SYMTYPE
            info.linkname = "/etc/passwd"
            info.size = 0
            tar.addfile(info)
        manifest_payload = json.dumps(manifest).encode("utf-8")
        info = tarfile.TarInfo(f"{snapshot_name}/manifest.json")
        info.size = len(manifest_payload)
        tar.addfile(info, io.BytesIO(manifest_payload))
    return buffer.getvalue()


def test_list_snapshots_uses_azure_container(monkeypatch, tmp_path) -> None:
    blobs = [
        SimpleNamespace(
            name="hriv-backups/hriv-backup-20260102-020000.tar.gz",
            size=1234,
            last_modified=datetime(2026, 1, 2, 2, 0, tzinfo=timezone.utc),
        ),
        SimpleNamespace(
            name="hriv-backups/hriv-backup-20260102-020000.manifest.json",
            size=99,
            last_modified=datetime(2026, 1, 2, 2, 0, tzinfo=timezone.utc),
        ),
    ]
    fake_container = _FakeContainer(blobs, {})
    _configure(monkeypatch, tmp_path, fake_container)

    snapshots = list_snapshots()

    assert snapshots == [
        {
            "name": "hriv-backup-20260102-020000.tar.gz",
            "blob_name": "hriv-backups/hriv-backup-20260102-020000.tar.gz",
            "size": 1234,
            "created_at": "2026-01-02T02:00:00+00:00",
        }
    ]


def test_get_snapshot_manifest_prefers_sidecar(monkeypatch, tmp_path) -> None:
    snapshot_name = "hriv-backup-20260102-020000"
    manifest = _snapshot_manifest(snapshot_name, {"data/source_images/a.jpg": (b"abc", hashlib.sha256(b"abc").hexdigest())})
    fake_container = _FakeContainer(
        [],
        {f"hriv-backups/{snapshot_name}.manifest.json": json.dumps(manifest).encode("utf-8")},
    )
    _configure(monkeypatch, tmp_path, fake_container)

    result = get_snapshot_manifest(snapshot_name)

    assert result == manifest


def test_get_snapshot_manifest_falls_back_to_tar_member(monkeypatch, tmp_path) -> None:
    snapshot_name = "hriv-backup-20260102-020000"
    file_payload = b"abc"
    manifest = _snapshot_manifest(
        snapshot_name,
        {"data/source_images/a.jpg": (file_payload, hashlib.sha256(file_payload).hexdigest())},
    )
    tar_payload = _tar_bytes(snapshot_name, manifest, {"data/source_images/a.jpg": file_payload})
    fake_container = _FakeContainer(
        [],
        {
            f"hriv-backups/{snapshot_name}.tar.gz": tar_payload,
        },
    )
    _configure(monkeypatch, tmp_path, fake_container)

    result = get_snapshot_manifest(snapshot_name)

    assert result == manifest


def test_restore_snapshot_file_happy_path(monkeypatch, tmp_path) -> None:
    snapshot_name = "hriv-backup-20260102-020000"
    file_payload = b"restored payload"
    sha256 = hashlib.sha256(file_payload).hexdigest()
    manifest = _snapshot_manifest(
        snapshot_name,
        {"data/source_images/a.jpg": (file_payload, sha256)},
    )
    tar_payload = _tar_bytes(snapshot_name, manifest, {"data/source_images/a.jpg": file_payload})
    fake_container = _FakeContainer(
        [],
        {
            f"hriv-backups/{snapshot_name}.manifest.json": json.dumps(manifest).encode("utf-8"),
            f"hriv-backups/{snapshot_name}.tar.gz": tar_payload,
        },
    )
    _configure(monkeypatch, tmp_path, fake_container)

    result = restore_snapshot_file(snapshot_name, "data/source_images/a.jpg")

    restored = Path(backup_access.settings.data_dir) / "source_images" / "a.jpg"
    assert restored.read_bytes() == file_payload
    assert result["sha256"] == sha256
    assert result["member_path"] == "data/source_images/a.jpg"


def test_restore_snapshot_file_checksum_mismatch(monkeypatch, tmp_path) -> None:
    snapshot_name = "hriv-backup-20260102-020000"
    file_payload = b"wrong123"
    expected_payload = b"expected"
    manifest = _snapshot_manifest(
        snapshot_name,
        {"data/source_images/a.jpg": (expected_payload, hashlib.sha256(expected_payload).hexdigest())},
    )
    tar_payload = _tar_bytes(snapshot_name, manifest, {"data/source_images/a.jpg": file_payload})
    fake_container = _FakeContainer(
        [],
        {
            f"hriv-backups/{snapshot_name}.manifest.json": json.dumps(manifest).encode("utf-8"),
            f"hriv-backups/{snapshot_name}.tar.gz": tar_payload,
        },
    )
    _configure(monkeypatch, tmp_path, fake_container)

    with pytest.raises(BackupSnapshotMemberError, match="SHA-256 mismatch"):
        restore_snapshot_file(snapshot_name, "data/source_images/a.jpg")

    restored = Path(backup_access.settings.data_dir) / "source_images" / "a.jpg"
    assert not restored.exists()


@pytest.mark.parametrize(
    "requested_path",
    ["db.sql", "/absolute/path", "data/../db.sql", "../db.sql"],
)
def test_restore_snapshot_file_rejects_invalid_paths(monkeypatch, tmp_path, requested_path: str) -> None:
    snapshot_name = "hriv-backup-20260102-020000"
    file_payload = b"abc"
    manifest = _snapshot_manifest(
        snapshot_name,
        {"data/source_images/a.jpg": (file_payload, hashlib.sha256(file_payload).hexdigest())},
    )
    fake_container = _FakeContainer(
        [],
        {f"hriv-backups/{snapshot_name}.manifest.json": json.dumps(manifest).encode("utf-8")},
    )
    _configure(monkeypatch, tmp_path, fake_container)

    with pytest.raises(BackupSnapshotMemberError):
        restore_snapshot_file(snapshot_name, requested_path)


def test_restore_snapshot_file_rejects_symlink_member(monkeypatch, tmp_path) -> None:
    snapshot_name = "hriv-backup-20260102-020000"
    file_payload = b"abc"
    manifest = _snapshot_manifest(
        snapshot_name,
        {"data/source_images/a.jpg": (file_payload, hashlib.sha256(file_payload).hexdigest())},
    )
    tar_payload = _tar_bytes(
        snapshot_name,
        manifest,
        {},
        symlink="data/source_images/a.jpg",
    )
    fake_container = _FakeContainer(
        [],
        {
            f"hriv-backups/{snapshot_name}.manifest.json": json.dumps(manifest).encode("utf-8"),
            f"hriv-backups/{snapshot_name}.tar.gz": tar_payload,
        },
    )
    _configure(monkeypatch, tmp_path, fake_container)

    with pytest.raises(BackupSnapshotMemberError, match="not a regular file"):
        restore_snapshot_file(snapshot_name, "data/source_images/a.jpg")


def test_backup_access_disabled_short_circuits_without_client(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(backup_access.settings, "azure_read_sas_url", "")
    monkeypatch.setattr(backup_access.settings, "azure_backup_prefix", "hriv-backups")
    with patch.object(
        backup_access.ContainerClient,
        "from_container_url",
        side_effect=AssertionError("should not construct a client"),
    ) as mock_from_url:
        with pytest.raises(BackupRestoreNotConfiguredError):
            list_snapshots()
        with pytest.raises(BackupRestoreNotConfiguredError):
            get_snapshot_manifest("hriv-backup-20260102-020000")
        with pytest.raises(BackupRestoreNotConfiguredError):
            restore_snapshot_file("hriv-backup-20260102-020000", "data/source_images/a.jpg")
    mock_from_url.assert_not_called()
