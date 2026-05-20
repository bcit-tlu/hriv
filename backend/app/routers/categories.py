import hashlib
import json as _json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user, require_role
from ..database import get_db
from ..models import Category, Image, Program, User
from ..schemas import CategoryCreate, CategoryUpdate, CategoryOut, CategoryTree, CategoryReorderRequest, ImageOut
from ..visibility import compute_excluded_category_ids, get_student_excluded_category_ids, is_category_visible_to_student

router = APIRouter(prefix="/categories", tags=["categories"])


async def _load_tree(
    db: AsyncSession,
    parent_id: int | None,
    *,
    user_role: str = "admin",
    user_program_ids: set[int] | None = None,
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
    img_stmt = select(Image).order_by(Image.name)
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
            all_categories, user_program_ids or set(),
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
                status=cat.status,
                sort_order=cat.sort_order,
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
    tree = await _load_tree(
        db, None, user_role=_user.role, user_program_ids=user_program_ids,
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
        excluded = await get_student_excluded_category_ids(db, user_program_ids)
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
        if not await is_category_visible_to_student(db, category_id, user_program_ids):
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

    cat = Category(
        label=body.label,
        parent_id=body.parent_id,
        status=body.status,
        sort_order=body.sort_order,
        metadata_=body.metadata_extra or {},
    )
    if body.program_ids:
        progs = (await db.execute(
            select(Program).where(Program.id.in_(body.program_ids))
        )).scalars().all()
        found_ids = {p.id for p in progs}
        missing = set(body.program_ids) - found_ids
        if missing:
            raise HTTPException(422, f"Invalid program IDs: {sorted(missing)}")
        cat.programs = list(progs)
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return cat


@router.patch("/{category_id}", response_model=CategoryOut)
async def update_category(
    category_id: int,
    body: CategoryUpdate,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
):
    cat = await db.get(Category, category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
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
    if "metadata_extra" in update_data:
        update_data["metadata_"] = update_data.pop("metadata_extra")
    for key, value in update_data.items():
        setattr(cat, key, value)
    if program_ids is not None:
        if program_ids:
            progs = (await db.execute(
                select(Program).where(Program.id.in_(program_ids))
            )).scalars().all()
            found_ids = {p.id for p in progs}
            missing = set(program_ids) - found_ids
            if missing:
                raise HTTPException(422, f"Invalid program IDs: {sorted(missing)}")
            cat.programs = list(progs)
        else:
            cat.programs = []
    await db.commit()
    await db.refresh(cat)
    return cat


@router.put("/reorder", status_code=200)
async def reorder_categories(
    body: CategoryReorderRequest,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
):
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


@router.delete("/{category_id}", status_code=204)
async def delete_category(
    category_id: int,
    _user: Annotated[User, Depends(require_role("admin"))],
    db: AsyncSession = Depends(get_db),
):
    cat = await db.get(Category, category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    await db.delete(cat)
    await db.commit()
