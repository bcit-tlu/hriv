import hashlib
import json as _json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user, require_role
from ..database import get_db
from ..models import Category, Image, User
from ..schemas import CategoryCreate, CategoryUpdate, CategoryOut, CategoryTree, CategoryReorderRequest, ImageOut

router = APIRouter(prefix="/categories", tags=["categories"])


async def _load_tree(db: AsyncSession, parent_id: int | None, *, user_role: str = "admin") -> list[CategoryTree]:
    """Build the full category tree using two flat queries instead of
    recursive per-level SELECTs.  This reduces the number of DB round-trips
    from O(depth) to exactly 2 regardless of tree depth."""

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

    # ── Recursive assembly (in-memory only, no DB calls) ──
    def _assemble(pid: int | None) -> list[CategoryTree]:
        tree: list[CategoryTree] = []
        for cat in children_by_parent.get(pid, []):
            if user_role == "student" and cat.status == "hidden":
                continue
            cat_images = images_by_cat.get(cat.id, [])
            if user_role == "student":
                cat_images = [img for img in cat_images if img.active]
            tree.append(CategoryTree(
                id=cat.id,
                label=cat.label,
                parent_id=cat.parent_id,
                program=cat.program,
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
    tree = await _load_tree(db, None, user_role=_user.role)

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
    response.headers["Cache-Control"] = "private, max-age=30"

    client_etags = request.headers.get("if-none-match", "")
    if client_etags == "*" or f'W/"{etag}"' in [t.strip() for t in client_etags.split(",")]:
        return Response(status_code=304, headers={"ETag": f'W/"{etag}"', "Cache-Control": "private, max-age=30"})

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
    return cat


@router.post("/", response_model=CategoryOut, status_code=201)
async def create_category(
    body: CategoryCreate,
    _user: Annotated[User, Depends(require_role("admin", "instructor"))],
    db: AsyncSession = Depends(get_db),
):
    cat = Category(
        label=body.label,
        parent_id=body.parent_id,
        program=body.program,
        status=body.status,
        sort_order=body.sort_order,
        metadata_=body.metadata_extra or {},
    )
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
    if "metadata_extra" in update_data:
        update_data["metadata_"] = update_data.pop("metadata_extra")
    for key, value in update_data.items():
        setattr(cat, key, value)
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
