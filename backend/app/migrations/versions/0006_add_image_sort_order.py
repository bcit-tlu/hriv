"""Add sort_order column to images table.

Revision ID: 0006_add_image_sort_order
Revises: 0005_add_program_oidc_group
Create Date: 2026-06-01
"""

from alembic import op
import sqlalchemy as sa

revision = "0006_add_image_sort_order"
down_revision = "0005_add_program_oidc_group"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "images",
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("images", "sort_order")
