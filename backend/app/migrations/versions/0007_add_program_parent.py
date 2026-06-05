"""Add parent_program_id to programs table (tenant/cohort hierarchy).

Revision ID: 0007_add_program_parent
Revises: 0006_add_image_sort_order
Create Date: 2026-06-04
"""

from alembic import op
import sqlalchemy as sa

revision = "0007_add_program_parent"
down_revision = "0006_add_image_sort_order"
branch_labels = None
depends_on = None


def upgrade() -> None:
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


def downgrade() -> None:
    op.drop_index("idx_programs_parent_program_id", table_name="programs")
    op.drop_constraint(
        "fk_programs_parent_program_id", "programs", type_="foreignkey",
    )
    op.drop_column("programs", "parent_program_id")
