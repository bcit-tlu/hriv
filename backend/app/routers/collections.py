"""Collections: user- or program-owned groupings of existing images.

Read endpoints only enforce *who may see what*; every response is filtered
server-side. Non-students see all collections. Students see their own,
``public`` collections, and ``restricted`` collections passing the program
AND group dual gate (``authz.can_view_collection``). Inside a collection a
student only receives images they could open via ``GET /api/images/{id}``
(active + category visible); hidden images are omitted, not an error.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..authz import (
    can_delete_collection,
    can_edit_collection,
    can_transfer_collection,
    can_view_collection,
)
from ..database import get_db
from ..models import COLLECTION_TYPES, Collection, Image, User
from ..schemas import (
    CollectionOut,
    CollectionOwnerOut,
    CollectionPermissionsOut,
    CollectionSummaryOut,
    ImageOut,
)
from ..visibility import get_student_excluded_category_ids

router = APIRouter(prefix="/collections", tags=["collections"])


class _ViewerContext:
    """Per-request visibility context for the calling user.

    ``excluded_category_ids`` is ``None`` for non-students (no filtering);
    for students it is the set of categories they must not see, computed
    once per request so listing many collections stays O(1) queries.
    """

    def __init__(
        self,
        user: User,
        excluded_category_ids: set[int] | None,
    ) -> None:
        self.user = user
        self.program_ids = {p.id for p in user.programs}
        self.group_ids = {g.id for g in user.groups}
        self.excluded_category_ids = excluded_category_ids

    @classmethod
    async def build(cls, db: AsyncSession, user: User) -> "_ViewerContext":
        excluded: set[int] | None = None
        if user.role == "student":
            excluded = await get_student_excluded_category_ids(
                db,
                {p.id for p in user.programs},
                {g.id for g in user.groups},
            )
        return cls(user, excluded)

    def can_view(self, collection: Collection) -> bool:
        return can_view_collection(
            self.user, collection, self.program_ids, self.group_ids
        )

    def visible_images(self, collection: Collection) -> list[Image]:
        images = [
            link.image for link in collection.image_links if link.image is not None
        ]
        if self.excluded_category_ids is None:
            return images
        return [
            img
            for img in images
            if img.active
            and (
                img.category_id is None
                or img.category_id not in self.excluded_category_ids
            )
        ]


def _owner_out(collection: Collection) -> CollectionOwnerOut | None:
    if collection.user_id is not None and collection.owner is not None:
        return CollectionOwnerOut(user_id=collection.user_id, name=collection.owner.name)
    if collection.owner_program_id is not None and collection.owner_program is not None:
        return CollectionOwnerOut(
            program_id=collection.owner_program_id, name=collection.owner_program.name
        )
    return None


def _permissions_for(user: User, collection: Collection) -> CollectionPermissionsOut:
    return CollectionPermissionsOut(
        can_edit=can_edit_collection(user, collection),
        can_delete=can_delete_collection(user, collection),
        can_transfer=can_transfer_collection(user, collection),
    )


def _summary_fields(
    ctx: _ViewerContext, collection: Collection, images: list[Image]
) -> dict:
    return {
        "id": collection.id,
        "name": collection.name,
        "description": collection.description,
        "type": collection.type,
        "visibility": collection.visibility,
        "owner": _owner_out(collection),
        "image_count": len(images),
        "cover_thumb": images[0].thumb if images else None,
        "version": collection.version,
        "created_at": collection.created_at,
        "updated_at": collection.updated_at,
        "permissions": _permissions_for(ctx.user, collection),
    }


def collection_summary_out(
    ctx: _ViewerContext, collection: Collection
) -> CollectionSummaryOut:
    return CollectionSummaryOut(
        **_summary_fields(ctx, collection, ctx.visible_images(collection))
    )


def collection_out(ctx: _ViewerContext, collection: Collection) -> CollectionOut:
    images = ctx.visible_images(collection)
    return CollectionOut(
        **_summary_fields(ctx, collection, images),
        images=[ImageOut.model_validate(img) for img in images],
        program_ids=[p.id for p in collection.programs],
        group_ids=[g.id for g in collection.groups],
        viewport_state=dict(collection.viewport_state or {}),
    )


async def get_visible_collection_or_404(
    db: AsyncSession, user: User, collection_id: int
) -> tuple[_ViewerContext, Collection]:
    """Load a collection the caller may view, or raise 404.

    A 404 (not 403) is returned for collections the caller may not see so
    that private collection ids cannot be probed for existence.
    """
    collection = await db.get(Collection, collection_id)
    ctx = await _ViewerContext.build(db, user)
    if collection is None or not ctx.can_view(collection):
        raise HTTPException(status_code=404, detail="Collection not found")
    return ctx, collection


@router.get("", response_model=list[CollectionSummaryOut])
async def list_collections(
    user: Annotated[User, Depends(get_current_user)],
    type: str | None = None,
    mine: bool = False,
    owner_user_id: int | None = None,
    owner_program_id: int | None = None,
    orphaned: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """List collections visible to the caller (server-side filtered).

    ``orphaned=true`` (collections whose owning program was deleted) is an
    admin-only filter; other roles receive 403.
    """
    if type is not None and type not in COLLECTION_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"type must be one of {', '.join(COLLECTION_TYPES)}",
        )
    if orphaned and user.role != "admin":
        raise HTTPException(
            status_code=403, detail="Only admins may list orphaned collections"
        )

    stmt = select(Collection)
    if type is not None:
        stmt = stmt.where(Collection.type == type)
    if mine:
        stmt = stmt.where(Collection.user_id == user.id)
    if owner_user_id is not None:
        stmt = stmt.where(Collection.user_id == owner_user_id)
    if owner_program_id is not None:
        stmt = stmt.where(Collection.owner_program_id == owner_program_id)
    if orphaned:
        stmt = stmt.where(
            Collection.user_id.is_(None), Collection.owner_program_id.is_(None)
        )
    stmt = stmt.order_by(Collection.updated_at.desc(), Collection.id.desc())

    collections = (await db.execute(stmt)).scalars().unique().all()
    ctx = await _ViewerContext.build(db, user)
    return [
        collection_summary_out(ctx, c) for c in collections if ctx.can_view(c)
    ]


@router.get("/{collection_id}", response_model=CollectionOut)
async def get_collection(
    collection_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    ctx, collection = await get_visible_collection_or_404(db, user, collection_id)
    return collection_out(ctx, collection)
