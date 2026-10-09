"""collection cover blank

Add ``collections.cover_blank`` — the explicit "no cover" state from the
tile cover picker. ``false`` keeps existing behaviour (a pinned member
cover, else the first-member fallback); ``true`` renders the type-logo
placeholder regardless of members. Writes through the PATCH endpoint keep
``cover_blank`` and ``cover_image_id`` mutually exclusive.

Revision ID: 0035_collection_cover_blank
Revises: 0034_collection_cover
Create Date: 2026-10-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0035_collection_cover_blank'
down_revision: Union[str, Sequence[str], None] = '0034_collection_cover'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'collections',
        sa.Column('cover_blank', sa.Boolean(), server_default='false', nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('collections', 'cover_blank')
