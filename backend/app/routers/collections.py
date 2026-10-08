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

Ownership is the ``collection_owners`` user set plus the optional
``owner_program_id`` program (#1531). ``PUT …/owners`` wholesale-replaces
the user-owner set and ``POST …/transfer`` reassigns program ownership
(setting a program clears the user-owner rows; ``program_id: null`` clears
it and 422s when that would orphan). Both are gated by
``authz.can_transfer_collection``: admins may manage owners of any
collection; instructors only collections they own/co-own or that belong to
one of their programs — and transfer targets limited to their own programs.
Owner targets for ``PUT /owners`` may be any active user. Collections with
no owner rows AND no program owner are orphaned (admin-only until
reassigned); ``collections.user_id`` is creator audit, not ownership.

Browse placement (epic #1525 / #1527): ``category_id`` files a collection
into the category tree (``None`` = unfiled, not on Browse). ``POST
…/{id}/move`` is admin/instructor-only and independent of ownership — filing
is curatorial like moving images/categories — bumps affected category
tile-order scope revisions (revision-then-rows lock order) and the browse ETag
revision, and carries the same ``version`` optimistic-concurrency token as
PATCH.
Serialization/visibility helpers live in ``app.collection_views`` so the
category tree can embed collection summaries without importing this router.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select, update as sql_update
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user, require_role
from ..authz import (
    can_attach_group_to_collection,
    can_attach_program_to_collection,
    can_change_collection_scope,
    can_delete_collection,
    can_edit_collection,
    can_hide_collection,
    can_transfer_collection,
)
from ..browse_state import bump_browse_revision
from ..collection_views import (
    _ViewerContext,
    collection_out,
    collection_summary_out,
    get_visible_collection_or_404,
)
from ..database import get_db, settings
from ..models import (
    COLLECTION_TYPES,
    SYNCHRONIZED_COLLECTION_MAX_IMAGES,
    Category,
    Collection,
    CollectionImage,
    Group,
    Image,
    Program,
    User,
)
from ..schemas import (
    CollectionBulkDelete,
    CollectionBulkUpdate,
    CollectionCreate,
    CollectionImagesUpdate,
    CollectionMove,
    CollectionOut,
    CollectionOwnersUpdate,
    CollectionSummaryOut,
    CollectionTransfer,
    CollectionUpdate,
    CollectionViewportUpdate,
)
from ..tile_order import bump_scopes, collection_scope_keys

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


@router.get("", response_model=list[CollectionSummaryOut])
async def list_collections(
    user: Annotated[User, Depends(get_current_user)],
    type: str | None = None,
    mine: bool = False,
    owner_user_id: int | None = None,
    owner_program_id: int | None = None,
    orphaned: bool = False,
    uncategorized: bool = False,
    limit: Annotated[int | None, Query(ge=1, le=100)] = None,
    db: AsyncSession = Depends(get_db),
):
    """List collections visible to the caller (server-side filtered).

    ``orphaned=true`` (collections with no user-owner rows and no program
    owner — e.g. after a program delete) is an admin-only filter; other
    roles receive 403. ``mine`` / ``owner_user_id`` match
    ``collection_owners`` membership (#1531). ``uncategorized=true`` selects
    the unfiled queue: collections not shown on Browse because their
    ``category_id`` is null. ``limit`` is applied after visibility filtering,
    so inaccessible collections do not consume result slots.
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
        stmt = stmt.where(Collection.owners.any(User.id == user.id))
    if owner_user_id is not None:
        stmt = stmt.where(Collection.owners.any(User.id == owner_user_id))
    if owner_program_id is not None:
        stmt = stmt.where(Collection.owner_program_id == owner_program_id)
    if orphaned:
        stmt = stmt.where(
            ~Collection.owners.any(), Collection.owner_program_id.is_(None)
        )
    if uncategorized:
        stmt = stmt.where(Collection.category_id.is_(None))
    stmt = stmt.order_by(Collection.updated_at.desc(), Collection.id.desc())

    collections = (await db.execute(stmt)).scalars().unique().all()
    ctx = await _ViewerContext.build(db, user)
    visible = [c for c in collections if ctx.can_view(c)]
    if limit is not None:
        visible = visible[:limit]
    return [collection_summary_out(ctx, c) for c in visible]


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
    """Create a collection owned by the caller.

    Admins and instructors must file new collections into an existing Browse
    category. Other authenticated roles may create only unfiled collections.
    The caller becomes the first user owner and is recorded as creator
    (``collections.user_id`` audit). ``restricted`` visibility additionally
    needs attach authority over every program/group id.
    """
    ctx = await _ViewerContext.build(db, user)
    if user.role in {"admin", "instructor"}:
        if body.category_id is None:
            raise HTTPException(
                status_code=422,
                detail="A category is required when creating a collection",
            )
        if await db.get(Category, body.category_id) is None:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid category ID: {body.category_id}",
            )
        affected = collection_scope_keys({body.category_id})
        if affected:
            await bump_scopes(db, affected)
    elif body.category_id is not None:
        raise HTTPException(
            status_code=403,
            detail="Only admins and instructors may file collections",
        )
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
        category_id=body.category_id,
        # user_id is the creator audit column (#1531); ownership is the
        # ``owners`` row added below.
        user_id=user.id,
        sort_order=0,
        viewport_state={},
        version=1,
    )
    collection.owners = [user]
    collection.programs = progs
    collection.groups = grps
    _replace_image_links(collection, images)
    db.add(collection)
    if body.category_id is not None:
        await bump_browse_revision(db)
    await db.commit()
    await db.refresh(collection)
    return collection_out(ctx, collection)


# ── Bulk operations (#1578) ───────────────────────────────────────────────
# Registered before ``/{collection_id}`` so "bulk" is never parsed as an id.


async def _select_collections_or_404(
    db: AsyncSession, collection_ids: list[int]
) -> list[Collection]:
    """Load the requested collection rows; 404 when any id is missing."""
    collections = (
        await db.execute(
            select(Collection).where(Collection.id.in_(collection_ids))
        )
    ).scalars().all()
    if len(collections) != len(set(collection_ids)):
        raise HTTPException(404, "One or more collections not found")
    return collections


async def _lock_and_verify_unchanged(
    db: AsyncSession,
    collection_ids: list[int],
    snapshot: dict[int, int | None],
) -> list[Collection]:
    """FOR UPDATE re-read of the bulk target rows, locked after the scope
    bumps so the scope → row → browse lock order used by ``…/{id}/move``
    and ``DELETE`` is preserved.

    Between the unlocked read and this lock another transaction may have
    moved or deleted a row — its real source scope would then be missing
    from the bumped set, so ``populate_existing`` refreshes the rows under
    the lock and any drift is a 409 for the caller to retry with fresh
    state rather than a silently skipped tile-order invalidation.
    """
    locked = (
        await db.execute(
            select(Collection)
            .where(Collection.id.in_(collection_ids))
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalars().all()
    if len(locked) != len(snapshot) or any(
        c.category_id != snapshot[c.id] for c in locked
    ):
        raise HTTPException(
            409,
            "One or more selected collections changed during the bulk "
            "operation — refresh and retry",
        )
    return locked


@router.patch("/bulk", response_model=list[CollectionSummaryOut])
async def bulk_update_collections(
    body: CollectionBulkUpdate,
    user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
):
    """Bulk-update curatorial fields for multiple collections (#1578).

    Both fields are curatorial like ``POST …/{id}/move`` and a hidden-only
    PATCH — ``category_id`` refiles every collection (``null`` = Browse
    root) and ``hidden`` hides/shows for students — so one role gate
    covers the call regardless of ownership. Scope fields
    (``visibility``/``program_ids``/``group_ids``) are deliberately not
    bulk-editable: scope authority is per-collection (sole owner vs
    co-owner) and ``restricted`` needs per-collection attach lists.

    Atomic: every id must resolve (404) and ``category_id`` must exist
    (422) before any write. ``category_id=null`` unfiles the selected
    collections from Browse. Only filed source/destination scopes are
    invalidated, and a concurrent move/delete between the read and the row
    lock is a 409 rather than a missed scope bump. Like
    ``PATCH /images/bulk`` there is no per-row ``version`` token; the row
    lock plus ``populate_existing`` makes the loaded ``version`` the
    committed-latest, so a plain increment cannot collide with a racing
    write, and a no-op edit advances nothing.
    """
    collections = await _select_collections_or_404(db, body.collection_ids)
    provided = body.model_fields_set
    category_provided = "category_id" in provided
    hidden_provided = "hidden" in provided
    new_category = body.category_id

    if category_provided and new_category is not None:
        if await db.get(Category, new_category) is None:
            raise HTTPException(
                422, f"Invalid category ID: {new_category}"
            )

    snapshot = {c.id: c.category_id for c in collections}
    if category_provided:
        # Speculative sources from the unlocked read; the locked re-read
        # below turns real-source drift into a 409, so an over-broad bump
        # is harmless while a missed one is not.
        moved = [
            cid for cid, src in snapshot.items() if src != new_category
        ]
        if moved:
            affected = collection_scope_keys(
                {snapshot[cid] for cid in moved} | {new_category}
            )
            if affected:
                await bump_scopes(db, affected)

    locked = await _lock_and_verify_unchanged(
        db, body.collection_ids, snapshot
    )

    changed = [
        c
        for c in locked
        if (category_provided and c.category_id != new_category)
        or (hidden_provided and c.hidden != body.hidden)
    ]
    for c in changed:
        if category_provided:
            c.category_id = new_category
        if hidden_provided:
            c.hidden = body.hidden
        # ``populate_existing`` under FOR UPDATE read the committed-latest
        # version, so this increment cannot duplicate a racing write.
        c.version += 1
    if changed:
        # Both fields are tile-visible: ``category_id`` is scope membership
        # and ``hidden`` drops the tile for non-owner students.
        await bump_browse_revision(db)
    await db.commit()
    # ``updated_at`` is SQL-generated (onupdate=func.now()) — refresh the
    # changed rows post-commit like ``update_collection`` so the response
    # carries the committed modification time.
    for c in changed:
        await db.refresh(c)
    ctx = await _ViewerContext.build(db, user)
    by_id = {c.id: c for c in collections}
    return [
        collection_summary_out(ctx, by_id[cid])
        for cid in dict.fromkeys(body.collection_ids)
    ]


@router.delete("/bulk", status_code=204)
async def bulk_delete_collections(
    body: CollectionBulkDelete,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """Bulk-delete collections (#1578).

    Unlike ``DELETE /images/bulk`` (curator-only) authority stays
    per-collection so owners keep the single-delete contract at scale:
    every id must resolve and be viewable (404 — private ids cannot be
    probed) and pass ``can_delete_collection`` (403). The call is atomic —
    one failure deletes nothing — and a concurrent move/delete between the
    read and the row lock is a 409 rather than a missed scope bump.
    """
    collections = await _select_collections_or_404(db, body.collection_ids)
    ctx = await _ViewerContext.build(db, user)
    for c in collections:
        if not ctx.can_view(c):
            raise HTTPException(404, "Collection not found")
    for c in collections:
        if not can_delete_collection(user, c):
            raise HTTPException(
                403,
                "You may not delete one or more of the selected collections",
            )
    # Lock order mirrors the single delete: scope revisions first, then the
    # rows, then the browse revision. The locked re-read guards the
    # speculative source set against concurrent moves.
    snapshot = {c.id: c.category_id for c in collections}
    affected = collection_scope_keys(snapshot.values())
    if affected:
        await bump_scopes(db, affected)
    locked = await _lock_and_verify_unchanged(
        db, body.collection_ids, snapshot
    )
    for c in locked:
        await db.delete(c)
    await bump_browse_revision(db)
    await db.commit()
    return Response(status_code=204)


@router.patch("/{collection_id}", response_model=CollectionOut)
async def update_collection(
    collection_id: int,
    body: CollectionUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """Update name / description / visibility / scope. ``type`` is immutable.

    Field-level authority (#1531): content fields (``name`` / ``description``
    / ``type`` echo) require ``can_edit_collection``; scope fields
    (``visibility`` / ``program_ids`` / ``group_ids``) require
    ``can_change_collection_scope`` — a student or staff co-owner may edit
    content but not scope, while a sole owner holds both. A
    ``version``-only PATCH counts as a content write.

    Leaving ``restricted`` clears the program/group scope; sending a
    non-empty scope for a non-restricted collection is 422. Newly attached
    programs/groups re-check attach authority (403).
    """
    ctx, collection = await get_visible_collection_or_404(db, user, collection_id)
    fields = body.model_dump(exclude_unset=True)
    scope_touched = (
        body.visibility is not None
        or body.program_ids is not None
        or body.group_ids is not None
    )
    # Hide is curatorial (#1559): admins/instructors may hide any collection
    # regardless of ownership — a hidden-only PATCH skips the owner-edit
    # gate below, while owners themselves may not unhide. Keyed on whether
    # the field was supplied so a curator's repeat/no-op hide succeeds too.
    hidden_supplied = body.hidden is not None
    hidden_only = set(fields) <= {"hidden", "version"}
    if hidden_supplied and not can_hide_collection(user, collection):
        raise HTTPException(
            status_code=403,
            detail="Only admins and instructors may hide collections",
        )
    if scope_touched:
        # Scope rights imply content rights for every role (a student sole
        # owner is still an owner), so one check covers mixed bodies.
        if not can_change_collection_scope(user, collection):
            raise HTTPException(
                status_code=403,
                detail="You may not change this collection's scope",
            )
    elif not can_edit_collection(user, collection) and not (
        hidden_supplied and hidden_only
    ):
        raise HTTPException(
            status_code=403, detail="You may not edit this collection"
        )
    if body.type is not None and body.type != collection.type:
        raise HTTPException(422, "Collection type is immutable")

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
    if body.hidden is not None:
        collection.hidden = body.hidden
    if new_programs is not None:
        collection.programs = new_programs
    if new_groups is not None:
        collection.groups = new_groups
    # Tile-visible fields (name/visibility/counts rendered on Browse tiles)
    # may have changed — invalidate the category-tree ETag.
    await bump_browse_revision(db)
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
    # Lock order: scope revision(s) first (tile-order convention), then the
    # collection row, then the browse revision last — matching PATCH, which
    # locks the collection row via its CAS before browse_state. Taking
    # browse_state before the row would deadlock against a concurrent PATCH.
    affected = collection_scope_keys({collection.category_id})
    if affected:
        await bump_scopes(db, affected)
    await db.delete(collection)
    await bump_browse_revision(db)
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
    # Member count and cover thumbnail are shown on the Browse tile.
    await bump_browse_revision(db)
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


# ── Browse placement ──────────────────────────────────────────────────────


@router.post("/{collection_id}/move", response_model=CollectionOut)
async def move_collection(
    collection_id: int,
    body: CollectionMove,
    user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
):
    """File the collection into a category; ``category_id=null`` unfiles it
    and removes its tile from Browse.

    Filing is curatorial — any admin/instructor may move any collection,
    independent of ownership (same authority as moving images/categories),
    so this is a dedicated endpoint rather than a ``category_id`` field on
    the owner-gated PATCH. The move keeps the collection's ``sort_order``
    (``PUT /api/tile-order`` re-normalizes the destination scope) and
    carries the same ``version`` optimistic-concurrency token as PATCH.

    Lock order: scope revisions first (the same revision-then-rows
    convention as ``PUT /api/tile-order``), then the collection row via the
    version CAS, then the browse revision — matching PATCH's
    row-then-browse order so a concurrent PATCH cannot deadlock against a
    move. A no-op move (same category) skips both revision bumps while
    still running the CAS.
    """
    collection = await db.get(Collection, collection_id)
    if collection is None:
        raise HTTPException(status_code=404, detail="Collection not found")
    if body.category_id is not None:
        if await db.get(Category, body.category_id) is None:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid category ID: {body.category_id}",
            )
    moved = collection.category_id != body.category_id
    if moved:
        affected = collection_scope_keys(
            {collection.category_id, body.category_id}
        )
        if affected:
            await bump_scopes(db, affected)
    ctx = await _ViewerContext.build(db, user)
    await _bump_version_or_409(db, ctx, collection, body.version)
    if moved:
        await bump_browse_revision(db)
    collection.category_id = body.category_id
    await db.commit()
    await db.refresh(collection)
    return collection_out(ctx, collection)


# ── Ownership (#1531) ─────────────────────────────────────────────────────


async def _resolve_owner_users(
    db: AsyncSession, user_ids: list[int]
) -> list[User]:
    """Resolve the target user-owner set for ``PUT /owners``.

    Targets may be any *active* user — co-ownership is deliberately not
    role-restricted (an instructor may add students as co-owners). Unknown
    or deactivated ids are 422.
    """
    if not user_ids:
        return []
    users = (
        await db.execute(select(User).where(User.id.in_(user_ids)))
    ).scalars().all()
    by_id = {u.id: u for u in users}
    missing = set(user_ids) - set(by_id)
    if missing:
        raise HTTPException(422, f"Invalid user IDs: {sorted(missing)}")
    inactive = sorted(u.id for u in users if not u.active)
    if inactive:
        raise HTTPException(
            422,
            "Collections cannot be owned by deactivated users: "
            f"{inactive}",
        )
    return [by_id[uid] for uid in user_ids]


@router.put("/{collection_id}/owners", response_model=CollectionOut)
async def replace_collection_owners(
    collection_id: int,
    body: CollectionOwnersUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """Replace the user-owner set wholesale (add/remove co-owners).

    404 when the caller cannot view the collection, 403 when they can view
    it but fail ``can_transfer_collection`` (staff and students always —
    even sole-owner students). 422 when the resulting set is empty and no
    program owns the collection (would orphan). ``version`` advances under
    the same optimistic-concurrency rule as PATCH.
    """
    ctx, collection = await get_visible_collection_or_404(db, user, collection_id)
    if not can_transfer_collection(user, collection):
        raise HTTPException(
            status_code=403, detail="You may not manage this collection's owners"
        )
    owners = await _resolve_owner_users(db, body.user_ids)
    if not owners and collection.owner_program_id is None:
        raise HTTPException(
            status_code=422,
            detail="A collection must have at least one user owner or an "
            "owning program",
        )
    await _bump_version_or_409(db, ctx, collection, body.version)
    collection.owners = owners
    # The owner name/chip is rendered on the Browse tile.
    await bump_browse_revision(db)
    await db.commit()
    await db.refresh(collection)
    return collection_out(ctx, collection)


@router.post("/{collection_id}/transfer", response_model=CollectionOut)
async def transfer_collection(
    collection_id: int,
    body: CollectionTransfer,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """Reassign *program* ownership; user ownership moved to ``PUT /owners``.

    ``program_id`` set: the program becomes the owning program and the
    user-owner rows are cleared (422 unknown id, 403 when the caller may
    not attach that program — admins any, instructors only their own).
    ``program_id: null``: clears the program owner, keeping the user-owner
    rows; 422 when no user-owner rows exist (would orphan).

    404 when the caller cannot view the collection, 403 when they can view
    it but fail ``can_transfer_collection`` (students and staff always;
    instructors unless they own/co-own it or belong to its owning program;
    orphaned collections are admin-only). ``version`` advances under the
    same optimistic-concurrency rule as PATCH.
    """
    ctx, collection = await get_visible_collection_or_404(db, user, collection_id)
    if not can_transfer_collection(user, collection):
        raise HTTPException(
            status_code=403, detail="You may not transfer this collection"
        )
    if body.program_id is None:
        if not collection.owners:
            raise HTTPException(
                status_code=422,
                detail="Cannot clear the program owner while the collection "
                "has no user owners",
            )
        new_program = None
    else:
        new_program = await db.get(Program, body.program_id)
        if new_program is None:
            raise HTTPException(422, f"Invalid program ID: {body.program_id}")
        if not can_attach_program_to_collection(user, new_program.id):
            raise HTTPException(
                403,
                f"You may only transfer to programs you belong to ({new_program.name})",
            )
    await _bump_version_or_409(db, ctx, collection, body.version)
    collection.owner_program_id = body.program_id
    collection.owner_program = new_program
    if new_program is not None:
        # Transfer-to-program makes the program the sole owner (#1531).
        collection.owners = []
    # The owner name/chip is rendered on the Browse tile.
    await bump_browse_revision(db)
    await db.commit()
    await db.refresh(collection)
    return collection_out(ctx, collection)
