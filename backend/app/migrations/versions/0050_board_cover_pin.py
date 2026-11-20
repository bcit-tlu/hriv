"""board_cover_pin

Revision ID: 0050_board_cover_pin
Revises: 0049_inuksuks_to_markers
Create Date: 2026-11-18 21:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0050_board_cover_pin'
down_revision: Union[str, Sequence[str], None] = '0049_inuksuks_to_markers'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('boards', sa.Column('cover_marker_id', sa.Integer(), nullable=True))
    op.add_column(
        'boards', sa.Column('cover_blank', sa.Boolean(), server_default='false', nullable=False)
    )
    op.create_foreign_key(
        'boards_cover_marker_id_fkey', 'boards', 'markers', ['cover_marker_id'], ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('boards_cover_marker_id_fkey', 'boards', type_='foreignkey')
    op.drop_column('boards', 'cover_blank')
    op.drop_column('boards', 'cover_marker_id')
