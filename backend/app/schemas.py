from datetime import datetime
from pydantic import BaseModel, Field


# ── Program ──────────────────────────────────────────────

class ProgramBase(BaseModel):
    name: str


class ProgramCreate(ProgramBase):
    pass


class ProgramUpdate(BaseModel):
    name: str | None = None


class ProgramOut(ProgramBase):
    id: int
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
    program: str | None = None
    status: str | None = "active"
    metadata_extra: dict | None = Field(default=None, validation_alias="metadata_")


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    label: str | None = None
    parent_id: int | None = None
    program: str | None = None
    status: str | None = None
    metadata_extra: dict | None = None


class CategoryOut(CategoryBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class CategoryTree(CategoryOut):
    children: list["CategoryTree"] = []
    images: list["ImageOut"] = []


# ── Image ─────────────────────────────────────────────────

class ImageBase(BaseModel):
    label: str
    thumb: str
    tile_sources: str
    category_id: int | None = None
    copyright: str | None = None
    origin: str | None = None
    program: str | None = None
    status: str | None = "active"
    metadata_extra: dict | None = Field(default=None, validation_alias="metadata_")


class ImageCreate(ImageBase):
    pass


class ImageUpdate(BaseModel):
    label: str | None = None
    thumb: str | None = None
    tile_sources: str | None = None
    category_id: int | None = None
    copyright: str | None = None
    origin: str | None = None
    program: str | None = None
    status: str | None = None
    metadata_extra: dict | None = None


class ImageOut(ImageBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


# ── Source Image ─────────────────────────────────────────

class SourceImageOut(BaseModel):
    id: int
    original_filename: str
    status: str
    error_message: str | None = None
    label: str | None = None
    category_id: int | None = None
    image_id: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── User ──────────────────────────────────────────────────

class UserBase(BaseModel):
    name: str
    email: str
    role: str = "student"
    program_id: int | None = None
    metadata_extra: dict | None = Field(default=None, validation_alias="metadata_")


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    role: str | None = None
    program_id: int | None = None
    password: str | None = None
    metadata_extra: dict | None = None


class UserBulkUpdate(BaseModel):
    user_ids: list[int]
    program_id: int | None = None


class UserOut(UserBase):
    id: int
    last_access: datetime | None = None
    created_at: datetime
    updated_at: datetime
    program_name: str | None = None

    model_config = {"from_attributes": True, "populate_by_name": True}


# Rebuild forward refs for nested models
CategoryTree.model_rebuild()
