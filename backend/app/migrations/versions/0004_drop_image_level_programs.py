"""Drop image-level program associations.

PR #385 deprecated image-level programs in favour of category-level
restrictions.  This migration removes the now-unused ``image_programs``
junction table and the ``source_images.program`` column that stored
program IDs during upload processing.

Revision ID: 0004_drop_image_level_programs
Revises: 0003_rbac_program_scoping
Create Date: 2026-05-19
"""
from __future__ import annotations

import contextlib
import logging
from collections.abc import Iterator

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision = "0004_drop_image_level_programs"
down_revision = "0003_rbac_program_scoping"
branch_labels = None
depends_on = None


def _best_owner_role() -> str | None:
    """Return a role the current user should assume for DDL, or *None*.

    See 0003_rbac_program_scoping for full docstring.
    """
    conn = op.get_bind()
    current_user = conn.execute(text("SELECT current_user")).scalar_one()

    table_owner = conn.execute(
        text(
            "SELECT tableowner FROM pg_tables "
            "WHERE schemaname = 'public' AND tablename = 'images'"
        )
    ).scalar_one_or_none()

    if table_owner is None or table_owner == current_user:
        return None

    can_assume_table_owner = conn.execute(
        text("SELECT pg_has_role(current_user, :target, 'MEMBER')"),
        {"target": table_owner},
    ).scalar_one()
    if can_assume_table_owner:
        return table_owner

    db_owner = conn.execute(
        text(
            "SELECT pg_catalog.pg_get_userbyid(d.datdba) "
            "FROM pg_database d "
            "WHERE d.datname = current_database()"
        )
    ).scalar_one()
    if db_owner != current_user:
        can_assume_db_owner = conn.execute(
            text("SELECT pg_has_role(current_user, :target, 'MEMBER')"),
            {"target": db_owner},
        ).scalar_one()
        if can_assume_db_owner:
            return db_owner

    inherited_role = conn.execute(
        text(
            "SELECT r.rolname "
            "FROM pg_auth_members m "
            "JOIN pg_roles r ON r.oid = m.roleid "
            "WHERE m.member = ( "
            "    SELECT oid FROM pg_roles WHERE rolname = current_user "
            ") "
            "AND r.rolname NOT LIKE 'pg_%%' "
            "ORDER BY r.rolname LIMIT 1"
        )
    ).scalar_one_or_none()
    return inherited_role


@contextlib.contextmanager
def _as_db_owner() -> Iterator[None]:
    """SET ROLE to a privileged role for DDL that requires ownership."""
    target_role = _best_owner_role()
    role_switched = False
    if target_role is not None:
        conn = op.get_bind()
        safe_role = target_role.replace('"', '""')
        conn.execute(text(f'SET ROLE "{safe_role}"'))
        role_switched = True
    try:
        yield
    finally:
        if role_switched:
            try:
                conn = op.get_bind()
                conn.execute(text("RESET ROLE"))
            except Exception:
                logging.getLogger(__name__).warning(
                    "RESET ROLE failed during cleanup; "
                    "connection will be closed",
                    exc_info=True,
                )


def upgrade() -> None:
    with _as_db_owner():
        op.drop_table("image_programs")
        op.drop_column("source_images", "program")


def downgrade() -> None:
    with _as_db_owner():
        op.add_column(
            "source_images",
            sa.Column("program", sa.String(255), nullable=True),
        )
        op.create_table(
            "image_programs",
            sa.Column(
                "image_id",
                sa.Integer(),
                sa.ForeignKey("images.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column(
                "program_id",
                sa.Integer(),
                sa.ForeignKey("programs.id", ondelete="CASCADE"),
                primary_key=True,
            ),
        )
