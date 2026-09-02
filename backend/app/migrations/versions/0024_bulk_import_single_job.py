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

# Mirrors WORKER_JOB_TIMEOUT_SECONDS / _STALE_BULK_IMPORT_SECONDS in
# app/task_constants.py and app/routers/bulk_import.py: the same
# conservative, liveness-independent threshold reconcile_stale_bulk_import_jobs
# already trusts at every app startup to declare a row abandoned on its own.
# Migrations intentionally don't import app modules, so the value is
# duplicated here; keep it in sync if that constant ever changes.
_STALE_BULK_IMPORT_SECONDS = 7200


def upgrade() -> None:
    # This migration cannot know which (if any) of several already-active
    # rows still has a live coordinator -- that's a runtime Redis-liveness
    # question, not something a SQL migration can answer, and a rolling
    # deployment can leave an old pod's coordinator running (in-process,
    # with no outer timeout of its own) well after this migration executes.
    # Blindly failing every duplicate row -- regardless of how recently it
    # was updated -- would let a brand-new import start under the new unique
    # index while that stale-looking-but-still-running coordinator keeps
    # writing to (or finishing) its now-"failed" row underneath it.
    #
    # So only rows that are stale by the same conservative,
    # liveness-independent threshold reconcile_stale_bulk_import_jobs already
    # uses are finalized here -- old enough that no legitimate coordinator
    # (worker-hosted or API-hosted) would still be updating them. A single
    # active row, the overwhelmingly common case at deploy time, is left
    # untouched regardless of age, since it alone can never violate the new
    # index. Any import finalized here can simply be re-run.
    #
    # If more than one *non-stale* active row remains after this cleanup --
    # meaning multiple coordinators may genuinely still be alive, which
    # should never happen given the existing app-level guard -- the
    # subsequent CREATE UNIQUE INDEX below will fail on the real duplicate,
    # aborting the migration rather than silently discarding a live import.
    # That failure is the correct, safe outcome: it surfaces the anomaly for
    # an operator to resolve instead of guessing.
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
              AND updated_at < now() - make_interval(secs => :stale_seconds)
            """
        ).bindparams(stale_seconds=_STALE_BULK_IMPORT_SECONDS)
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
