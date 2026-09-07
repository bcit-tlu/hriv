"""Add durable rebuild retry timing.

Revision ID: 0028_rebuild_retry
Revises: 0027_merge_rebuild_actor
Create Date: 2026-09-07 15:56:30.208111

"""

from alembic import op
import sqlalchemy as sa


revision = "0028_rebuild_retry"
down_revision = "0027_merge_rebuild_actor"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "job_items",
        sa.Column(
            "retry_not_before",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.create_index(
        "idx_job_items_job_retry",
        "job_items",
        ["job_id", "status", "retry_not_before"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_job_items_job_retry", table_name="job_items")
    op.drop_column("job_items", "retry_not_before")
