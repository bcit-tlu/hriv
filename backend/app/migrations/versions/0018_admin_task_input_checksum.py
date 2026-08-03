"""Record import archive SHA-256 checksums on admin tasks.

Revision ID: 0018_admin_task_input_checksum
Revises: 0017_image_file_size_bytes
Create Date: 2026-07-28
"""

from alembic import op
import sqlalchemy as sa

revision = "0018_admin_task_input_checksum"
down_revision = "0017_image_file_size_bytes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "admin_tasks",
        sa.Column("input_checksum", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("admin_tasks", "input_checksum")
