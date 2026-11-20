"""One emoji reaction per reader per announcement.

Replaces the (announcement, user, emoji) unique key with (announcement, user)
so the database — not just the router — enforces the single-reaction rule.
Readers who already hold several emojis on one post keep only their newest.

Revision ID: 0044_one_reaction_per_user
Revises: 0043_role_audiences
"""

from alembic import op

revision: str = "0044_one_reaction_per_user"
down_revision: str = "0043_role_audiences"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "DELETE FROM announcement_reactions r USING announcement_reactions newer "
        "WHERE newer.announcement_id = r.announcement_id AND newer.user_id = r.user_id "
        "AND newer.id > r.id"
    )
    op.drop_constraint(
        "uq_announcement_reactions_user_emoji", "announcement_reactions", type_="unique"
    )
    op.create_unique_constraint(
        "uq_announcement_reactions_user", "announcement_reactions", ["announcement_id", "user_id"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_announcement_reactions_user", "announcement_reactions", type_="unique")
    op.create_unique_constraint(
        "uq_announcement_reactions_user_emoji",
        "announcement_reactions",
        ["announcement_id", "user_id", "emoji"],
    )
