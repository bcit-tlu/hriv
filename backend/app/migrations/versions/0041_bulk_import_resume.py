"""Resumable bulk-import coordination state (#1173).

Adds the durable links the resumable coordinator needs:

- ``jobs.coordinator_*`` — a CAS-guarded lease on the generic supervisor row
  so exactly one API replica coordinates a bulk-import job at a time, with
  heartbeat/expiry mirroring the ``JobItem`` claim contract.
- ``bulk_import_jobs.job_id`` — points the domain row at its ``Job``
  supervisor (``job_type="bulk_import"``) whose ``JobItem`` snapshot carries
  one item per staged file. ``NULL`` for rows created before this change;
  those keep the legacy finalize-on-stale reconciliation path.
- ``source_images.bulk_import_job_id`` plus a partial unique index on
  ``(bulk_import_job_id, stored_path)`` — lets a resumed coordinator tell
  which manifest entries already became ``SourceImage`` rows and guarantees
  exactly-once source-image creation per staged file even when two
  coordinators briefly overlap after a lease takeover.

Revision ID: 0041_bulk_import_resume
Revises: 0040_oidc_clear_password
Create Date: 2026-10-19
"""

from alembic import op
import sqlalchemy as sa

revision: str = "0041_bulk_import_resume"
down_revision: str = "0040_oidc_clear_password"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column("coordinator_token", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "jobs",
        sa.Column(
            "coordinator_heartbeat_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "jobs",
        sa.Column(
            "coordinator_lease_expires_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "bulk_import_jobs",
        sa.Column("job_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "bulk_import_jobs_job_id_fkey",
        "bulk_import_jobs",
        "jobs",
        ["job_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "source_images",
        sa.Column("bulk_import_job_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "source_images_bulk_import_job_id_fkey",
        "source_images",
        "bulk_import_jobs",
        ["bulk_import_job_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "uq_source_images_bulk_import_entry",
        "source_images",
        ["bulk_import_job_id", "stored_path"],
        unique=True,
        postgresql_where=sa.text("bulk_import_job_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_source_images_bulk_import_entry",
        table_name="source_images",
    )
    op.drop_constraint(
        "source_images_bulk_import_job_id_fkey",
        "source_images",
        type_="foreignkey",
    )
    op.drop_column("source_images", "bulk_import_job_id")
    op.drop_constraint(
        "bulk_import_jobs_job_id_fkey",
        "bulk_import_jobs",
        type_="foreignkey",
    )
    op.drop_column("bulk_import_jobs", "job_id")
    op.drop_column("jobs", "coordinator_lease_expires_at")
    op.drop_column("jobs", "coordinator_heartbeat_at")
    op.drop_column("jobs", "coordinator_token")
