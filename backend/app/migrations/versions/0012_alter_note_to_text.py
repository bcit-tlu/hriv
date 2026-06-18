"""Alter `note` columns to TEXT to allow longer notes.

Revision ID: 0012_alter_note_to_text
Revises: 0011_add_category_version
Create Date: 2026-06-18

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0012_alter_note_to_text"
down_revision = "0011_add_category_version"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Change images.note and source_images.note from VARCHAR(500) to TEXT
    op.alter_column(
        "images",
        "note",
        existing_type=sa.String(length=500),
        type_=sa.Text(),
        existing_nullable=True,
    )

    op.alter_column(
        "source_images",
        "note",
        existing_type=sa.String(length=500),
        type_=sa.Text(),
        existing_nullable=True,
    )


def downgrade() -> None:
    # Revert back to VARCHAR(500)
    op.alter_column(
        "source_images",
        "note",
        existing_type=sa.Text(),
        type_=sa.String(length=500),
        existing_nullable=True,
    )

    op.alter_column(
        "images",
        "note",
        existing_type=sa.Text(),
        type_=sa.String(length=500),
        existing_nullable=True,
    )
