"""Backfill missing image file sizes from completed source images.

Revision ID: 0036_image_file_size_backfill
Revises: 0035_collection_cover_blank
Create Date: 2026-10-11 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0036_image_file_size_backfill'
down_revision: Union[str, Sequence[str], None] = '0035_collection_cover_blank'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE images SET file_size = (
              SELECT s.file_size FROM source_images s
              WHERE s.image_id = images.id AND s.status = 'completed'
              ORDER BY s.id DESC LIMIT 1)
            WHERE file_size IS NULL
              AND (SELECT s.file_size FROM source_images s
                   WHERE s.image_id = images.id AND s.status = 'completed'
                   ORDER BY s.id DESC LIMIT 1) IS NOT NULL
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE browse_state
            SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = 1
            """
        )
    )


def downgrade() -> None:
    # The backfill is irreversible, and its copied data is harmless.
    pass
