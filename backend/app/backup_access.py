"""Read-only access helpers for backup snapshots stored in Azure Blob Storage."""

from __future__ import annotations

import hashlib
import json
import os
import posixpath
import re
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from azure.core.exceptions import ResourceNotFoundError
from azure.storage.blob import ContainerClient

from .database import settings

_CHUNK_SIZE = 1024 * 1024
_SNAPSHOT_NAME_RE = re.compile(r"(?P<stamp>\d{8}-\d{6})")


class BackupRestoreNotConfiguredError(RuntimeError):
    """Raised when backup restore endpoints are disabled by config."""


class BackupSnapshotNotFoundError(FileNotFoundError):
    """Raised when a requested snapshot blob does not exist."""


class BackupSnapshotManifestError(RuntimeError):
    """Raised when a snapshot manifest cannot be read or parsed."""


class BackupSnapshotMemberError(RuntimeError):
    """Raised when a requested archive member cannot be restored safely."""


class BackupSnapshotCancelledError(BackupSnapshotMemberError):
    """Raised when a restore operation is cancelled."""


def _require_configured() -> None:
    if not settings.azure_read_sas_url:
        raise BackupRestoreNotConfiguredError("backup restore is not configured")


def _container_client() -> ContainerClient:
    _require_configured()
    return ContainerClient.from_container_url(settings.azure_read_sas_url)


def _backup_prefix() -> str:
    prefix = settings.azure_backup_prefix.strip().strip("/")
    return f"{prefix}/" if prefix else ""


def _snapshot_stem(snapshot_name: str) -> str:
    name = Path(snapshot_name).name
    if name.endswith(".tar.gz"):
        name = name[: -len(".tar.gz")]
    return name


def _archive_blob_name(snapshot_name: str) -> str:
    return f"{_backup_prefix()}{_snapshot_stem(snapshot_name)}.tar.gz"


def _manifest_blob_name(snapshot_name: str) -> str:
    return f"{_backup_prefix()}{_snapshot_stem(snapshot_name)}.manifest.json"


def _created_at_from_snapshot_name(snapshot_name: str) -> datetime | None:
    match = _SNAPSHOT_NAME_RE.search(_snapshot_stem(snapshot_name))
    if not match:
        return None
    try:
        return datetime.strptime(match.group("stamp"), "%Y%m%d-%H%M%S").replace(
            tzinfo=timezone.utc,
        )
    except ValueError:
        return None


def _download_blob_bytes(blob_name: str) -> bytes:
    container = _container_client()
    downloader = container.download_blob(blob_name)
    return downloader.readall()


def _download_json_blob(blob_name: str) -> dict:
    try:
        return json.loads(_download_blob_bytes(blob_name))
    except BackupRestoreNotConfiguredError:
        raise
    except ResourceNotFoundError:
        raise
    except Exception as exc:  # noqa: BLE001 - map to a clearer domain error
        raise BackupSnapshotManifestError(f"Failed to parse {blob_name}") from exc


class _ChunkedBlobReader:
    """Minimal file-like wrapper over an Azure blob downloader."""

    def __init__(self, downloader) -> None:
        self._chunks = iter(downloader.chunks())
        self._buffer = bytearray()
        self._exhausted = False

    def read(self, size: int = -1) -> bytes:
        if size == 0:
            return b""

        if size < 0:
            chunks = [bytes(self._buffer)]
            self._buffer.clear()
            chunks.extend(self._chunks)
            self._exhausted = True
            return b"".join(chunks)

        while len(self._buffer) < size and not self._exhausted:
            try:
                self._buffer.extend(next(self._chunks))
            except StopIteration:
                self._exhausted = True
                break

        if not self._buffer:
            return b""

        out = bytes(self._buffer[:size])
        del self._buffer[:size]
        return out


def list_snapshots() -> list[dict]:
    """Return all snapshot archives available in Azure Blob Storage."""
    container = _container_client()
    prefix = _backup_prefix()
    snapshots: list[dict] = []

    for blob in container.list_blobs(name_starts_with=prefix):
        if not blob.name.endswith(".tar.gz"):
            continue
        name = blob.name.rsplit("/", 1)[-1]
        created_at = getattr(blob, "last_modified", None) or _created_at_from_snapshot_name(name)
        snapshots.append(
            {
                "name": name,
                "blob_name": blob.name,
                "size": blob.size,
                "created_at": created_at.isoformat() if created_at else None,
            }
        )

    snapshots.sort(key=lambda item: item["name"], reverse=True)
    return snapshots


def get_snapshot_manifest(snapshot_name: str) -> dict:
    """Return the manifest for *snapshot_name*.

    Prefers the separate manifest sidecar blob and falls back to reading
    the snapshot tarball when the sidecar is absent.
    """
    snapshot_stem = _snapshot_stem(snapshot_name)
    sidecar_blob = _manifest_blob_name(snapshot_stem)

    try:
        manifest = _download_json_blob(sidecar_blob)
        if isinstance(manifest, dict):
            return manifest
        raise BackupSnapshotManifestError(f"Manifest sidecar {sidecar_blob} did not contain a JSON object")
    except ResourceNotFoundError:
        pass

    archive_blob = _archive_blob_name(snapshot_stem)
    container = _container_client()
    try:
        downloader = container.download_blob(archive_blob)
    except ResourceNotFoundError as exc:
        raise BackupSnapshotNotFoundError(snapshot_stem) from exc
    reader = _ChunkedBlobReader(downloader)
    member_name = f"{snapshot_stem}/manifest.json"

    try:
        with tarfile.open(fileobj=reader, mode="r|gz") as tar:
            for member in tar:
                if member.name != member_name:
                    continue
                if not member.isfile():
                    raise BackupSnapshotManifestError(f"{member_name} is not a regular file")
                extracted = tar.extractfile(member)
                if extracted is None:
                    raise BackupSnapshotManifestError(f"Failed to read {member_name}")
                try:
                    manifest = json.loads(extracted.read())
                except Exception as exc:  # noqa: BLE001 - surface manifest parse issues cleanly
                    raise BackupSnapshotManifestError(f"Failed to parse {member_name}") from exc
                if not isinstance(manifest, dict):
                    raise BackupSnapshotManifestError(f"{member_name} did not contain a JSON object")
                return manifest
    except ResourceNotFoundError as exc:
        raise BackupSnapshotNotFoundError(snapshot_stem) from exc

    raise BackupSnapshotManifestError(f"Manifest {member_name} was not found in snapshot {snapshot_stem}")


def _normalize_restore_path(member_path: str) -> str:
    candidate = member_path.strip()
    if not candidate:
        raise BackupSnapshotMemberError("Restore path must not be empty")
    if candidate.startswith("/") or "\\" in candidate:
        raise BackupSnapshotMemberError("Restore path must be relative to data/")

    normalized = posixpath.normpath(candidate)
    if normalized in ("", ".", "..") or normalized.startswith("../") or "/../" in normalized:
        raise BackupSnapshotMemberError("Restore path must stay under data/")
    if not normalized.startswith("data/"):
        raise BackupSnapshotMemberError("Only data/ members may be restored")
    return normalized


def _manifest_file_entry(manifest: dict, member_path: str) -> dict:
    files = manifest.get("files")
    if not isinstance(files, dict):
        raise BackupSnapshotManifestError("Manifest is missing the files map")
    entry = files.get(member_path)
    if not isinstance(entry, dict):
        raise BackupSnapshotMemberError(f"{member_path} is not listed in the snapshot manifest")
    return entry


def restore_snapshot_file(
    snapshot_name: str,
    member_path: str,
    *,
    cancel_event=None,
    on_progress: Callable[[str], None] | None = None,
) -> dict:
    """Restore a single file from a snapshot into the shared data volume."""
    snapshot_stem = _snapshot_stem(snapshot_name)
    manifest = get_snapshot_manifest(snapshot_stem)
    member_path = _normalize_restore_path(member_path)
    entry = _manifest_file_entry(manifest, member_path)

    expected_sha256 = entry.get("sha256")
    expected_size = entry.get("size")
    if not isinstance(expected_sha256, str) or not expected_sha256:
        raise BackupSnapshotManifestError(f"Manifest entry for {member_path} is missing sha256")
    if not isinstance(expected_size, int):
        raise BackupSnapshotManifestError(f"Manifest entry for {member_path} is missing size")

    archive_blob = _archive_blob_name(snapshot_stem)
    container = _container_client()
    try:
        downloader = container.download_blob(archive_blob)
    except ResourceNotFoundError as exc:
        raise BackupSnapshotNotFoundError(snapshot_stem) from exc
    reader = _ChunkedBlobReader(downloader)
    archive_member = f"{snapshot_stem}/{member_path}"
    target_path = Path(settings.data_dir) / Path(member_path).relative_to("data")
    target_path.parent.mkdir(parents=True, exist_ok=True)

    def _check_cancel() -> None:
        if cancel_event is not None and cancel_event.is_set():
            raise BackupSnapshotCancelledError("Task cancelled by admin")

    if on_progress is not None:
        on_progress("stream")

    with tempfile.NamedTemporaryFile(
        mode="wb",
        prefix=f".{target_path.name}.",
        suffix=".restore",
        dir=str(target_path.parent),
        delete=False,
    ) as tmp:
        tmp_path = Path(tmp.name)
        hasher = hashlib.sha256()
        written = 0
        try:
            with tarfile.open(fileobj=reader, mode="r|gz") as tar:
                for member in tar:
                    _check_cancel()
                    if member.name != archive_member:
                        continue
                    if not member.isfile() or member.islnk() or member.issym():
                        raise BackupSnapshotMemberError(f"{member_path} is not a regular file")
                    extracted = tar.extractfile(member)
                    if extracted is None:
                        raise BackupSnapshotMemberError(f"Failed to read {member_path}")
                    while True:
                        _check_cancel()
                        chunk = extracted.read(_CHUNK_SIZE)
                        if not chunk:
                            break
                        tmp.write(chunk)
                        hasher.update(chunk)
                        written += len(chunk)
                    break
                else:
                    raise BackupSnapshotMemberError(f"{member_path} was not found in snapshot {snapshot_stem}")
        except Exception:
            try:
                tmp_path.unlink()
            except OSError:
                # Best-effort cleanup: do not mask the original restore error.
                pass
            raise

    if written != expected_size:
        try:
            tmp_path.unlink()
        except OSError:
            # Best-effort cleanup: keep the size-mismatch error as the primary failure.
            pass
        raise BackupSnapshotMemberError(
            f"Restored size mismatch for {member_path}: expected {expected_size}, got {written}"
        )

    digest = hasher.hexdigest()
    if digest != expected_sha256:
        try:
            tmp_path.unlink()
        except OSError:
            # Best-effort cleanup: keep the checksum error as the primary failure.
            pass
        raise BackupSnapshotMemberError(
            f"SHA-256 mismatch for {member_path}: expected {expected_sha256}, got {digest}"
        )

    os.replace(str(tmp_path), str(target_path))
    return {
        "snapshot_name": snapshot_stem,
        "member_path": member_path,
        "destination": str(target_path),
        "size": written,
        "sha256": digest,
    }
