"""Tests for the read-only jobs router endpoints."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.routers.jobs import get_job, list_jobs


def _mock_scalars(rows: list[object]) -> MagicMock:
    scalars = MagicMock()
    scalars.all.return_value = rows
    result = MagicMock()
    result.scalars.return_value = scalars
    return result


def _mock_scalar_one_or_none(row: object | None) -> MagicMock:
    result = MagicMock()
    result.scalar_one_or_none.return_value = row
    return result


async def test_list_jobs_returns_rows_newest_first() -> None:
    rows = [
        SimpleNamespace(id=2, job_type="rebuild", status="running"),
        SimpleNamespace(id=1, job_type="rebuild", status="completed"),
    ]
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalars(rows))

    result = await list_jobs(db, None)

    assert result == rows


async def test_get_job_returns_job_with_items() -> None:
    job = SimpleNamespace(
        id=5,
        job_type="rebuild",
        status="running",
        items=[SimpleNamespace(id=1, job_id=5, status="running")],
    )
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalar_one_or_none(job))

    result = await get_job(5, db, None)

    assert result is job


async def test_get_job_raises_404_when_missing() -> None:
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_mock_scalar_one_or_none(None))

    with pytest.raises(HTTPException) as exc_info:
        await get_job(404, db, None)

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Job not found"
