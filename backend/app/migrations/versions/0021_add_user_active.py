"""Add active flag to users.

Revision ID: 0021_add_user_active
Revises: 0020_browse_state
Create Date: 2026-08-30
"""

from alembic import op
import sqlalchemy as sa

revision = "0021_add_user_active"
down_revision = "0020_browse_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )


def downgrade() -> None:
    op.drop_column("users", "active")
