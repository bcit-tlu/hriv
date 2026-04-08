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
_RETRY_BACKOFF_SECS = 30.0
_last_failure: float = 0.0


async def _get_redis() -> Redis | None:
    """Return a shared async Redis client, or ``None`` if unavailable.

    After a connection failure the function backs off for
    ``_RETRY_BACKOFF_SECS`` seconds before retrying, to avoid hammering
    a down Redis on every login request while still recovering
    automatically once Redis comes back.
    """
    global _redis, _last_failure
    if _redis is not None:
        return _redis
    if _last_failure and (time.time() - _last_failure) < _RETRY_BACKOFF_SECS:
        return None
    try:
        client = Redis.from_url(settings.redis_url, decode_responses=True)
        try:
            await client.ping()
        except Exception:
            await client.aclose()
            raise
        _redis = client
        _last_failure = 0.0
        return _redis
    except Exception:
        _last_failure = time.time()
        logger.warning(
            "Redis unavailable — login rate limiting disabled (will retry in %ds)",
            int(_RETRY_BACKOFF_SECS),
            extra={"event": "rate_limit.redis_unavailable"},
        )
        return None


async def check_login_rate_limit(client_ip: str, email: str) -> int | None:
    """Check whether *client_ip* + *email* has exceeded the login rate limit.

    The key is a composite of IP and email so that one user's successful
    login does not reset the counter for a different user at the same IP
    (important when the service is publicly accessible and users may be
    behind a shared campus NAT).

    Returns ``None`` if the request is allowed, otherwise returns the
    number of seconds the client should wait (for a ``Retry-After``
    header).
    """
    redis = await _get_redis()
    if redis is None:
        return None  # limiter disabled — allow

    key = f"rate:login:{client_ip}:{email}"
    window = settings.rate_limit_login_window
    max_attempts = settings.rate_limit_login_max
    now = time.time()

    try:
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
    except Exception:
        logger.warning(
            "Redis operation failed — allowing request",
            extra={"event": "rate_limit.redis_error"},
        )
    return None


async def reset_login_rate_limit(client_ip: str, email: str) -> None:
    """Clear rate-limit state for *client_ip* + *email* after a successful login."""
    redis = await _get_redis()
    if redis is not None:
        await redis.delete(f"rate:login:{client_ip}:{email}")
