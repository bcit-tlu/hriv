"""Add oidc_group column to programs table.

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-20
"""

from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "programs",
        sa.Column("oidc_group", sa.String(255), nullable=True),
    )
    op.create_unique_constraint("uq_programs_oidc_group", "programs", ["oidc_group"])


def downgrade() -> None:
    op.drop_constraint("uq_programs_oidc_group", "programs", type_="unique")
    op.drop_column("programs", "oidc_group")
