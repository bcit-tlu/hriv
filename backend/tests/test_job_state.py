from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.job_state import (
    TERMINAL_JOB_ITEM_STATUSES,
    JobItemSpec,
    add_job_item_snapshot,
    aggregate_job_items,
    claim_job_items,
    finalize_job_item,
    heartbeat_job_item,
    reclaim_expired_job_items,
    refresh_job_aggregate,
)


def _execute_result(*, rows=None, rowcount=0, scalar=None):
    result = MagicMock()
    result.rowcount = rowcount
    result.all.return_value = rows or []
    result.scalar_one_or_none.return_value = scalar
    scalars = MagicMock()
    scalars.all.return_value = rows or []
    result.scalars.return_value = scalars
    return result


def test_terminal_item_statuses_include_skipped() -> None:
    assert TERMINAL_JOB_ITEM_STATUSES == {
        "completed",
        "skipped",
        "failed",
        "cancelled",
    }


def test_add_job_item_snapshot_rejects_duplicate_resources() -> None:
    session = MagicMock()
    job = SimpleNamespace(id=7)
    resources = [
        JobItemSpec("source_image", "42"),
        JobItemSpec("source_image", "42"),
    ]

    with pytest.raises(ValueError, match="Duplicate job item resource"):
        add_job_item_snapshot(session, job, resources)

    session.add_all.assert_not_called()


def test_add_job_item_snapshot_initializes_job_counts() -> None:
    session = MagicMock()
    job = SimpleNamespace(
        id=7,
        total_count=99,
        completed_count=4,
        skipped_count=2,
        failed_count=1,
        cancelled_count=3,
        progress=50,
    )

    items = add_job_item_snapshot(
        session,
        job,
        [
            JobItemSpec("source_image", "42", {"filename": "a.svs"}),
            JobItemSpec("source_image", "43"),
        ],
    )

    assert [item.resource_id for item in items] == ["42", "43"]
    assert items[0].metadata_ == {"filename": "a.svs"}
    assert job.total_count == 2
    assert job.completed_count == 0
    assert job.skipped_count == 0
    assert job.failed_count == 0
    assert job.cancelled_count == 0
    assert job.progress == 0
    session.add_all.assert_called_once_with(items)


@pytest.mark.parametrize("limit", [0, -1])
async def test_claim_job_items_returns_empty_for_nonpositive_limit(limit: int) -> None:
    session = MagicMock()
    session.execute = AsyncMock()

    assert await claim_job_items(session, 7, limit, 60) == []
    session.execute.assert_not_called()


async def test_claim_job_items_uses_skip_locked_and_assigns_claims() -> None:
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    first = SimpleNamespace(id=1, attempts=0)
    second = SimpleNamespace(id=2, attempts=3)
    session = MagicMock()
    session.execute = AsyncMock(
        return_value=_execute_result(rows=[first, second])
    )
    session.flush = AsyncMock()

    claimed = await claim_job_items(
        session,
        job_id=7,
        limit=2,
        lease_seconds=90,
        arq_job_id="arq-7",
        now=now,
    )

    statement = session.execute.call_args.args[0]
    assert statement._for_update_arg.skip_locked is True
    assert claimed == [first, second]
    for item, attempts in ((first, 1), (second, 4)):
        assert item.status == "running"
        assert item.attempts == attempts
        assert item.claim_token is not None
        assert len(item.claim_token) == 32
        assert item.heartbeat_at == now
        assert item.lease_expires_at == now + timedelta(seconds=90)
        assert item.arq_job_id == "arq-7"
        assert item.started_at == now
    session.flush.assert_awaited_once()


async def test_heartbeat_only_updates_the_current_claim() -> None:
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    session = MagicMock()
    session.execute = AsyncMock(return_value=_execute_result(rowcount=1))

    assert await heartbeat_job_item(session, 11, "claim-token", 60, now=now)
    statement = session.execute.call_args.args[0]
    rendered = str(statement)
    assert "claim_token" in rendered
    assert "status" in rendered


@pytest.mark.parametrize("status", ["queued", "running"])
async def test_finalize_rejects_nonterminal_status(status: str) -> None:
    session = MagicMock()

    with pytest.raises(ValueError, match="Invalid terminal item status"):
        await finalize_job_item(session, 11, "claim-token", status)  # type: ignore[arg-type]


async def test_finalize_clears_lease_and_marks_skipped() -> None:
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    session = MagicMock()
    session.execute = AsyncMock(return_value=_execute_result(rowcount=1))

    assert await finalize_job_item(
        session,
        11,
        "claim-token",
        "skipped",
        now=now,
    )
    statement = session.execute.call_args.args[0]
    values = {
        key.name: value.value for key, value in statement._values.items()
    }
    assert values["status"] == "skipped"
    assert values["progress"] == 100
    assert values["claim_token"] is None
    assert values["heartbeat_at"] is None
    assert values["lease_expires_at"] is None


async def test_finalize_returns_false_for_stale_claim() -> None:
    session = MagicMock()
    session.execute = AsyncMock(return_value=_execute_result(rowcount=0))

    assert not await finalize_job_item(
        session,
        11,
        "stale-token",
        "failed",
        error_message="failed",
    )


async def test_reclaim_expired_job_items_is_bounded() -> None:
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    session = MagicMock()
    session.execute = AsyncMock(return_value=_execute_result(rowcount=2))

    assert await reclaim_expired_job_items(
        session,
        job_id=7,
        now=now,
        limit=2,
    ) == 2
    statement = session.execute.call_args.args[0]
    assert statement.table.name == "job_items"
    assert statement._values[next(
        key for key in statement._values if key.name == "status"
    )].value == "queued"
    assert "job_items.status" in str(statement)
    assert "job_items.lease_expires_at" in str(statement)


async def test_aggregate_job_items_counts_terminal_progress() -> None:
    session = MagicMock()
    session.execute = AsyncMock(
        return_value=_execute_result(
            rows=[
                ("completed", 2),
                ("skipped", 1),
                ("failed", 1),
                ("queued", 2),
            ]
        )
    )

    counts = await aggregate_job_items(session, 7)

    assert counts["total_count"] == 6
    assert counts["completed_count"] == 2
    assert counts["skipped_count"] == 1
    assert counts["failed_count"] == 1
    assert counts["cancelled_count"] == 0
    assert counts["progress"] == 66


async def test_refresh_job_aggregate_persists_item_derived_counts() -> None:
    job = SimpleNamespace(
        total_count=0,
        completed_count=0,
        skipped_count=0,
        failed_count=0,
        cancelled_count=0,
        progress=0,
    )
    session = MagicMock()
    session.execute = AsyncMock(
        side_effect=[
            _execute_result(scalar=job),
            _execute_result(rows=[("completed", 1), ("skipped", 1)]),
        ]
    )
    session.flush = AsyncMock()

    counts = await refresh_job_aggregate(session, 7)

    assert counts["progress"] == 100
    assert job.total_count == 2
    assert job.completed_count == 1
    assert job.skipped_count == 1
    assert job.progress == 100
    session.flush.assert_awaited_once()
