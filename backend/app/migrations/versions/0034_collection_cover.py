"""collection cover image

Add ``collections.cover_image_id`` — the pinned tile cover picked from
the collection's members via ``PATCH /collections/{id}``. NULL keeps the
first-member fallback; ``ON DELETE SET NULL`` clears the pin when the
image row is deleted, and membership drops clear it in the router.

Revision ID: 0034_collection_cover
Revises: 0033_collection_hidden
Create Date: 2026-10-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0034_collection_cover'
down_revision: Union[str, Sequence[str], None] = '0033_collection_hidden'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('collections', sa.Column('cover_image_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_collections_cover_image',
        'collections', 'images',
        ['cover_image_id'], ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('fk_collections_cover_image', 'collections', type_='foreignkey')
    op.drop_column('collections', 'cover_image_id')
