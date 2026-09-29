"""Collections: user- or program-owned groupings of existing images.

Read endpoints only enforce *who may see what*; every response is filtered
server-side. Non-students see all collections. Students see their own,
``public`` collections, and ``restricted`` collections passing the program
AND group dual gate (``authz.can_view_collection``). Inside a collection a
student only receives images they could open via ``GET /api/images/{id}``
(active + category visible); hidden images are omitted, not an error. A
whole-list ``PUT …/images`` from such a caller retains those hidden members
(appended after the submitted list) rather than dropping them.

Write endpoints re-check authority server-side on every call: a caller who
cannot *view* a collection gets 404 (never 403, so private ids cannot be
probed); a caller who can view but not edit gets 403. PATCH / images /
viewport carry a ``version`` token; a stale token yields 409 whose ``detail``
is the current ``CollectionOut`` so the client can rebase.

Ownership transfer (``POST …/transfer``) is gated by
``authz.can_transfer_collection``: admins may hand any collection to any
active user or any program; instructors may move collections they own or
that belong to one of their programs, but only onto a program they belong
to. Collections orphaned by a program delete are admin-only until reassigned.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select, update as sql_update
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..authz import (
    can_attach_group_to_collection,
    can_attach_program_to_collection,
    can_delete_collection,
    can_edit_collection,
    can_transfer_collection,
    can_view_collection,
)
from ..database import get_db, settings
from ..models import (
    COLLECTION_TYPES,
    SYNCHRONIZED_COLLECTION_MAX_IMAGES,
    Collection,
    CollectionImage,
    Group,
    Image,
    Program,
    User,
)
from ..schemas import (
    CollectionCreate,
    CollectionImagesUpdate,
    CollectionOut,
    CollectionOwnerOut,
    CollectionPermissionsOut,
    CollectionSummaryOut,
    CollectionTransfer,
    CollectionUpdate,
    CollectionViewportUpdate,
    ImageOut,
)
from ..visibility import get_student_excluded_category_ids

def require_collections_enabled() -> None:
    """Router-wide gate for the ``COLLECTIONS_ENABLED`` dark-launch flag.

    Every collections endpoint returns the same 404 as an unknown route while
    the feature is off, so the API surface is indistinguishable from a build
    without collections. Evaluated per request so tests (and operators
    reloading settings) can flip it without rebuilding the app.
    """
    if not settings.collections_enabled:
        raise HTTPException(status_code=404, detail="Not Found")


router = APIRouter(
    prefix="/collections",
    tags=["collections"],
    dependencies=[Depends(require_collections_enabled)],
)


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


# ── Write helpers ─────────────────────────────────────────────────────────


async def get_editable_collection_or_error(
    db: AsyncSession, user: User, collection_id: int
) -> tuple[_ViewerContext, Collection]:
    """404 when the caller cannot view the collection, 403 when they can
    view it but may not edit it."""
    ctx, collection = await get_visible_collection_or_404(db, user, collection_id)
    if not can_edit_collection(user, collection):
        raise HTTPException(
            status_code=403, detail="You may not edit this collection"
        )
    return ctx, collection


def _require_restricted_authority(user: User) -> None:
    if user.role not in ("admin", "instructor"):
        raise HTTPException(
            status_code=403,
            detail="Only admins and instructors may use restricted visibility",
        )


async def _resolve_programs(
    db: AsyncSession, user: User, program_ids: list[int], existing_ids: set[int],
) -> list[Program]:
    """Validate program ids exist (422) and that *user* may attach the newly
    added ones (403): admins any program, instructors only their own.
    Programs already attached are kept without re-checking so any editor may
    narrow or remove scope.
    """
    if not program_ids:
        return []
    unique_ids = list(dict.fromkeys(program_ids))
    progs = (await db.execute(
        select(Program).where(Program.id.in_(unique_ids))
    )).scalars().all()
    by_id = {p.id: p for p in progs}
    missing = set(unique_ids) - set(by_id)
    if missing:
        raise HTTPException(422, f"Invalid program IDs: {sorted(missing)}")
    for pid in unique_ids:
        if pid in existing_ids:
            continue
        if not can_attach_program_to_collection(user, pid):
            raise HTTPException(
                403,
                f"You may only attach programs you belong to ({by_id[pid].name})",
            )
    return [by_id[pid] for pid in unique_ids]


async def _resolve_groups(
    db: AsyncSession, user: User, group_ids: list[int], existing_ids: set[int],
) -> list[Group]:
    """Validate group ids exist (422) and that *user* may attach the newly
    added ones (403): admins any group, instructors only groups they manage.
    """
    if not group_ids:
        return []
    unique_ids = list(dict.fromkeys(group_ids))
    grps = (await db.execute(
        select(Group).where(Group.id.in_(unique_ids))
    )).scalars().all()
    by_id = {g.id: g for g in grps}
    missing = set(unique_ids) - set(by_id)
    if missing:
        raise HTTPException(422, f"Invalid group IDs: {sorted(missing)}")
    for gid in unique_ids:
        if gid in existing_ids:
            continue
        group = by_id[gid]
        if not can_attach_group_to_collection(
            user, [i.id for i in group.instructors]
        ):
            raise HTTPException(
                403, f"You may only attach groups you manage ({group.name})"
            )
    return [by_id[gid] for gid in unique_ids]


def _unseen_links(
    ctx: _ViewerContext, collection: Collection
) -> list[CollectionImage]:
    """Membership rows whose image exists but the caller cannot view.

    ``GET`` omits these images, so a whole-list ``PUT`` built from that
    response cannot name them; they are carried over unchanged (original
    relative order) instead of being silently dropped. Non-students see every
    image, so for them this is always empty.
    """
    return sorted(
        (
            link
            for link in collection.image_links
            if link.image is not None and not ctx.can_view_image(link.image)
        ),
        key=lambda link: link.sort_order,
    )


async def _resolve_images(
    db: AsyncSession,
    ctx: _ViewerContext,
    collection_type: str,
    image_ids: list[int],
    retained: int = 0,
) -> list[Image]:
    """Validate the ordered image list for a collection of *collection_type*.

    422 when an id is unknown, when ids repeat, when a synchronized collection
    would exceed ``SYNCHRONIZED_COLLECTION_MAX_IMAGES`` (counting *retained*
    members the caller cannot see), or when a student names an image they
    cannot view (inactive, or category failing the program AND group dual
    gate). Returns images in request order.
    """
    if len(set(image_ids)) != len(image_ids):
        raise HTTPException(422, "image_ids must not contain duplicates")
    if (
        collection_type == "synchronized"
        and len(image_ids) + retained > SYNCHRONIZED_COLLECTION_MAX_IMAGES
    ):
        detail = (
            "synchronized collections hold at most "
            f"{SYNCHRONIZED_COLLECTION_MAX_IMAGES} images"
        )
        if retained:
            detail += f" ({retained} not visible to you are retained)"
        raise HTTPException(422, detail)
    if not image_ids:
        return []
    images = (await db.execute(
        select(Image).where(Image.id.in_(image_ids))
    )).scalars().all()
    by_id = {img.id: img for img in images}
    missing = set(image_ids) - set(by_id)
    if missing:
        raise HTTPException(422, f"Invalid image IDs: {sorted(missing)}")
    invisible = [iid for iid in image_ids if not ctx.can_view_image(by_id[iid])]
    if invisible:
        raise HTTPException(422, f"Invalid image IDs: {sorted(invisible)}")
    return [by_id[iid] for iid in image_ids]


def _replace_image_links(
    collection: Collection,
    images: list[Image],
    unseen: list[CollectionImage] | None = None,
) -> None:
    """Rewrite the membership to *images* in order with ``sort_order`` 0..n-1,
    followed by *unseen* links (members the caller cannot view) in their
    existing relative order.

    Existing link rows are reused for retained images (the composite PK
    would otherwise collide on delete-then-insert within one flush); links
    for dropped images become orphans and are deleted by the cascade.
    """
    existing = {link.image_id: link for link in collection.image_links}
    links: list[CollectionImage] = []
    for img in images:
        link = existing.get(img.id)
        if link is None:
            link = CollectionImage(image_id=img.id)
        links.append(link)
    links.extend(unseen or [])
    for position, link in enumerate(links):
        link.sort_order = position
    collection.image_links = links


async def _bump_version_or_409(
    db: AsyncSession,
    ctx: _ViewerContext,
    collection: Collection,
    expected_version: int,
) -> None:
    """Optimistic concurrency: atomically advance ``version`` from
    *expected_version* via ``UPDATE … WHERE version = :expected``; if no row
    matches, another client wrote first and the caller receives 409 with the
    current ``CollectionOut`` in ``detail`` (same shape as a fresh GET), or
    404 if that client deleted the collection meanwhile.
    """
    if collection.version == expected_version:
        cas = await db.execute(
            sql_update(Collection)
            .where(
                Collection.id == collection.id,
                Collection.version == expected_version,
            )
            .values(version=expected_version + 1)
        )
        if cas.rowcount:
            collection.version = expected_version + 1
            return
    try:
        await db.refresh(collection)
    except InvalidRequestError:
        raise HTTPException(status_code=404, detail="Collection not found")
    raise HTTPException(
        status_code=409,
        detail=collection_out(ctx, collection).model_dump(mode="json"),
    )


# ── Write endpoints ───────────────────────────────────────────────────────


@router.post("", response_model=CollectionOut, status_code=201)
async def create_collection(
    body: CollectionCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """Create a collection owned by the caller. Any authenticated role may
    create; ``restricted`` visibility needs admin/instructor and attach
    authority over every program/group id.
    """
    ctx = await _ViewerContext.build(db, user)
    progs: list[Program] = []
    grps: list[Group] = []
    if body.visibility == "restricted":
        _require_restricted_authority(user)
        progs = await _resolve_programs(db, user, body.program_ids, set())
        grps = await _resolve_groups(db, user, body.group_ids, set())
    images = await _resolve_images(db, ctx, body.type, body.image_ids)

    collection = Collection(
        name=body.name,
        description=body.description,
        type=body.type,
        visibility=body.visibility,
        user_id=user.id,
        viewport_state={},
        version=1,
    )
    collection.programs = progs
    collection.groups = grps
    _replace_image_links(collection, images)
    db.add(collection)
    await db.commit()
    await db.refresh(collection)
    return collection_out(ctx, collection)


@router.patch("/{collection_id}", response_model=CollectionOut)
async def update_collection(
    collection_id: int,
    body: CollectionUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """Update name / description / visibility / scope. ``type`` is immutable.

    Leaving ``restricted`` clears the program/group scope; sending a
    non-empty scope for a non-restricted collection is 422. Newly attached
    programs/groups re-check attach authority (403).
    """
    ctx, collection = await get_editable_collection_or_error(db, user, collection_id)
    if body.type is not None and body.type != collection.type:
        raise HTTPException(422, "Collection type is immutable")

    fields = body.model_dump(exclude_unset=True)
    visibility = body.visibility or collection.visibility

    new_programs: list[Program] | None = None
    new_groups: list[Group] | None = None
    if visibility == "restricted":
        if (
            body.visibility is not None
            or body.program_ids is not None
            or body.group_ids is not None
        ):
            _require_restricted_authority(user)
        if body.program_ids is not None:
            new_programs = await _resolve_programs(
                db, user, body.program_ids, {p.id for p in collection.programs},
            )
        if body.group_ids is not None:
            new_groups = await _resolve_groups(
                db, user, body.group_ids, {g.id for g in collection.groups},
            )
    else:
        if body.program_ids or body.group_ids:
            raise HTTPException(
                422,
                "program_ids/group_ids may only be set when visibility is 'restricted'",
            )
        new_programs, new_groups = [], []

    await _bump_version_or_409(db, ctx, collection, body.version)
    if body.name is not None:
        collection.name = body.name
    if "description" in fields:
        collection.description = body.description
    if body.visibility is not None:
        collection.visibility = body.visibility
    if new_programs is not None:
        collection.programs = new_programs
    if new_groups is not None:
        collection.groups = new_groups
    await db.commit()
    await db.refresh(collection)
    return collection_out(ctx, collection)


@router.delete("/{collection_id}", status_code=204)
async def delete_collection(
    collection_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    ctx, collection = await get_visible_collection_or_404(db, user, collection_id)
    if not can_delete_collection(user, collection):
        raise HTTPException(
            status_code=403, detail="You may not delete this collection"
        )
    await db.delete(collection)
    await db.commit()
    return Response(status_code=204)


@router.put("/{collection_id}/images", response_model=CollectionOut)
async def replace_collection_images(
    collection_id: int,
    body: CollectionImagesUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """Replace the ordered image list (add / remove / reorder in one call).

    Members the caller cannot view are never in ``image_ids`` (GET omits them
    and naming one is 422); they are retained after the submitted list rather
    than dropped, and still count toward the synchronized cap.
    """
    ctx, collection = await get_editable_collection_or_error(db, user, collection_id)
    unseen = _unseen_links(ctx, collection)
    images = await _resolve_images(
        db, ctx, collection.type, body.image_ids, retained=len(unseen)
    )
    await _bump_version_or_409(db, ctx, collection, body.version)
    _replace_image_links(collection, images, unseen)
    await db.commit()
    await db.refresh(collection)
    return collection_out(ctx, collection)


@router.put("/{collection_id}/viewport", response_model=CollectionOut)
async def replace_collection_viewport(
    collection_id: int,
    body: CollectionViewportUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """Replace ``viewport_state`` wholesale — the stored JSONB is overwritten,
    never merged key-by-key."""
    ctx, collection = await get_editable_collection_or_error(db, user, collection_id)
    await _bump_version_or_409(db, ctx, collection, body.version)
    collection.viewport_state = dict(body.viewport_state)
    await db.commit()
    await db.refresh(collection)
    return collection_out(ctx, collection)


# ── Ownership transfer ────────────────────────────────────────────────────


async def _resolve_transfer_target(
    db: AsyncSession, user: User, body: CollectionTransfer,
) -> tuple[User | None, Program | None]:
    """Resolve the new owner named by *body* as ``(user, None)`` or
    ``(None, program)``.

    Only admins may assign a user owner (403 otherwise), and that user must
    exist and be active (422). A program owner must exist (422) and pass
    ``can_attach_program_to_collection`` (403): admins any program,
    instructors only programs they belong to.
    """
    if body.user_id is not None:
        if user.role != "admin":
            raise HTTPException(
                status_code=403,
                detail="Only admins may transfer a collection to a user",
            )
        new_owner = await db.get(User, body.user_id)
        if new_owner is None:
            raise HTTPException(422, f"Invalid user ID: {body.user_id}")
        if not new_owner.active:
            raise HTTPException(
                422, "Collections cannot be transferred to a deactivated user"
            )
        return new_owner, None

    new_program = await db.get(Program, body.program_id)
    if new_program is None:
        raise HTTPException(422, f"Invalid program ID: {body.program_id}")
    if not can_attach_program_to_collection(user, new_program.id):
        raise HTTPException(
            403,
            f"You may only transfer to programs you belong to ({new_program.name})",
        )
    return None, new_program


@router.post("/{collection_id}/transfer", response_model=CollectionOut)
async def transfer_collection(
    collection_id: int,
    body: CollectionTransfer,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """Reassign ownership to exactly one of ``user_id`` / ``program_id``.

    404 when the caller cannot view the collection, 403 when they can view
    it but fail ``can_transfer_collection`` (students and staff always;
    instructors unless they own it or belong to its owning program;
    orphaned collections are admin-only). The other owner column is cleared
    and ``version`` advances under the same optimistic-concurrency rule as
    PATCH.
    """
    ctx, collection = await get_visible_collection_or_404(db, user, collection_id)
    if not can_transfer_collection(user, collection):
        raise HTTPException(
            status_code=403, detail="You may not transfer this collection"
        )
    new_owner, new_program = await _resolve_transfer_target(db, user, body)
    await _bump_version_or_409(db, ctx, collection, body.version)
    collection.user_id = new_owner.id if new_owner is not None else None
    collection.owner = new_owner
    collection.owner_program_id = new_program.id if new_program is not None else None
    collection.owner_program = new_program
    await db.commit()
    await db.refresh(collection)
    return collection_out(ctx, collection)
