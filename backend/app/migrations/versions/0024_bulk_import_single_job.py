"""Enforce at most one pending/processing bulk import job.

The bulk-import "already in progress" guard previously relied solely on an
app-level SELECT-then-INSERT check, which is racy under concurrent requests
(two requests can both pass the check before either commits its new job
row). This adds a partial unique index that makes the invariant an actual
database guarantee; the router catches the resulting IntegrityError and
returns the same 409 response the pre-check already produces.

Revision ID: 0024_bulk_import_single_job
Revises: 0023_add_jobs
Create Date: 2026-09-08
"""

from alembic import op
import sqlalchemy as sa

revision = "0024_bulk_import_single_job"
down_revision = "0023_add_jobs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Defensively finalize any but the most-recently-updated active job
    # before adding the constraint, so this migration can never fail on
    # data that shouldn't exist given the existing app-level 409 guard.
    op.execute(
        sa.text(
            """
            UPDATE bulk_import_jobs
            SET status = 'failed', updated_at = now()
            WHERE status IN ('pending', 'processing')
              AND id NOT IN (
                  SELECT id FROM bulk_import_jobs
                  WHERE status IN ('pending', 'processing')
                  ORDER BY updated_at DESC
                  LIMIT 1
              )
            """
        )
    )
    op.create_index(
        "idx_bulk_import_jobs_single_active",
        "bulk_import_jobs",
        [sa.text("(true)")],
        unique=True,
        postgresql_where=sa.text("status IN ('pending', 'processing')"),
    )


def downgrade() -> None:
    op.drop_index(
        "idx_bulk_import_jobs_single_active",
        table_name="bulk_import_jobs",
    )
