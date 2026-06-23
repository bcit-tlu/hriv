"""Add tile-cache provenance columns to source_images.

Records enough provenance to evaluate whether a generated tile tree is
``current`` / ``missing`` / ``stale`` / ``failed`` after a restore, source
replacement, or tile-generation pipeline change (issue #734) without manual
filesystem inspection.

- ``source_checksum``: SHA-256 of the source file used to generate the tiles.
- ``tile_settings_hash``: fingerprint of the tile-generation settings/version.
- ``tiles_generated_at``: timestamp tiles were last generated.

All columns are nullable so existing rows are left untouched; a row with no
``tiles_generated_at`` evaluates as ``missing`` (or ``failed`` when its
processing status is ``failed``). The effective ``tile_cache_status`` is
computed at read time and intentionally not stored, so it can never drift from
the current settings hash.

Revision ID: 0014_add_tile_provenance
Revises: 0013_alter_note_to_text
Create Date: 2026-06-23
"""

from alembic import op
import sqlalchemy as sa

revision = "0014_add_tile_provenance"
down_revision = "0013_alter_note_to_text"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "source_images",
        sa.Column("source_checksum", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "source_images",
        sa.Column("tile_settings_hash", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "source_images",
        sa.Column("tiles_generated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("source_images", "tiles_generated_at")
    op.drop_column("source_images", "tile_settings_hash")
    op.drop_column("source_images", "source_checksum")
