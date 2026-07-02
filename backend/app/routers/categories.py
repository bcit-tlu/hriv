import hashlib
import json as _json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from opentelemetry import trace
from sqlalchemy import and_, select, update as sql_update
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user, require_role
from ..authz import (
    can_attach_group_to_category,
    can_attach_program_to_category,
)
from ..database import get_db
from ..tracing import record_exception_if_server_error
from ..models import Category, Group, Image, Program, User
from ..schemas import (
    CategoryCreate,
    CategoryUpdate,
    CategoryOut,
    CategoryTree,
    CategoryReorderRequest,
    CategoryWarning,
    ImageOut,
)
from ..visibility import compute_excluded_category_ids, get_student_excluded_category_ids, is_category_visible_to_student

tracer = trace.get_tracer(__name__)

router = APIRouter(prefix="/categories", tags=["categories"])


async def _resolve_programs(
    db: AsyncSession, user: User, program_ids: list[int], existing_ids: set[int],
) -> list[Program]:
    """Validate program ids exist and that *user* may attach the new ones.

    Programs already attached (in *existing_ids*) are left untouched — any
    editor may remove a restriction (edit authority is global). Only newly
    added programs require attach authority (admins: any; instructors: only
    programs they belong to).
    """
    if not program_ids:
        return []
    progs = (await db.execute(
        select(Program).where(Program.id.in_(program_ids))
    )).scalars().all()
    found_ids = {p.id for p in progs}
    name_by_id = {p.id: p.name for p in progs}
    missing = set(program_ids) - found_ids
    if missing:
        raise HTTPException(422, f"Invalid program IDs: {sorted(missing)}")
    for pid in set(program_ids) - existing_ids:
        if not can_attach_program_to_category(user, pid):
            raise HTTPException(
                403,
                f"You may only attach programs you belong to ({name_by_id[pid]})",
            )
    return list(progs)


async def _resolve_groups(
    db: AsyncSession, user: User, group_ids: list[int], existing_ids: set[int],
) -> list[Group]:
    """Validate group ids exist and that *user* may attach the new ones.

    Only newly added groups require attach authority (admins: any;
    instructors: only groups they manage).
    """
    if not group_ids:
        return []
    grps = (await db.execute(
        select(Group).where(Group.id.in_(group_ids))
    )).scalars().all()
    found_ids = {g.id for g in grps}
    missing = set(group_ids) - found_ids
    if missing:
        raise HTTPException(422, f"Invalid group IDs: {sorted(missing)}")
    by_id = {g.id: g for g in grps}
    for gid in set(group_ids) - existing_ids:
        group = by_id[gid]
        if not can_attach_group_to_category(
            user, [i.id for i in group.instructors]
        ):
            raise HTTPException(
                403,
                f"You may only attach groups you manage ({by_id[gid].name})",
            )
    return list(grps)


def _intersection_warnings(
    programs: list[Program], groups: list[Group],
) -> list[CategoryWarning]:
    """Symmetric non-blocking advisory when program AND group gates intersect.

    When a category is restricted by both dimensions, a student must satisfy
    *both* (be in a selected program AND a selected group). Group members who
    belong to none of the selected programs therefore lose access. This warns
    about that reduction regardless of which dimension was added last.
    """
    if not programs or not groups:
        return []
    program_ids = {p.id for p in programs}
    total_members: set[int] = set()
    excluded_members: set[int] = set()
    for group in groups:
        for member in group.members:
            total_members.add(member.id)
            if not ({p.id for p in member.programs} & program_ids):
                excluded_members.add(member.id)
    if not excluded_members:
        return []
    return [
        CategoryWarning(
            code="program_group_intersection",
            message=(
                f"{len(excluded_members)} of {len(total_members)} student(s) in "
                f"the selected group(s) are not in any selected program and will "
                f"not see this category because program and group restrictions "
                f"are combined (AND)."
            ),
        )
    ]


async def _load_tree(
    db: AsyncSession,
    parent_id: int | None,
    *,
    user_role: str = "admin",
    user_program_ids: set[int] | None = None,
    user_group_ids: set[int] | None = None,
) -> list[CategoryTree]:
    """Build the full category tree using two flat queries instead of
    recursive per-level SELECTs.  This reduces the number of DB round-trips
    from O(depth) to exactly 2 regardless of tree depth.

    When *user_role* is ``"student"`` and *user_program_ids* is provided,
    categories with program restrictions are filtered to only those matching
    the student's program associations.  Categories with no program
    restrictions (empty ``programs``) are visible to everyone.  Filtering
    cascades: if a parent category is hidden from a student, its entire
    subtree is also hidden—even if children have no program restrictions.
    """

    # ── Query 1: all categories in one shot ──
    cat_stmt = select(Category).order_by(Category.sort_order, Category.label)
    cat_result = await db.execute(cat_stmt)
    all_categories = cat_result.scalars().unique().all()

    # ── Query 2: all images in one shot (with eager-loaded programs) ──
    img_stmt = select(Image).order_by(Image.sort_order, Image.name)
    img_result = await db.execute(img_stmt)
    all_images = img_result.scalars().unique().all()

    # ── Index images by category_id ──
    images_by_cat: dict[int | None, list[Image]] = {}
    for img in all_images:
        images_by_cat.setdefault(img.category_id, []).append(img)

    # ── Index categories by parent_id ──
    children_by_parent: dict[int | None, list[Category]] = {}
    for cat in all_categories:
        children_by_parent.setdefault(cat.parent_id, []).append(cat)

    # ── Compute excluded category IDs for students ──
    excluded: set[int] = set()
    if user_role == "student":
        excluded = compute_excluded_category_ids(
            all_categories, user_program_ids or set(), user_group_ids or set(),
        )

    # ── Recursive assembly (in-memory only, no DB calls) ──
    def _assemble(pid: int | None) -> list[CategoryTree]:
        tree: list[CategoryTree] = []
        for cat in children_by_parent.get(pid, []):
            if user_role == "student" and cat.id in excluded:
                continue
            cat_images = images_by_cat.get(cat.id, [])
            if user_role == "student":
                cat_images = [img for img in cat_images if img.active]
            tree.append(CategoryTree(
                id=cat.id,
                label=cat.label,
                parent_id=cat.parent_id,
                program_ids=[p.id for p in cat.programs],
                group_ids=[g.id for g in cat.groups],
                status=cat.status,
                sort_order=cat.sort_order,
                version=cat.version,
                metadata_extra=cat.metadata_,
                created_at=cat.created_at,
                updated_at=cat.updated_at,
                children=_assemble(cat.id),
                images=[
                    ImageOut.model_validate(img)
                    for img in cat_images
                ],
            ))
        return tree

    return _assemble(parent_id)


@router.get("/tree", response_model=list[CategoryTree])
async def get_category_tree(
    request: Request,
    response: Response,
    _user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    user_program_ids = (
        {p.id for p in _user.programs}
        if _user.role == "student"
        else None
    )
    user_group_ids = (
        {g.id for g in _user.groups}
        if _user.role == "student"
        else None
    )
    tree = await _load_tree(
        db, None,
        user_role=_user.role,
        user_program_ids=user_program_ids,
        user_group_ids=user_group_ids,
    )

    # ── ETag / Cache-Control ──
    # Compute a lightweight ETag from the serialised response so browsers
    # and proxies can use conditional requests (If-None-Match) to skip
    # redundant payload transfers when the tree hasn't changed.
    body_bytes = _json.dumps(
        [t.model_dump(mode="json") for t in tree],
        sort_keys=True,
        default=str,
    ).encode()
    etag = hashlib.md5(body_bytes).hexdigest()  # noqa: S324
    response.headers["ETag"] = f'W/"{etag}"'
    response.headers["Cache-Control"] = "private, no-cache"

    client_etags = request.headers.get("if-none-match", "")
    if client_etags == "*" or f'W/"{etag}"' in [t.strip() for t in client_etags.split(",")]:
        return Response(status_code=304, headers={"ETag": f'W/"{etag}"', "Cache-Control": "private, no-cache"})

    return tree


@router.get("/", response_model=list[CategoryOut])
async def list_categories(
    _user: Annotated[User, Depends(get_current_user)],
    parent_id: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Category)
    if parent_id is not None:
        stmt = stmt.where(Category.parent_id == parent_id)
    else:
        stmt = stmt.where(Category.parent_id.is_(None))
    if _user.role == "student":
        user_program_ids = {p.id for p in _user.programs}
        user_group_ids = {g.id for g in _user.groups}
        excluded = await get_student_excluded_category_ids(
            db, user_program_ids, user_group_ids,
        )
        if excluded:
            stmt = stmt.where(~Category.id.in_(excluded))
    stmt = stmt.order_by(Category.sort_order, Category.label)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{category_id}", response_model=CategoryOut)
async def get_category(
    category_id: int,
    _user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    cat = await db.get(Category, category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    if _user.role == "student":
        user_program_ids = {p.id for p in _user.programs}
        user_group_ids = {g.id for g in _user.groups}
        if not await is_category_visible_to_student(
            db, category_id, user_program_ids, user_group_ids,
        ):
            raise HTTPException(status_code=404, detail="Category not found")
    return cat


@router.post("/", response_model=CategoryOut, status_code=201)
async def create_category(
    body: CategoryCreate,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
):
    # Reject duplicate label among siblings (same parent_id)
    sibling_filter = [
        Category.label == body.label,
        Category.parent_id == body.parent_id
        if body.parent_id is not None
        else Category.parent_id.is_(None),
    ]
    existing = await db.execute(select(Category).where(and_(*sibling_filter)))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail="A category with this name already exists at this level",
        )

    progs = await _resolve_programs(db, _user, body.program_ids, set())
    grps = await _resolve_groups(db, _user, body.group_ids, set())

    cat = Category(
        label=body.label,
        parent_id=body.parent_id,
        status=body.status,
        sort_order=body.sort_order,
        metadata_=body.metadata_extra or {},
    )
    cat.programs = progs
    cat.groups = grps
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    cat._category_warnings = _intersection_warnings(progs, grps)
    return cat


@router.patch("/{category_id}", response_model=CategoryOut)
async def update_category(
    category_id: int,
    body: CategoryUpdate,
    request: Request,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
):
    cat = await db.get(Category, category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    # Optimistic concurrency: same CAS pattern as image updates.
    if_match = request.headers.get("If-Match")
    if if_match is not None:
        try:
            client_version = int(if_match.strip('"'))
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid If-Match header")
        cas = await db.execute(
            sql_update(Category)
            .where(Category.id == category_id, Category.version == client_version)
            .values(version=Category.version + 1)
        )
        if cas.rowcount == 0:
            raise HTTPException(
                status_code=409,
                detail="Resource has been modified by another client",
            )
        cat.version = client_version + 1
    else:
        cat.version = cat.version + 1

    update_data = body.model_dump(exclude_unset=True)
    if "parent_id" in update_data:
        new_parent_id = update_data["parent_id"]
        if new_parent_id == category_id:
            raise HTTPException(
                status_code=400, detail="A category cannot be its own parent"
            )
        if new_parent_id is not None:
            ancestor_id: int | None = new_parent_id
            while ancestor_id is not None:
                ancestor = await db.get(Category, ancestor_id)
                if ancestor is None:
                    break
                if ancestor.id == category_id:
                    raise HTTPException(
                        status_code=400,
                        detail="Cannot move a category into one of its own descendants",
                    )
                ancestor_id = ancestor.parent_id
    if "label" in update_data or "parent_id" in update_data:
        new_label = update_data.get("label", cat.label)
        new_parent_id = update_data.get("parent_id", cat.parent_id)
        sibling_filter = [
            Category.label == new_label,
            Category.parent_id == new_parent_id
            if new_parent_id is not None
            else Category.parent_id.is_(None),
            Category.id != category_id,
        ]
        dup = await db.execute(select(Category).where(and_(*sibling_filter)))
        if dup.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail="A category with this name already exists at this level",
            )
    program_ids = update_data.pop("program_ids", None)
    group_ids = update_data.pop("group_ids", None)
    if "metadata_extra" in update_data:
        update_data["metadata_"] = update_data.pop("metadata_extra")
    for key, value in update_data.items():
        setattr(cat, key, value)
    if program_ids is not None:
        existing_program_ids = {p.id for p in cat.programs}
        cat.programs = await _resolve_programs(
            db, _user, program_ids, existing_program_ids,
        )
    if group_ids is not None:
        existing_group_ids = {g.id for g in cat.groups}
        cat.groups = await _resolve_groups(
            db, _user, group_ids, existing_group_ids,
        )
    await db.commit()
    await db.refresh(cat)
    cat._category_warnings = _intersection_warnings(
        list(cat.programs), list(cat.groups)
    )
    response = Response(
        content=CategoryOut.model_validate(cat).model_dump_json(),
        media_type="application/json",
    )
    response.headers["ETag"] = f'"{cat.version}"'
    return response


@router.put("/reorder", status_code=200)
async def reorder_categories(
    body: CategoryReorderRequest,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
):
    with tracer.start_as_current_span("category.reorder") as span:
        try:
            span.set_attribute("category.count", len(body.items))
            # Build proposed parent graph and validate for cycles
            parent_map: dict[int, int | None] = {item.id: item.parent_id for item in body.items}
            for item in body.items:
                if item.parent_id == item.id:
                    raise HTTPException(
                        status_code=400, detail="A category cannot be its own parent"
                    )
            # Walk ancestor chains in the proposed graph to detect cycles
            for item_id in parent_map:
                visited: set[int] = set()
                current: int | None = item_id
                while current is not None:
                    if current in visited:
                        raise HTTPException(
                            status_code=400,
                            detail="Reorder would create a circular parent reference",
                        )
                    visited.add(current)
                    if current in parent_map:
                        current = parent_map[current]
                    else:
                        # Not in the request — look up its existing parent in the DB
                        ancestor = await db.get(Category, current)
                        current = ancestor.parent_id if ancestor else None

            for item in body.items:
                cat = await db.get(Category, item.id)
                if cat is None:
                    raise HTTPException(status_code=404, detail=f"Category {item.id} not found")
                cat.parent_id = item.parent_id
                cat.sort_order = item.sort_order
            await db.commit()
            return {"status": "ok"}
        except Exception as exc:
            record_exception_if_server_error(span, exc)
            raise


@router.delete("/{category_id}", status_code=204)
async def delete_category(
    category_id: int,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
):
    cat = await db.get(Category, category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    await db.delete(cat)
    await db.commit()
