"""Alter `note` columns to TEXT while app validation enforces note length.

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
    # Remove the database-level length constraint from note columns.
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
    # Restore the previous VARCHAR(500) column types.
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
