"""Add durable JobItem ownership and lease state.

Revision ID: 0025_job_item_leases
Revises: 0024_bulk_import_single_job
Create Date: 2026-09-01
"""

from alembic import op
import sqlalchemy as sa


revision = "0025_job_item_leases"
down_revision = "0024_bulk_import_single_job"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column("skipped_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column("job_items", sa.Column("claim_token", sa.String(length=64)))
    op.add_column(
        "job_items",
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "job_items",
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "job_items",
        sa.Column("arq_job_id", sa.String(length=255), nullable=True),
    )
    op.create_index(
        "idx_job_items_lease",
        "job_items",
        ["status", "lease_expires_at"],
        unique=False,
    )
    op.create_unique_constraint(
        "uq_job_items_job_resource",
        "job_items",
        ["job_id", "resource_type", "resource_id"],
        postgresql_nulls_not_distinct=True,
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_job_items_job_resource",
        "job_items",
        type_="unique",
    )
    op.drop_index("idx_job_items_lease", table_name="job_items")
    op.drop_column("job_items", "arq_job_id")
    op.drop_column("job_items", "lease_expires_at")
    op.drop_column("job_items", "heartbeat_at")
    op.drop_column("job_items", "claim_token")
    op.drop_column("jobs", "skipped_count")
