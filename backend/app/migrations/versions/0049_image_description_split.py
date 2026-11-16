"""Split image notes: rename `note` to `description`, add `instructor_note`.

Applies to both ``images`` and ``source_images``. The rename keeps every
existing value (still public); ``instructor_note`` starts empty and is
scrubbed from student payloads at serialization time.

Revision ID: 0049_image_description_split
Revises: 0048_remove_board_sections
"""

from alembic import op
import sqlalchemy as sa

revision = "0049_image_description_split"
down_revision = "0048_remove_board_sections"
branch_labels = None
depends_on = None

_TABLES = ("images", "source_images")


def upgrade() -> None:
    for table in _TABLES:
        op.alter_column(table, "note", new_column_name="description")
        op.add_column(table, sa.Column("instructor_note", sa.Text(), nullable=True))


def downgrade() -> None:
    # instructor_note values are lost on downgrade; descriptions survive as note.
    for table in _TABLES:
        op.drop_column(table, "instructor_note")
        op.alter_column(table, "description", new_column_name="note")
