"""Initial schema — baseline of all application tables.

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-04-16

This migration establishes the Alembic baseline and is the sole source of
truth for the initial schema.  Running ``alembic upgrade head`` against a
fresh database creates every table, index, and column below in a single
transaction and stamps ``alembic_version`` so subsequent rollouts apply
only newer revisions.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "programs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False, unique=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column(
            "parent_id",
            sa.Integer(),
            sa.ForeignKey("categories.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("program", sa.String(length=255), nullable=True),
        sa.Column(
            "status",
            sa.String(length=50),
            server_default=sa.text("'active'"),
            nullable=True,
        ),
        sa.Column(
            "sort_order",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "idx_categories_parent", "categories", ["parent_id"], unique=False
    )

    op.create_table(
        "images",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("thumb", sa.Text(), nullable=False),
        sa.Column("tile_sources", sa.Text(), nullable=False),
        sa.Column(
            "category_id",
            sa.Integer(),
            sa.ForeignKey("categories.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("copyright", sa.String(length=500), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column(
            "active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=True,
        ),
        sa.Column(
            "version",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("file_size", sa.Float(precision=53), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("idx_images_category", "images", ["category_id"], unique=False)

    op.create_table(
        "image_programs",
        sa.Column(
            "image_id",
            sa.Integer(),
            sa.ForeignKey("images.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "program_id",
            sa.Integer(),
            sa.ForeignKey("programs.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )

    op.create_table(
        "source_images",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("original_filename", sa.String(length=500), nullable=False),
        sa.Column("stored_path", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=50),
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
        sa.Column(
            "progress",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("status_message", sa.String(length=255), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column(
            "category_id",
            sa.Integer(),
            sa.ForeignKey("categories.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("copyright", sa.String(length=500), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column(
            "active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column("program", sa.String(length=255), nullable=True),
        sa.Column(
            "image_id",
            sa.Integer(),
            sa.ForeignKey("images.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("file_size", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "idx_source_images_status", "source_images", ["status"], unique=False
    )

    op.create_table(
        "bulk_import_jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "status",
            sa.String(length=50),
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
        sa.Column(
            "category_id",
            sa.Integer(),
            sa.ForeignKey("categories.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "total_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "completed_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "failed_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "errors",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "idx_bulk_import_jobs_status",
        "bulk_import_jobs",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_bulk_import_jobs_category_id",
        "bulk_import_jobs",
        ["category_id"],
        unique=False,
    )

    op.create_table(
        "announcements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "message",
            sa.Text(),
            server_default=sa.text("''"),
            nullable=False,
        ),
        sa.Column(
            "enabled",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column("oidc_subject", sa.String(length=255), nullable=True, unique=True),
        sa.Column(
            "role",
            sa.String(length=50),
            server_default=sa.text("'student'"),
            nullable=False,
        ),
        sa.Column(
            "program_id",
            sa.Integer(),
            sa.ForeignKey("programs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("last_access", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("users")
    op.drop_table("announcements")
    op.drop_index("ix_bulk_import_jobs_category_id", table_name="bulk_import_jobs")
    op.drop_index("idx_bulk_import_jobs_status", table_name="bulk_import_jobs")
    op.drop_table("bulk_import_jobs")
    op.drop_index("idx_source_images_status", table_name="source_images")
    op.drop_table("source_images")
    op.drop_table("image_programs")
    op.drop_index("idx_images_category", table_name="images")
    op.drop_table("images")
    op.drop_index("idx_categories_parent", table_name="categories")
    op.drop_table("categories")
    op.drop_table("programs")
