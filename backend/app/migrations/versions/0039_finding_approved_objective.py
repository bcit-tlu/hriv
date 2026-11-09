"""Add measurement_findings.approved_objective.

Revision ID: 0039_finding_approved_objective
Revises: 0038_user_auth_state
Create Date: 2026-11-08 09:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0039_finding_approved_objective"
down_revision: Union[str, Sequence[str], None] = "0038_user_auth_state"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "measurement_findings",
        sa.Column("approved_objective", sa.String(length=20), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("measurement_findings", "approved_objective")
