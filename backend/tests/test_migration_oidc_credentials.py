"""Execute the credential cleanup migration against a minimal SQL database."""

import importlib

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

migration = importlib.import_module("app.migrations.versions.0040_oidc_clear_password")


@pytest.mark.parametrize("populated", [False, True])
def test_oidc_cleanup_sql(populated: bool) -> None:
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "CREATE TABLE users (id INTEGER PRIMARY KEY, oidc_subject TEXT, "
                "password_hash TEXT, invite_nonce TEXT, must_change_password BOOLEAN)"
            )
        )
        if populated:
            connection.execute(
                sa.text(
                    "INSERT INTO users VALUES "
                    "(1, 'sso', 'hash', 'nonce', true), "
                    "(2, NULL, 'local-hash', 'local-nonce', true), "
                    "(3, 'clean-sso', NULL, NULL, false), "
                    "(4, NULL, NULL, 'invite', false), "
                    "(5, '', 'legacy-hash', 'legacy-nonce', true)"
                )
            )
        context = MigrationContext.configure(connection)
        with Operations.context(context):
            migration.upgrade()
            migration.upgrade()
            migration.downgrade()
        rows = connection.execute(
            sa.text(
                "SELECT id, password_hash, invite_nonce, must_change_password "
                "FROM users ORDER BY id"
            )
        ).fetchall()
        assert rows == (
            [
                (1, None, None, False),
                (2, "local-hash", "local-nonce", True),
                (3, None, None, False),
                (4, None, "invite", False),
                (5, None, None, False),
            ]
            if populated
            else []
        )
    engine.dispose()
