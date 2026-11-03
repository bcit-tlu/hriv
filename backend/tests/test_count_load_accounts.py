"""Unit tests for ``scripts/count_load_accounts.py`` (#1670).

The ops script lives outside ``app/`` (it is executed inside the backend
container via ``kubectl exec``), so it is loaded by file path — the same
approach ``test_purge_failed_source_images.py`` uses.
"""

import importlib.util
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.auth_events import SYNTHETIC_METADATA_KEY


def _load_accounts_script() -> ModuleType:
    path = (
        Path(__file__).resolve().parents[2] / "scripts" / "count_load_accounts.py"
    )
    spec = importlib.util.spec_from_file_location("count_load_accounts", path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


accounts = _load_accounts_script()


def _session_factory(session: MagicMock) -> MagicMock:
    """Match the ``async_session()`` async-context-manager call shape."""
    factory = MagicMock()
    factory.return_value.__aenter__ = AsyncMock(return_value=session)
    factory.return_value.__aexit__ = AsyncMock(return_value=False)
    return factory


def _select_result(rows: list) -> MagicMock:
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows
    return result


async def test_create_adds_45_synthetic_users(monkeypatch) -> None:
    monkeypatch.setenv("LOADTEST_PASSWORD", "pw")
    session = MagicMock()
    session.execute = AsyncMock(return_value=_select_result([]))
    session.commit = AsyncMock()
    monkeypatch.setattr(accounts, "async_session", _session_factory(session))
    monkeypatch.setattr(accounts, "hash_password", lambda _pw: "hash")

    await accounts.create()

    assert session.add.call_count == 45
    for c in session.add.call_args_list:
        user = c.args[0]
        assert user.metadata_ == {SYNTHETIC_METADATA_KEY: True}
        assert user.email.endswith(accounts.DOMAIN)


async def test_create_backfills_flag_on_existing_roster_user(monkeypatch) -> None:
    monkeypatch.setenv("LOADTEST_PASSWORD", "pw")
    existing = SimpleNamespace(
        email=f"{accounts.PREFIX}s01{accounts.DOMAIN}", metadata_={"note": 1}
    )
    session = MagicMock()
    session.execute = AsyncMock(return_value=_select_result([existing]))
    session.commit = AsyncMock()
    monkeypatch.setattr(accounts, "async_session", _session_factory(session))
    monkeypatch.setattr(accounts, "hash_password", lambda _pw: "hash")

    await accounts.create()

    # 44 new users; s01 is backfilled, not re-added.
    assert session.add.call_count == 44
    assert existing.metadata_ == {"note": 1, SYNTHETIC_METADATA_KEY: True}


async def test_remove_deletes_only_roster_emails(monkeypatch) -> None:
    session = MagicMock()
    session.execute = AsyncMock(return_value=MagicMock(rowcount=45))
    session.commit = AsyncMock()
    monkeypatch.setattr(accounts, "async_session", _session_factory(session))

    await accounts.remove()

    stmt = session.execute.call_args.args[0]
    compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    assert " IN " in compiled
    assert "LIKE" not in compiled.upper()
    for email in accounts.EMAILS:
        assert email in compiled
    assert session.execute.call_count == 1
