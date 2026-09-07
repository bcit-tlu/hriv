"""Add upload actor attribution.

Revision ID: 0026_upload_actor
Revises: 0025_job_item_leases
Create Date: 2026-09-07
"""

from alembic import op
import sqlalchemy as sa


revision = "0026_upload_actor"
down_revision = "0025_job_item_leases"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "source_images",
        sa.Column("uploaded_by", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_source_images_uploaded_by_users",
        "source_images",
        "users",
        ["uploaded_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "idx_source_images_uploaded_by",
        "source_images",
        ["uploaded_by"],
        unique=False,
    )

    op.add_column(
        "bulk_import_jobs",
        sa.Column("requested_by", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_bulk_import_jobs_requested_by_users",
        "bulk_import_jobs",
        "users",
        ["requested_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "idx_bulk_import_jobs_requested_by",
        "bulk_import_jobs",
        ["requested_by"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_bulk_import_jobs_requested_by", table_name="bulk_import_jobs")
    op.drop_constraint(
        "fk_bulk_import_jobs_requested_by_users",
        "bulk_import_jobs",
        type_="foreignkey",
    )
    op.drop_column("bulk_import_jobs", "requested_by")

    op.drop_index("idx_source_images_uploaded_by", table_name="source_images")
    op.drop_constraint(
        "fk_source_images_uploaded_by_users",
        "source_images",
        type_="foreignkey",
    )
    op.drop_column("source_images", "uploaded_by")
