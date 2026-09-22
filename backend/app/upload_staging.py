"""Staged upload writes and ownership-safe file cleanup (#1248).

Upload and image-replacement routes stream request bodies to a
``.staging-`` sibling of the final stored path, then atomically rename it
into place just before committing the ``SourceImage`` row. Staging names
are never persisted, so a request that is cancelled or fails mid-stream
can only leave a staging artifact — swept by
:func:`reconcile_staging_artifacts` — and never a final-path file that
looks like a committed upload.

Failures before the commit attempt are handled by
:func:`cleanup_unowned_final`, which deletes the final-path file only
after proving that no committed ``SourceImage.stored_path`` owns it.
Once ``commit()`` has been attempted the outcome is ambiguous — the
server can still commit after the client sees an error — so callers must
retain the file unconditionally; a wrongly deleted owned file is
unrecoverable while an orphan is merely reconcilable. Aged unowned
final-path files are surfaced (not deleted) by
:func:`list_orphaned_final_files` for operator reconciliation.
"""

import asyncio
import contextlib
import logging
import os
import time

from sqlalchemy import exists, select

from .database import async_session
from .image_validation import UPLOAD_CHUNK_SIZE
from .models import SourceImage

logger = logging.getLogger(__name__)

STAGING_PREFIX = ".staging-"

# A staging artifact older than this can only belong to a dead request:
# an in-flight upload refreshes the file's mtime on every chunk write.
# The bound deliberately exceeds the 7200-second ingress upload timeout
# (charts/frontend/values.yaml proxy-read/send-timeout) so a stalled but
# still-connected request can never outlive the sweep threshold.
STAGING_MAX_AGE_SECONDS = 4 * 3600


def staging_path_for(stored_path: str) -> str:
    """Return the staging sibling for a final stored path."""
    return os.path.join(
        os.path.dirname(stored_path),
        f"{STAGING_PREFIX}{os.path.basename(stored_path)}",
    )


def is_staging_artifact(filename: str) -> bool:
    return filename.startswith(STAGING_PREFIX)


async def write_upload_to_staging(file, staging_path: str) -> int:
    """Stream *file* to *staging_path* in chunks; return bytes written.

    Each write is offloaded via ``asyncio.to_thread``: ``f.write`` is a
    blocking syscall, and on a networked PVC a multi-GB upload can stall
    the event loop long enough to starve concurrent requests (including
    the readiness probe) if run inline.
    """
    with open(staging_path, "wb") as f:
        while True:
            chunk = await file.read(UPLOAD_CHUNK_SIZE)
            if not chunk:
                break
            await asyncio.to_thread(f.write, chunk)
    return os.path.getsize(staging_path)


def discard_staging(staging_path: str) -> None:
    """Remove a staging artifact. Synchronous on purpose: staging names are
    never persisted to the database, so removal is always safe — including
    while the request task is being cancelled."""
    with contextlib.suppress(OSError):
        os.unlink(staging_path)


async def cleanup_unowned_final(stored_path: str) -> None:
    """Best-effort delete of *stored_path* unless a committed row owns it.

    Only safe for failures that happen **before** ``db.commit()`` is
    attempted: with no commit sent, no row can own the path, and the
    ownership query cannot race an in-flight transaction. After a commit
    attempt the outcome is ambiguous (the server may commit after the
    client sees an error) — callers must retain the file instead of
    calling this. Retains the file when a ``SourceImage`` row references
    it or when ownership cannot be determined. Never raises.
    """
    if not os.path.exists(stored_path):
        return
    try:
        async with async_session() as db:
            owned = bool(
                await db.scalar(
                    select(exists().where(SourceImage.stored_path == stored_path))
                )
            )
    except Exception as exc:
        logger.warning(
            "Could not determine source-file ownership; retaining file",
            extra={
                "event": "upload.ownership_check_failed",
                "stored_path": stored_path,
                "error": str(exc),
            },
        )
        return
    if owned:
        return
    with contextlib.suppress(OSError):
        os.unlink(stored_path)
        logger.info(
            "Removed unowned upload file after failed request",
            extra={
                "event": "upload.unowned_file_removed",
                "stored_path": stored_path,
            },
        )


def _stale_staging_files(directory: str, cutoff: float) -> list[str]:
    """Return staging artifacts in *directory* whose mtime precedes *cutoff*."""
    try:
        entries = os.scandir(directory)
    except OSError:
        return []
    stale = []
    for entry in entries:
        try:
            if (
                entry.is_file()
                and is_staging_artifact(entry.name)
                and entry.stat().st_mtime < cutoff
            ):
                stale.append(entry.path)
        except OSError:
            continue
    return stale


async def list_orphaned_final_files(
    directory: str,
    *,
    min_age_seconds: int = STAGING_MAX_AGE_SECONDS,
) -> list[str]:
    """Return final-path files with no owning row, older than *min_age_seconds*.

    Detection only — never deletes. Files in the narrow window between a
    completed upload and its (possibly still in-flight) commit are younger
    than the bound, so an aged unowned final file is a reconcilable orphan
    rather than a race victim. Surfaced via a warning for operators to
    triage like the #1240 reconciliation.
    """
    cutoff = time.time() - min_age_seconds
    try:
        entries = await asyncio.to_thread(lambda: list(os.scandir(directory)))
    except OSError:
        return []
    candidates: list[str] = []
    for entry in entries:
        try:
            # Dot-prefixed names are never stored uploads (real names are
            # uuid4-hex + extension): this skips ``.staging-*`` artifacts
            # and infrastructure files like the rebuild-fixture archive
            # lock, which has no owning row by design.
            if (
                entry.is_file()
                and not entry.name.startswith(".")
                and entry.stat().st_mtime < cutoff
            ):
                candidates.append(entry.path)
        except OSError:
            continue
    if not candidates:
        return []
    async with async_session() as db:
        # One round trip: fetch every owned path under the directory rather
        # than binding candidates into an IN clause, which would exceed
        # asyncpg's argument limit on fixture-scale volumes.
        prefix = directory.rstrip(os.sep) + os.sep
        result = await db.execute(
            select(SourceImage.stored_path).where(
                SourceImage.stored_path.startswith(prefix)
            )
        )
        owned_paths = set(result.scalars().all())
    orphans = [p for p in candidates if p not in owned_paths]
    if orphans:
        logger.warning(
            "Detected %d unowned source-image file(s) older than %ds; "
            "retained for manual reconciliation",
            len(orphans),
            min_age_seconds,
            extra={
                "event": "upload.unowned_final_detected",
                "paths": orphans,
            },
        )
    return orphans


async def reconcile_staging_artifacts(
    directory: str,
    *,
    max_age_seconds: int = STAGING_MAX_AGE_SECONDS,
) -> int:
    """Delete ``.staging-*`` files in *directory* older than the bound.

    Staging names are never referenced by committed rows, so an aged
    artifact always belongs to a dead request and is safe to remove.
    Returns the number of files removed.
    """
    cutoff = time.time() - max_age_seconds
    stale = await asyncio.to_thread(_stale_staging_files, directory, cutoff)
    removed = 0
    for path in stale:
        try:
            await asyncio.to_thread(os.unlink, path)
            removed += 1
        except OSError as exc:
            logger.warning(
                "Failed to remove stale upload staging artifact: %s",
                exc,
                extra={
                    "event": "upload.staging_sweep_failed",
                    "path": path,
                    "error": str(exc),
                },
            )
    if removed:
        logger.info(
            "Removed %d stale upload staging artifact(s)",
            removed,
            extra={"event": "upload.staging_swept", "removed": removed},
        )
    return removed
