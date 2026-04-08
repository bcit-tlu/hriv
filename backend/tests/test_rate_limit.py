"""Tests for login rate limiting (Phase 5.3)."""

import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.rate_limit import check_login_rate_limit

_MOCK_SETTINGS = SimpleNamespace(
    redis_url="redis://localhost:6379",
    rate_limit_login_max=5,
    rate_limit_login_window=60,
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
