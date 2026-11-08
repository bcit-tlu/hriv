"""user_auth_state

Revision ID: 0038_user_auth_state
Revises: 0037_measurement_findings
Create Date: 2026-11-08 03:47:41.803060

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0038_user_auth_state'
down_revision: Union[str, Sequence[str], None] = '0037_measurement_findings'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('invite_nonce', sa.String(length=64), nullable=True))
    op.add_column('users', sa.Column('must_change_password', sa.Boolean(), server_default=sa.text('false'), nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'must_change_password')
    op.drop_column('users', 'invite_nonce')
