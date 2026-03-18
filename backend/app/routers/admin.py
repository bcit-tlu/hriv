import json
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import require_role
from ..database import get_db
from ..models import Category, Image, User

router = APIRouter(prefix="/admin", tags=["admin"])

_admin = require_role("admin")


@router.get("/export")
async def export_database(
    _user: Annotated[User, Depends(_admin)],
    db: AsyncSession = Depends(get_db),
):
    """Export all database tables as a JSON document."""
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

    def dt(v: datetime | None) -> str | None:
        return v.isoformat() if v else None

    dump = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
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
                "program": i.program,
                "status": i.status,
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
                "program": u.program,
                "last_access": dt(u.last_access),
                "metadata": u.metadata_,
                "created_at": dt(u.created_at),
                "updated_at": dt(u.updated_at),
            }
            for u in users
        ],
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
        await db.execute(text("DELETE FROM images"))
        await db.execute(text("DELETE FROM categories"))
        await db.execute(text("DELETE FROM users"))

        # Import users
        for u in dump["users"]:
            user = User(
                id=u["id"],
                name=u["name"],
                email=u["email"],
                password_hash=u.get("password_hash"),
                role=u.get("role", "student"),
                program=u.get("program"),
                last_access=_parse_dt(u.get("last_access")),
                metadata_=u.get("metadata", {}),
            )
            db.add(user)

        # Import categories (ordered by id to respect parent_id references)
        sorted_cats = sorted(dump["categories"], key=lambda c: c["id"])
        for c in sorted_cats:
            cat = Category(
                id=c["id"],
                label=c["label"],
                parent_id=c.get("parent_id"),
                program=c.get("program"),
                status=c.get("status", "active"),
                metadata_=c.get("metadata", {}),
            )
            db.add(cat)

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
                program=i.get("program"),
                status=i.get("status", "active"),
                metadata_=i.get("metadata", {}),
            )
            db.add(img)

        # Flush images so sequence reset sees all rows
        await db.flush()

        # Reset sequences so new inserts get correct IDs (before commit for atomicity)
        await db.execute(
            text("SELECT setval('categories_id_seq', COALESCE((SELECT MAX(id) FROM categories), 0))")
        )
        await db.execute(
            text("SELECT setval('images_id_seq', COALESCE((SELECT MAX(id) FROM images), 0))")
        )
        await db.execute(
            text("SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 0))")
        )

        await db.commit()

    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Import failed: {exc}")

    return {
        "status": "ok",
        "imported": {
            "categories": len(dump["categories"]),
            "images": len(dump["images"]),
            "users": len(dump["users"]),
        },
    }


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value)
