"""Enforce one active durable tile rebuild.

Revision ID: 0026_active_rebuild_job
Revises: 0025_job_item_leases
Create Date: 2026-09-07
"""

import sqlalchemy as sa
from alembic import op

revision = "0026_active_rebuild_job"
down_revision = "0025_job_item_leases"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "uq_jobs_active_rebuild_tiles",
        "jobs",
        ["job_type"],
        unique=True,
        postgresql_where=sa.text(
            "job_type = 'rebuild_tiles' "
            "AND status IN ('queued', 'running', 'cancelling')"
        ),
    )


def downgrade() -> None:
    op.drop_index("uq_jobs_active_rebuild_tiles", table_name="jobs")
