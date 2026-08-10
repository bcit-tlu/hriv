"""Add tile_order_revisions for atomic, revisioned tile ordering.

Revision ID: 0018_tile_order_revisions
Revises: 0017_image_file_size_bytes
Create Date: 2026-07-28
"""

from alembic import op
import sqlalchemy as sa

revision = "0018_tile_order_revisions"
down_revision = "0017_image_file_size_bytes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tile_order_revisions",
        sa.Column("scope_key", sa.Integer(), nullable=False, autoincrement=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("scope_key"),
    )


def downgrade() -> None:
    op.drop_table("tile_order_revisions")
