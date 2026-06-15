"""Add version column to categories table for optimistic concurrency control.

Mirrors the existing ``images.version`` column. Starts at 1 for all rows and
increments on every PATCH. Clients may send ``If-Match: <version>`` to detect
concurrent edits; the backend returns ``ETag`` with the new version on success.

Revision ID: 0011_add_category_version
Revises: 0010_add_groups
Create Date: 2026-06-05
"""

from alembic import op
import sqlalchemy as sa

revision = "0011_add_category_version"
down_revision = "0010_add_groups"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "categories",
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    )


def downgrade() -> None:
    op.drop_column("categories", "version")
