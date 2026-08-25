"""Add browse_state singleton for a monotonic browse revision.

Revision ID: 0020_browse_state
Revises: 0019_admin_task_input_checksum
Create Date: 2026-08-24
"""

from alembic import op
import sqlalchemy as sa

revision = "0020_browse_state"
down_revision = "0019_admin_task_input_checksum"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "browse_state",
        sa.Column("id", sa.Integer(), nullable=False, autoincrement=False),
        sa.Column("revision", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        sa.text(
            "INSERT INTO browse_state (id, revision, updated_at) "
            "VALUES (1, 0, now()) ON CONFLICT (id) DO NOTHING"
        )
    )


def downgrade() -> None:
    op.drop_table("browse_state")
