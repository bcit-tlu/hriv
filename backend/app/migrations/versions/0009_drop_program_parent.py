"""Drop parent_program_id from programs table.

Removes the tenant/cohort hierarchy introduced in 0007. Programs are once
again a flat, admin/OIDC-managed entity; instructor-managed subdivision now
lives in the first-class ``groups`` model (added in a later migration).

Revision ID: 0009_drop_program_parent
Revises: 0008_normalize_user_email_case
Create Date: 2026-06-04
"""

from alembic import op
import sqlalchemy as sa

revision = "0009_drop_program_parent"
down_revision = "0008_normalize_user_email_case"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("idx_programs_parent_program_id", table_name="programs")
    op.drop_constraint(
        "fk_programs_parent_program_id", "programs", type_="foreignkey",
    )
    op.drop_column("programs", "parent_program_id")


def downgrade() -> None:
    op.add_column(
        "programs",
        sa.Column("parent_program_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_programs_parent_program_id",
        "programs",
        "programs",
        ["parent_program_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "idx_programs_parent_program_id", "programs", ["parent_program_id"],
    )
