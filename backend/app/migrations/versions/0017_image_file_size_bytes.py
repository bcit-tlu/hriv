"""Store image file sizes in bytes.

Revision ID: 0017_image_file_size_bytes
Revises: 0016_admin_task_orig_filename
Create Date: 2026-07-20
"""

from alembic import op
import sqlalchemy as sa

revision = "0017_image_file_size_bytes"
down_revision = "0016_admin_task_orig_filename"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("UPDATE images SET file_size = round(file_size::numeric * 1048576)"))
    op.alter_column(
        "images",
        "file_size",
        existing_type=sa.Float(precision=53),
        type_=sa.BigInteger(),
        postgresql_using="file_size::bigint",
    )


def downgrade() -> None:
    op.alter_column(
        "images",
        "file_size",
        existing_type=sa.BigInteger(),
        type_=sa.Float(precision=53),
        postgresql_using="file_size::double precision",
    )
    op.execute(
        sa.text("UPDATE images SET file_size = round(file_size::numeric / 1048576, 2)")
    )
