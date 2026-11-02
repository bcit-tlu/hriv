"""Add measurement_findings for the Measurement review workflow.

Revision ID: 0037_measurement_findings
Revises: 0036_image_file_size_backfill
Create Date: 2026-11-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '0037_measurement_findings'
down_revision: Union[str, Sequence[str], None] = '0036_image_file_size_backfill'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'measurement_findings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('image_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=20), server_default=sa.text("'pending'"), nullable=False),
        sa.Column('source', sa.String(length=50), nullable=False),
        sa.Column('proposed_scale', sa.Float(), nullable=True),
        sa.Column('proposed_unit', sa.String(length=10), server_default=sa.text("'um'"), nullable=False),
        sa.Column('objective', sa.String(length=20), nullable=True),
        sa.Column('confidence', sa.Float(), server_default='0', nullable=False),
        sa.Column('evidence', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=True),
        sa.Column('detector_version', sa.String(length=50), nullable=False),
        sa.Column('approved_scale', sa.Float(), nullable=True),
        sa.Column('approved_unit', sa.String(length=10), nullable=True),
        sa.Column('reviewed_by', sa.Integer(), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'superseded')",
            name='ck_measurement_findings_status',
        ),
        sa.ForeignKeyConstraint(['image_id'], ['images.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['reviewed_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_measurement_findings_image', 'measurement_findings', ['image_id'])
    op.create_index(
        'idx_measurement_findings_status_conf', 'measurement_findings', ['status', 'confidence'],
    )
    op.create_index(
        'uq_measurement_findings_pending_image',
        'measurement_findings',
        ['image_id'],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )


def downgrade() -> None:
    op.drop_index('uq_measurement_findings_pending_image', table_name='measurement_findings')
    op.drop_index('idx_measurement_findings_status_conf', table_name='measurement_findings')
    op.drop_index('idx_measurement_findings_image', table_name='measurement_findings')
    op.drop_table('measurement_findings')
