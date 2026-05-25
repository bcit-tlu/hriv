from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, field_validator, model_validator


# ── Overlay Rect (shared validation for locked_overlays in metadata_extra) ────

class OverlayRectSchema(BaseModel):
    x: float
    y: float
    w: float
    h: float


def _validate_locked_overlays(meta: dict | None) -> dict | None:
    """Validate the ``locked_overlays`` key inside a metadata dict.

    Each entry must have numeric ``x``, ``y``, ``w``, ``h`` properties.
    Malformed entries are silently dropped; if the resulting list is empty
    the key is removed entirely.
    """
    if meta is None:
        return meta
    raw = meta.get("locked_overlays")
    if raw is None:
        return meta
    if not isinstance(raw, list):
        meta.pop("locked_overlays", None)
        return meta
    valid: list[dict] = []
    for item in raw:
        try:
            valid.append(OverlayRectSchema.model_validate(item).model_dump())
        except Exception:
            continue
    if valid:
        meta["locked_overlays"] = valid
    else:
        meta.pop("locked_overlays", None)
    return meta


# ── Program ──────────────────────────────────────────────

class ProgramBase(BaseModel):
    name: str


def _normalize_oidc_group(v: str | None) -> str | None:
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


class ProgramCreate(ProgramBase):
    oidc_group: str | None = None

    _norm_oidc = field_validator("oidc_group", mode="before")(_normalize_oidc_group)


class ProgramUpdate(BaseModel):
    name: str | None = None
    oidc_group: str | None = None

    _norm_oidc = field_validator("oidc_group", mode="before")(_normalize_oidc_group)


class ProgramOut(ProgramBase):
    id: int
    oidc_group: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Announcement ─────────────────────────────────────────

class AnnouncementOut(BaseModel):
    id: int
    message: str
    enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AnnouncementUpdate(BaseModel):
    message: str | None = None
    enabled: bool | None = None


# ── Category ──────────────────────────────────────────────

class CategoryBase(BaseModel):
    label: str
    parent_id: int | None = None
    program_ids: list[int] = []
    status: str | None = "active"
    sort_order: int = 0
    metadata_extra: Annotated[dict | None, Field(validation_alias="metadata_")] = None


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    label: str | None = None
    parent_id: int | None = None
    program_ids: list[int] | None = None
    status: str | None = None
    sort_order: int | None = None
    metadata_extra: dict | None = None


class CategoryReorderItem(BaseModel):
    id: int
    parent_id: int | None = None
    sort_order: int


class CategoryReorderRequest(BaseModel):
    items: list[CategoryReorderItem]


class CategoryOut(CategoryBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}

    @model_validator(mode="before")
    @classmethod
    def extract_program_ids(cls, data: object) -> object:
        """Convert the 'programs' relationship list into 'program_ids'."""
        if hasattr(data, "programs"):
            program_ids = [p.id for p in data.programs]
            return dict(
                label=data.label,
                parent_id=data.parent_id,
                program_ids=program_ids,
                status=data.status,
                sort_order=data.sort_order,
                metadata_=data.metadata_,
                id=data.id,
                created_at=data.created_at,
                updated_at=data.updated_at,
            )
        return data


class CategoryTree(CategoryOut):
    children: list["CategoryTree"] = []
    images: list["ImageOut"] = []


# ── Image ─────────────────────────────────────────────────

class ImageBase(BaseModel):
    name: str
    thumb: str
    tile_sources: str
    category_id: int | None = None
    copyright: str | None = None
    note: str | None = None
    active: bool = True
    metadata_extra: Annotated[dict | None, Field(validation_alias="metadata_")] = None
    width: int | None = None
    height: int | None = None
    file_size: float | None = None


class ImageCreate(ImageBase):
    pass


class ImageUpdate(BaseModel):
    name: str | None = None
    thumb: str | None = None
    tile_sources: str | None = None
    category_id: int | None = None
    copyright: str | None = None
    note: str | None = None
    active: bool | None = None
    metadata_extra: dict | None = None
    metadata_extra_merge: dict | None = None

    @model_validator(mode="after")
    def validate_overlay_shapes(self) -> "ImageUpdate":
        if "metadata_extra" in self.model_fields_set and "metadata_extra_merge" in self.model_fields_set:
            raise ValueError(
                "metadata_extra and metadata_extra_merge are mutually exclusive"
            )
        if self.metadata_extra is not None:
            _validate_locked_overlays(self.metadata_extra)
        if self.metadata_extra_merge is not None:
            raw = self.metadata_extra_merge.get("locked_overlays")
            if raw is not None:
                _validate_locked_overlays(self.metadata_extra_merge)
        return self


class ImageOut(ImageBase):
    id: int
    version: int = 1
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


# ── Source Image ─────────────────────────────────────────

class SourceImageOut(BaseModel):
    id: int
    original_filename: str
    status: str
    progress: int = 0
    error_message: str | None = None
    status_message: str | None = None
    name: str | None = None
    category_id: int | None = None
    copyright: str | None = None
    note: str | None = None
    active: bool = True
    image_id: int | None = None
    file_size: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Bulk Import Job ──────────────────────────────────────

class BulkImportJobOut(BaseModel):
    id: int
    status: str
    category_id: int | None = None
    total_count: int
    completed_count: int
    failed_count: int
    errors: list[dict] | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── User ──────────────────────────────────────────────────

class UserBase(BaseModel):
    name: str
    email: str
    role: str = "student"
    program_ids: list[int] = []
    metadata_extra: Annotated[dict | None, Field(validation_alias="metadata_")] = None


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    role: str | None = None
    program_ids: list[int] | None = None
    password: str | None = None
    metadata_extra: dict | None = None


class UserBulkUpdate(BaseModel):
    user_ids: list[int]
    program_ids: list[int] = []


class UserBulkRoleUpdate(BaseModel):
    user_ids: list[int]
    role: str


class UserBulkDelete(BaseModel):
    user_ids: list[int]


# ── Image Bulk Operations ────────────────────────────────

class ImageBulkUpdate(BaseModel):
    image_ids: list[int]
    category_id: int | None = None
    copyright: str | None = None
    note: str | None = None
    active: bool | None = None


class ImageBulkDelete(BaseModel):
    image_ids: list[int]


class UserOut(UserBase):
    id: int
    last_access: datetime | None = None
    created_at: datetime
    updated_at: datetime
    program_names: list[str] = []

    model_config = {"from_attributes": True, "populate_by_name": True}


# Rebuild forward refs for nested models
CategoryTree.model_rebuild()
