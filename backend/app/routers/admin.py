import asyncio
import json
import logging
import os
import shutil
import tarfile
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import Response, StreamingResponse
from jose import JWTError, jwt
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import auth_settings, require_role
from ..database import get_db, settings
from ..models import Announcement, Category, Image, Program, SourceImage, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

_admin = require_role("admin")

@router.get("/export")
async def export_database(
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    """Export all database tables as a JSON document."""
    # Programs
    result = await db.execute(
        select(Program).order_by(Program.id)
    )
    programs = result.scalars().all()

    # Categories
    result = await db.execute(
        select(Category).order_by(Category.id)
    )
    categories = result.scalars().all()

    # Images
    result = await db.execute(
        select(Image).order_by(Image.id)
    )
    images = result.scalars().all()

    # Users
    result = await db.execute(
        select(User).order_by(User.id)
    )
    users = result.scalars().all()

    # Source images
    result = await db.execute(
        select(SourceImage).order_by(SourceImage.id)
    )
    source_images = result.scalars().all()

    # Announcement
    result = await db.execute(
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
                "error_message": s.error_message,
                "name": s.name,
                "category_id": s.category_id,
                "copyright": s.copyright,
                "note": s.note,
                "active": s.active,
                "program": s.program,
                "image_id": s.image_id,
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

    logger.info(
        "Database export generated",
        extra={
            "event": "admin.export",
            "detail": {
                "programs": len(dump["programs"]),
                "categories": len(dump["categories"]),
                "images": len(dump["images"]),
                "users": len(dump["users"]),
            },
        },
    )

    content = json.dumps(dump, indent=2)
    return Response(
        content=content,
        media_type="application/json",
        headers={
            "Content-Disposition": "attachment; filename=corgi-export.json",
        },
    )


@router.post("/import")
async def import_database(
    _user: Annotated[User, Depends(_admin)],
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Import a previously exported JSON dump, replacing all data."""
    if not file.filename or not file.filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="Only .json files are accepted")

    try:
        raw = await file.read()
        dump = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}")

    if not isinstance(dump, dict):
        raise HTTPException(status_code=400, detail="Expected a JSON object")

    for key in ("categories", "images", "users"):
        if key not in dump:
            raise HTTPException(
                status_code=400, detail=f"Missing required key: {key}"
            )

    try:
        # Clear existing data in dependency order
        await db.execute(text("DELETE FROM source_images"))
        await db.execute(text("DELETE FROM image_programs"))
        await db.execute(text("DELETE FROM images"))
        await db.execute(text("DELETE FROM categories"))
        await db.execute(text("DELETE FROM users"))
        await db.execute(text("DELETE FROM announcements"))
        await db.execute(text("DELETE FROM programs"))

        # Import programs (if present in dump)
        for p in dump.get("programs", []):
            program = Program(
                id=p["id"],
                name=p["name"],
                created_at=_parse_dt(p.get("created_at")),
                updated_at=_parse_dt(p.get("updated_at")),
            )
            db.add(program)
        await db.flush()

        # Import users
        for u in dump["users"]:
            user = User(
                id=u["id"],
                name=u["name"],
                email=u["email"],
                password_hash=u.get("password_hash"),
                role=u.get("role", "student"),
                program_id=u.get("program_id"),
                last_access=_parse_dt(u.get("last_access")),
                metadata_=u.get("metadata", {}),
                created_at=_parse_dt(u.get("created_at")),
                updated_at=_parse_dt(u.get("updated_at")),
            )
            db.add(user)

        # Import categories (topologically sorted to respect parent_id FK)
        cat_map = {c["id"]: c for c in dump["categories"]}
        inserted_ids: set[int] = set()
        remaining = list(dump["categories"])
        while remaining:
            progress = False
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
                        metadata_=c.get("metadata", {}),
                        created_at=_parse_dt(c.get("created_at")),
                        updated_at=_parse_dt(c.get("updated_at")),
                    )
                    db.add(cat)
                    inserted_ids.add(c["id"])
                    progress = True
                else:
                    next_remaining.append(c)
            if not progress:
                raise ValueError("Circular or broken parent_id references in categories")
            remaining = next_remaining
            await db.flush()

        # Flush categories so image foreign keys resolve
        await db.flush()

        # Import images
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
            # Handle program_ids (new format only; legacy string 'program' is not migrated)
            prog_ids = i.get("program_ids", [])
            if prog_ids:
                progs = (await db.execute(
                    select(Program).where(Program.id.in_(prog_ids))
                )).scalars().all()
                img.programs = list(progs)
            db.add(img)

        # Flush images so sequence reset sees all rows
        await db.flush()

        # Import source images (if present in dump)
        for s in dump.get("source_images", []):
            src = SourceImage(
                id=s["id"],
                original_filename=s["original_filename"],
                stored_path=s["stored_path"],
                status=s.get("status", "pending"),
                error_message=s.get("error_message"),
                name=s.get("name"),
                category_id=s.get("category_id"),
                copyright=s.get("copyright"),
                note=s.get("note"),
                active=s.get("active", True),
                program=s.get("program"),
                image_id=s.get("image_id"),
                created_at=_parse_dt(s.get("created_at")),
                updated_at=_parse_dt(s.get("updated_at")),
            )
            db.add(src)
        await db.flush()

        # Import announcement (if present in dump)
        ann_data = dump.get("announcement")
        if ann_data:
            ann = Announcement(
                id=1,
                message=ann_data.get("message", ""),
                enabled=ann_data.get("enabled", False),
                created_at=_parse_dt(ann_data.get("created_at")),
                updated_at=_parse_dt(ann_data.get("updated_at")),
            )
            db.add(ann)
        else:
            db.add(Announcement(id=1, message="", enabled=False))
        await db.flush()

        # Reset sequences so new inserts get correct IDs (before commit for atomicity)
        # Use GREATEST(..., 1) with is_called=EXISTS(...) to handle empty tables
        # (PostgreSQL SERIAL sequences have MINVALUE 1, so setval(seq, 0) would fail)
        await db.execute(
            text("SELECT setval('programs_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM programs), 1), 1), EXISTS(SELECT 1 FROM programs))")
        )
        await db.execute(
            text("SELECT setval('categories_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM categories), 1), 1), EXISTS(SELECT 1 FROM categories))")
        )
        await db.execute(
            text("SELECT setval('images_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM images), 1), 1), EXISTS(SELECT 1 FROM images))")
        )
        await db.execute(
            text("SELECT setval('users_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM users), 1), 1), EXISTS(SELECT 1 FROM users))")
        )
        await db.execute(
            text("SELECT setval('announcements_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM announcements), 1), 1), EXISTS(SELECT 1 FROM announcements))")
        )
        await db.execute(
            text("SELECT setval('source_images_id_seq', GREATEST(COALESCE((SELECT MAX(id) FROM source_images), 1), 1), EXISTS(SELECT 1 FROM source_images))")
        )

        await db.commit()

    except Exception as exc:
        await db.rollback()
        logger.exception(
            "Database import failed",
            extra={"event": "admin.import_failed"},
        )
        raise HTTPException(status_code=500, detail=f"Import failed: {exc}")

    result = {
        "status": "ok",
        "imported": {
            "programs": len(dump.get("programs", [])),
            "categories": len(dump["categories"]),
            "images": len(dump["images"]),
            "users": len(dump["users"]),
            "source_images": len(dump.get("source_images", [])),
        },
    }
    logger.info(
        "Database import completed",
        extra={
            "event": "admin.import",
            "detail": result["imported"],
        },
    )
    return result


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value)


# ---------------------------------------------------------------------------
# Filesystem snapshot export / import
# ---------------------------------------------------------------------------

_CHUNK_SIZE = 1024 * 1024  # 1 MiB streaming chunks
_DOWNLOAD_TOKEN_EXPIRE_SECONDS = 60


def _create_tar_file(data_dir: str, dest: str) -> None:
    """Write a tar.gz archive of *data_dir* to *dest* (runs in a thread)."""
    with tarfile.open(dest, mode="w:gz") as tar:
        tar.add(data_dir, arcname="data")


def _extract_and_restore(
    tmp_archive: str,
    tmpdir: str,
    data_dir: str,
    tiles_dir: str,
    source_images_dir: str,
) -> dict[str, int]:
    """Extract archive, swap data dir atomically, count restored files.

    Runs in a worker thread to avoid blocking the async event loop.
    """
    # Validate and extract the archive into a staging directory
    with tarfile.open(tmp_archive, "r:gz") as tar:
        members = tar.getnames()
        if not members:
            raise ValueError("Archive is empty")
        staging = Path(tmpdir) / "staging"
        staging.mkdir()
        tar.extractall(path=str(staging), filter="data")

    # Locate the extracted data root
    extracted = staging / "data"
    if not extracted.exists():
        entries = list(staging.iterdir())
        extracted = entries[0] if len(entries) == 1 and entries[0].is_dir() else staging

    data_path = Path(data_dir)
    backup_path = data_path.with_name(
        data_path.name + f".bak-{int(datetime.now(timezone.utc).timestamp())}"
    )

    # Atomic-ish swap: rename existing data to backup, copy new data in.
    # If the copy fails, restore the backup so no data is lost.
    if data_path.exists():
        os.rename(str(data_path), str(backup_path))

    try:
        os.makedirs(str(data_path), exist_ok=True)
        shutil.copytree(str(extracted), str(data_path), dirs_exist_ok=True)
    except Exception:
        # Restore the backup on failure
        if backup_path.exists():
            if data_path.exists():
                shutil.rmtree(str(data_path), ignore_errors=True)
            os.rename(str(backup_path), str(data_path))
        raise

    # Success — remove the backup
    if backup_path.exists():
        shutil.rmtree(str(backup_path), ignore_errors=True)

    # Count what was restored
    tiles_count = 0
    source_count = 0
    tiles_path = Path(tiles_dir)
    source_path = Path(source_images_dir)
    if tiles_path.exists():
        tiles_count = sum(1 for f in tiles_path.rglob("*") if f.is_file())
    if source_path.exists():
        source_count = sum(1 for f in source_path.rglob("*") if f.is_file())

    return {"tile_files": tiles_count, "source_files": source_count}


@router.post("/export-files-token")
async def create_export_files_token(
    _user: Annotated[User, Depends(_admin)],
):
    """Create a short-lived signed JWT for downloading the filesystem archive.

    The token is valid for 60 seconds and allows a single browser-native
    download via ``GET /admin/export-files?token=<token>``, avoiding the
    need to buffer the entire archive in browser memory.

    Using a signed JWT (instead of an in-memory dict) ensures the token
    is valid across all uvicorn workers in a multi-process deployment.
    """
    expire = datetime.now(timezone.utc) + timedelta(seconds=_DOWNLOAD_TOKEN_EXPIRE_SECONDS)
    payload = {
        "sub": str(_user.id),
        "purpose": "file-export",
        "exp": expire,
    }
    token = jwt.encode(
        payload, auth_settings.jwt_secret, algorithm=auth_settings.jwt_algorithm
    )
    return {"token": token}


@router.get("/export-files")
async def export_files(
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Stream a tar.gz archive of the filesystem data directory.

    The archive contains DZI tiles, thumbnails, and source images —
    everything needed to restore the file-based half of the system.

    Authentication is via a short-lived download token obtained from
    ``POST /admin/export-files-token``.  This allows the browser to
    perform a native download (``window.location``) instead of buffering
    the entire archive in JavaScript memory.
    """
    # Validate the signed download token (JWT)
    try:
        payload = jwt.decode(
            token,
            auth_settings.jwt_secret,
            algorithms=[auth_settings.jwt_algorithm],
        )
    except JWTError:
        raise HTTPException(
            status_code=401, detail="Invalid or expired download token"
        )
    if payload.get("purpose") != "file-export":
        raise HTTPException(
            status_code=401, detail="Invalid or expired download token"
        )
    user_id_str = payload.get("sub")
    if not user_id_str:
        raise HTTPException(
            status_code=401, detail="Invalid or expired download token"
        )
    user = await db.get(User, int(user_id_str))
    if user is None or user.role != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")

    data_dir = Path(settings.tiles_dir).parent  # /data

    if not data_dir.exists() or not any(data_dir.iterdir()):
        raise HTTPException(
            status_code=404,
            detail="Data directory is empty or missing \u2014 nothing to export",
        )

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"corgi-files-{timestamp}.tar.gz"

    # Write the archive to a temp file in a worker thread so we don't
    # block the async event loop or hold the full archive in memory.
    tmp = tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False)
    tmp.close()
    try:
        await asyncio.to_thread(_create_tar_file, str(data_dir), tmp.name)
    except Exception:
        os.unlink(tmp.name)
        raise

    # Sync generator — Starlette wraps it in iterate_in_threadpool so
    # file reads don't block the event loop.
    def _stream_and_cleanup():
        try:
            with open(tmp.name, "rb") as fh:
                while True:
                    chunk = fh.read(_CHUNK_SIZE)
                    if not chunk:
                        break
                    yield chunk
        finally:
            os.unlink(tmp.name)

    return StreamingResponse(
        _stream_and_cleanup(),
        media_type="application/gzip",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
        },
    )


@router.post("/import-files")
async def import_files(
    _user: Annotated[User, Depends(_admin)],
    file: UploadFile = File(...),
):
    """Accept a tar.gz archive and restore it over the data directory.

    This replaces the current tiles and source images on disk.
    """
    if not file.filename or not (
        file.filename.endswith(".tar.gz") or file.filename.endswith(".tgz")
    ):
        raise HTTPException(
            status_code=400, detail="Only .tar.gz / .tgz files are accepted"
        )

    data_dir = Path(settings.tiles_dir).parent  # /data

    with tempfile.TemporaryDirectory(prefix="corgi-import-") as tmpdir:
        # Stream the upload to a temporary file (handles large archives).
        # This uses ``await file.read()`` and must stay in the async handler.
        tmp_archive = Path(tmpdir) / "upload.tar.gz"
        with open(tmp_archive, "wb") as f:
            while True:
                chunk = await file.read(_CHUNK_SIZE)
                if not chunk:
                    break
                f.write(chunk)

        # Offload all blocking I/O (tar extraction, directory swap,
        # file counting) to a worker thread.
        try:
            restored = await asyncio.to_thread(
                _extract_and_restore,
                str(tmp_archive),
                tmpdir,
                str(data_dir),
                settings.tiles_dir,
                settings.source_images_dir,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except tarfile.TarError as exc:
            raise HTTPException(
                status_code=400, detail=f"Invalid tar.gz archive: {exc}"
            )

    return {
        "status": "ok",
        "restored": restored,
    }
