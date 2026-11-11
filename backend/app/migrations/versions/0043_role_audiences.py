"""Widen the announcements audience check for single-role audiences.

``audience='staff'`` keeps meaning admins + instructors + staff; ``admins``,
``instructors`` and ``staff_only`` address exactly one role each (resolved at
read time like ``staff`` — no junction rows).

Revision ID: 0043_role_audiences
Revises: 0042_announcements
"""

from alembic import op

revision: str = "0043_role_audiences"
down_revision: str = "0042_announcements"
branch_labels = None
depends_on = None

_OLD_CHECK = "audience IN ('everyone','staff','targeted')"
_NEW_CHECK = "audience IN ('everyone','staff','admins','instructors','staff_only','targeted')"


def upgrade() -> None:
    op.drop_constraint("ck_announcements_audience", "announcements", type_="check")
    op.create_check_constraint("ck_announcements_audience", "announcements", _NEW_CHECK)


def downgrade() -> None:
    # Single-role posts fold back into the widest role audience the old
    # schema can express rather than being dropped.
    op.execute(
        "UPDATE announcements SET audience = 'staff' "
        "WHERE audience IN ('admins','instructors','staff_only')"
    )
    op.drop_constraint("ck_announcements_audience", "announcements", type_="check")
    op.create_check_constraint("ck_announcements_audience", "announcements", _OLD_CHECK)
