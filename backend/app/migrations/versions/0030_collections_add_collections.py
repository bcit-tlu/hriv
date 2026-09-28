"""Add collections: grouped image viewing (synchronized + sequence).

Creates ``collections`` plus the ``collection_images`` (ordered membership),
``collection_programs`` and ``collection_groups`` (restricted-visibility
scoping) junction tables. Collections reference existing images and never
duplicate image or category rows.

Ownership: exactly one of ``user_id`` (CASCADE on user delete) or
``owner_program_id`` (SET NULL on program delete) is set; both NULL marks an
orphaned, admin-managed collection.

Revision ID: 0030_collections
Revises: 0029_backup_wal_fence
Create Date: 2026-09-27
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0030_collections"
down_revision = "0029_backup_wal_fence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "collections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column(
            "visibility",
            sa.String(length=20),
            server_default=sa.text("'private'"),
            nullable=False,
        ),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("owner_program_id", sa.Integer(), nullable=True),
        sa.Column(
            "viewport_state",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
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
        sa.CheckConstraint(
            "type IN ('synchronized', 'sequence')", name="ck_collections_type"
        ),
        sa.CheckConstraint(
            "visibility IN ('private', 'public', 'restricted')",
            name="ck_collections_visibility",
        ),
        sa.CheckConstraint(
            "num_nonnulls(user_id, owner_program_id) <= 1",
            name="ck_collections_single_owner",
        ),
        sa.ForeignKeyConstraint(
            ["owner_program_id"], ["programs.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("idx_collections_user", "collections", ["user_id"])
    op.create_index(
        "idx_collections_owner_program", "collections", ["owner_program_id"]
    )

    op.create_table(
        "collection_images",
        sa.Column("collection_id", sa.Integer(), nullable=False),
        sa.Column("image_id", sa.Integer(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["collection_id"], ["collections.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["image_id"], ["images.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("collection_id", "image_id"),
    )
    op.create_index(
        "idx_collection_images_order",
        "collection_images",
        ["collection_id", "sort_order"],
    )

    op.create_table(
        "collection_programs",
        sa.Column("collection_id", sa.Integer(), nullable=False),
        sa.Column("program_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["collection_id"], ["collections.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["program_id"], ["programs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("collection_id", "program_id"),
    )

    op.create_table(
        "collection_groups",
        sa.Column("collection_id", sa.Integer(), nullable=False),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["collection_id"], ["collections.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("collection_id", "group_id"),
    )


def downgrade() -> None:
    op.drop_table("collection_groups")
    op.drop_table("collection_programs")
    op.drop_index("idx_collection_images_order", table_name="collection_images")
    op.drop_table("collection_images")
    op.drop_index("idx_collections_owner_program", table_name="collections")
    op.drop_index("idx_collections_user", table_name="collections")
    op.drop_table("collections")
