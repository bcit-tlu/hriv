"""Background execution logic for admin import/export tasks.

Each ``run_*`` coroutine is designed to be called from an arq worker task
or from a FastAPI ``BackgroundTasks`` fallback.  They manage their own
database sessions and update the :class:`~app.models.AdminTask` record
with progress, log output, and results.
"""

import asyncio
import json
import logging
import os
import queue
import shutil
import tarfile
import tempfile
import threading
from collections.abc import Callable, Iterator
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_async_session, settings
from .models import (
    AdminTask,
    Announcement,
    Category,
    Image,
    Program,
    SourceImage,
    User,
)

logger = logging.getLogger(__name__)

_CHUNK_SIZE = 1024 * 1024  # 1 MiB

# Directory where background task outputs are stored.
_TASKS_DIR = os.environ.get(
    "ADMIN_TASKS_DIR",
    os.path.join(str(Path(settings.tiles_dir).parent), "admin_tasks"),
)


def _ensure_tasks_dir() -> str:
    os.makedirs(_TASKS_DIR, exist_ok=True)
    return _TASKS_DIR


# Threshold (seconds) after which an in-flight admin task with no
# ``updated_at`` progress is considered abandoned and eligible for the
# startup reconciler to mark as ``failed``.  Every task runner writes to
# ``updated_at`` at least every few seconds via ``_update_task`` (see the
# verbose archive poller in ``run_files_export`` for example), so 15 min
# is generously large.  Configurable via env for clusters with unusually
# long individual checkpoints.
_STALE_TASK_THRESHOLD_SECONDS = int(
    os.environ.get("ADMIN_TASK_STALE_SECONDS", "900")
)


# ── Helpers ────────────────────────────────────────────────


class TaskCancelled(Exception):
    """Raised when an admin task detects a cancellation request."""


async def reconcile_stale_tasks(
    session: AsyncSession,
    stale_after_seconds: int = _STALE_TASK_THRESHOLD_SECONDS,
) -> int:
    """Mark orphaned in-flight admin tasks as ``failed``.

    A task is considered stale when its status is still ``pending``,
    ``running`` or ``cancelling`` but its ``updated_at`` timestamp is
    older than *stale_after_seconds*.  This runs on backend startup so
    tasks whose runner process died (pod crash, OOM kill, rollout) are
    cleared up instead of blocking the ``_create_task`` concurrency
    guard indefinitely.

    The threshold guards against multi-replica deployments: a freshly
    starting pod will not clobber a task actively running on a sibling
    pod because that sibling pod is writing progress to ``updated_at``.

    Returns the number of rows updated.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=stale_after_seconds)
    stmt = (
        update(AdminTask)
        .where(
            AdminTask.status.in_(["pending", "running", "cancelling"]),
            AdminTask.updated_at < cutoff,
        )
        .values(
            status="failed",
            error_message=(
                "Task marked as failed on backend startup — no progress "
                f"update for more than {stale_after_seconds}s; the runner "
                "likely crashed before it could finalise the task."
            ),
            # Core-level ``update()`` skips SQLAlchemy's ``onupdate``
            # hooks on ``updated_at``; set it explicitly so the row
            # reflects the reconciliation time rather than the moment
            # the original runner last wrote progress.
            updated_at=func.now(),
        )
        .returning(AdminTask.id)
    )
    result = await session.execute(stmt)
    ids = [row[0] for row in result.all()]
    await session.commit()
    if ids:
        logger.warning(
            "Reconciled %d stale admin task(s) to 'failed' on startup",
            len(ids),
            extra={
                "event": "admin_task.reconciled_stale",
                "task_ids": ids,
                "stale_after_seconds": stale_after_seconds,
            },
        )
    return len(ids)


async def _update_task(
    session: AsyncSession,
    task: AdminTask,
    *,
    status: str | None = None,
    progress: int | None = None,
    log_line: str | None = None,
    result_filename: str | None = None,
    result_path: str | None = None,
    error_message: str | None = None,
    check_cancelled: bool = False,
) -> None:
    """Persist incremental updates to an AdminTask record.

    When *check_cancelled* is ``True`` the helper re-reads the task from
    the database before applying changes.  If the status has been set to
    ``cancelling`` (by the cancel endpoint) a :class:`TaskCancelled`
    exception is raised so the caller can abort cleanly.
    """
    if check_cancelled:
        await session.refresh(task, attribute_names=["status"])
        if task.status in ("cancelling", "cancelled"):
            raise TaskCancelled("Task cancelled by admin")

    if status is not None:
        task.status = status
    if progress is not None:
        task.progress = progress
    if log_line is not None:
        task.log = (task.log or "") + log_line + "\n"
    if result_filename is not None:
        task.result_filename = result_filename
    if result_path is not None:
        task.result_path = result_path
    if error_message is not None:
        task.error_message = error_message
    await session.commit()


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value)


# ── Database Export ────────────────────────────────────────


async def run_db_export(task_id: int) -> None:
    """Export all database tables to a JSON file in the background."""
    async with get_async_session()() as session:
        task = await session.get(AdminTask, task_id)
        if task is None:
            logger.error("AdminTask %d not found", task_id)
            return

        filepath: str | None = None
        try:
            await _update_task(
                session, task,
                status="running", progress=0,
                log_line="Starting database export…",
                check_cancelled=True,
            )

            # Programs
            await _update_task(session, task, log_line="Exporting programs…", progress=10, check_cancelled=True)
            result = await session.execute(select(Program).order_by(Program.id))
            programs = result.scalars().all()

            # Categories
            await _update_task(session, task, log_line="Exporting categories…", progress=20, check_cancelled=True)
            result = await session.execute(select(Category).order_by(Category.id))
            categories = result.scalars().all()

            # Images
            await _update_task(session, task, log_line="Exporting images…", progress=40, check_cancelled=True)
            result = await session.execute(select(Image).order_by(Image.id))
            images = result.scalars().all()

            # Users
            await _update_task(session, task, log_line="Exporting users…", progress=55, check_cancelled=True)
            result = await session.execute(select(User).order_by(User.id))
            users = result.scalars().all()

            # Source images
            await _update_task(session, task, log_line="Exporting source images…", progress=65, check_cancelled=True)
            result = await session.execute(select(SourceImage).order_by(SourceImage.id))
            source_images = result.scalars().all()

            # Announcement
            await _update_task(session, task, log_line="Exporting announcement…", progress=75, check_cancelled=True)
            result = await session.execute(
                select(Announcement).where(Announcement.id == 1)
            )
            ann = result.scalar_one_or_none()

            def dt(v: datetime | None) -> str | None:
                return v.isoformat() if v else None

            dump = {
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "programs": [
                    {
                        "id": p.id,
                        "name": p.name,
                        "created_at": dt(p.created_at),
                        "updated_at": dt(p.updated_at),
                    }
                    for p in programs
                ],
                "categories": [
                    {
                        "id": c.id,
                        "label": c.label,
                        "parent_id": c.parent_id,
                        "program": c.program,
                        "status": c.status,
                        "sort_order": c.sort_order,
                        "metadata": c.metadata_,
                        "created_at": dt(c.created_at),
                        "updated_at": dt(c.updated_at),
                    }
                    for c in categories
                ],
                "images": [
                    {
                        "id": i.id,
                        "name": i.name,
                        "thumb": i.thumb,
                        "tile_sources": i.tile_sources,
                        "category_id": i.category_id,
                        "copyright": i.copyright,
                        "note": i.note,
                        "program_ids": [p.id for p in i.programs],
                        "active": i.active,
                        "metadata": i.metadata_,
                        "created_at": dt(i.created_at),
                        "updated_at": dt(i.updated_at),
                    }
                    for i in images
                ],
                "users": [
                    {
                        "id": u.id,
                        "name": u.name,
                        "email": u.email,
                        "password_hash": u.password_hash,
                        "oidc_subject": u.oidc_subject,
                        "role": u.role,
                        "program_id": u.program_id,
                        "last_access": dt(u.last_access),
                        "metadata": u.metadata_,
                        "created_at": dt(u.created_at),
                        "updated_at": dt(u.updated_at),
                    }
                    for u in users
                ],
                "source_images": [
                    {
                        "id": s.id,
                        "original_filename": s.original_filename,
                        "stored_path": s.stored_path,
                        "status": s.status,
                        "progress": s.progress,
                        "error_message": s.error_message,
                        "name": s.name,
                        "category_id": s.category_id,
                        "copyright": s.copyright,
                        "note": s.note,
                        "active": s.active,
                        "program": s.program,
                        "image_id": s.image_id,
                        "file_size": s.file_size,
                        "created_at": dt(s.created_at),
                        "updated_at": dt(s.updated_at),
                    }
                    for s in source_images
                ],
                "announcement": {
                    "message": ann.message if ann else "",
                    "enabled": ann.enabled if ann else False,
                    "created_at": dt(ann.created_at) if ann else None,
                    "updated_at": dt(ann.updated_at) if ann else None,
                },
            }

            # Write JSON to file
            await _update_task(session, task, log_line="Writing JSON file…", progress=85, check_cancelled=True)
            tasks_dir = _ensure_tasks_dir()
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            filename = f"hriv-export-{timestamp}.json"
            filepath = os.path.join(tasks_dir, filename)
            content = json.dumps(dump, indent=2)
            await asyncio.to_thread(_write_file, filepath, content)

            summary = (
                f"Exported {len(dump['programs'])} programs, "
                f"{len(dump['categories'])} categories, "
                f"{len(dump['images'])} images, "
                f"{len(dump['users'])} users, "
                f"{len(dump['source_images'])} source images."
            )
            await _update_task(
                session, task,
                status="completed", progress=100,
                log_line=f"Export complete. {summary}",
                result_filename=filename,
                result_path=filepath,
                check_cancelled=True,
            )
            logger.info(
                "Background DB export completed",
                extra={"event": "admin_task.db_export_done", "task_id": task_id},
            )

        except TaskCancelled:
            logger.info(
                "Background DB export cancelled",
                extra={"event": "admin_task.db_export_cancelled", "task_id": task_id},
            )
            # Clean up result file if it was already written
            if filepath and os.path.exists(filepath):
                try:
                    os.unlink(filepath)
                except OSError:
                    pass
            await session.refresh(task)
            await _update_task(
                session, task,
                status="cancelled",
                log_line="Task cancelled.",
            )

        except Exception as exc:
            logger.exception(
                "Background DB export failed",
                extra={"event": "admin_task.db_export_failed", "task_id": task_id},
            )
            await session.rollback()
            await session.refresh(task)
            await _update_task(
                session, task,
                status="failed", progress=0,
                log_line=f"ERROR: {exc}",
                error_message=str(exc),
            )


def _write_file(path: str, content: str) -> None:
    with open(path, "w") as f:
        f.write(content)


# ── Database Import ────────────────────────────────────────


async def run_db_import(task_id: int) -> None:
    """Import a previously exported JSON dump in the background.

    Uses two separate database sessions:
    - ``status_session``: for AdminTask progress updates (committed freely)
    - ``data_session``: for the actual import data (committed only once at the end)
    This ensures the import is atomic — a mid-import failure rolls back all data
    changes without losing task status visibility.
    """
    session_factory = get_async_session()

    # Status session — used only for AdminTask updates, committed freely
    async with session_factory() as status_session:
        task = await status_session.get(AdminTask, task_id)
        if task is None:
            logger.error("AdminTask %d not found", task_id)
            return

        input_path = task.input_path

        # Data session — used for all import DML, committed once at the end
        async with session_factory() as data_session:
            try:
                await _update_task(
                    status_session, task,
                    status="running", progress=0,
                    log_line="Starting database import…",
                    check_cancelled=True,
                )

                # Read and validate JSON
                await _update_task(status_session, task, log_line="Reading JSON file…", progress=5, check_cancelled=True)
                raw = await asyncio.to_thread(_read_file, input_path)
                dump = json.loads(raw)

                if not isinstance(dump, dict):
                    raise ValueError("Expected a JSON object")
                for key in ("categories", "images", "users"):
                    if key not in dump:
                        raise ValueError(f"Missing required key: {key}")

                # Clear existing data in dependency order
                await _update_task(status_session, task, log_line="Clearing existing data…", progress=10)

                # Detach this task's created_by FK *via status_session*
                # before deleting users.  DELETE FROM users cascades
                # ON DELETE SET NULL to admin_tasks.created_by, which would
                # lock THIS task's row inside data_session.  Because both
                # sessions run in the same coroutine, status_session could
                # never acquire the same row lock to commit progress
                # updates — a self-deadlock.  By NULLing only the current
                # task's created_by through status_session (which commits
                # immediately), the FK reference is gone before
                # data_session touches users.  Other tasks' created_by
                # values are left intact — they will be SET NULL by the
                # CASCADE inside data_session (and restored on rollback).
                await status_session.execute(
                    text("UPDATE admin_tasks SET created_by = NULL WHERE id = :tid"),
                    {"tid": task_id},
                )
                await status_session.commit()

                await data_session.execute(text("DELETE FROM source_images"))
                await data_session.execute(text("DELETE FROM image_programs"))
                await data_session.execute(text("DELETE FROM images"))
                await data_session.execute(text("DELETE FROM categories"))
                await data_session.execute(text("DELETE FROM users"))
                await data_session.execute(text("DELETE FROM announcements"))
                await data_session.execute(text("DELETE FROM programs"))

                # Import programs
                await _update_task(status_session, task, log_line="Importing programs…", progress=15, check_cancelled=True)
                for p in dump.get("programs", []):
                    program = Program(
                        id=p["id"],
                        name=p["name"],
                        created_at=_parse_dt(p.get("created_at")),
                        updated_at=_parse_dt(p.get("updated_at")),
                    )
                    data_session.add(program)
                await data_session.flush()

                # Import users
                await _update_task(status_session, task, log_line="Importing users…", progress=25)
                for u in dump["users"]:
                    user = User(
                        id=u["id"],
                        name=u["name"],
                        email=u["email"],
                        password_hash=u.get("password_hash"),
                        oidc_subject=u.get("oidc_subject"),
                        role=u.get("role", "student"),
                        program_id=u.get("program_id"),
                        last_access=_parse_dt(u.get("last_access")),
                        metadata_=u.get("metadata", {}),
                        created_at=_parse_dt(u.get("created_at")),
                        updated_at=_parse_dt(u.get("updated_at")),
                    )
                    data_session.add(user)

                # Import categories (topologically sorted)
                await _update_task(status_session, task, log_line="Importing categories…", progress=35)
                inserted_ids: set[int] = set()
                remaining = list(dump["categories"])
                while remaining:
                    progress_made = False
                    next_remaining = []
                    for c in remaining:
                        pid = c.get("parent_id")
                        if pid is None or pid in inserted_ids:
                            cat = Category(
                                id=c["id"],
                                label=c["label"],
                                parent_id=pid,
                                program=c.get("program"),
                                status=c.get("status", "active"),
                                sort_order=c.get("sort_order", 0),
                                metadata_=c.get("metadata", {}),
                                created_at=_parse_dt(c.get("created_at")),
                                updated_at=_parse_dt(c.get("updated_at")),
                            )
                            data_session.add(cat)
                            inserted_ids.add(c["id"])
                            progress_made = True
                        else:
                            next_remaining.append(c)
                    if not progress_made:
                        raise ValueError("Circular or broken parent_id references in categories")
                    remaining = next_remaining
                    await data_session.flush()

                await data_session.flush()

                # Import images
                await _update_task(status_session, task, log_line="Importing images…", progress=50, check_cancelled=True)
                for i in dump["images"]:
                    img = Image(
                        id=i["id"],
                        name=i.get("name") or i.get("label", ""),
                        thumb=i["thumb"],
                        tile_sources=i["tile_sources"],
                        category_id=i.get("category_id"),
                        copyright=i.get("copyright"),
                        note=i.get("note") or i.get("origin"),
                        active=i.get("active", True),
                        metadata_=i.get("metadata", {}),
                        created_at=_parse_dt(i.get("created_at")),
                        updated_at=_parse_dt(i.get("updated_at")),
                    )
                    prog_ids = i.get("program_ids", [])
                    if prog_ids:
                        progs = (await data_session.execute(
                            select(Program).where(Program.id.in_(prog_ids))
                        )).scalars().all()
                        img.programs = list(progs)
                    data_session.add(img)
                await data_session.flush()

                # Import source images
                await _update_task(status_session, task, log_line="Importing source images…", progress=65)
                for s in dump.get("source_images", []):
                    src = SourceImage(
                        id=s["id"],
                        original_filename=s["original_filename"],
                        stored_path=s["stored_path"],
                        status=s.get("status", "pending"),
                        progress=s.get("progress", 0),
                        error_message=s.get("error_message"),
                        name=s.get("name"),
                        category_id=s.get("category_id"),
                        copyright=s.get("copyright"),
                        note=s.get("note"),
                        active=s.get("active", True),
                        program=s.get("program"),
                        image_id=s.get("image_id"),
                        file_size=s.get("file_size"),
                        created_at=_parse_dt(s.get("created_at")),
                        updated_at=_parse_dt(s.get("updated_at")),
                    )
                    data_session.add(src)
                await data_session.flush()

                # Import announcement
                await _update_task(status_session, task, log_line="Importing announcement…", progress=75, check_cancelled=True)
                ann_data = dump.get("announcement")
                if ann_data:
                    ann = Announcement(
                        id=1,
                        message=ann_data.get("message", ""),
                        enabled=ann_data.get("enabled", False),
                        created_at=_parse_dt(ann_data.get("created_at")),
                        updated_at=_parse_dt(ann_data.get("updated_at")),
                    )
                    data_session.add(ann)
                else:
                    data_session.add(Announcement(id=1, message="", enabled=False))
                await data_session.flush()

                # Reset sequences
                await _update_task(status_session, task, log_line="Resetting sequences…", progress=85)
                for tbl in ("programs", "categories", "images", "users", "announcements", "source_images"):
                    await data_session.execute(
                        text(
                            f"SELECT setval('{tbl}_id_seq', "
                            f"GREATEST(COALESCE((SELECT MAX(id) FROM {tbl}), 1), 1), "
                            f"EXISTS(SELECT 1 FROM {tbl}))"
                        )
                    )

                # Single atomic commit for all data changes
                await data_session.commit()

                summary = (
                    f"Imported {len(dump.get('programs', []))} programs, "
                    f"{len(dump['categories'])} categories, "
                    f"{len(dump['images'])} images, "
                    f"{len(dump['users'])} users, "
                    f"{len(dump.get('source_images', []))} source images."
                )
                # Do NOT check_cancelled here — data_session.commit() already
                # succeeded so the import data is permanently persisted.
                # Marking the task "cancelled" at this point would be
                # misleading ("All changes rolled back" when they weren't).
                await _update_task(
                    status_session, task,
                    status="completed", progress=100,
                    log_line=f"Import complete. {summary}",
                )
                logger.info(
                    "Background DB import completed",
                    extra={"event": "admin_task.db_import_done", "task_id": task_id},
                )

            except TaskCancelled:
                await data_session.rollback()
                logger.info(
                    "Background DB import cancelled",
                    extra={"event": "admin_task.db_import_cancelled", "task_id": task_id},
                )
                await status_session.refresh(task)
                await _update_task(
                    status_session, task,
                    status="cancelled",
                    log_line="Task cancelled. Data changes rolled back.",
                )

            except Exception as exc:
                await data_session.rollback()
                logger.exception(
                    "Background DB import failed",
                    extra={"event": "admin_task.db_import_failed", "task_id": task_id},
                )
                # Refresh task from status_session (not affected by data rollback)
                await status_session.refresh(task)
                await _update_task(
                    status_session, task,
                    status="failed", progress=0,
                    log_line=f"ERROR: {exc}",
                    error_message=str(exc),
                )
            finally:
                # Clean up the uploaded input file
                if input_path:
                    try:
                        os.unlink(input_path)
                    except OSError:
                        pass


def _read_file(path: str | None) -> str:
    if not path:
        raise ValueError("No input file path specified")
    with open(path, "r") as f:
        return f.read()


# ── Filesystem Export ──────────────────────────────────────


def _iter_export_files(data_dir: str) -> Iterator[tuple[str, int]]:
    """Yield ``(absolute_path, size_bytes)`` for every file that would
    be included in a filesystem export of *data_dir*.

    Mirrors the traversal logic in :func:`_create_tar_file` so callers
    can pre-compute the total payload size for accurate progress
    reporting without actually opening the tar archive.
    """
    tasks_basename = os.path.basename(_TASKS_DIR)
    for dirpath, dirnames, filenames in os.walk(data_dir):
        rel = os.path.relpath(dirpath, data_dir)
        top = rel.split(os.sep)[0]
        if top == tasks_basename:
            dirnames.clear()
            continue
        if tasks_basename in dirnames:
            dirnames.remove(tasks_basename)
        for fname in filenames:
            fpath = os.path.join(dirpath, fname)
            try:
                size = os.path.getsize(fpath)
            except OSError:
                # Symlink to missing target, race with deletion, etc.
                # Skip silently — the archive will either include a
                # zero-byte entry or skip it on its own.
                continue
            yield fpath, size


def _create_tar_file(
    data_dir: str,
    dest: str,
    *,
    cancel_event: threading.Event | None = None,
    on_entry: Callable[[str, int], None] | None = None,
) -> None:
    """Write a tar.gz archive of *data_dir* to *dest*.

    The ``admin_tasks`` subdirectory is excluded so that previously
    generated export artefacts (JSON dumps, tar.gz archives) do not
    bloat successive filesystem exports.

    If *cancel_event* is set while walking the tree, :class:`TaskCancelled`
    is raised so the caller can abort promptly.  *on_entry* is called
    as ``on_entry(arcname, size_bytes)`` for every entry added, giving
    callers both a streaming activity feed and byte counts suitable for
    progress estimation.  ``size_bytes`` is ``0`` for directory entries.
    """
    tasks_basename = os.path.basename(_TASKS_DIR)

    def _check_cancel() -> None:
        if cancel_event is not None and cancel_event.is_set():
            raise TaskCancelled("Task cancelled by admin")

    with tarfile.open(dest, mode="w:gz") as tar:
        for dirpath, dirnames, filenames in os.walk(data_dir):
            _check_cancel()

            rel = os.path.relpath(dirpath, data_dir)
            top = rel.split(os.sep)[0]
            if top == tasks_basename:
                dirnames.clear()
                continue

            # Prune admin_tasks from child list so os.walk skips it
            if tasks_basename in dirnames:
                dirnames.remove(tasks_basename)

            arcname = os.path.join("data", rel) if rel != "." else "data"
            tar.add(dirpath, arcname=arcname, recursive=False)
            if on_entry is not None:
                on_entry(arcname + "/", 0)

            for fname in filenames:
                _check_cancel()
                fpath = os.path.join(dirpath, fname)
                arc_fpath = os.path.join(arcname, fname)
                try:
                    size = os.path.getsize(fpath)
                except OSError:
                    size = 0
                tar.add(fpath, arcname=arc_fpath)
                if on_entry is not None:
                    on_entry(arc_fpath, size)


_LOG_FLUSH_INTERVAL = 2  # seconds between verbose-log DB flushes


async def run_files_export(task_id: int) -> None:
    """Create a tar.gz archive of the data directory in the background."""
    async with get_async_session()() as session:
        task = await session.get(AdminTask, task_id)
        if task is None:
            logger.error("AdminTask %d not found", task_id)
            return

        filepath: str | None = None
        tmp_name: str | None = None
        try:
            await _update_task(
                session, task,
                status="running", progress=0,
                log_line="Starting filesystem export…",
                check_cancelled=True,
            )

            data_dir = Path(settings.tiles_dir).parent  # /data

            if not data_dir.exists() or not any(data_dir.iterdir()):
                raise ValueError("Data directory is empty or missing — nothing to export")

            await _update_task(
                session, task, progress=10,
                log_line=f"Archiving data directory: {data_dir}",
                check_cancelled=True,
            )

            tasks_dir = _ensure_tasks_dir()
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            filename = f"hriv-files-{timestamp}.tar.gz"
            filepath = os.path.join(tasks_dir, filename)

            # Write to /tmp first so the archive doesn't include itself
            # (_TASKS_DIR lives inside the data directory being archived).
            tmp = tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False)
            tmp.close()
            tmp_name = tmp.name

            # Pre-walk to sum total bytes so we can report accurate
            # progress during archiving (the slow phase — without this
            # the bar sits at 20% for the duration).  Runs in a thread
            # because walking millions of files is CPU/IO-bound.
            await _update_task(
                session, task, progress=15,
                log_line="Calculating total export size…",
                check_cancelled=True,
            )
            total_bytes = await asyncio.to_thread(
                lambda: sum(sz for _p, sz in _iter_export_files(str(data_dir)))
            )
            total_mb = total_bytes / (1024 * 1024)
            await _update_task(
                session, task, progress=20,
                log_line=(
                    f"Total to archive: {total_mb:.1f} MB. "
                    "Creating tar.gz archive…"
                ),
                check_cancelled=True,
            )

            # -- verbose archive with cancellation support --
            cancel_event = threading.Event()
            entry_queue: queue.Queue[tuple[str, int]] = queue.Queue()
            bytes_added = 0

            def _on_entry(arcname: str, size_bytes: int) -> None:
                entry_queue.put((arcname, size_bytes))

            # Progress is mapped across 20% → 95% during archiving;
            # the final 5% is reserved for the post-archive finalise
            # step (move to tasks_dir + commit).  If ``total_bytes`` is
            # zero (empty export) we hold progress at 20 to avoid a
            # divide-by-zero and let the completion step jump to 100.
            _ARCHIVE_PROGRESS_START = 20
            _ARCHIVE_PROGRESS_END = 95

            async def _flush_and_poll() -> None:
                """Flush queued entry names / progress and check for cancellation."""
                nonlocal bytes_added
                while True:
                    await asyncio.sleep(_LOG_FLUSH_INTERVAL)
                    entries: list[tuple[str, int]] = []
                    while not entry_queue.empty():
                        try:
                            entries.append(entry_queue.get_nowait())
                        except queue.Empty:
                            break
                    progress_update: int | None = None
                    if entries:
                        bytes_added += sum(sz for _name, sz in entries)
                        if total_bytes > 0:
                            span = _ARCHIVE_PROGRESS_END - _ARCHIVE_PROGRESS_START
                            progress_update = min(
                                _ARCHIVE_PROGRESS_END,
                                _ARCHIVE_PROGRESS_START + int(
                                    span * bytes_added / total_bytes
                                ),
                            )
                        batch = "\n".join(f"  adding {name}" for name, _ in entries)
                        await _update_task(
                            session, task,
                            log_line=batch,
                            progress=progress_update,
                        )
                    # Check DB for cancellation request.  Both
                    # ``cancelling`` (normal path) and ``cancelled``
                    # (force-cancel when a previous cancel got stuck)
                    # must trip the tar thread's cancel_event; otherwise
                    # the archive continues to completion and this poll
                    # loop spins forever waiting for it.
                    await session.refresh(task, attribute_names=["status"])
                    if task.status in ("cancelling", "cancelled"):
                        cancel_event.set()
                        return

            tar_task = asyncio.ensure_future(
                asyncio.to_thread(
                    _create_tar_file, str(data_dir), tmp_name,
                    cancel_event=cancel_event, on_entry=_on_entry,
                )
            )
            poll_task = asyncio.ensure_future(_flush_and_poll())

            try:
                done, _pending = await asyncio.wait(
                    [tar_task, poll_task], return_when=asyncio.FIRST_COMPLETED,
                )
                # If tar finished first, cancel the poll loop
                if tar_task in done:
                    poll_task.cancel()
                    tar_task.result()  # propagate exceptions
                else:
                    # Poll exited first — distinguish DB error from
                    # genuine cancellation detection.
                    poll_exc = poll_task.exception() if poll_task.done() else None
                    if poll_exc is not None:
                        cancel_event.set()  # stop the tar thread
                        try:
                            await asyncio.wait_for(tar_task, timeout=5)
                        except asyncio.TimeoutError:
                            pass
                        if not tar_task.done():
                            tar_task.cancel()
                        raise poll_exc
                    # Poll returned normally → cancellation detected.
                    # Wait briefly for tar thread to notice the event.
                    try:
                        await asyncio.wait_for(tar_task, timeout=5)
                    except asyncio.TimeoutError:
                        pass
                    if tar_task.done():
                        tar_task.result()
                    else:
                        tar_task.cancel()
                    raise TaskCancelled("Task cancelled by admin")
            finally:
                # Flush any remaining queued entries
                remaining: list[tuple[str, int]] = []
                while not entry_queue.empty():
                    try:
                        remaining.append(entry_queue.get_nowait())
                    except queue.Empty:
                        break
                if remaining:
                    batch = "\n".join(
                        f"  adding {name}" for name, _size in remaining
                    )
                    await _update_task(session, task, log_line=batch)

            try:
                shutil.move(tmp_name, filepath)
                tmp_name = None  # moved successfully; no temp to clean up
            except Exception:
                # Clean up temp file on failure before re-raising
                try:
                    os.unlink(tmp_name)
                except OSError:
                    pass
                tmp_name = None
                raise

            file_size = os.path.getsize(filepath)
            size_mb = file_size / (1024 * 1024)

            await _update_task(
                session, task,
                status="completed", progress=100,
                log_line=f"Export complete. Archive size: {size_mb:.1f} MB",
                result_filename=filename,
                result_path=filepath,
                check_cancelled=True,
            )
            logger.info(
                "Background files export completed",
                extra={
                    "event": "admin_task.files_export_done",
                    "task_id": task_id,
                    "size_bytes": file_size,
                },
            )

        except TaskCancelled:
            logger.info(
                "Background files export cancelled",
                extra={"event": "admin_task.files_export_cancelled", "task_id": task_id},
            )
            # Clean up temp file and/or result file
            for path in (tmp_name, filepath):
                if path:
                    try:
                        os.unlink(path)
                    except OSError:
                        pass
            await session.refresh(task)
            await _update_task(
                session, task,
                status="cancelled",
                log_line="Task cancelled.",
            )

        except Exception as exc:
            logger.exception(
                "Background files export failed",
                extra={"event": "admin_task.files_export_failed", "task_id": task_id},
            )
            # Clean up temp file if it wasn't already handled
            if tmp_name:
                try:
                    os.unlink(tmp_name)
                except OSError:
                    pass
            await session.rollback()
            await session.refresh(task)
            await _update_task(
                session, task,
                status="failed", progress=0,
                log_line=f"ERROR: {exc}",
                error_message=str(exc),
            )


# ── Filesystem Import ──────────────────────────────────────


def _extract_and_restore(
    tmp_archive: str,
    tmpdir: str,
    data_dir: str,
    tiles_dir: str,
    source_images_dir: str,
) -> dict[str, int]:
    """Extract archive, swap data dir atomically, count restored files."""
    with tarfile.open(tmp_archive, "r:gz") as tar:
        members = tar.getnames()
        if not members:
            raise ValueError("Archive is empty")
        staging = Path(tmpdir) / "staging"
        staging.mkdir()
        tar.extractall(path=str(staging), filter="data")

    extracted = staging / "data"
    if not extracted.exists():
        entries = list(staging.iterdir())
        extracted = entries[0] if len(entries) == 1 and entries[0].is_dir() else staging

    data_path = Path(data_dir)
    backup_path = data_path.with_name(
        data_path.name + f".bak-{int(datetime.now(timezone.utc).timestamp())}"
    )

    # Preserve admin_tasks directory — it contains result files from prior
    # export tasks and the input file for this very import.  The archive
    # won't contain it (exports exclude admin_tasks/), so the swap would
    # otherwise destroy it.
    tasks_basename = os.path.basename(_TASKS_DIR)
    tasks_src = data_path / tasks_basename
    tasks_shelter = Path(tmpdir) / tasks_basename

    try:
        if tasks_src.exists():
            os.rename(str(tasks_src), str(tasks_shelter))

        if data_path.exists():
            os.rename(str(data_path), str(backup_path))
        os.makedirs(str(data_path), exist_ok=True)
        shutil.copytree(str(extracted), str(data_path), dirs_exist_ok=True)
        # Restore the preserved admin_tasks directory.  The restored archive
        # should not contain admin_tasks (exports exclude it), but handle
        # the edge case where it does by merging.
        restored_tasks = data_path / tasks_basename
        if tasks_shelter.exists():
            if restored_tasks.exists():
                # Archive unexpectedly contained admin_tasks — merge our
                # preserved files into it (ours win on conflict).
                shutil.copytree(str(tasks_shelter), str(restored_tasks), dirs_exist_ok=True)
                shutil.rmtree(str(tasks_shelter), ignore_errors=True)
            else:
                shutil.move(str(tasks_shelter), str(restored_tasks))
    except Exception:
        # Restore admin_tasks back into backup before rolling back
        if tasks_shelter.exists():
            backup_tasks = backup_path / tasks_basename if backup_path.exists() else tasks_src
            try:
                shutil.move(str(tasks_shelter), str(backup_tasks))
            except OSError:
                pass
        if backup_path.exists():
            if data_path.exists():
                shutil.rmtree(str(data_path), ignore_errors=True)
            os.rename(str(backup_path), str(data_path))
        raise

    if backup_path.exists():
        shutil.rmtree(str(backup_path), ignore_errors=True)

    tiles_count = 0
    source_count = 0
    tiles_path = Path(tiles_dir)
    source_path = Path(source_images_dir)
    if tiles_path.exists():
        tiles_count = sum(1 for f in tiles_path.rglob("*") if f.is_file())
    if source_path.exists():
        source_count = sum(1 for f in source_path.rglob("*") if f.is_file())

    return {"tile_files": tiles_count, "source_files": source_count}


async def run_files_import(task_id: int) -> None:
    """Extract a tar.gz archive over the data directory in the background."""
    async with get_async_session()() as session:
        task = await session.get(AdminTask, task_id)
        if task is None:
            logger.error("AdminTask %d not found", task_id)
            return

        input_path = task.input_path
        try:
            await _update_task(
                session, task,
                status="running", progress=0,
                log_line="Starting filesystem import…",
                check_cancelled=True,
            )

            if not input_path or not os.path.exists(input_path):
                raise ValueError("Uploaded archive file not found")

            data_dir = str(Path(settings.tiles_dir).parent)

            await _update_task(
                session, task, progress=10,
                log_line="Extracting and restoring files (this may take a while)…",
                check_cancelled=True,
            )

            with tempfile.TemporaryDirectory(prefix="hriv-import-") as tmpdir:
                restored = await asyncio.to_thread(
                    _extract_and_restore,
                    input_path,
                    tmpdir,
                    data_dir,
                    settings.tiles_dir,
                    settings.source_images_dir,
                )

            summary = (
                f"Restored {restored['tile_files']} tile files, "
                f"{restored['source_files']} source files."
            )
            # Do NOT check_cancelled here — files have already been
            # extracted to disk and cannot be rolled back.  Marking the
            # task "cancelled" at this point would be misleading.
            await _update_task(
                session, task,
                status="completed", progress=100,
                log_line=f"Import complete. {summary}",
            )
            logger.info(
                "Background files import completed",
                extra={
                    "event": "admin_task.files_import_done",
                    "task_id": task_id,
                    "restored": restored,
                },
            )

        except TaskCancelled:
            logger.info(
                "Background files import cancelled",
                extra={"event": "admin_task.files_import_cancelled", "task_id": task_id},
            )
            await session.refresh(task)
            await _update_task(
                session, task,
                status="cancelled",
                log_line="Task cancelled.",
            )

        except Exception as exc:
            logger.exception(
                "Background files import failed",
                extra={"event": "admin_task.files_import_failed", "task_id": task_id},
            )
            await session.rollback()
            await session.refresh(task)
            await _update_task(
                session, task,
                status="failed", progress=0,
                log_line=f"ERROR: {exc}",
                error_message=str(exc),
            )
        finally:
            if input_path:
                try:
                    os.unlink(input_path)
                except OSError:
                    pass
