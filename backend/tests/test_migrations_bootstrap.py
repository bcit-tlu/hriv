"""Unit tests for the Alembic bootstrap helper.

These tests exercise the *strategy-selection* logic only (``upgrade`` vs.
``stamp``).  The actual ``alembic.command.*`` calls and async DB inspection
are mocked because they're already covered by Alembic's own test suite and
require a live Postgres server.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app import migrations_bootstrap


async def test_decide_strategy_upgrades_when_alembic_version_exists() -> None:
    """If ``alembic_version`` exists we always upgrade (even alongside legacy tables)."""
    with patch.object(
        migrations_bootstrap,
        "_existing_tables",
        return_value={"alembic_version", "images", "categories"},
    ):
        assert await migrations_bootstrap._decide_strategy() == "upgrade"


async def test_decide_strategy_stamps_legacy_db() -> None:
    """App tables without alembic_version must be stamped, not re-created."""
    with patch.object(
        migrations_bootstrap,
        "_existing_tables",
        return_value={"images", "categories", "users"},
    ):
        assert await migrations_bootstrap._decide_strategy() == "stamp"


async def test_decide_strategy_upgrades_fresh_database() -> None:
    """Empty DBs trigger a full ``upgrade head`` to create the schema."""
    with patch.object(
        migrations_bootstrap, "_existing_tables", return_value=set()
    ):
        assert await migrations_bootstrap._decide_strategy() == "upgrade"


async def test_decide_strategy_falls_back_to_upgrade_on_inspection_failure() -> None:
    """If the DB cannot be inspected, we fall back to upgrade so the underlying
    error surfaces rather than being silently swallowed."""
    with patch.object(
        migrations_bootstrap,
        "_existing_tables",
        side_effect=ConnectionError("boom"),
    ):
        assert await migrations_bootstrap._decide_strategy() == "upgrade"


def test_apply_strategy_runs_upgrade_for_upgrade_strategy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``_apply_strategy('upgrade', ...)`` dispatches to ``alembic.command.upgrade``."""
    fake_cfg = MagicMock(name="Config")
    upgrade = MagicMock()
    stamp = MagicMock()

    monkeypatch.setattr(migrations_bootstrap.command, "upgrade", upgrade)
    monkeypatch.setattr(migrations_bootstrap.command, "stamp", stamp)

    migrations_bootstrap._apply_strategy("upgrade", fake_cfg)

    upgrade.assert_called_once_with(fake_cfg, "head")
    stamp.assert_not_called()


def test_apply_strategy_runs_stamp_for_stamp_strategy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``_apply_strategy('stamp', ...)`` dispatches to ``alembic.command.stamp``."""
    fake_cfg = MagicMock(name="Config")
    upgrade = MagicMock()
    stamp = MagicMock()

    monkeypatch.setattr(migrations_bootstrap.command, "upgrade", upgrade)
    monkeypatch.setattr(migrations_bootstrap.command, "stamp", stamp)

    migrations_bootstrap._apply_strategy("stamp", fake_cfg)

    stamp.assert_called_once_with(fake_cfg, "head")
    upgrade.assert_not_called()


def test_bootstrap_wires_decide_and_apply(monkeypatch: pytest.MonkeyPatch) -> None:
    """``bootstrap()`` resolves the strategy once and dispatches via
    ``_apply_strategy`` with the Alembic Config."""
    fake_cfg = MagicMock(name="Config")
    apply_strategy = MagicMock()

    async def _fake_decide() -> str:
        return "stamp"

    monkeypatch.setattr(migrations_bootstrap, "_alembic_config", lambda: fake_cfg)
    monkeypatch.setattr(migrations_bootstrap, "_decide_strategy", _fake_decide)
    monkeypatch.setattr(migrations_bootstrap, "_apply_strategy", apply_strategy)

    migrations_bootstrap.bootstrap()

    apply_strategy.assert_called_once_with("stamp", fake_cfg)


def test_alembic_config_points_at_repo_ini() -> None:
    """The helper must resolve to the real alembic.ini so migrations are found."""
    cfg = migrations_bootstrap._alembic_config()
    ini_path = cfg.config_file_name
    assert ini_path is not None
    assert ini_path.endswith("/alembic.ini")
    # Sanity check: it's inside the backend/ directory.
    assert "/backend/" in ini_path


def test_main_returns_zero_on_success(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(migrations_bootstrap, "bootstrap", lambda: None)
    assert migrations_bootstrap.main() == 0


def test_main_returns_one_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    def _raise() -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(migrations_bootstrap, "bootstrap", _raise)
    assert migrations_bootstrap.main() == 1
