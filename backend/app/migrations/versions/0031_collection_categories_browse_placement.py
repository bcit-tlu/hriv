"""File collections into the Browse hierarchy (epic #1525 / issue #1527).

Adds ``collections.category_id`` — the category the collection is filed in,
``NULL`` for uncategorized (shown at the Browse root like uncategorized
images) — and ``collections.sort_order``, its tile-order position inside the
scope. Deleting the category unfiles the collection (``ON DELETE SET NULL``)
rather than deleting it, matching ``images.category_id`` semantics.

(Autogenerate also reported unrelated index-name drift on
``bulk_import_jobs`` and ``source_images`` — ``idx_*`` vs ``ix_*`` — which is
intentionally not part of this migration.)

Revision ID: 0031_collection_categories
Revises: 0030_collections
Create Date: 2026-10-05
"""

from alembic import op
import sqlalchemy as sa


revision = "0031_collection_categories"
down_revision = "0030_collections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "collections", sa.Column("category_id", sa.Integer(), nullable=True)
    )
    op.add_column(
        "collections",
        sa.Column(
            "sort_order", sa.Integer(), server_default="0", nullable=False
        ),
    )
    op.create_index(
        "idx_collections_category",
        "collections",
        ["category_id"],
        unique=False,
    )
    op.create_foreign_key(
        "collections_category_id_fkey",
        "collections",
        "categories",
        ["category_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "collections_category_id_fkey", "collections", type_="foreignkey"
    )
    op.drop_index("idx_collections_category", table_name="collections")
    op.drop_column("collections", "sort_order")
    op.drop_column("collections", "category_id")
