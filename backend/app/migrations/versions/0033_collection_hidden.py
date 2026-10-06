"""collection hidden

Add ``collections.hidden`` — curatorial hide (#1559). A hidden
collection drops out of student view unless the student owns it;
admins/instructors toggle it via PATCH /collections/{id}.

Revision ID: 0033_collection_hidden
Revises: 0032_collection_owners
Create Date: 2026-10-05 22:46:25.926168

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0033_collection_hidden'
down_revision: Union[str, Sequence[str], None] = '0032_collection_owners'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('collections', sa.Column('hidden', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('collections', 'hidden')
