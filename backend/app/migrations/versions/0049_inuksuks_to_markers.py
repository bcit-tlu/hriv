"""Rename Inuksuk storage to Marker.

Revision ID: 0049_inuksuks_to_markers
Revises: 0048_remove_board_sections
"""

from alembic import op

revision = "0049_inuksuks_to_markers"
down_revision = "0048_remove_board_sections"
branch_labels = None
depends_on = None

_TABLES = (
    ("inuksuks", "markers"),
    ("board_inuksuks", "board_markers"),
    ("inuksuk_owners", "marker_owners"),
)

# (new table name, old column, new column); the table rename runs first.
_COLUMNS = (
    ("board_markers", "inuksuk_id", "marker_id"),
    ("marker_owners", "inuksuk_id", "marker_id"),
)

_INDEXES = (
    ("idx_inuksuks_image", "idx_markers_image"),
    ("idx_inuksuk_owners_user", "idx_marker_owners_user"),
    ("idx_board_inuksuks_order", "idx_board_markers_order"),
)

# (new table name, old constraint, new constraint). Postgres keeps the
# auto-generated names through table/column renames, so rename explicitly.
_CONSTRAINTS = (
    ("markers", "inuksuks_pkey", "markers_pkey"),
    ("markers", "inuksuks_image_id_fkey", "markers_image_id_fkey"),
    ("markers", "inuksuks_created_by_user_id_fkey", "markers_created_by_user_id_fkey"),
    ("board_markers", "board_inuksuks_pkey", "board_markers_pkey"),
    ("board_markers", "board_inuksuks_board_id_fkey", "board_markers_board_id_fkey"),
    ("board_markers", "board_inuksuks_inuksuk_id_fkey", "board_markers_marker_id_fkey"),
    ("marker_owners", "inuksuk_owners_pkey", "marker_owners_pkey"),
    ("marker_owners", "inuksuk_owners_inuksuk_id_fkey", "marker_owners_marker_id_fkey"),
    ("marker_owners", "inuksuk_owners_user_id_fkey", "marker_owners_user_id_fkey"),
)

_DOWN_TABLES = {new: old for old, new in _TABLES}


def upgrade() -> None:
    for old, new in _TABLES:
        op.rename_table(old, new)
    for table, old, new in _COLUMNS:
        op.execute(f'ALTER TABLE "{table}" RENAME COLUMN "{old}" TO "{new}"')
    for old, new in _INDEXES:
        op.execute(f'ALTER INDEX "{old}" RENAME TO "{new}"')
    for table, old, new in _CONSTRAINTS:
        op.execute(f'ALTER TABLE "{table}" RENAME CONSTRAINT "{old}" TO "{new}"')
    op.execute("ALTER SEQUENCE IF EXISTS inuksuks_id_seq RENAME TO markers_id_seq")
    op.execute(
        "UPDATE markers SET thumb = replace(thumb, '/inuksuks/', '/markers/') "
        "WHERE thumb LIKE '%/inuksuks/%'"
    )


def downgrade() -> None:
    for old, new in reversed(_TABLES):
        op.rename_table(new, old)
    for table, old, new in _COLUMNS:
        op.execute(f'ALTER TABLE "{_DOWN_TABLES[table]}" RENAME COLUMN "{new}" TO "{old}"')
    for old, new in reversed(_INDEXES):
        op.execute(f'ALTER INDEX "{new}" RENAME TO "{old}"')
    for table, old, new in reversed(_CONSTRAINTS):
        op.execute(f'ALTER TABLE "{_DOWN_TABLES[table]}" RENAME CONSTRAINT "{new}" TO "{old}"')
    op.execute("ALTER SEQUENCE IF EXISTS markers_id_seq RENAME TO inuksuks_id_seq")
    op.execute(
        "UPDATE inuksuks SET thumb = replace(thumb, '/markers/', '/inuksuks/') "
        "WHERE thumb LIKE '%/markers/%'"
    )
