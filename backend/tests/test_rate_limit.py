"""Tests for login rate limiting (Phase 5.3)."""

import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.rate_limit import (
    _telemetry_rate_limit_key,
    check_login_rate_limit,
    check_telemetry_rate_limit,
)

_MOCK_SETTINGS = SimpleNamespace(
    redis_url="redis://localhost:6379",
    rate_limit_login_max=5,
    rate_limit_login_window=60,
    rate_limit_telemetry_max=60,
    rate_limit_telemetry_window=60,
)


def _make_pipe(count: int) -> MagicMock:
    """Build a mock Redis pipeline returning *count* for zcard."""
    pipe = MagicMock()
    pipe.zremrangebyscore = MagicMock(return_value=pipe)
    pipe.zcard = MagicMock(return_value=pipe)
    pipe.execute = AsyncMock(return_value=[0, count])
    return pipe


async def test_rate_limit_allows_when_redis_unavailable() -> None:
    """When Redis is down, rate limiting is a no-op (returns None)."""
    with patch("app.rate_limit._get_redis", new_callable=AsyncMock, return_value=None):
        result = await check_login_rate_limit("1.2.3.4", "user@example.com")

    assert result is None


async def test_rate_limit_allows_under_threshold() -> None:
    """Requests under the limit are allowed."""
    mock_redis = AsyncMock()
    mock_redis.pipeline = MagicMock(return_value=_make_pipe(count=3))
    mock_redis.zadd = AsyncMock()
    mock_redis.expire = AsyncMock()

    with (
        patch("app.rate_limit._get_redis", new_callable=AsyncMock, return_value=mock_redis),
        patch("app.rate_limit.settings", _MOCK_SETTINGS),
    ):
        result = await check_login_rate_limit("1.2.3.4", "user@example.com")

    assert result is None
    mock_redis.zadd.assert_awaited_once()


async def test_rate_limit_blocks_over_threshold() -> None:
    """Requests over the limit return a retry-after value."""
    now = time.time()
    mock_redis = AsyncMock()
    mock_redis.pipeline = MagicMock(return_value=_make_pipe(count=5))
    mock_redis.zrange = AsyncMock(return_value=[("ts", now - 10)])

    with (
        patch("app.rate_limit._get_redis", new_callable=AsyncMock, return_value=mock_redis),
        patch("app.rate_limit.settings", _MOCK_SETTINGS),
    ):
        result = await check_login_rate_limit("1.2.3.4", "user@example.com")

    assert result is not None
    assert result >= 1  # retry-after in seconds


async def test_rate_limit_returns_retry_after_when_no_oldest() -> None:
    """When zrange returns empty, use full window as retry-after."""
    mock_redis = AsyncMock()
    mock_redis.pipeline = MagicMock(return_value=_make_pipe(count=10))
    mock_redis.zrange = AsyncMock(return_value=[])

    with (
        patch("app.rate_limit._get_redis", new_callable=AsyncMock, return_value=mock_redis),
        patch("app.rate_limit.settings", _MOCK_SETTINGS),
    ):
        result = await check_login_rate_limit("1.2.3.4", "user@example.com")

    assert result == 60


def test_telemetry_key_distinct_per_session() -> None:
    """Distinct X-Session-IDs for the same user produce distinct budgets."""
    key_a = _telemetry_rate_limit_key(7, "tab-a")
    key_b = _telemetry_rate_limit_key(7, "tab-b")

    assert key_a != key_b
    assert key_a.startswith("rate:telemetry:7:")
    # Raw session id is digested, never stored verbatim in the key.
    assert "tab-a" not in key_a


def test_telemetry_key_falls_back_to_user_only_without_session() -> None:
    """Missing/blank session ids fall back to a stable user-only key."""
    user_only = "rate:telemetry:7"
    assert _telemetry_rate_limit_key(7, None) == user_only
    assert _telemetry_rate_limit_key(7, "   ") == user_only


def test_telemetry_key_stable_for_same_session() -> None:
    """The same user + session id always maps to the same key."""
    assert _telemetry_rate_limit_key(7, "tab-a") == _telemetry_rate_limit_key(7, "tab-a")


async def test_telemetry_rate_limit_uses_session_key() -> None:
    """check_telemetry_rate_limit keys Redis by user + digested session id."""
    mock_redis = AsyncMock()
    mock_redis.pipeline = MagicMock(return_value=_make_pipe(count=1))
    mock_redis.zadd = AsyncMock()
    mock_redis.expire = AsyncMock()

    with (
        patch("app.rate_limit._get_redis", new_callable=AsyncMock, return_value=mock_redis),
        patch("app.rate_limit.settings", _MOCK_SETTINGS),
    ):
        result = await check_telemetry_rate_limit(7, "tab-a")

    assert result is None
    used_key = mock_redis.zadd.await_args.args[0]
    assert used_key == _telemetry_rate_limit_key(7, "tab-a")


async def test_telemetry_rate_limit_fail_open_when_redis_down() -> None:
    """Telemetry limiter fails open (allows) when Redis is unavailable."""
    with patch("app.rate_limit._get_redis", new_callable=AsyncMock, return_value=None):
        result = await check_telemetry_rate_limit(7, "tab-a")

    assert result is None
