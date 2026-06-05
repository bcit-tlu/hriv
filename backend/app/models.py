from datetime import datetime
from sqlalchemy import BigInteger, Boolean, Column, Float, Index, Integer, String, Text, ForeignKey, DateTime, Table, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


user_programs = Table(
    "user_programs",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("program_id", Integer, ForeignKey("programs.id", ondelete="CASCADE"), primary_key=True),
)

category_programs = Table(
    "category_programs",
    Base.metadata,
    Column("category_id", Integer, ForeignKey("categories.id", ondelete="CASCADE"), primary_key=True),
    Column("program_id", Integer, ForeignKey("programs.id", ondelete="CASCADE"), primary_key=True),
)


class Program(Base):
    __tablename__ = "programs"
    __table_args__ = (
        # Named explicitly to match the Alembic migration so that
        # ``alembic revision --autogenerate`` does not propose dropping it.
        Index("idx_programs_parent_program_id", "parent_program_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    oidc_group: Mapped[str | None] = mapped_column(
        String(255), nullable=True, unique=True,
    )
    parent_program_id: Mapped[int | None] = mapped_column(
        ForeignKey("programs.id", ondelete="CASCADE"), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    users: Mapped[list["User"]] = relationship(
        "User", secondary=user_programs, back_populates="programs", viewonly=True,
    )
    parent: Mapped["Program | None"] = relationship(
        "Program", back_populates="cohorts", remote_side=[id],
    )
    cohorts: Mapped[list["Program"]] = relationship(
        "Program", back_populates="parent", cascade="all, delete-orphan",
    )


class Category(Base):
    __tablename__ = "categories"
    __table_args__ = (
        # Named explicitly (matches the Alembic baseline) so that
        # ``alembic revision --autogenerate`` does not propose renaming the
        # default-generated ``ix_categories_parent_id`` to/from this index.
        Index("idx_categories_parent", "parent_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), nullable=True
    )
    status: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
        default="active",
        server_default=text("'active'"),
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    metadata_: Mapped[dict | None] = mapped_column(
        "metadata",
        JSONB,
        nullable=True,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    children: Mapped[list["Category"]] = relationship(
        "Category", back_populates="parent", cascade="all, delete-orphan"
    )
    parent: Mapped["Category | None"] = relationship(
        "Category", back_populates="children", remote_side=[id]
    )
    images: Mapped[list["Image"]] = relationship(
        "Image", back_populates="category"
    )
    programs: Mapped[list["Program"]] = relationship(
        "Program", secondary=category_programs, lazy="selectin"
    )


class Image(Base):
    __tablename__ = "images"
    __table_args__ = (
        # Named explicitly (matches the Alembic baseline) so that
        # ``alembic revision --autogenerate`` does not propose renaming the
        # default-generated ``ix_images_category_id`` to/from this index.
        Index("idx_images_category", "category_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    thumb: Mapped[str] = mapped_column(Text, nullable=False)
    tile_sources: Mapped[str] = mapped_column(Text, nullable=False)
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    copyright: Mapped[str | None] = mapped_column(String(500), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    metadata_: Mapped[dict | None] = mapped_column(
        "metadata",
        JSONB,
        nullable=True,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    file_size: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    category: Mapped["Category | None"] = relationship("Category", back_populates="images")


class SourceImage(Base):
    __tablename__ = "source_images"
    __table_args__ = (
        # Named explicitly (matches the Alembic baseline) so that
        # ``alembic revision --autogenerate`` does not propose dropping
        # and recreating this index under a different name.
        Index("idx_source_images_status", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    original_filename: Mapped[str] = mapped_column(String(500), nullable=False)
    stored_path: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="pending",
        server_default=text("'pending'"),
    )
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    status_message: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    copyright: Mapped[str | None] = mapped_column(String(500), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    image_id: Mapped[int | None] = mapped_column(
        ForeignKey("images.id", ondelete="SET NULL"), nullable=True
    )
    file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    image: Mapped["Image | None"] = relationship("Image")


class BulkImportJob(Base):
    __tablename__ = "bulk_import_jobs"
    __table_args__ = (
        # Named explicitly (matches the Alembic baseline) so that
        # ``alembic revision --autogenerate`` does not propose dropping
        # and recreating this index under a different name.
        Index("idx_bulk_import_jobs_status", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="pending",
        server_default=text("'pending'"),
    )
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True, index=True
    )
    total_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    completed_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    failed_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    errors: Mapped[list | None] = mapped_column(
        JSONB,
        nullable=True,
        default=list,
        server_default=text("'[]'::jsonb"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    category: Mapped["Category | None"] = relationship("Category")


class Announcement(Base):
    __tablename__ = "announcements"

    id: Mapped[int] = mapped_column(primary_key=True)
    message: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default=text("''")
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    oidc_subject: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True)
    role: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="student",
        server_default=text("'student'"),
    )
    last_access: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    metadata_: Mapped[dict | None] = mapped_column(
        "metadata",
        JSONB,
        nullable=True,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    programs: Mapped[list["Program"]] = relationship(
        "Program", secondary=user_programs, back_populates="users", lazy="selectin"
    )


class AdminTask(Base):
    """Tracks long-running admin operations (import/export) executed in the background."""

    __tablename__ = "admin_tasks"
    __table_args__ = (
        Index("idx_admin_tasks_status", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    task_type: Mapped[str] = mapped_column(
        String(50), nullable=False,
    )  # db_export, db_import, files_export, files_import
    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="pending",
        server_default=text("'pending'"),
    )  # pending, running, completed, failed
    progress: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0",
    )
    log: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default=text("''"),
    )
    result_filename: Mapped[str | None] = mapped_column(String(500), nullable=True)
    result_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )

    creator: Mapped["User | None"] = relationship("User")
