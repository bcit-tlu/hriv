"""Drop the redundant case-sensitive unique constraint on users.email.

Since migration 0008 lowercased all emails and added the case-insensitive
functional unique index ``ix_users_email_lower``, the original case-sensitive
``users_email_key`` unique constraint (created inline in 0001) is redundant:
both enforce the same invariant now that emails are always stored lowercase.
The functional index remains the sole guard on email uniqueness.

Revision ID: 0015_drop_user_email_unique
Revises: 0014_add_tile_provenance
Create Date: 2026-07-02
"""

from alembic import op

revision = "0015_drop_user_email_unique"
down_revision = "0014_add_tile_provenance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("users_email_key", "users", type_="unique")


def downgrade() -> None:
    op.create_unique_constraint("users_email_key", "users", ["email"])
