"""Redis-backed rate limiting for login endpoint (Phase 5.3).

Uses a sliding-window counter stored in Redis.  When Redis is
unavailable the limiter is a no-op so the application keeps working.
"""

import logging
import time

from redis.asyncio import Redis

from .database import settings

logger = logging.getLogger(__name__)

_redis: Redis | None = None
_redis_checked = False


async def _get_redis() -> Redis | None:
    """Return a shared async Redis client, or ``None`` if unavailable."""
    global _redis, _redis_checked
    if _redis is not None:
        return _redis
    if _redis_checked:
        return None
    try:
        client = Redis.from_url(settings.redis_url, decode_responses=True)
        await client.ping()
        _redis = client
        return _redis
    except Exception:
        _redis_checked = True
        logger.warning(
            "Redis unavailable — login rate limiting disabled",
            extra={"event": "rate_limit.redis_unavailable"},
        )
        return None


async def check_login_rate_limit(client_ip: str) -> int | None:
    """Check whether *client_ip* has exceeded the login rate limit.

    Returns ``None`` if the request is allowed, otherwise returns the
    number of seconds the client should wait (for a ``Retry-After``
    header).
    """
    redis = await _get_redis()
    if redis is None:
        return None  # limiter disabled — allow

    key = f"rate:login:{client_ip}"
    window = settings.rate_limit_login_window
    max_attempts = settings.rate_limit_login_max
    now = time.time()

    pipe = redis.pipeline()
    # Remove entries outside the current window
    pipe.zremrangebyscore(key, 0, now - window)
    # Count remaining entries
    pipe.zcard(key)
    results = await pipe.execute()
    count: int = results[1]

    if count >= max_attempts:
        # Oldest entry still in the window tells us when it will expire
        oldest = await redis.zrange(key, 0, 0, withscores=True)
        if oldest:
            retry_after = int(oldest[0][1] + window - now) + 1
        else:
            retry_after = window
        return max(retry_after, 1)

    # Record this attempt
    await redis.zadd(key, {str(now): now})
    await redis.expire(key, window)
    return None


async def reset_login_rate_limit(client_ip: str) -> None:
    """Clear rate-limit state for *client_ip* (useful in tests)."""
    redis = await _get_redis()
    if redis is not None:
        await redis.delete(f"rate:login:{client_ip}")
