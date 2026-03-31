from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import get_current_user, require_role
from ..database import get_db
from ..models import Category, User
from ..schemas import CategoryCreate, CategoryUpdate, CategoryOut, CategoryTree

router = APIRouter(prefix="/categories", tags=["categories"])


async def _load_tree(db: AsyncSession, parent_id: int | None, *, user_role: str = "admin") -> list[CategoryTree]:
    from ..schemas import ImageOut

    stmt = (
        select(Category)
        .where(Category.parent_id == parent_id if parent_id is not None else Category.parent_id.is_(None))
        .options(selectinload(Category.images))
        .order_by(Category.label)
    )
    result = await db.execute(stmt)
    cats = result.scalars().unique().all()

    tree: list[CategoryTree] = []
    for cat in cats:
        children = await _load_tree(db, cat.id, user_role=user_role)
        images = cat.images if user_role != "student" else [img for img in cat.images if img.active]
        tree.append(CategoryTree(
            id=cat.id,
            label=cat.label,
            parent_id=cat.parent_id,
            program=cat.program,
            status=cat.status,
            metadata_extra=cat.metadata_,
            created_at=cat.created_at,
            updated_at=cat.updated_at,
            children=children,
            images=[
                ImageOut.model_validate(img)
                for img in images
            ],
        ))
    return tree


@router.get("/tree", response_model=list[CategoryTree])
async def get_category_tree(
    _user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    return await _load_tree(db, None, user_role=_user.role)


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
    stmt = stmt.order_by(Category.label)
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
