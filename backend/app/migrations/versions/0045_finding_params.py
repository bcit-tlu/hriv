"""Add measurement_findings.params for instructor-tuned detection values.

Revision ID: 0045_finding_params
Revises: 0044_one_reaction_per_user
Create Date: 2026-11-12 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0045_finding_params"
down_revision: Union[str, Sequence[str], None] = "0044_one_reaction_per_user"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "measurement_findings",
        sa.Column(
            "params",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("measurement_findings", "params")
