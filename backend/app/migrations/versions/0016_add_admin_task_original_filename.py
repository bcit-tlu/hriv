"""Add original_filename to admin_tasks for filesystem import archives.

Revision ID: 0016_add_admin_task_original_filename
Revises: 0015_drop_user_email_unique
Create Date: 2026-07-08
"""

from alembic import op
import sqlalchemy as sa

revision = "0016_add_admin_task_original_filename"
down_revision = "0015_drop_user_email_unique"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "admin_tasks",
        sa.Column("original_filename", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("admin_tasks", "original_filename")
