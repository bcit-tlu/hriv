"""Persist the staged file manifest for bulk import jobs.

Revision ID: 0022_bulk_import_file_manifest
Revises: 0021_add_user_active
Create Date: 2026-09-05
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0022_bulk_import_file_manifest"
down_revision = "0021_add_user_active"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "bulk_import_jobs",
        sa.Column(
            "file_manifest",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("bulk_import_jobs", "file_manifest")
