"""Redis-only store for ephemeral count jobs (epic #1661, API in #1664).

No database tables, no migration, no image metadata — every job is a JSON
record plus an optional JSON result, both with a short TTL, plus a per-user
set used to enforce the active-job cap. Records are written by the API
before enqueueing and updated by the counting worker; cancellation deletes
the record outright.

Worker status writes use ``SET key value XX KEEPTTL`` so a record deleted
mid-run (user cancel / TTL expiry) is never resurrected; a failed ``XX``
write means "cancelled — stop".

Key scheme follows the repo's per-feature prefix convention (``rate:`` for
rate limiting, ``arq:`` for arq) — counting keys live under ``count:``:

- ``count:job:{job_id}``    — JSON job record
- ``count:result:{job_id}`` — JSON result payload (result contract)
- ``count:user:{user_id}``  — set of that user's job ids (cap bookkeeping)
"""

from __future__ import annotations

import json
import time
from typing import Any

from opentelemetry import metrics
from redis.asyncio import Redis

KEY_PREFIX = "count:"

# Job-record statuses. ``cancelled`` and ``expired`` are part of the result
# contract but never persisted: cancellation deletes the record and expiry
# is Redis TTL eviction, so reads see them as a missing record (404).
STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_DONE = "done"
STATUS_FAILED = "failed"
ACTIVE_STATUSES = frozenset({STATUS_QUEUED, STATUS_RUNNING})

_meter = metrics.get_meter(__name__)
_count_jobs_counter = _meter.create_counter(
    "hriv.count_jobs",
    description="Count-job lifecycle outcomes by mode",
    unit="1",
)

# OTel attribute values are bounded (docs/observability-conventions.md).
COUNT_OUTCOME_ENQUEUED = "enqueued"
COUNT_OUTCOME_DONE = "done"
COUNT_OUTCOME_FAILED = "failed"
COUNT_OUTCOME_CANCELLED = "cancelled"
COUNT_OUTCOME_EXPIRED = "expired"
COUNT_OUTCOME_REJECTED_TOO_LARGE = "rejected_too_large"
COUNT_OUTCOME_REJECTED_RATE_LIMITED = "rejected_rate_limited"
COUNT_OUTCOME_QUEUE_UNAVAILABLE = "queue_unavailable"


def record_count_job(mode: str, outcome: str, reason: str | None = None) -> None:
    """Record one bounded count-job lifecycle outcome in OpenTelemetry.

    ``reason`` carries the job error code on ``failed`` and the API detail
    code on ``rejected_*``/``queue_unavailable`` outcomes (bounded
    allowlist values only).
    """
    attributes = {"mode": mode, "outcome": outcome}
    if reason is not None:
        attributes["reason"] = reason
    _count_jobs_counter.add(1, attributes)


def _job_key(job_id: str) -> str:
    return f"{KEY_PREFIX}job:{job_id}"


def _result_key(job_id: str) -> str:
    return f"{KEY_PREFIX}result:{job_id}"


def _user_key(user_id: int) -> str:
    return f"{KEY_PREFIX}user:{user_id}"


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())


async def create_record(
    redis: Redis,
    *,
    job_id: str,
    user_id: int,
    image_id: int,
    source_image_id: int,
    mode: str,
    selection: dict[str, int],
    mpp: float | None = None,
    ttl_seconds: int,
) -> dict[str, Any]:
    """Persist a fresh queued record (before enqueue) and return it."""
    record: dict[str, Any] = {
        "job_id": job_id,
        "user_id": user_id,
        "image_id": image_id,
        "source_image_id": source_image_id,
        "mode": mode,
        "selection": selection,
        "mpp": mpp,
        "status": STATUS_QUEUED,
        "created_at": _now(),
        # Epoch seconds: the worker derives hriv.count.wait from this —
        # created_at is second-precision and unusable for a histogram.
        "enqueued_at": time.time(),
        "started_at": None,
        "finished_at": None,
        "error": None,
    }
    await redis.set(_job_key(job_id), json.dumps(record), ex=ttl_seconds)
    return record


def _parse_record(raw: Any) -> dict[str, Any] | None:
    if raw is None:
        return None
    try:
        record = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return record if isinstance(record, dict) else None


async def get_record(redis: Redis, job_id: str) -> dict[str, Any] | None:
    return _parse_record(await redis.get(_job_key(job_id)))


async def update_status(
    redis: Redis,
    job_id: str,
    status: str,
    *,
    error: str | None = None,
) -> bool:
    """Transition a record's status; ``False`` when the record is gone.

    ``XX KEEPTTL`` guarantees a deleted (cancelled/expired) record is never
    recreated by a late worker write, and its remaining TTL is preserved.
    """
    record = await get_record(redis, job_id)
    if record is None:
        return False
    record["status"] = status
    if status == STATUS_RUNNING:
        record["started_at"] = _now()
    if status in (STATUS_DONE, STATUS_FAILED):
        record["finished_at"] = _now()
    if error is not None:
        record["error"] = error
    result = await redis.set(
        _job_key(job_id), json.dumps(record), xx=True, keepttl=True
    )
    return bool(result)


async def write_result(
    redis: Redis,
    job_id: str,
    result: dict[str, Any],
    ttl_seconds: int,
) -> None:
    """Persist the result payload, expiring with its job record.

    The result inherits the record's remaining TTL so a long queue wait
    never leaves an unreachable result behind; *ttl_seconds* is only the
    fallback when the record has no TTL to inherit.
    """
    remaining = await redis.ttl(_job_key(job_id))
    ex = remaining if remaining and remaining > 0 else ttl_seconds
    await redis.set(_result_key(job_id), json.dumps(result), ex=ex)


async def get_result(redis: Redis, job_id: str) -> dict[str, Any] | None:
    raw = await redis.get(_result_key(job_id))
    if raw is None:
        return None
    try:
        result = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return result if isinstance(result, dict) else None


async def delete_job(
    redis: Redis, *, job_id: str, user_id: int
) -> dict[str, Any] | None:
    """Atomically remove record, result and the owner's set entry.

    Returns the record as it was at deletion (None when already gone), so
    callers can make exactly-once decisions against the worker's
    ``update_status`` GET-then-``SET XX KEEPTTL`` write.
    """
    async with redis.pipeline(transaction=True) as pipe:
        pipe.get(_job_key(job_id))
        pipe.delete(_job_key(job_id), _result_key(job_id))
        pipe.srem(_user_key(user_id), job_id)
        raw, _, _ = await pipe.execute()
    return _parse_record(raw)


async def record_exists(redis: Redis, job_id: str) -> bool:
    return bool(await redis.exists(_job_key(job_id)))


async def reserve_active_slot(
    redis: Redis,
    *,
    user_id: int,
    job_id: str,
    cap: int,
    ttl_seconds: int,
) -> bool:
    """Reserve a per-user active-job slot; ``False`` when the cap is hit.

    Reserve-then-verify: the new id is added to the user's set first, then
    members whose records still exist and are queued/running are counted
    (dead members are pruned as a side effect). When over cap the
    reservation is rolled back. Two simultaneous creations each count the
    other, so races err toward rejecting — never toward exceeding.
    """
    ukey = _user_key(user_id)
    await redis.sadd(ukey, job_id)
    await redis.expire(ukey, ttl_seconds)
    members = await redis.smembers(ukey)
    if members:
        pipe = redis.pipeline(transaction=False)
        for member in members:
            pipe.get(_job_key(member))
        raws = await pipe.execute()
    else:
        raws = []

    active = 0
    dead: list[str] = []
    for member, raw in zip(members, raws):
        record = None
        if raw is not None:
            try:
                record = json.loads(raw)
            except (TypeError, ValueError):
                record = None
        if isinstance(record, dict) and record.get("status") in ACTIVE_STATUSES:
            active += 1
        else:
            dead.append(member)
    if dead:
        await redis.srem(ukey, *dead)
    if active > cap:
        await redis.srem(ukey, job_id)
        return False
    return True


async def release_active_slot(redis: Redis, *, user_id: int, job_id: str) -> None:
    await redis.srem(_user_key(user_id), job_id)


async def queue_position(
    redis: Redis, *, job_id: str, queue_name: str
) -> int | None:
    """0-based rank of *job_id* in the counting queue's arq sorted set."""
    return await redis.zrank(queue_name, job_id)
