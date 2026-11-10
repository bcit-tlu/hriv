"""Announcements become a multi-author stream; changelog folds into it (#1833).

Part of epic #1832.  The singleton ``announcements`` banner row becomes one
announcement among many and ``changelog_entries`` is merged into the same
table so release notes share the Inbox, reactions, seen-state and banner
machinery instead of living in a parallel admin-only feature.

Schema:

- ``announcements`` gains ``title``, ``kind`` (controlled icon set), ``author_id``
  (→ ``users``, ``SET NULL``), ``audience`` (``everyone`` | ``staff`` |
  ``targeted``), ``publish_at`` / ``expires_at`` / ``notified_at``, ``pinned``
  and ``banner``; ``enabled`` is dropped (``publish_at IS NULL`` = draft).
- ``announcement_programs`` / ``announcement_groups`` junctions (``CASCADE``),
  ``announcement_reactions`` (one row per user × emoji, ``CASCADE``) and
  ``content_media`` (uploaded images/videos, ``uploader_id`` → ``SET NULL``).

Data:

- A. The legacy banner row keeps its ``message`` as an ``audience='everyone'``,
  ``kind='notice'``, ``banner=true`` announcement.  ``enabled=true`` →
  ``publish_at = notified_at = created_at``; ``enabled=false`` → draft.  Rows
  with an empty message (the default placeholder) are removed.
- B. Every ``changelog_entries`` row becomes an ``audience='staff'``,
  ``kind='release'`` announcement (``title``, ``message = body``,
  ``publish_at = notified_at = published_at``, timestamps preserved,
  ``author_id NULL``).  ``users.metadata["changelog_last_read_at"]`` seeds
  ``metadata["announcement_seen"]`` for the migrated entries published on or
  before that instant, then the legacy key is removed (JSONB merge — the rest
  of ``metadata`` is untouched).  ``changelog_entries`` is dropped.

Revision ID: 0042_announcements
Revises: 0041_bulk_import_resume
Create Date: 2026-11-10
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

revision: str = "0042_announcements"
down_revision: str = "0041_bulk_import_resume"
branch_labels = None
depends_on = None

_KIND_CHECK = "kind IN ('notice','event','reminder','celebration','release','warning')"
_AUDIENCE_CHECK = "audience IN ('everyone','staff','targeted')"


def _parse_iso(value: str) -> datetime | None:
    """Parse the ISO-8601 string the changelog router stored; naive → UTC."""
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def upgrade() -> None:
    conn = op.get_bind()

    # ── Schema: widen announcements ─────────────────────────────────────
    op.add_column("announcements", sa.Column("title", sa.String(length=255), nullable=True))
    op.add_column(
        "announcements",
        sa.Column(
            "kind",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'notice'"),
        ),
    )
    op.add_column("announcements", sa.Column("author_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "announcements_author_id_fkey",
        "announcements",
        "users",
        ["author_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "announcements",
        sa.Column(
            "audience",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'targeted'"),
        ),
    )
    op.add_column(
        "announcements",
        sa.Column("publish_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "announcements",
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "announcements",
        sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "announcements",
        sa.Column(
            "pinned",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "announcements",
        sa.Column(
            "banner",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_check_constraint("ck_announcements_kind", "announcements", _KIND_CHECK)
    op.create_check_constraint("ck_announcements_audience", "announcements", _AUDIENCE_CHECK)

    # ── Data A: legacy banner row ───────────────────────────────────────
    op.execute(sa.text("DELETE FROM announcements WHERE btrim(message) = ''"))
    op.execute(
        sa.text(
            "UPDATE announcements SET "
            "audience = 'everyone', kind = 'notice', banner = true, "
            "publish_at = CASE WHEN enabled THEN created_at END, "
            "notified_at = CASE WHEN enabled THEN created_at END"
        )
    )
    op.drop_column("announcements", "enabled")

    # ── Schema: junctions, reactions, media ─────────────────────────────
    op.create_table(
        "announcement_programs",
        sa.Column("announcement_id", sa.Integer(), nullable=False),
        sa.Column("program_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["announcement_id"], ["announcements.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["program_id"], ["programs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("announcement_id", "program_id"),
    )
    op.create_table(
        "announcement_groups",
        sa.Column("announcement_id", sa.Integer(), nullable=False),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["announcement_id"], ["announcements.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("announcement_id", "group_id"),
    )
    op.create_table(
        "announcement_reactions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("announcement_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("emoji", sa.String(length=20), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["announcement_id"], ["announcements.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "announcement_id", "user_id", "emoji", name="uq_announcement_reactions_user_emoji"
        ),
    )
    op.create_index(
        "ix_announcement_reactions_announcement_id",
        "announcement_reactions",
        ["announcement_id"],
    )
    op.create_table(
        "content_media",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("stored_name", sa.String(length=255), nullable=False),
        sa.Column("original_name", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("uploader_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["uploader_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("stored_name"),
    )

    # ── Data B: changelog_entries → release announcements ───────────────
    # The legacy singleton was inserted with an explicit id, so the sequence
    # may still be behind MAX(id); realign it before RETURNING-id inserts.
    op.execute(
        sa.text(
            "SELECT setval('announcements_id_seq', "
            "GREATEST(COALESCE((SELECT MAX(id) FROM announcements), 1), 1), "
            "EXISTS(SELECT 1 FROM announcements))"
        )
    )
    entries = conn.execute(
        sa.text(
            "SELECT id, title, body, published_at, created_at, updated_at "
            "FROM changelog_entries ORDER BY id"
        )
    ).fetchall()
    migrated: list[tuple[int, datetime | None]] = []
    for entry in entries:
        new_id = conn.execute(
            sa.text(
                "INSERT INTO announcements "
                "(title, message, kind, audience, publish_at, notified_at, "
                " pinned, banner, created_at, updated_at) "
                "VALUES (:title, :message, 'release', 'staff', :published_at, "
                " :published_at, false, false, :created_at, :updated_at) "
                "RETURNING id"
            ),
            {
                "title": entry.title,
                "message": entry.body,
                "published_at": entry.published_at,
                "created_at": entry.created_at or entry.published_at,
                "updated_at": entry.updated_at or entry.published_at,
            },
        ).scalar_one()
        migrated.append((new_id, entry.published_at))

    readers = conn.execute(
        sa.text(
            "SELECT id, metadata->>'changelog_last_read_at' AS last_read "
            "FROM users WHERE metadata->>'changelog_last_read_at' IS NOT NULL"
        )
    ).fetchall()
    for reader in readers:
        last_read = _parse_iso(reader.last_read)
        seen: dict[str, str] = {}
        if last_read is not None:
            for new_id, published_at in migrated:
                if published_at is None:
                    continue
                published = (
                    published_at
                    if published_at.tzinfo is not None
                    else published_at.replace(tzinfo=timezone.utc)
                )
                if published <= last_read:
                    seen[str(new_id)] = published.isoformat()
        conn.execute(
            sa.text(
                "UPDATE users SET metadata = "
                "(COALESCE(metadata, '{}'::jsonb) - 'changelog_last_read_at') "
                "|| jsonb_build_object('announcement_seen', "
                "   COALESCE(metadata->'announcement_seen', '{}'::jsonb) "
                "   || CAST(:seen AS jsonb)) "
                "WHERE id = :user_id"
            ),
            {"seen": json.dumps(seen), "user_id": reader.id},
        )

    op.drop_table("changelog_entries")


def downgrade() -> None:
    conn = op.get_bind()

    op.create_table(
        "changelog_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "published_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        sa.text(
            "INSERT INTO changelog_entries (title, body, published_at, created_at, updated_at) "
            "SELECT COALESCE(title, ''), message, "
            "       COALESCE(publish_at, created_at), created_at, updated_at "
            "FROM announcements WHERE kind = 'release' ORDER BY id"
        )
    )
    # Seen-state → legacy watermark: the newest release note a user has seen.
    op.execute(
        sa.text(
            "UPDATE users SET metadata = (metadata - 'announcement_seen') "
            "|| jsonb_build_object('changelog_last_read_at', m.last_seen) "
            "FROM ("
            "  SELECT u.id, max(v.value) AS last_seen "
            "  FROM users u, jsonb_each_text(u.metadata->'announcement_seen') v "
            "  JOIN announcements a ON a.id = v.key::int AND a.kind = 'release' "
            "  GROUP BY u.id"
            ") m WHERE users.id = m.id"
        )
    )
    op.execute(
        sa.text(
            "UPDATE users SET metadata = metadata - 'announcement_seen' "
            "WHERE metadata ? 'announcement_seen'"
        )
    )
    op.execute(sa.text("DELETE FROM announcements WHERE kind = 'release'"))

    op.drop_table("content_media")
    op.drop_index("ix_announcement_reactions_announcement_id", table_name="announcement_reactions")
    op.drop_table("announcement_reactions")
    op.drop_table("announcement_groups")
    op.drop_table("announcement_programs")

    op.add_column(
        "announcements",
        sa.Column(
            "enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    conn.execute(
        sa.text(
            "UPDATE announcements SET enabled = (publish_at IS NOT NULL "
            "AND publish_at <= now() AND (expires_at IS NULL OR expires_at > now()))"
        )
    )
    # The legacy API only ever read id=1; keep the newest broadcast banner there.
    conn.execute(
        sa.text(
            "DELETE FROM announcements WHERE id <> ("
            "SELECT id FROM announcements "
            "WHERE audience = 'everyone' AND banner "
            "ORDER BY enabled DESC, publish_at DESC NULLS LAST, id DESC LIMIT 1)"
        )
    )
    conn.execute(sa.text("UPDATE announcements SET id = 1"))
    op.execute(
        sa.text(
            "SELECT setval('announcements_id_seq', "
            "GREATEST(COALESCE((SELECT MAX(id) FROM announcements), 1), 1), "
            "EXISTS(SELECT 1 FROM announcements))"
        )
    )

    op.drop_constraint("ck_announcements_audience", "announcements", type_="check")
    op.drop_constraint("ck_announcements_kind", "announcements", type_="check")
    op.drop_constraint("announcements_author_id_fkey", "announcements", type_="foreignkey")
    for column in (
        "banner",
        "pinned",
        "notified_at",
        "expires_at",
        "publish_at",
        "audience",
        "author_id",
        "kind",
        "title",
    ):
        op.drop_column("announcements", column)
