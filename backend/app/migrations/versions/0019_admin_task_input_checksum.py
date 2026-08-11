"""Record import archive SHA-256 checksums on admin tasks.

Revision ID: 0019_admin_task_input_checksum
Revises: 0018_tile_order_revisions
Create Date: 2026-07-28
"""

from alembic import op
import sqlalchemy as sa

revision = "0019_admin_task_input_checksum"
down_revision = "0018_tile_order_revisions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "admin_tasks",
        sa.Column("input_checksum", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("admin_tasks", "input_checksum")
