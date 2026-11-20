"""Remove the shelved Board grouping feature.

Revision ID: 0048_remove_board_sections
Revises: 0047_collection_image_slots
"""

from alembic import op
import sqlalchemy as sa

revision = "0048_remove_board_sections"
down_revision = "0047_collection_image_slots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("idx_board_inuksuks_section_order", table_name="board_inuksuks")
    op.drop_constraint("board_inuksuks_section_id_fkey", "board_inuksuks", type_="foreignkey")
    op.drop_column("board_inuksuks", "section_id")
    op.drop_table("board_sections")


def downgrade() -> None:
    op.create_table(
        "board_sections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("board_id", sa.Integer(), sa.ForeignKey("boards.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("idx_board_sections_board", "board_sections", ["board_id"])
    op.add_column("board_inuksuks", sa.Column("section_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "board_inuksuks_section_id_fkey", "board_inuksuks", "board_sections",
        ["section_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index(
        "idx_board_inuksuks_section_order", "board_inuksuks",
        ["board_id", "section_id", "sort_order"],
    )
