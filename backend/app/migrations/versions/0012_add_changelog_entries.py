"""Add changelog_entries table for in-app notification changelog.

Each entry stores a title and Markdown body. Published entries appear in the
"What's New" feed visible to admin and instructor roles. Read state is tracked
per-user via ``users.metadata_`` JSONB (key: ``changelog_last_read_at``).

Revision ID: 0012_add_changelog_entries
Revises: 0011_add_category_version
Create Date: 2026-06-16
"""

from alembic import op
import sqlalchemy as sa

revision = "0012_add_changelog_entries"
down_revision = "0011_add_category_version"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "changelog_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "published_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("changelog_entries")
