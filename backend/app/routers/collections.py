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

``GET /api/collections`` carries a weak revision-based ETag (#1619),
``W/"collections-{browse_revision}-{hash}"``, where the hash covers the
viewer's id/role/programs/groups and the canonical query string. A matching
``If-None-Match`` short-circuits to ``304 Not Modified`` before the
collection select runs; responses also set ``Cache-Control: private,
no-cache`` and ``X-Browse-Revision``. Every mutation that changes a
list-visible row bumps the browse revision — including writes to unfiled
collections, which appear in the list even though they never render on
Browse.

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

import hashlib
import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from opentelemetry import metrics
from sqlalchemy import func, or_, select, update as sql_update
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import lazyload, selectinload

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
from ..browse_state import bump_browse_revision, get_browse_revision
from ..collection_views import (
    _ViewerContext,
    _owners_out,
    collection_out,
    collection_summary_out,
    get_visible_collection_or_404,
    owner_label,
)
from ..database import get_db, settings
from ..models import (
    COLLECTION_TYPES,
    COLLECTION_VISIBILITIES,
    STUDENT_MAX_COLLECTIONS_PER_TYPE,
    STUDENT_SEQUENCE_MAX_IMAGES,
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
    CollectionGraphCategoryOut,
    CollectionGraphImageOut,
    CollectionGraphNodeOut,
    CollectionGraphOut,
    CollectionImagesUpdate,
    CollectionMove,
    CollectionOut,
    CollectionOwnersUpdate,
    CollectionOwnerOut,
    CollectionSummaryOut,
    CollectionTransfer,
    CollectionUpdate,
    CollectionViewportUpdate,
    CollectionsGraphOut,
)
from ..tile_order import bump_scopes, collection_scope_keys

_meter = metrics.get_meter(__name__)

# Collections-list 304 short-circuit observability (#1619), mirroring the
# browse-tree pair in routers/categories.py: the counter splits successful
# full builds from ETag short-circuits; the histogram measures the avoided
# work so "work saved" ≈ not_modified count × mean build duration. `outcome`
# is on the metric-label allowlist in docs/observability-conventions.md.
_collections_list_requests = _meter.create_counter(
    "hriv.collections_list.requests",
    description="GET /api/collections responses by outcome",
    unit="1",
)
_collections_list_build_duration = _meter.create_histogram(
    "hriv.collections_list.build.duration",
    description="Collection list build duration on non-short-circuited requests",
    unit="s",
)


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


# ── List search / sort / paging (#1631) ───────────────────────────────────

_LIST_SORT_KEYS = frozenset({
    "id",
    "name",
    "type",
    "visibility",
    "description",
    "category",
    "image_count",
    "owner",
    "hidden",
    "created_at",
    "updated_at",
})
# Sorts whose natural reading order is descending when ``direction`` is
# omitted (recency / magnitude); text columns default to ascending.
_LIST_DESC_DEFAULT = frozenset({"id", "image_count", "created_at", "updated_at"})


def _category_label_path(by_id: dict[int, Category], category: Category) -> str:
    """``›``-joined label path from the root down to *category*."""
    labels: list[str] = []
    node: Category | None = category
    while node is not None:
        labels.append(node.label)
        node = by_id.get(node.parent_id)
    return " › ".join(reversed(labels))


def _category_with_descendants(
    by_id: dict[int, Category], root_ids: list[int]
) -> set[int]:
    """*root_ids* plus every descendant id, walked via ``parent_id``."""
    children: dict[int | None, list[int]] = {}
    for cat in by_id.values():
        children.setdefault(cat.parent_id, []).append(cat.id)
    allowed: set[int] = set()
    stack = list(root_ids)
    while stack:
        cat_id = stack.pop()
        if cat_id in allowed:
            continue
        allowed.add(cat_id)
        stack.extend(children.get(cat_id, []))
    return allowed


def _category_hidden(
    by_id: dict[int, Category], category_id: int | None
) -> bool:
    """True when the filed category or any ancestor is ``status="hidden"``
    (mirrors the hidden-subtree rule in ``app.visibility``)."""
    node = by_id.get(category_id) if category_id is not None else None
    while node is not None:
        if node.status == "hidden":
            return True
        node = by_id.get(node.parent_id)
    return False


def _list_sort_key(
    collection: Collection,
    sort: str,
    cat_by_id: dict[int, Category],
    image_counts: dict[int, int],
) -> object:
    """Primary sort key for one collection (ties break on ``id``)."""
    if sort == "name":
        return collection.name.casefold()
    if sort == "type":
        return collection.type
    if sort == "visibility":
        return collection.visibility
    if sort == "description":
        return (collection.description or "").casefold()
    if sort == "owner":
        return owner_label(collection).casefold()
    if sort == "category":
        cat = (
            cat_by_id.get(collection.category_id)
            if collection.category_id is not None
            else None
        )
        label = "Unfiled" if cat is None else _category_label_path(cat_by_id, cat)
        return label.casefold()
    if sort == "hidden":
        return bool(
            collection.hidden
            or _category_hidden(cat_by_id, collection.category_id)
        )
    if sort == "image_count":
        return image_counts.get(collection.id, 0)
    if sort == "id":
        return collection.id
    if sort == "created_at":
        return collection.created_at
    # sort is validated to the allowlist; the only remaining key.
    return collection.updated_at


async def _caller_visible_image_counts(
    db: AsyncSession, ctx: _ViewerContext, collection_ids: list[int]
) -> dict[int, int]:
    """Grouped count of caller-visible members per collection — the
    SQL twin of ``len(ctx.visible_images(c))`` without loading image rows.
    Students get the ``active`` + non-excluded-category clauses of
    ``_ViewerContext.can_view_image``; everyone else counts every member."""
    if not collection_ids:
        return {}
    stmt = (
        select(CollectionImage.collection_id, func.count())
        .join(Image, Image.id == CollectionImage.image_id)
        .where(CollectionImage.collection_id.in_(collection_ids))
        .group_by(CollectionImage.collection_id)
    )
    if ctx.excluded_category_ids is not None:
        stmt = stmt.where(Image.active.is_(True))
        if ctx.excluded_category_ids:
            stmt = stmt.where(
                or_(
                    Image.category_id.is_(None),
                    Image.category_id.not_in(ctx.excluded_category_ids),
                )
            )
    return dict((await db.execute(stmt)).all())


def _list_etag(user: User, browse_revision: int, query_fragment: str) -> str:
    """Weak ETag for one (viewer, canonical query) pair at *browse_revision*.

    The viewer fragment covers id, role, program and group membership for
    every role — not just students — because ``permissions.can_transfer``
    depends on instructor program membership and ``mine``/owner permissions
    depend on the user id (#1619).
    """
    programs = ",".join(str(i) for i in sorted({p.id for p in user.programs}))
    groups = ",".join(str(i) for i in sorted({g.id for g in user.groups}))
    viewer = f"{user.id}|{user.role}|{programs}|{groups}"
    digest = hashlib.md5(f"{viewer}\n{query_fragment}".encode()).hexdigest()
    return f'W/"collections-{browse_revision}-{digest}"'


@router.get("", response_model=list[CollectionSummaryOut])
async def list_collections(
    user: Annotated[User, Depends(get_current_user)],
    type: str | None = None,
    mine: bool = False,
    owner_user_id: int | None = None,
    owner_program_id: int | None = None,
    orphaned: bool = False,
    uncategorized: bool = False,
    q: str | None = None,
    visibility: Annotated[list[str] | None, Query()] = None,
    category_id: Annotated[list[int] | None, Query()] = None,
    sort: str = "updated_at",
    direction: str | None = None,
    limit: Annotated[int | None, Query(ge=1, le=100)] = None,
    page: Annotated[int | None, Query(ge=1)] = None,
    page_size: Annotated[int | None, Query(ge=1, le=200)] = None,
    request: Request = None,  # type: ignore[assignment]
    response: Response = None,  # type: ignore[assignment]
    db: AsyncSession = Depends(get_db),
):
    """List collections visible to the caller (server-side filtered).

    ``orphaned=true`` (collections with no user-owner rows and no program
    owner — e.g. after a program delete) is an admin-only filter; other
    roles receive 403. ``mine`` / ``owner_user_id`` match
    ``collection_owners`` membership (#1531). ``uncategorized=true`` selects
    the unfiled queue: collections not shown on Browse because their
    ``category_id`` is null.

    Search / sort / paging (#1631) all run after the visibility gate:

    * ``q`` — case-insensitive substring over name, description and the
      owner label; ``%``/``_`` are literal, blank values are ignored.
    * ``visibility`` — repeatable; each value must be private, public or
      restricted (**422** otherwise).
    * ``category_id`` — repeatable, ancestor-aware: matches collections
      filed in a listed category or any descendant; unfiled never matches.
    * ``sort`` — one of ``id``, ``name``, ``type``, ``visibility``,
      ``description``, ``category`` (``›``-joined label path, unfiled sorts
      as "Unfiled"), ``image_count`` (caller-visible members), ``owner``,
      ``hidden`` (collection flag or a hidden ancestor category),
      ``created_at``, ``updated_at``; anything else is **422**.
      ``direction`` is ``asc``/``desc`` (default ``desc`` for ``id``,
      ``image_count``, ``created_at``, ``updated_at``; ``asc`` otherwise);
      ties always break on ``id`` in the same direction.
    * ``page`` + ``page_size`` slice the sorted result; ``page`` without
      ``page_size`` is **422**. The pre-slice count is reported in the
      ``X-Total-Count`` header. ``limit`` (the drawer/shelf cap) may not be
      combined with ``page``/``page_size`` (**422**) and is applied after
      visibility filtering, so inaccessible collections do not consume
      result slots.

    Member images are only loaded for the returned slice: the first query
    skips ``image_links`` (``lazyload``) and the page rows are hydrated with
    a second ``populate_existing`` select.

    Conditional requests (#1619): the response carries a weak
    ``W/"collections-{revision}-{hash}"`` ETag (viewer + canonical query)
    plus ``Cache-Control: private, no-cache`` and ``X-Browse-Revision``. A
    matching ``If-None-Match`` (or ``*``) returns ``304`` before the
    collection select runs.
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
    for value in visibility or []:
        if value not in COLLECTION_VISIBILITIES:
            raise HTTPException(
                status_code=422,
                detail=(
                    "visibility must be one of "
                    f"{', '.join(COLLECTION_VISIBILITIES)}"
                ),
            )
    if sort not in _LIST_SORT_KEYS:
        raise HTTPException(
            status_code=422,
            detail=f"sort must be one of {', '.join(sorted(_LIST_SORT_KEYS))}",
        )
    if direction is not None and direction not in ("asc", "desc"):
        raise HTTPException(
            status_code=422, detail="direction must be asc or desc"
        )
    if page is not None and page_size is None:
        raise HTTPException(
            status_code=422, detail="page requires page_size"
        )
    if limit is not None and (page is not None or page_size is not None):
        raise HTTPException(
            status_code=422,
            detail="limit cannot be combined with page/page_size",
        )

    # ── Browse-revision 304 short-circuit (#1619) ──
    # The list renders unfiled collections too, so every collection write —
    # filed or not — bumps the same browse revision the tree uses; a matching
    # ETag therefore proves this exact query result is unchanged.
    browse_revision = await get_browse_revision(db)
    query_fragment = "|".join(
        [
            str(type),
            str(mine),
            str(owner_user_id),
            str(owner_program_id),
            str(orphaned),
            str(uncategorized),
            (q or "").strip().casefold(),
            ",".join(sorted(visibility or [])),
            ",".join(str(i) for i in sorted(category_id or [])),
            str(sort),
            str(direction),
            str(limit),
            str(page),
            str(page_size),
        ]
    )
    etag = _list_etag(user, browse_revision, query_fragment)
    if response is not None:
        response.headers["ETag"] = etag
        response.headers["Cache-Control"] = "private, no-cache"
        response.headers["X-Browse-Revision"] = str(browse_revision)

    if request is not None:
        client_etags = request.headers.get("if-none-match", "")
        if client_etags == "*" or etag in [
            t.strip() for t in client_etags.split(",")
        ]:
            _collections_list_requests.add(1, {"outcome": "not_modified"})
            return Response(
                status_code=304,
                headers={
                    "ETag": etag,
                    "Cache-Control": "private, no-cache",
                    "X-Browse-Revision": str(browse_revision),
                },
            )

    build_started = time.monotonic()
    stmt = select(Collection).options(lazyload(Collection.image_links))
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

    needle = (q or "").strip().casefold()
    if needle:
        visible = [
            c
            for c in visible
            if needle in c.name.casefold()
            or needle in (c.description or "").casefold()
            or needle in owner_label(c).casefold()
        ]
    if visibility:
        wanted = set(visibility)
        visible = [c for c in visible if c.visibility in wanted]

    cat_by_id: dict[int, Category] = {}
    if category_id or sort in ("category", "hidden"):
        categories = (await db.execute(select(Category))).scalars().all()
        cat_by_id = {c.id: c for c in categories}
    if category_id:
        filed_in = _category_with_descendants(cat_by_id, category_id)
        visible = [c for c in visible if c.category_id in filed_in]

    image_counts = (
        await _caller_visible_image_counts(
            db, ctx, [c.id for c in visible]
        )
        if sort == "image_count"
        else {}
    )
    descending = (
        direction == "desc"
        if direction is not None
        else sort in _LIST_DESC_DEFAULT
    )
    visible.sort(
        key=lambda c: (
            _list_sort_key(c, sort, cat_by_id, image_counts),
            c.id,
        ),
        reverse=descending,
    )

    if response is not None:
        response.headers["X-Total-Count"] = str(len(visible))
    if page_size is not None:
        offset = (page - 1) * page_size if page is not None else 0
        visible = visible[offset:offset + page_size]
    elif limit is not None:
        visible = visible[:limit]

    if visible:
        hydrated = (
            (
                await db.execute(
                    select(Collection)
                    .where(Collection.id.in_([c.id for c in visible]))
                    .options(
                        selectinload(Collection.image_links)
                        .selectinload(CollectionImage.image)
                    )
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .unique()
            .all()
        )
        by_id = {c.id: c for c in hydrated}
        visible = [by_id.get(c.id, c) for c in visible]
    _collections_list_requests.add(1, {"outcome": "full"})
    _collections_list_build_duration.record(time.monotonic() - build_started)
    return [collection_summary_out(ctx, c) for c in visible]


# ── Graph endpoints (#1628) ───────────────────────────────────────────────
# ``/graph`` is registered before ``/{collection_id}`` so the literal segment
# is never parsed as an int path parameter (which would 422 every request).


def _graph_node(ctx: _ViewerContext, collection: Collection) -> CollectionGraphNodeOut:
    """Node payload for one collection; ``image_count`` counts only members
    the caller may see (visible-only, like ``collection_summary_out``)."""
    return CollectionGraphNodeOut(
        id=collection.id,
        name=collection.name,
        type=collection.type,
        image_count=len(ctx.visible_images(collection)),
        hidden=bool(collection.hidden),
        category_id=collection.category_id,
    )


async def _graph_categories(
    db: AsyncSession,
    ctx: _ViewerContext,
    category_ids: set[int] | None = None,
) -> list[CollectionGraphCategoryOut]:
    """Category nodes for ``order=3`` (#1633).

    Two queries total: one ``select(Category)`` for labels and the
    ``›``-joined label path (walked via ``parent_id``), and one grouped
    count of visible images per category. The count mirrors
    ``_ViewerContext.can_view_image`` (collection_views.py) without loading
    image rows: non-students see every image; students need ``active`` and
    the category outside their excluded set. Only categories with ≥1
    visible image are returned; *category_ids*, when given, narrows the
    result to that subset (the ``/{id}/graph`` local view).
    """
    categories = (await db.execute(select(Category))).scalars().all()
    by_id = {c.id: c for c in categories}
    count_stmt = (
        select(Image.category_id, func.count())
        .where(Image.category_id.isnot(None))
        .group_by(Image.category_id)
    )
    if ctx.excluded_category_ids is not None:
        count_stmt = count_stmt.where(Image.active.is_(True))
    counts = dict((await db.execute(count_stmt)).all())
    excluded = ctx.excluded_category_ids or set()

    nodes: list[CollectionGraphCategoryOut] = []
    for category_id, count in counts.items():
        if (
            count < 1
            or category_id in excluded
            or (category_ids is not None and category_id not in category_ids)
        ):
            continue
        category = by_id.get(category_id)
        if category is None:
            continue
        nodes.append(
            CollectionGraphCategoryOut(
                id=category_id,
                label=category.label,
                path=_category_label_path(by_id, category),
                image_count=count,
            )
        )
    return sorted(nodes, key=lambda n: n.id)


def _graph_image(
    image: Image, collection_ids: list[int]
) -> CollectionGraphImageOut:
    return CollectionGraphImageOut(
        id=image.id,
        name=image.name,
        collection_ids=collection_ids,
        category_id=image.category_id,
    )


@router.get("/graph", response_model=CollectionsGraphOut)
async def collections_graph(
    user: Annotated[User, Depends(get_current_user)],
    order: Annotated[int, Query(ge=1, le=3)] = 1,
    db: AsyncSession = Depends(get_db),
):
    """Structural graph for the Collections page.

    Nodes are exactly the collections an unfiltered ``GET /collections``
    would return. At ``order`` ≥ 2 each caller-visible member image is a
    node whose ``collection_ids`` list every visible collection containing
    it — edges are implied. At ``order=3`` every caller-visible category
    holding ≥1 visible image is a node too, including categories with no
    collection (isolated nodes). ``image_links`` /
    ``CollectionImage.image`` are selectin-loaded, so member loading adds
    two queries total, not per collection.
    """
    collections = (
        (await db.execute(
            select(Collection).order_by(
                Collection.updated_at.desc(), Collection.id.desc()
            )
        ))
        .scalars()
        .unique()
        .all()
    )
    ctx = await _ViewerContext.build(db, user)
    visible = [c for c in collections if ctx.can_view(c)]

    images: list[CollectionGraphImageOut] = []
    if order >= 2:
        by_id: dict[int, Image] = {}
        members: dict[int, list[int]] = {}
        for collection in visible:
            for image in ctx.visible_images(collection):
                by_id.setdefault(image.id, image)
                members.setdefault(image.id, []).append(collection.id)
        images = [
            _graph_image(by_id[image_id], sorted(collection_ids))
            for image_id, collection_ids in sorted(members.items())
        ]
    return CollectionsGraphOut(
        order=order,
        collections=[_graph_node(ctx, c) for c in visible],
        images=images,
        categories=(
            await _graph_categories(db, ctx) if order == 3 else []
        ),
    )


@router.get("/owners", response_model=list[CollectionOwnerOut])
async def list_collection_owners(
    user: Annotated[User, Depends(get_current_user)],
    type: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Distinct owners across the collections the caller may see (#1631).

    Backs the Owner facet: the frontend can no longer derive it from
    ``GET /api/collections`` now that the list pages server-side. Same
    visibility filtering and optional ``type`` query as the list (422 on an
    unknown type). User owners and owning programs are deduplicated across
    collections and sorted by (name, kind, id); ``CollectionOwnerOut`` is
    the same shape as a summary's ``owners`` entries.
    """
    if type is not None and type not in COLLECTION_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"type must be one of {', '.join(COLLECTION_TYPES)}",
        )
    stmt = select(Collection).options(lazyload(Collection.image_links))
    if type is not None:
        stmt = stmt.where(Collection.type == type)
    collections = (await db.execute(stmt)).scalars().unique().all()
    ctx = await _ViewerContext.build(db, user)
    seen: set[tuple[int | None, int | None]] = set()
    owners: list[CollectionOwnerOut] = []
    for collection in collections:
        if not ctx.can_view(collection):
            continue
        for owner in _owners_out(collection):
            key = (owner.user_id, owner.program_id)
            if key not in seen:
                seen.add(key)
                owners.append(owner)
    return sorted(
        owners,
        key=lambda o: (
            o.name.casefold(),
            "user" if o.user_id is not None else "program",
            o.user_id if o.user_id is not None else o.program_id,
        ),
    )


@router.get("/{collection_id}", response_model=CollectionOut)
async def get_collection(
    collection_id: int,
    user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    ctx, collection = await get_visible_collection_or_404(db, user, collection_id)
    return collection_out(ctx, collection)


@router.get("/{collection_id}/graph", response_model=CollectionGraphOut)
async def collection_graph(
    collection_id: int,
    user: Annotated[User, Depends(get_current_user)],
    order: Annotated[int, Query(ge=1, le=3)] = 1,
    db: AsyncSession = Depends(get_db),
):
    """Graph from one collection's perspective (the dialog view).

    ``images`` are the hub's caller-visible members in member order. At
    ``order`` ≥ 2 every visible collection sharing a visible member is added
    to ``collection_ids`` and to ``related_collections`` (deduplicated,
    excluding the hub), so the dialog can render them without extra
    requests; switching perspective fetches that collection's own graph.
    At ``order=3`` ``categories`` lists the categories of the hub's visible
    members (this view stays local — uncovered categories are a main-page
    concern).
    """
    ctx, collection = await get_visible_collection_or_404(
        db, user, collection_id
    )
    hub_images = ctx.visible_images(collection)
    hub_image_ids = {image.id for image in hub_images}
    members: dict[int, list[int]] = {
        image.id: [collection.id] for image in hub_images
    }

    related: list[Collection] = []
    if order >= 2 and hub_image_ids:
        others = (
            (await db.execute(
                select(Collection)
                .join(CollectionImage)
                .where(
                    CollectionImage.image_id.in_(hub_image_ids),
                    Collection.id != collection.id,
                )
            ))
            .scalars()
            .unique()
            .all()
        )
        related = [c for c in others if ctx.can_view(c)]
        for other in related:
            for image in ctx.visible_images(other):
                if image.id in hub_image_ids:
                    members[image.id].append(other.id)

    return CollectionGraphOut(
        order=order,
        collection=_graph_node(ctx, collection),
        images=[
            _graph_image(image, sorted(members[image.id]))
            for image in hub_images
        ],
        related_collections=[
            _graph_node(ctx, c)
            for c in sorted(related, key=lambda c: (c.name, c.id))
        ],
        categories=(
            await _graph_categories(
                db,
                ctx,
                {i.category_id for i in hub_images if i.category_id is not None},
            )
            if order == 3
            else []
        ),
    )


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


def _enforce_student_sequence_cap(
    user: User,
    collection_type: str,
    image_ids: list[int],
    retained: int,
    existing_ids: set[int],
) -> None:
    """Reject student sequence additions that would exceed the cap (#1583)."""
    if user.role != "student" or collection_type != "sequence":
        return
    if len(image_ids) + retained <= STUDENT_SEQUENCE_MAX_IMAGES:
        return
    if any(image_id not in existing_ids for image_id in image_ids):
        raise HTTPException(
            status_code=422,
            detail=(
                "Students may add at most "
                f"{STUDENT_SEQUENCE_MAX_IMAGES} images to a sequence collection"
            ),
        )


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
    elif body.category_id is not None:
        raise HTTPException(
            status_code=403,
            detail="Only admins and instructors may file collections",
        )
    if user.role == "student":
        await db.execute(
            select(User.id).where(User.id == user.id).with_for_update()
        )
        owned_count = (
            await db.execute(
                select(func.count())
                .select_from(Collection)
                .where(
                    Collection.type == body.type,
                    Collection.owners.any(User.id == user.id),
                )
            )
        ).scalar_one()
        if owned_count >= STUDENT_MAX_COLLECTIONS_PER_TYPE:
            raise HTTPException(
                status_code=422,
                detail=(
                    "Students may own at most "
                    f"{STUDENT_MAX_COLLECTIONS_PER_TYPE} {body.type} collections"
                ),
            )
    _enforce_student_sequence_cap(
        user,
        body.type,
        body.image_ids,
        retained=0,
        existing_ids=set(),
    )
    if body.visibility == "restricted":
        _require_restricted_authority(user)
    ctx = await _ViewerContext.build(db, user)
    progs: list[Program] = []
    grps: list[Group] = []
    if body.visibility == "restricted":
        progs = await _resolve_programs(db, user, body.program_ids, set())
        grps = await _resolve_groups(db, user, body.group_ids, set())
    images = await _resolve_images(db, ctx, body.type, body.image_ids)
    if body.category_id is not None:
        affected = collection_scope_keys({body.category_id})
        if affected:
            await bump_scopes(db, affected)

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
    # Unconditional: an unfiled collection never reaches Browse but still
    # appears in ``GET /api/collections``, whose ETag rides this revision
    # (#1619).
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

    if "cover_image_id" in fields and body.cover_image_id is not None:
        # The pinned cover must be a member the caller can actually view —
        # a cover the picker could not show would silently fall back to the
        # first member anyway, so naming one is a 422 (mirrors the
        # invisible-member rule on PUT /images).
        member_ids = {link.image_id for link in collection.image_links}
        visible_ids = {img.id for img in ctx.visible_images(collection)}
        if (
            body.cover_image_id not in member_ids
            or body.cover_image_id not in visible_ids
        ):
            raise HTTPException(
                422,
                "cover_image_id must reference an image in this collection",
            )

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
    if "cover_image_id" in fields:
        collection.cover_image_id = body.cover_image_id
        collection.cover_blank = False
    if "cover_blank" in fields:
        collection.cover_blank = bool(body.cover_blank)
        if collection.cover_blank:
            collection.cover_image_id = None
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
    existing_ids = {link.image_id for link in collection.image_links}
    _enforce_student_sequence_cap(
        user,
        collection.type,
        body.image_ids,
        retained=len(unseen),
        existing_ids=existing_ids,
    )
    images = await _resolve_images(
        db, ctx, collection.type, body.image_ids, retained=len(unseen)
    )
    await _bump_version_or_409(db, ctx, collection, body.version)
    _replace_image_links(collection, images, unseen)
    # A pinned cover that is no longer a member reverts to the first-member
    # fallback — a retained *unseen* member still counts, so the pin survives
    # edits by callers who cannot view it.
    member_ids = {link.image_id for link in collection.image_links}
    if (
        collection.cover_image_id is not None
        and collection.cover_image_id not in member_ids
    ):
        collection.cover_image_id = None
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
    # The CAS advances ``version``/``updated_at`` — both are in
    # ``CollectionSummaryOut`` and ``updated_at`` is the default list sort —
    # so the list ETag must invalidate even though tiles are unchanged
    # (#1619).
    await bump_browse_revision(db)
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
    move. A no-op move (same category) skips the scope bump while still
    running the CAS — and the CAS advances ``version``/``updated_at``, which
    the list ETag covers, so the browse bump is not skipped (#1619).
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
    # Unconditional (#1619): even a no-op move runs the CAS, which advances
    # ``version``/``updated_at`` — both surface in the collections list.
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
