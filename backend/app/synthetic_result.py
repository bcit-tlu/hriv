"""Durable storage and schema for authoritative synthetic journey results."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator
from pydantic.config import ConfigDict
from redis.asyncio import Redis
from redis.exceptions import WatchError

from .rate_limit import _get_redis

logger = logging.getLogger(__name__)

SYNTHETIC_RESULT_EVENT_VERSION = 1
SYNTHETIC_RESULT_REDIS_KEY = "observability:synthetic:latest_result"

SYNTHETIC_STEP_NAMES = (
    "frontend",
    "login",
    "category",
    "image",
    "dzi",
    "tile",
)

SYNTHETIC_FAILURE_CODES = (
    "frontend_unreachable",
    "login_failed",
    "category_unavailable",
    "image_unavailable",
    "dzi_failed",
    "tile_failed",
    "timeout",
    "result_submission_failed",
    "unexpected_error",
)

SyntheticStepName = Literal[
    "frontend",
    "login",
    "category",
    "image",
    "dzi",
    "tile",
]
SyntheticFailureCode = Literal[
    "frontend_unreachable",
    "login_failed",
    "category_unavailable",
    "image_unavailable",
    "dzi_failed",
    "tile_failed",
    "timeout",
    "result_submission_failed",
    "unexpected_error",
]


class SyntheticResultStorageUnavailableError(RuntimeError):
    """Raised when authoritative synthetic-result storage is unavailable."""


class StaleSyntheticResultError(RuntimeError):
    """Raised when a synthetic result is older than the stored latest result."""

    def __init__(self, latest_completed_at: datetime):
        self.latest_completed_at = latest_completed_at
        super().__init__(
            "Synthetic result is stale relative to the stored latest completion time."
        )


class SyntheticJourneyStep(BaseModel):
    """Bounded result for a single synthetic journey step."""

    model_config = ConfigDict(extra="forbid")

    name: SyntheticStepName
    success: bool
    duration_ms: float = Field(..., ge=0)


class SyntheticJourneyResult(BaseModel):
    """Authoritative summary emitted by the Playwright synthetic journey."""

    model_config = ConfigDict(extra="forbid")

    event_version: Literal[1]
    started_at: datetime
    completed_at: datetime
    success: bool
    duration_ms: float = Field(..., ge=0)
    failure_code: SyntheticFailureCode | None = None
    component_version: str | None = Field(None, min_length=1, max_length=64)
    steps: list[SyntheticJourneyStep] = Field(
        ..., min_length=1, max_length=len(SYNTHETIC_STEP_NAMES)
    )

    @field_validator("started_at", "completed_at")
    @classmethod
    def _require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Timestamps must include a timezone offset.")
        return value

    @model_validator(mode="after")
    def _validate_consistency(self) -> "SyntheticJourneyResult":
        if self.completed_at < self.started_at:
            raise ValueError("completed_at must be greater than or equal to started_at.")
        if self.success:
            if self.failure_code is not None:
                raise ValueError("Successful results must not include a failure_code.")
            if any(not step.success for step in self.steps):
                raise ValueError("Successful results must not include failed steps.")
        elif self.failure_code is None:
            raise ValueError("Failed results must include a failure_code.")

        step_names = [step.name for step in self.steps]
        if len(step_names) != len(set(step_names)):
            raise ValueError("Step names must be unique within a result.")

        return self


class StoredSyntheticJourneyState(BaseModel):
    """Redis-persisted authoritative synthetic result state."""

    model_config = ConfigDict(extra="forbid")

    latest_result: SyntheticJourneyResult
    last_success_completed_at: datetime | None = None
    updated_at: datetime

    @field_validator("last_success_completed_at", "updated_at")
    @classmethod
    def _require_optional_timezone(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Timestamps must include a timezone offset.")
        return value


def _parse_stored_state(raw: str | bytes | None) -> StoredSyntheticJourneyState | None:
    """Parse the stored Redis value into the strongly typed state model."""
    if raw in (None, ""):
        return None

    try:
        return StoredSyntheticJourneyState.model_validate_json(raw)
    except ValidationError:
        logger.warning(
            "Stored synthetic journey result state is invalid; ignoring it",
            extra={"event": "synthetic.result_state_invalid"},
        )
        return None


def _build_stored_state(
    result: SyntheticJourneyResult,
    previous: StoredSyntheticJourneyState | None,
) -> StoredSyntheticJourneyState:
    """Build the Redis-persisted authoritative state after accepting *result*."""
    last_success_completed_at = (
        result.completed_at if result.success else previous.last_success_completed_at if previous else None
    )
    return StoredSyntheticJourneyState(
        latest_result=result,
        last_success_completed_at=last_success_completed_at,
        updated_at=datetime.now(result.completed_at.tzinfo),
    )


async def load_stored_synthetic_result_state(
    redis_client: Redis | None = None,
) -> StoredSyntheticJourneyState | None:
    """Return the currently stored synthetic result state, if any."""
    redis = redis_client or await _get_redis()
    if redis is None:
        return None

    try:
        raw = await redis.get(SYNTHETIC_RESULT_REDIS_KEY)
    except Exception:
        logger.warning(
            "Redis operation failed while loading synthetic result state",
            extra={"event": "synthetic.result_state_load_failed"},
        )
        return None
    return _parse_stored_state(raw)


async def store_synthetic_result(
    result: SyntheticJourneyResult,
    redis_client: Redis | None = None,
) -> StoredSyntheticJourneyState:
    """Atomically persist *result* as the latest authoritative synthetic state."""
    redis = redis_client or await _get_redis()
    if redis is None:
        raise SyntheticResultStorageUnavailableError

    while True:
        pipe = redis.pipeline()
        try:
            await pipe.watch(SYNTHETIC_RESULT_REDIS_KEY)
            current = _parse_stored_state(await pipe.get(SYNTHETIC_RESULT_REDIS_KEY))
            if (
                current is not None
                and result.completed_at <= current.latest_result.completed_at
            ):
                raise StaleSyntheticResultError(current.latest_result.completed_at)

            state = _build_stored_state(result, current)
            pipe.multi()
            pipe.set(SYNTHETIC_RESULT_REDIS_KEY, state.model_dump_json())
            await pipe.execute()
            return state
        except WatchError:
            continue
        except Exception as exc:
            if isinstance(exc, StaleSyntheticResultError):
                raise
            logger.warning(
                "Redis operation failed while storing synthetic result",
                extra={
                    "event": "synthetic.result_store_failed",
                    "error": str(exc),
                },
            )
            raise SyntheticResultStorageUnavailableError from exc
        finally:
            await pipe.reset()
