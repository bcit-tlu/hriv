"""RBAC: M2M user_programs and category_programs tables.

Replaces the single-valued ``users.program_id`` FK and the text-based
``categories.program`` column with proper many-to-many junction tables
so users can belong to multiple programs and categories can be
restricted to multiple programs.

Data migration:
- Copies existing ``users.program_id`` → ``user_programs`` rows
- Matches ``categories.program`` (text) → ``programs.name`` to populate
  ``category_programs`` rows

Revision ID: 0003_rbac_program_scoping
Revises: 0002_add_admin_tasks
Create Date: 2026-05-06
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision = "0003_rbac_program_scoping"
down_revision = "0002_add_admin_tasks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Create user_programs junction table ──
    op.create_table(
        "user_programs",
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "program_id",
            sa.Integer(),
            sa.ForeignKey("programs.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )

    # ── Create category_programs junction table ──
    op.create_table(
        "category_programs",
        sa.Column(
            "category_id",
            sa.Integer(),
            sa.ForeignKey("categories.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "program_id",
            sa.Integer(),
            sa.ForeignKey("programs.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )

    # ── Migrate users.program_id → user_programs ──
    op.execute(
        "INSERT INTO user_programs (user_id, program_id) "
        "SELECT id, program_id FROM users WHERE program_id IS NOT NULL"
    )

    # ── Migrate categories.program (text) → category_programs ──
    op.execute(
        "INSERT INTO category_programs (category_id, program_id) "
        "SELECT c.id, p.id FROM categories c "
        "JOIN programs p ON p.name = c.program "
        "WHERE c.program IS NOT NULL"
    )

    # ── Drop old columns ──
    # In CNPG + Vault environments, each pod gets a fresh dynamic role
    # that may not own the tables created by a previous role.  DDL like
    # DROP CONSTRAINT / DROP COLUMN requires ownership, so we SET ROLE
    # to the database owner (the static role CNPG creates) first.
    conn = op.get_bind()

    db_owner = conn.execute(
        text(
            "SELECT pg_catalog.pg_get_userbyid(d.datdba) "
            "FROM pg_database d "
            "WHERE d.datname = current_database()"
        )
    ).scalar_one()
    current_user = conn.execute(text("SELECT current_user")).scalar_one()
    role_switched = False
    if current_user != db_owner:
        conn.execute(text(f'SET ROLE "{db_owner}"'))
        role_switched = True

    try:
        # Look up the FK constraint name from pg_constraint instead of
        # hard-coding it — the name may vary across environments.
        fk_name = conn.execute(
            text(
                "SELECT c.conname FROM pg_constraint c "
                "JOIN pg_attribute a ON a.attrelid = c.conrelid "
                "  AND a.attnum = ANY(c.conkey) "
                "WHERE c.conrelid = 'users'::regclass "
                "  AND c.contype = 'f' "
                "  AND a.attname = 'program_id'"
            )
        ).scalar_one()
        op.drop_constraint(fk_name, "users", type_="foreignkey")
        op.drop_column("users", "program_id")
        op.drop_column("categories", "program")
    finally:
        if role_switched:
            conn.execute(text("RESET ROLE"))


def downgrade() -> None:
    # ── Re-add columns ──
    op.add_column(
        "users",
        sa.Column("program_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "users_program_id_fkey",
        "users",
        "programs",
        ["program_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "categories",
        sa.Column("program", sa.String(255), nullable=True),
    )

    # ── Migrate back: pick the first program association ──
    op.execute(
        "UPDATE users u SET program_id = up.program_id "
        "FROM (SELECT DISTINCT ON (user_id) user_id, program_id "
        "      FROM user_programs ORDER BY user_id, program_id) up "
        "WHERE u.id = up.user_id"
    )
    op.execute(
        "UPDATE categories c SET program = p.name "
        "FROM (SELECT DISTINCT ON (category_id) category_id, program_id "
        "      FROM category_programs ORDER BY category_id, program_id) cp "
        "JOIN programs p ON p.id = cp.program_id "
        "WHERE c.id = cp.category_id"
    )

    # ── Drop junction tables ──
    op.drop_table("category_programs")
    op.drop_table("user_programs")
