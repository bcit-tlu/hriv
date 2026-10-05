"""Multi-owner collections (epic #1525 / issue #1531).

Adds ``collection_owners(collection_id, user_id)`` — the co-management M2M —
and backfills it from ``collections.user_id``. That column is re-purposed as
creator-only audit: its foreign key becomes ``ON DELETE SET NULL`` (like
``groups.created_by_user_id``) and the ``ck_collections_single_owner`` check
is dropped because a creator may now coexist with a program owner.

Ownership after this migration = ``collection_owners`` rows plus the optional
``owner_program_id`` program; a collection is orphaned only when it has no
owner rows AND no program owner.

Revision ID: 0032_collection_owners
Revises: 0031_collection_categories
Create Date: 2026-10-05
"""

from alembic import op
import sqlalchemy as sa


revision = "0032_collection_owners"
down_revision = "0031_collection_categories"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "collection_owners",
        sa.Column("collection_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["collection_id"], ["collections.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("collection_id", "user_id"),
    )
    op.create_index(
        "idx_collection_owners_user", "collection_owners", ["user_id"]
    )
    # Existing single owners become owner rows; user_id stays populated as
    # the creator audit column.
    op.execute(
        "INSERT INTO collection_owners (collection_id, user_id) "
        "SELECT id, user_id FROM collections WHERE user_id IS NOT NULL"
    )
    op.drop_constraint(
        "ck_collections_single_owner", "collections", type_="check"
    )
    op.drop_constraint(
        "collections_user_id_fkey", "collections", type_="foreignkey"
    )
    op.create_foreign_key(
        "collections_user_id_fkey",
        "collections",
        "users",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    # Restore the single-owner model: copy the first owner row back into
    # ``user_id`` where the column is empty, then clear it on program-owned
    # rows so the mutual-exclusion check can be recreated.
    op.execute(
        "UPDATE collections c SET user_id = o.user_id "
        "FROM (SELECT collection_id, MIN(user_id) AS user_id "
        "      FROM collection_owners GROUP BY collection_id) o "
        "WHERE o.collection_id = c.id AND c.owner_program_id IS NULL"
    )
    op.execute(
        "UPDATE collections SET user_id = NULL "
        "WHERE owner_program_id IS NOT NULL"
    )
    op.drop_constraint(
        "collections_user_id_fkey", "collections", type_="foreignkey"
    )
    op.create_foreign_key(
        "collections_user_id_fkey",
        "collections",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_check_constraint(
        "ck_collections_single_owner",
        "collections",
        "num_nonnulls(user_id, owner_program_id) <= 1",
    )
    op.drop_index(
        "idx_collection_owners_user", table_name="collection_owners"
    )
    op.drop_table("collection_owners")
