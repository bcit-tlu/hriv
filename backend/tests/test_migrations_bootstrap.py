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


async def _noop_check_schema_privilege(_conn):
    """Stand-in that always passes the schema privilege check."""
    return None


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
    monkeypatch.setattr(migrations_bootstrap, "_check_schema_privilege", _noop_check_schema_privilege)

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
    monkeypatch.setattr(migrations_bootstrap, "_check_schema_privilege", _noop_check_schema_privilege)
    monkeypatch.setattr(migrations_bootstrap.asyncio, "to_thread", _fake_to_thread)

    migrations_bootstrap.bootstrap()

    assert len(to_thread_calls) == 1
    func, args, _kwargs = to_thread_calls[0]
    assert func is upgrade
    assert args == (fake_cfg,)


def test_bootstrap_retries_transient_connectivity_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Transient CNPG startup/shutdown connection errors should retry."""
    attempts: list[str] = []
    sleeps: list[float] = []

    async def _flaky_async_bootstrap() -> None:
        attempts.append("attempt")
        if len(attempts) == 1:
            raise RuntimeError("the database system is shutting down")

    monkeypatch.setattr(migrations_bootstrap, "_async_bootstrap", _flaky_async_bootstrap)
    monkeypatch.setattr(migrations_bootstrap.time, "sleep", sleeps.append)
    monkeypatch.setattr(migrations_bootstrap, "_BOOTSTRAP_MAX_ATTEMPTS", 3)
    monkeypatch.setattr(migrations_bootstrap, "_BOOTSTRAP_RETRY_DELAY_SECONDS", 0.25)

    migrations_bootstrap.bootstrap()

    assert attempts == ["attempt", "attempt"]
    assert sleeps == [0.25]


def test_bootstrap_does_not_retry_non_transient_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Non-connectivity bootstrap failures should still fail immediately."""
    sleeps: list[float] = []

    async def _boom() -> None:
        raise RuntimeError("simulated bootstrap failure")

    monkeypatch.setattr(migrations_bootstrap, "_async_bootstrap", _boom)
    monkeypatch.setattr(migrations_bootstrap.time, "sleep", sleeps.append)
    monkeypatch.setattr(migrations_bootstrap, "_BOOTSTRAP_MAX_ATTEMPTS", 3)

    with pytest.raises(RuntimeError, match="simulated bootstrap failure"):
        migrations_bootstrap.bootstrap()

    assert sleeps == []


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
    """When ``programs`` exists but ``alembic_version`` is absent, the DB
    was bootstrapped before Alembic and needs a stamp instead of upgrade."""
    conn = AsyncMock(name="AsyncConnection")
    # 1st call: to_regclass('public.programs') → 'programs' (present)
    # 2nd call: to_regclass('public.alembic_version') → None (absent)
    conn.execute = AsyncMock(side_effect=[
        MagicMock(scalar_one_or_none=MagicMock(return_value="programs")),
        MagicMock(scalar_one_or_none=MagicMock(return_value=None)),
    ])

    result = await migrations_bootstrap._should_stamp_legacy(conn)

    assert result is True
    assert conn.execute.await_count == 2


async def test_should_stamp_legacy_returns_true_when_alembic_version_empty() -> None:
    """When ``programs`` exists and ``alembic_version`` exists but is empty
    (left over from a previous failed migration attempt), the DB still
    needs a stamp."""
    conn = AsyncMock(name="AsyncConnection")
    # 1st call: to_regclass('public.programs') → 'programs' (present)
    # 2nd call: to_regclass('public.alembic_version') → 'alembic_version'
    # 3rd call: SELECT count(*) FROM alembic_version → 0
    conn.execute = AsyncMock(side_effect=[
        MagicMock(scalar_one_or_none=MagicMock(return_value="programs")),
        MagicMock(scalar_one_or_none=MagicMock(return_value="alembic_version")),
        MagicMock(scalar_one=MagicMock(return_value=0)),
    ])

    result = await migrations_bootstrap._should_stamp_legacy(conn)

    assert result is True
    assert conn.execute.await_count == 3


async def test_should_stamp_legacy_returns_false_when_alembic_version_populated() -> None:
    """When ``alembic_version`` exists and has rows, the DB is properly
    Alembic-managed and should use normal ``upgrade head``."""
    conn = AsyncMock(name="AsyncConnection")
    # 1st call: to_regclass('public.programs') → 'programs' (present)
    # 2nd call: to_regclass('public.alembic_version') → 'alembic_version'
    # 3rd call: SELECT count(*) FROM alembic_version → 1
    conn.execute = AsyncMock(side_effect=[
        MagicMock(scalar_one_or_none=MagicMock(return_value="programs")),
        MagicMock(scalar_one_or_none=MagicMock(return_value="alembic_version")),
        MagicMock(scalar_one=MagicMock(return_value=1)),
    ])

    result = await migrations_bootstrap._should_stamp_legacy(conn)

    assert result is False


async def test_should_stamp_legacy_returns_false_for_fresh_db() -> None:
    """A completely fresh DB (no ``programs``) should use normal
    ``upgrade head`` to create all tables."""
    conn = AsyncMock(name="AsyncConnection")
    # 1st call: to_regclass('public.programs') → None (absent)
    conn.execute = AsyncMock(return_value=MagicMock(
        scalar_one_or_none=MagicMock(return_value=None),
    ))

    result = await migrations_bootstrap._should_stamp_legacy(conn)

    assert result is False
    # Only one query needed — early return when programs doesn't exist
    assert conn.execute.await_count == 1


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
    monkeypatch.setattr(migrations_bootstrap, "_check_schema_privilege", _noop_check_schema_privilege)

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


def test_main_logs_auth_hint_on_password_error(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
) -> None:
    """When the bootstrap fails with a password authentication error,
    ``main()`` must log an actionable hint pointing at Vault / CNPG
    credential mismatch rather than a raw asyncpg traceback."""

    def _boom() -> None:
        raise RuntimeError("password authentication failed for user \"hriv\"")

    monkeypatch.setattr(migrations_bootstrap, "bootstrap", _boom)

    with caplog.at_level("ERROR"):
        rc = migrations_bootstrap.main()

    assert rc == 1
    assert "Database authentication failed" in caplog.text
    assert "Vault" in caplog.text


def test_main_logs_host_hint_on_dns_error(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
) -> None:
    """When the bootstrap fails because the database host is unreachable,
    ``main()`` must log a hint about the CNPG service."""

    def _boom() -> None:
        raise RuntimeError("could not translate host name \"hriv-backend-db-rw\"")

    monkeypatch.setattr(migrations_bootstrap, "bootstrap", _boom)

    with caplog.at_level("ERROR"):
        rc = migrations_bootstrap.main()

    assert rc == 1
    assert "Database host unreachable" in caplog.text


async def test_check_schema_privilege_passes_when_granted() -> None:
    """``_check_schema_privilege`` must succeed silently when the current
    role has CREATE on the ``public`` schema."""
    conn = AsyncMock(name="AsyncConnection")
    conn.execute = AsyncMock(
        return_value=MagicMock(scalar_one=MagicMock(return_value=True)),
    )

    # Should not raise
    await migrations_bootstrap._check_schema_privilege(conn)

    conn.execute.assert_awaited_once()


async def test_check_schema_privilege_raises_when_missing() -> None:
    """``_check_schema_privilege`` must raise ``SchemaPrivilegeError`` with
    an actionable message when the current role lacks CREATE on ``public``."""
    conn = AsyncMock(name="AsyncConnection")
    # 1st call: has_schema_privilege → False
    # 2nd call: current_user → 'v-kubernet-hriv-db-abc123'
    conn.execute = AsyncMock(side_effect=[
        MagicMock(scalar_one=MagicMock(return_value=False)),
        MagicMock(scalar_one=MagicMock(return_value="v-kubernet-hriv-db-abc123")),
    ])

    with pytest.raises(
        migrations_bootstrap.SchemaPrivilegeError,
        match="lacks CREATE privilege on schema",
    ):
        await migrations_bootstrap._check_schema_privilege(conn)

    assert conn.execute.await_count == 2


async def test_check_schema_privilege_error_includes_vault_hint() -> None:
    """The error message must include a Vault-specific remediation hint
    since dynamic credentials are the most common cause of missing
    schema-level grants."""
    conn = AsyncMock(name="AsyncConnection")
    conn.execute = AsyncMock(side_effect=[
        MagicMock(scalar_one=MagicMock(return_value=False)),
        MagicMock(scalar_one=MagicMock(return_value="v-kubernet-hriv-db-abc123")),
    ])

    with pytest.raises(
        migrations_bootstrap.SchemaPrivilegeError,
        match="creation_statements",
    ) as exc_info:
        await migrations_bootstrap._check_schema_privilege(conn)

    msg = str(exc_info.value)
    assert "GRANT CREATE ON SCHEMA public" in msg or "GRANT ALL ON SCHEMA public" in msg
    assert "v-kubernet-hriv-db-abc123" in msg


def test_main_logs_schema_privilege_hint(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
) -> None:
    """When the bootstrap fails with a SchemaPrivilegeError, ``main()``
    must log the actionable message without a raw traceback."""

    def _boom() -> None:
        raise migrations_bootstrap.SchemaPrivilegeError(
            "Role 'v-test' lacks CREATE privilege on schema 'public'."
        )

    monkeypatch.setattr(migrations_bootstrap, "bootstrap", _boom)

    with caplog.at_level("ERROR"):
        rc = migrations_bootstrap.main()

    assert rc == 1
    assert "lacks CREATE privilege" in caplog.text
    # Must NOT produce a traceback for this expected error
    assert "Traceback" not in caplog.text


def test_redacted_url_masks_password() -> None:
    """``_redacted_url`` must return host/user/db without the password."""
    url = "postgresql+asyncpg://hriv:s3cret@db-rw:5432/hriv"
    result = migrations_bootstrap._redacted_url(url)
    assert "s3cret" not in result
    assert "hriv@db-rw:5432/hriv" == result


def test_redacted_url_handles_unparseable() -> None:
    """``_redacted_url`` must not raise on garbage input."""
    assert migrations_bootstrap._redacted_url("") is not None


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("the database system is shutting down", True),
        ("the database system is starting up", True),
        ("the database system is not yet accepting connections", True),
        ("connection refused", True),
        ("simulated bootstrap failure", False),
    ],
)
def test_is_transient_bootstrap_connectivity_error(message: str, expected: bool) -> None:
    """Transient DB turnover messages should be classified as retryable."""
    exc = RuntimeError(message)
    assert migrations_bootstrap._is_transient_bootstrap_connectivity_error(exc) is expected
