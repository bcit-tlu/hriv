"""Clear local credentials from OIDC-linked accounts.

Revision ID: 0040_oidc_clear_password
Revises: 0039_finding_approved_objective
"""

from alembic import op
import sqlalchemy as sa

revision: str = "0040_oidc_clear_password"
down_revision: str = "0039_finding_approved_objective"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE users SET password_hash = NULL, invite_nonce = NULL, "
            "must_change_password = false WHERE oidc_subject IS NOT NULL"
        )
    )


def downgrade() -> None:
    pass
