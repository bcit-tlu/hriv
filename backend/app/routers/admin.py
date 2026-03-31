import json
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_role
from ..database import get_db
from ..models import Announcement, Category, Image, Program, User

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
                "label": i.label,
                "thumb": i.thumb,
                "tile_sources": i.tile_sources,
                "category_id": i.category_id,
                "copyright": i.copyright,
                "origin": i.origin,
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
        "announcement": {
            "message": ann.message if ann else "",
            "enabled": ann.enabled if ann else False,
            "created_at": dt(ann.created_at) if ann else None,
            "updated_at": dt(ann.updated_at) if ann else None,
        },
    }

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
                label=i["label"],
                thumb=i["thumb"],
                tile_sources=i["tile_sources"],
                category_id=i.get("category_id"),
                copyright=i.get("copyright"),
                origin=i.get("origin"),
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

        await db.commit()

    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Import failed: {exc}")

    return {
        "status": "ok",
        "imported": {
            "programs": len(dump.get("programs", [])),
            "categories": len(dump["categories"]),
            "images": len(dump["images"]),
            "users": len(dump["users"]),
        },
    }


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value)
