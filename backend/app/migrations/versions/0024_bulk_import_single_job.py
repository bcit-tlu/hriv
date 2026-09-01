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
    # This migration cannot know which (if any) of several already-active
    # rows still has a live coordinator — that's a runtime Redis-liveness
    # question, not something a SQL migration can answer. Picking an
    # arbitrary "survivor" (e.g. most-recently-updated) risks keeping an
    # abandoned row alive while failing a genuinely in-flight import, or vice
    # versa. So when more than one pending/processing row exists (which
    # should never happen given the existing app-level guard — this is
    # purely a defensive backstop for a database that already has stale
    # duplicates), finalize *all* of them uniformly rather than guessing. A
    # single active row, the overwhelmingly common case at deploy time, is
    # left untouched. Any import finalized here can simply be re-run.
    op.execute(
        sa.text(
            """
            WITH active_count AS (
                SELECT count(*) AS n
                FROM bulk_import_jobs
                WHERE status IN ('pending', 'processing')
            )
            UPDATE bulk_import_jobs
            SET status = 'failed', updated_at = now()
            WHERE status IN ('pending', 'processing')
              AND (SELECT n FROM active_count) > 1
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
