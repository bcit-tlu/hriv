"""Unit tests for migration role-resolution helpers.

Covers ``_best_owner_role()`` and ``_as_db_owner()`` from the
0003_rbac_program_scoping migration.  All database interaction is mocked
via ``op.get_bind()`` — no live Postgres required.
"""
from __future__ import annotations

import importlib.util
import logging
import sys
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest


def _load_migration() -> ModuleType:
    """Import the 0003 migration module despite the digit-prefixed filename."""
    path = (
        Path(__file__).resolve().parent.parent
        / "app"
        / "migrations"
        / "versions"
        / "0003_rbac_program_scoping.py"
    )
    spec = importlib.util.spec_from_file_location("m0003", path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


m0003 = _load_migration()


def _mock_conn(side_effects: list[MagicMock]) -> MagicMock:
    """Build a fake connection whose ``execute().scalar_*`` calls return
    the given sequence of results."""
    conn = MagicMock(name="FakeConnection")
    conn.execute = MagicMock(side_effect=side_effects)
    return conn


def _scalar_one(value: object) -> MagicMock:
    return MagicMock(scalar_one=MagicMock(return_value=value))


def _scalar_one_or_none(value: object) -> MagicMock:
    return MagicMock(scalar_one_or_none=MagicMock(return_value=value))


class TestBestOwnerRole:
    """Tests for ``_best_owner_role()``."""

    def test_current_user_is_table_owner_returns_none(self) -> None:
        conn = _mock_conn([
            _scalar_one("hriv"),               # current_user
            _scalar_one_or_none("hriv"),        # tableowner
        ])
        with patch.object(m0003.op, "get_bind", return_value=conn):
            assert m0003._best_owner_role() is None

    def test_table_owner_assumable_returns_table_owner(self) -> None:
        conn = _mock_conn([
            _scalar_one("v-dynamic-abc"),       # current_user
            _scalar_one_or_none("hriv"),         # tableowner (different)
            _scalar_one(True),                   # pg_has_role → table owner
        ])
        with patch.object(m0003.op, "get_bind", return_value=conn):
            assert m0003._best_owner_role() == "hriv"

    def test_db_owner_assumable_returns_db_owner(self) -> None:
        conn = _mock_conn([
            _scalar_one("v-dynamic-abc"),       # current_user
            _scalar_one_or_none("other_owner"),  # tableowner
            _scalar_one(False),                  # pg_has_role(table_owner) → False
            _scalar_one("postgres"),             # db owner
            _scalar_one(True),                   # pg_has_role(db_owner) → True
        ])
        with patch.object(m0003.op, "get_bind", return_value=conn):
            assert m0003._best_owner_role() == "postgres"

    def test_inherited_role_fallback(self) -> None:
        conn = _mock_conn([
            _scalar_one("v-dynamic-abc"),       # current_user
            _scalar_one_or_none("other_owner"),  # tableowner
            _scalar_one(False),                  # pg_has_role(table_owner) → False
            _scalar_one("postgres"),             # db owner
            _scalar_one(False),                  # pg_has_role(db_owner) → False
            _scalar_one_or_none("app_role"),     # inherited non-system role
        ])
        with patch.object(m0003.op, "get_bind", return_value=conn):
            assert m0003._best_owner_role() == "app_role"

    def test_table_does_not_exist_returns_none(self) -> None:
        conn = _mock_conn([
            _scalar_one("v-dynamic-abc"),       # current_user
            _scalar_one_or_none(None),           # tableowner → table absent
        ])
        with patch.object(m0003.op, "get_bind", return_value=conn):
            assert m0003._best_owner_role() is None

    def test_db_owner_is_current_user_skips_to_inherited(self) -> None:
        conn = _mock_conn([
            _scalar_one("v-dynamic-abc"),       # current_user
            _scalar_one_or_none("other_owner"),  # tableowner
            _scalar_one(False),                  # pg_has_role(table_owner) → False
            _scalar_one("v-dynamic-abc"),        # db owner == current_user
            _scalar_one_or_none("inherited_r"),  # inherited role
        ])
        with patch.object(m0003.op, "get_bind", return_value=conn):
            assert m0003._best_owner_role() == "inherited_r"

    def test_no_inherited_role_returns_none(self) -> None:
        conn = _mock_conn([
            _scalar_one("v-dynamic-abc"),       # current_user
            _scalar_one_or_none("other_owner"),  # tableowner
            _scalar_one(False),                  # pg_has_role(table_owner) → False
            _scalar_one("postgres"),             # db owner
            _scalar_one(False),                  # pg_has_role(db_owner) → False
            _scalar_one_or_none(None),           # no inherited role
        ])
        with patch.object(m0003.op, "get_bind", return_value=conn):
            assert m0003._best_owner_role() is None


class TestAsDbOwner:
    """Tests for ``_as_db_owner()``."""

    def test_no_role_switch_when_best_owner_returns_none(self) -> None:
        with patch.object(m0003, "_best_owner_role", return_value=None):
            with m0003._as_db_owner():
                pass

    def test_set_role_and_reset_role_called(self) -> None:
        conn = MagicMock(name="FakeConnection")
        with (
            patch.object(m0003, "_best_owner_role", return_value="hriv"),
            patch.object(m0003.op, "get_bind", return_value=conn),
        ):
            with m0003._as_db_owner():
                pass

        executed_sql = [
            str(call.args[0]) for call in conn.execute.call_args_list
        ]
        assert any('SET ROLE "hriv"' in s for s in executed_sql)
        assert any("RESET ROLE" in s for s in executed_sql)

    def test_reset_role_warning_logged_on_failure(
        self, caplog: pytest.LogCaptureFixture,
    ) -> None:
        call_count = 0

        def _get_bind_side_effect() -> MagicMock:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return MagicMock(name="FakeConnection")
            conn = MagicMock(name="FailingConnection")
            conn.execute = MagicMock(side_effect=RuntimeError("connection lost"))
            return conn

        with (
            patch.object(m0003, "_best_owner_role", return_value="hriv"),
            patch.object(m0003.op, "get_bind", side_effect=_get_bind_side_effect),
            caplog.at_level(logging.WARNING),
        ):
            with m0003._as_db_owner():
                pass

        assert "RESET ROLE failed" in caplog.text

    def test_double_quote_escaping_in_role_name(self) -> None:
        conn = MagicMock(name="FakeConnection")
        with (
            patch.object(m0003, "_best_owner_role", return_value='ro"le'),
            patch.object(m0003.op, "get_bind", return_value=conn),
        ):
            with m0003._as_db_owner():
                pass

        set_role_sql = str(conn.execute.call_args_list[0].args[0])
        assert 'SET ROLE "ro""le"' in set_role_sql
