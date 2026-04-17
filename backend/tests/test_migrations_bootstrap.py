"""Unit tests for the Alembic bootstrap helper.

The module under test is small by design — ``bootstrap()`` acquires a
PostgreSQL advisory lock and runs ``alembic upgrade head``.  The tests
here verify that wiring (lock bracketing, Alembic dispatch, advisory-lock
SQL + key) without requiring a live Postgres server.  Exhaustive
migration-apply coverage is Alembic's own test suite's job.
"""
from __future__ import annotations

import contextlib
from unittest.mock import AsyncMock, MagicMock

import pytest

from app import migrations_bootstrap


@contextlib.asynccontextmanager
async def _noop_advisory_lock():
    """Stand-in for ``_advisory_lock`` that skips the real Postgres round-trip."""
    yield AsyncMock(name="FakeConn")


def test_run_upgrade_dispatches_to_alembic_command(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``_run_upgrade`` must call ``alembic.command.upgrade(cfg, 'head')``."""
    fake_cfg = MagicMock(name="Config")
    upgrade = MagicMock()
    monkeypatch.setattr(migrations_bootstrap.command, "upgrade", upgrade)

    migrations_bootstrap._run_upgrade(fake_cfg)

    upgrade.assert_called_once_with(fake_cfg, "head")


def test_bootstrap_runs_upgrade_under_advisory_lock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``bootstrap()`` acquires the advisory lock and then runs the upgrade.

    Recorded events capture the exact order: lock acquired → upgrade
    executed → lock released.  This guarantees concurrent pods serialize
    on the lock rather than racing on the baseline ``CREATE TABLE``.
    """
    events: list[str] = []

    @contextlib.asynccontextmanager
    async def _tracking_lock():
        events.append("lock_acquired")
        try:
            yield AsyncMock(name="FakeConn")
        finally:
            events.append("lock_released")

    def _tracking_upgrade(cfg: MagicMock) -> None:
        events.append("upgrade")

    async def _no_stamp(_conn):
        return False

    fake_cfg = MagicMock(name="Config")
    monkeypatch.setattr(migrations_bootstrap, "_alembic_config", lambda: fake_cfg)
    monkeypatch.setattr(migrations_bootstrap, "_run_upgrade", _tracking_upgrade)
    monkeypatch.setattr(migrations_bootstrap, "_advisory_lock", _tracking_lock)
    monkeypatch.setattr(migrations_bootstrap, "_should_stamp_legacy", _no_stamp)

    migrations_bootstrap.bootstrap()

    assert events == ["lock_acquired", "upgrade", "lock_released"]


def test_bootstrap_runs_upgrade_in_worker_thread(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The Alembic upgrade must run via ``asyncio.to_thread`` — Alembic's
    ``env.py`` calls ``asyncio.run()`` internally and a nested
    ``asyncio.run()`` on the same thread would raise ``RuntimeError``."""
    to_thread_calls: list[tuple] = []

    async def _fake_to_thread(func, *args, **kwargs):
        to_thread_calls.append((func, args, kwargs))
        return func(*args, **kwargs)

    async def _no_stamp(_conn):
        return False

    fake_cfg = MagicMock(name="Config")
    upgrade = MagicMock()
    monkeypatch.setattr(migrations_bootstrap, "_alembic_config", lambda: fake_cfg)
    monkeypatch.setattr(migrations_bootstrap, "_run_upgrade", upgrade)
    monkeypatch.setattr(migrations_bootstrap, "_advisory_lock", _noop_advisory_lock)
    monkeypatch.setattr(migrations_bootstrap, "_should_stamp_legacy", _no_stamp)
    monkeypatch.setattr(migrations_bootstrap.asyncio, "to_thread", _fake_to_thread)

    migrations_bootstrap.bootstrap()

    assert len(to_thread_calls) == 1
    func, args, _kwargs = to_thread_calls[0]
    assert func is upgrade
    assert args == (fake_cfg,)


async def test_advisory_lock_acquires_and_releases(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``_advisory_lock`` must SELECT pg_advisory_lock before yielding and
    SELECT pg_advisory_unlock on exit, using the fixed ``_ADVISORY_LOCK_KEY``.

    Uses the existing asyncpg engine so no synchronous Postgres driver is
    needed as a dependency.
    """
    fake_conn = AsyncMock(name="AsyncConnection")
    fake_engine = MagicMock(name="AsyncEngine")
    connect_cm = MagicMock(name="ConnectCM")
    connect_cm.__aenter__ = AsyncMock(return_value=fake_conn)
    connect_cm.__aexit__ = AsyncMock(return_value=False)
    fake_engine.connect.return_value = connect_cm
    fake_engine.dispose = AsyncMock()

    captured: dict[str, object] = {}

    def _fake_create_async_engine(*args: object, **kwargs: object) -> MagicMock:
        captured["args"] = args
        captured["kwargs"] = kwargs
        return fake_engine

    monkeypatch.setattr(
        migrations_bootstrap,
        "create_async_engine",
        _fake_create_async_engine,
    )

    async with migrations_bootstrap._advisory_lock() as conn:
        assert conn is fake_conn

    assert fake_conn.execute.await_count == 2
    first_sql = str(fake_conn.execute.await_args_list[0].args[0])
    second_sql = str(fake_conn.execute.await_args_list[1].args[0])
    assert "pg_advisory_lock" in first_sql
    assert "pg_advisory_unlock" in second_sql
    lock_params = fake_conn.execute.await_args_list[0].args[1]
    assert lock_params == {"key": migrations_bootstrap._ADVISORY_LOCK_KEY}
    # AUTOCOMMIT keeps the lock connection from sitting idle-in-transaction
    # while Alembic runs its migrations on a separate connection — otherwise
    # ``idle_in_transaction_session_timeout`` could silently release the lock.
    assert captured["kwargs"].get("isolation_level") == "AUTOCOMMIT"
    fake_engine.dispose.assert_awaited_once()


def test_alembic_config_resolves_alembic_ini(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``_alembic_config`` must return a Config pointing at the repo's
    ``backend/alembic.ini`` — a missing file raises ``RuntimeError`` so
    deployments fail loudly rather than silently no-op'ing."""
    cfg = migrations_bootstrap._alembic_config()
    assert cfg.config_file_name is not None
    assert cfg.config_file_name.endswith("alembic.ini")


def test_alembic_config_raises_when_ini_missing(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    """If ``alembic.ini`` is missing, bootstrap must raise rather than
    silently construct an empty Config."""
    fake_file = tmp_path / "app" / "migrations_bootstrap.py"
    fake_file.parent.mkdir(parents=True)
    fake_file.write_text("")

    monkeypatch.setattr(migrations_bootstrap, "__file__", str(fake_file))

    with pytest.raises(RuntimeError, match="alembic.ini not found"):
        migrations_bootstrap._alembic_config()


def test_run_stamp_dispatches_to_alembic_command(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``_run_stamp`` must call ``alembic.command.stamp(cfg, _BASELINE_REVISION)``."""
    fake_cfg = MagicMock(name="Config")
    stamp = MagicMock()
    monkeypatch.setattr(migrations_bootstrap.command, "stamp", stamp)

    migrations_bootstrap._run_stamp(fake_cfg)

    stamp.assert_called_once_with(fake_cfg, migrations_bootstrap._BASELINE_REVISION)


async def test_should_stamp_legacy_returns_true_for_pre_alembic_db() -> None:
    """When ``alembic_version`` is absent but ``programs`` exists, the DB
    was bootstrapped before Alembic and needs a stamp instead of upgrade."""
    conn = AsyncMock(name="AsyncConnection")
    # First call: to_regclass('public.alembic_version') → None (absent)
    # Second call: to_regclass('public.programs') → 'programs' (present)
    conn.execute = AsyncMock(side_effect=[
        MagicMock(scalar_one_or_none=MagicMock(return_value=None)),
        MagicMock(scalar_one_or_none=MagicMock(return_value="programs")),
    ])

    result = await migrations_bootstrap._should_stamp_legacy(conn)

    assert result is True
    assert conn.execute.await_count == 2


async def test_should_stamp_legacy_returns_false_when_alembic_version_exists() -> None:
    """When ``alembic_version`` already exists the DB is Alembic-managed
    and should use normal ``upgrade head``."""
    conn = AsyncMock(name="AsyncConnection")
    conn.execute = AsyncMock(return_value=MagicMock(
        scalar_one_or_none=MagicMock(return_value="alembic_version"),
    ))

    result = await migrations_bootstrap._should_stamp_legacy(conn)

    assert result is False
    # Only one query needed — early return after finding alembic_version
    assert conn.execute.await_count == 1


async def test_should_stamp_legacy_returns_false_for_fresh_db() -> None:
    """A completely fresh DB (no ``alembic_version``, no ``programs``)
    should use normal ``upgrade head`` to create all tables."""
    conn = AsyncMock(name="AsyncConnection")
    conn.execute = AsyncMock(side_effect=[
        MagicMock(scalar_one_or_none=MagicMock(return_value=None)),
        MagicMock(scalar_one_or_none=MagicMock(return_value=None)),
    ])

    result = await migrations_bootstrap._should_stamp_legacy(conn)

    assert result is False


def test_bootstrap_stamps_then_upgrades_legacy_db(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When ``_should_stamp_legacy`` returns True, bootstrap must stamp the
    baseline revision *and then* run ``upgrade head`` so that any migrations
    added after the baseline are still applied."""
    events: list[str] = []

    @contextlib.asynccontextmanager
    async def _tracking_lock():
        events.append("lock_acquired")
        try:
            yield AsyncMock(name="FakeConn")
        finally:
            events.append("lock_released")

    def _tracking_stamp(cfg: MagicMock) -> None:
        events.append("stamp")

    def _tracking_upgrade(cfg: MagicMock) -> None:
        events.append("upgrade")

    async def _yes_stamp(_conn):
        return True

    fake_cfg = MagicMock(name="Config")
    monkeypatch.setattr(migrations_bootstrap, "_alembic_config", lambda: fake_cfg)
    monkeypatch.setattr(migrations_bootstrap, "_run_stamp", _tracking_stamp)
    monkeypatch.setattr(migrations_bootstrap, "_run_upgrade", _tracking_upgrade)
    monkeypatch.setattr(migrations_bootstrap, "_advisory_lock", _tracking_lock)
    monkeypatch.setattr(migrations_bootstrap, "_should_stamp_legacy", _yes_stamp)

    migrations_bootstrap.bootstrap()

    assert events == ["lock_acquired", "stamp", "upgrade", "lock_released"]


def test_main_returns_zero_on_success(monkeypatch: pytest.MonkeyPatch) -> None:
    """``main()`` (the ``__main__`` entrypoint) returns 0 when bootstrap
    succeeds so the Helm initContainer / docker-compose migrate service
    exits cleanly."""
    monkeypatch.setattr(migrations_bootstrap, "bootstrap", lambda: None)
    assert migrations_bootstrap.main() == 0


def test_main_returns_one_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """``main()`` must return 1 when bootstrap raises so the orchestrator
    (Helm / docker-compose) marks the migrate step as failed and doesn't
    proceed to start the backend against an unmigrated DB."""

    def _boom() -> None:
        raise RuntimeError("simulated bootstrap failure")

    monkeypatch.setattr(migrations_bootstrap, "bootstrap", _boom)
    assert migrations_bootstrap.main() == 1
