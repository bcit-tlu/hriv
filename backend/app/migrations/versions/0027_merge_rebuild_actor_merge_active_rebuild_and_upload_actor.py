"""Merge active rebuild and upload actor migration branches.

Revision ID: 0027_merge_rebuild_actor
Revises: 0026_active_rebuild_job, 0026_upload_actor
Create Date: 2026-09-07 15:37:52.927651
"""

revision = "0027_merge_rebuild_actor"
down_revision = ("0026_active_rebuild_job", "0026_upload_actor")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Merge migration branches without schema changes."""


def downgrade() -> None:
    """Restore both migration branches as independent heads."""
