"""Give collection members independent slot identity and snapshots."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0047_collection_image_slots"
down_revision = "0046_inuksuks_and_boards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE collection_images ADD COLUMN id SERIAL NOT NULL")
    op.drop_constraint("collection_images_pkey", "collection_images", type_="primary")
    op.create_primary_key("collection_images_pkey", "collection_images", ["id"])
    op.create_index("idx_collection_images_image", "collection_images", ["collection_id", "image_id"])
    op.add_column("collection_images", sa.Column("viewport_state", postgresql.JSONB(), nullable=True))
    op.add_column("collection_images", sa.Column("thumb", sa.Text(), nullable=True))
    op.add_column("collection_images", sa.Column("label", sa.String(255), nullable=True))


def downgrade() -> None:
    op.execute("DELETE FROM collection_images a USING collection_images b "
               "WHERE a.collection_id = b.collection_id AND a.image_id = b.image_id AND a.id > b.id")
    op.drop_constraint("collection_images_pkey", "collection_images", type_="primary")
    op.drop_index("idx_collection_images_image", table_name="collection_images")
    for column in ("label", "thumb", "viewport_state", "id"):
        op.drop_column("collection_images", column)
    op.create_primary_key("collection_images_pkey", "collection_images", ["collection_id", "image_id"])
