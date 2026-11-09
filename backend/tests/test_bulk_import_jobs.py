"""Unit tests for ``app.bulk_import_jobs`` — the durable bulk-import
supervisor/item service (#1173). Session-param functions are exercised
against a mocked ``AsyncSession``; self-contained finalize paths patch
``get_async_session`` to yield the same mock.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app import bulk_import_jobs as svc
from app.models import BulkImportJob, Job, JobItem


def _session():
    db = AsyncMock()
    db.add = MagicMock()
    db.add_all = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    db.execute = AsyncMock()
    return db


def _bulk(**over):
    base = dict(
        id=7,
        status="pending",
        job_id=None,
        requested_by=3,
        category_id=1,
    )
    base.update(over)
    return SimpleNamespace(**base)


def test_bulk_import_resource_id_is_stable_and_bounded():
    rid = svc.bulk_import_resource_id("/very/long/path/image.png")
    assert rid == svc.bulk_import_resource_id("/very/long/path/image.png")
    assert rid != svc.bulk_import_resource_id("/very/long/path/other.png")
    assert len(rid) == 64  # sha256 hex — fits resource_id's 255-char limit


def test_bulk_import_source_arq_job_id_format():
    assert (
        svc.bulk_import_source_arq_job_id(42)
        == "process-source-image:42"
    )


def test_coordinator_claims_parsing():
    assert svc.coordinator_claims(None) == 0
    assert svc.coordinator_claims({}) == 0
    assert svc.coordinator_claims({"coordinator_claims": 4}) == 4
    assert svc.coordinator_claims({"coordinator_claims": "x"}) == 0
    assert svc.coordinator_claims({"coordinator_claims": -1}) == 0


async def test_create_bulk_import_job_snapshots_supervisor_and_items():
    db = _session()
    bulk = _bulk(id=7)
    added: list[object] = []
    db.add.side_effect = added.append

    job = await svc.create_bulk_import_job(
        db,
        bulk_import_job=bulk,
        file_entries=[("a.png", "/data/a.png"), ("b.png", "/data/b.png")],
        copyright="CC0",
        note=None,
        active=True,
        parallelism=4,
    )

    assert job.job_type == "bulk_import"
    assert job.status == "running"
    assert job.started_at is not None
    assert job.total_count == 2
    assert job.metadata_["bulk_import_job_id"] == 7
    assert job.metadata_["coordinator_claims"] == 0
    assert job.metadata_["parallelism"] == 4
    # The domain row is linked to the supervisor (job.id assigned by flush
    # in production; both stay None under the mock).
    assert bulk.job_id == job.id
    # The Job was added individually; both JobItem snapshots went through
    # add_all in one call.
    assert added == [job]
    items_arg = db.add_all.call_args.args[0]
    assert len(items_arg) == 2
    assert {i.resource_type for i in items_arg} == {"bulk_import_file"}


async def test_load_bulk_import_supervisor_variants():
    db = _session()
    # Legacy row without durable link → None
    db.get = AsyncMock(return_value=_bulk(job_id=None))
    assert await svc.load_bulk_import_supervisor(db, 7) is None

    # Durable link but wrong job_type → None
    db.get = AsyncMock(
        side_effect=lambda model, pk: (
            _bulk(job_id=55)
            if model is BulkImportJob
            else SimpleNamespace(job_type="rebuild_tiles")
        )
    )
    assert await svc.load_bulk_import_supervisor(db, 7) is None

    # Happy path → (bulk, job)
    job = SimpleNamespace(id=55, job_type="bulk_import", status="running")
    bulk = _bulk(job_id=55)
    db.get = AsyncMock(
        side_effect=lambda model, pk: bulk if model is BulkImportJob else job
    )
    ctx = await svc.load_bulk_import_supervisor(db, 7)
    assert ctx == (bulk, job)


async def test_try_claim_coordinator_cas():
    db = _session()
    result = MagicMock()
    result.rowcount = 1
    db.execute = AsyncMock(return_value=result)
    assert await svc.try_claim_bulk_import_coordinator(
        db, 55, token="tok", lease_seconds=120
    )
    result.rowcount = 0
    assert not await svc.try_claim_bulk_import_coordinator(
        db, 55, token="tok", lease_seconds=120
    )


async def test_heartbeat_and_release_coordinator():
    db = _session()
    result = MagicMock()
    result.rowcount = 1
    db.execute = AsyncMock(return_value=result)
    assert await svc.heartbeat_bulk_import_coordinator(
        db, 55, "tok", 120
    )
    await svc.release_bulk_import_coordinator(db, 55, "tok")
    assert db.execute.await_count == 2


async def test_increment_coordinator_claims():
    db = _session()
    job = SimpleNamespace(
        id=55, metadata_={"coordinator_claims": 2}
    )
    db.get = AsyncMock(return_value=job)
    new = await svc.increment_coordinator_claims(db, 55)
    assert new == 3
    assert job.metadata_["coordinator_claims"] == 3


async def test_requeue_orphaned_items_returns_rowcount():
    db = _session()
    result = MagicMock()
    result.rowcount = 2
    db.execute = AsyncMock(return_value=result)
    assert await svc.requeue_orphaned_bulk_import_items(db, 55) == 2


async def test_reclaim_requeues_and_exhausts():
    db = _session()
    running = SimpleNamespace(
        id=1,
        status="running",
        attempts=1,
        claim_token="t",
        heartbeat_at=datetime.now(timezone.utc),
        lease_expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
        retry_not_before=None,
        arq_job_id="j",
        started_at=None,
        completed_at=None,
        updated_at=None,
        metadata_={"original_filename": "a.png"},
        error_message=None,
        progress=50,
    )
    exhausted = SimpleNamespace(
        id=2,
        status="running",
        attempts=3,
        claim_token="t",
        heartbeat_at=datetime.now(timezone.utc),
        lease_expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
        retry_not_before=None,
        arq_job_id=None,
        started_at=None,
        completed_at=None,
        updated_at=None,
        metadata_={"original_filename": "b.png"},
        error_message=None,
        progress=10,
    )
    select_result = MagicMock()
    select_result.scalars.return_value.all.return_value = [running, exhausted]
    # First execute = the SELECT; second = _record_bulk_import_failure UPDATE.
    db.execute = AsyncMock(
        side_effect=[select_result, MagicMock(), MagicMock()]
    )

    requeued, exhausted_count = await svc.reclaim_expired_bulk_import_items(
        db, 55, 7, max_attempts=3
    )

    assert (requeued, exhausted_count) == (1, 1)
    assert running.status == "queued"
    assert exhausted.status == "failed"
    assert "abandoned" in exhausted.error_message


async def test_finalize_bulk_import_item_won_and_lost():
    db = _session()
    # finalize_job_item returns won → counters + aggregate + commit.
    with (
        patch(
            "app.bulk_import_jobs.get_async_session",
            lambda: (lambda: _AsyncCtx(db)),
        ),
        patch(
            "app.bulk_import_jobs.finalize_job_item",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch(
            "app.bulk_import_jobs.aggregate_job_items",
            new_callable=AsyncMock,
            return_value={"queued": 0, "running": 0},
        ),
        patch(
            "app.bulk_import_jobs._bulk_import_counters",
            new_callable=AsyncMock,
            return_value=(2, 0),
        ),
        patch(
            "app.bulk_import_jobs.refresh_bulk_import_supervisor",
            new_callable=AsyncMock,
            return_value={},
        ),
    ):
        db.get = AsyncMock(
            return_value=SimpleNamespace(
                id=7, status="processing", completed_count=2, failed_count=0
            )
        )
        won = await svc.finalize_bulk_import_item(
            job_id=55,
            item_id=9,
            claim_token="tok",
            bulk_import_job_id=7,
            filename="a.png",
            terminal_status="completed",
        )
        assert won is True
        db.commit.assert_awaited_once()

    # Lost claim → rollback, no counter writes.
    db2 = _session()
    with (
        patch(
            "app.bulk_import_jobs.get_async_session",
            lambda: (lambda: _AsyncCtx(db2)),
        ),
        patch(
            "app.bulk_import_jobs.finalize_job_item",
            new_callable=AsyncMock,
            return_value=False,
        ),
    ):
        won = await svc.finalize_bulk_import_item(
            job_id=55,
            item_id=9,
            claim_token="stale",
            bulk_import_job_id=7,
            filename="a.png",
            terminal_status="completed",
        )
        assert won is False
        db2.rollback.assert_awaited_once()
        db2.commit.assert_not_awaited()


class _AsyncCtx:
    """Minimal async-context wrapper around a mock session."""

    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *exc):
        return False


async def test_list_active_bulk_import_supervisors_lease_flag():
    db = _session()
    now = datetime.now(timezone.utc)
    result = MagicMock()
    result.all.return_value = [
        (1, 55, "running", None),  # no lease → free
        (2, 56, "running", now + timedelta(seconds=60)),  # held
        (3, 57, "running", now - timedelta(seconds=1)),  # expired → free
    ]
    db.execute = AsyncMock(return_value=result)

    rows = await svc.list_active_bulk_import_supervisors(db)

    assert [r["bulk_import_job_id"] for r in rows] == [1, 2, 3]
    assert rows[0]["lease_free"] is True
    assert rows[1]["lease_free"] is False
    assert rows[2]["lease_free"] is True
