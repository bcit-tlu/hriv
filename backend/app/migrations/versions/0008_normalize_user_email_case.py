"""Normalize user email case: lowercase existing emails and add
case-insensitive unique index.

Revision ID: 0008_normalize_user_email_case
Revises: 0007_add_program_parent
Create Date: 2026-06-05
"""

from alembic import op
import sqlalchemy as sa

revision = "0008_normalize_user_email_case"
down_revision = "0007_add_program_parent"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Lowercase all existing email values.
    op.execute(sa.text("UPDATE users SET email = lower(email)"))

    # Add a case-insensitive unique index to prevent future duplicates.
    op.create_index(
        "ix_users_email_lower",
        "users",
        [sa.text("lower(email)")],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_users_email_lower", table_name="users")
