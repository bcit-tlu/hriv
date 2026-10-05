"""Serialization and per-request visibility helpers for collections.

Separated from ``routers/collections.py`` so other readers — the category
tree in ``routers/categories.py`` embeds collections as Browse tiles — can
build the same ``CollectionSummaryOut`` / ``CollectionOut`` payloads without
importing a sibling router.

Visibility rules (``_ViewerContext``) are the single enforcement point used
by list/detail endpoints, the write API's 404-or-403 gate, and the tree
embed: non-students see every collection; students see their own, ``public``
collections, and ``restricted`` collections passing the program AND group
dual gate (``authz.can_view_collection``) — and, since epic #1525 files
collections into categories, only when the collection's category (if any)
passes the student's category subtree exclusion as well.
"""

from collections.abc import Iterable

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .authz import (
    can_change_collection_scope,
    can_delete_collection,
    can_edit_collection,
    can_transfer_collection,
    can_view_collection,
)
from .models import Collection, CollectionImage, Image, User
from .schemas import (
    CollectionOut,
    CollectionOwnerOut,
    CollectionPermissionsOut,
    CollectionSummaryOut,
    ImageOut,
)
from .visibility import get_student_excluded_category_ids


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
        """Both gates AND: the collection's own visibility gate plus the
        ancestor gate of the category it is filed in (a hidden/restricted
        category hides everything inside it, including collections)."""
        if (
            self.excluded_category_ids is not None
            and collection.category_id is not None
            and collection.category_id in self.excluded_category_ids
        ):
            return False
        return can_view_collection(
            self.user, collection, self.program_ids, self.group_ids
        )

    def can_view_image(self, img: Image) -> bool:
        """Same gate as ``GET /api/images/{id}``: non-students see every
        image; students need it active and its category not excluded.
        """
        if self.excluded_category_ids is None:
            return True
        return bool(img.active) and (
            img.category_id is None
            or img.category_id not in self.excluded_category_ids
        )

    def visible_images(self, collection: Collection) -> list[Image]:
        return [
            link.image
            for link in collection.image_links
            if link.image is not None and self.can_view_image(link.image)
        ]


def _owners_out(collection: Collection) -> list[CollectionOwnerOut]:
    """User co-owners (name-sorted for stable display) followed by the
    owning program's entry when set. Empty means orphaned (#1531).
    """
    owners = [
        CollectionOwnerOut(user_id=o.id, name=o.name)
        for o in sorted(
            collection.owners, key=lambda u: (u.name.casefold(), u.id)
        )
    ]
    if collection.owner_program_id is not None and collection.owner_program is not None:
        owners.append(
            CollectionOwnerOut(
                program_id=collection.owner_program_id,
                name=collection.owner_program.name,
            )
        )
    return owners


def _permissions_for(user: User, collection: Collection) -> CollectionPermissionsOut:
    return CollectionPermissionsOut(
        can_edit=can_edit_collection(user, collection),
        can_change_scope=can_change_collection_scope(user, collection),
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
        "owners": _owners_out(collection),
        "image_count": len(images),
        "cover_thumb": images[0].thumb if images else None,
        "version": collection.version,
        "category_id": collection.category_id,
        "sort_order": collection.sort_order,
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
        # Nominal membership for unfiltered viewers (non-students). For
        # students the true total would disclose how many images are
        # restricted from them, so the count is clamped to ``len(images) + 1``:
        # enough to signal "hidden members exist" (the restricted-members
        # message deliberately reveals that much) without leaking the total.
        member_count=(
            len(collection.image_links)
            if ctx.excluded_category_ids is None
            else min(len(collection.image_links), len(images) + 1)
        ),
    )


async def image_ids_in_filed_collections(
    db: AsyncSession, image_ids: Iterable[int]
) -> set[int]:
    """Subset of *image_ids* that belong to a collection filed into a
    category (``category_id IS NOT NULL``).

    Such an image's ``thumb``/``active``/membership renders on that
    collection's Browse tile via ``cover_thumb``/``image_count``, so writes
    to it must bump the browse revision even when the image itself is
    uncategorized — the image routers historically skip the bump for
    uncategorized images because they never appeared in the tree (epic
    #1525 / #1527).
    """
    ids = {i for i in image_ids}
    if not ids:
        return set()
    result = await db.execute(
        select(CollectionImage.image_id)
        .join(Collection, Collection.id == CollectionImage.collection_id)
        .where(
            CollectionImage.image_id.in_(ids),
            Collection.category_id.isnot(None),
        )
        .distinct()
    )
    return set(result.scalars().all())


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
