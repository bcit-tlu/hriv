"""Add the production-backup singleton WAL fence table.

Revision ID: 0029_backup_wal_fence
Revises: 0028_rebuild_retry
Create Date: 2026-09-08 02:03:24.515699
"""

from __future__ import annotations

import contextlib
import logging
from collections.abc import Iterator

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision = "0029_backup_wal_fence"
down_revision = "0028_rebuild_retry"
branch_labels = None
depends_on = None


def _best_owner_role() -> str | None:
    """Return the stable application owner when the current role can assume it."""
    conn = op.get_bind()
    current_user = conn.execute(text("SELECT current_user")).scalar_one()
    table_owner = conn.execute(
        text(
            "SELECT tableowner FROM pg_tables "
            "WHERE schemaname = 'public' AND tablename = 'users'"
        )
    ).scalar_one_or_none()
    if table_owner is None or table_owner == current_user:
        return None
    if conn.execute(
        text("SELECT pg_has_role(current_user, :target, 'MEMBER')"),
        {"target": table_owner},
    ).scalar_one():
        return table_owner

    db_owner = conn.execute(
        text(
            "SELECT pg_catalog.pg_get_userbyid(d.datdba) FROM pg_database d "
            "WHERE d.datname = current_database()"
        )
    ).scalar_one()
    if (
        db_owner != current_user
        and conn.execute(
            text("SELECT pg_has_role(current_user, :target, 'MEMBER')"),
            {"target": db_owner},
        ).scalar_one()
    ):
        return db_owner

    return conn.execute(
        text(
            "SELECT r.rolname FROM pg_auth_members m "
            "JOIN pg_roles r ON r.oid = m.roleid "
            "WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user) "
            "AND r.rolname NOT LIKE 'pg_%%' ORDER BY r.rolname LIMIT 1"
        )
    ).scalar_one_or_none()


@contextlib.contextmanager
def _as_db_owner() -> Iterator[None]:
    """Assume the stable owner used by CNPG Vault dynamic application roles."""
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
                op.get_bind().execute(text("RESET ROLE"))
            except Exception:
                logging.getLogger(__name__).warning(
                    "RESET ROLE failed during cleanup; connection will be closed",
                    exc_info=True,
                )


def upgrade() -> None:
    with _as_db_owner():
        op.create_table(
            "backup_recovery_wal_fence",
            sa.Column("singleton", sa.Boolean(), nullable=False, primary_key=True),
            sa.Column("generation", sa.BigInteger(), nullable=False),
            sa.Column("fenced_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "singleton",
                name="ck_backup_recovery_wal_fence_singleton",
            ),
            schema="public",
        )
        op.execute(
            sa.text(
                "INSERT INTO public.backup_recovery_wal_fence "
                "(singleton, generation, fenced_at) "
                "VALUES (TRUE, 0, CURRENT_TIMESTAMP)"
            )
        )
        # CURRENT_USER is the stable owner selected by _as_db_owner, not the
        # short-lived Vault username. Dynamic INHERIT members retain these rights.
        op.execute(
            sa.text(
                "GRANT SELECT, UPDATE ON TABLE "
                "public.backup_recovery_wal_fence TO CURRENT_USER"
            )
        )


def downgrade() -> None:
    with _as_db_owner():
        op.drop_table("backup_recovery_wal_fence", schema="public")
