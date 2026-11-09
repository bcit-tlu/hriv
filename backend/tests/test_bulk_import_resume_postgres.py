"""PostgreSQL regression tests for resumable bulk imports (#1173).

These exercise the real durable path end-to-end against a migrated
database: ``Job``/``JobItem`` snapshots, coordinator lease CAS, orphaned
item requeue, token-guarded finalization, and per-file ``SourceImage``
idempotency. Only the child-image pipeline itself is stubbed (no
pyvips/Redis needed).

Run with ``REORDER_FIXTURE_DATABASE_URL`` pointing at a migrated
database; skipped otherwise (CI provides one).
"""

import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

# Ensure pyvips can be imported even when libvips is not installed. Only
# stub when the real import fails — an unconditional stub would poison
# sys.modules for later test modules that need real libvips (CI has it).
try:
    import pyvips  # noqa: F401
except Exception:
    sys.modules["pyvips"] = MagicMock()
    sys.modules["pyvips.enums"] = MagicMock()

from app.bulk_import_jobs import (
    create_bulk_import_job,
    increment_coordinator_claims,
    requeue_orphaned_bulk_import_items,
    try_claim_bulk_import_coordinator,
)
from app.database import AppSession
from app.job_state import claim_job_items
from app.models import BulkImportJob, Job, JobItem, SourceImage
from app.routers.bulk_import import (
    _BulkImportProgress,
    _process_bulk_import_impl,
    _track_bulk_import_item,
)
from app.worker import EnqueueResult

DB_URL = os.environ.get("REORDER_FIXTURE_DATABASE_URL", "")

requires_db = pytest.mark.skipif(
    not DB_URL,
    reason="REORDER_FIXTURE_DATABASE_URL not set (needs PostgreSQL)",
)


_CREATED_BULK_IDS: list[int] = []


@pytest.fixture
async def db_factory():
    engine = create_async_engine(DB_URL)
    factory = async_sessionmaker(
        engine,
        expire_on_commit=False,
        sync_session_class=AppSession,
    )
    yield factory
    bulk_ids = list(_CREATED_BULK_IDS)
    _CREATED_BULK_IDS.clear()
    async with factory() as session:
        job_ids = (
            await session.execute(
                select(BulkImportJob.job_id).where(
                    BulkImportJob.id.in_(bulk_ids)
                )
            )
        ).scalars().all()
        job_ids = [j for j in job_ids if j is not None]
        if bulk_ids:
            await session.execute(
                delete(SourceImage).where(
                    SourceImage.bulk_import_job_id.in_(bulk_ids)
                )
            )
            await session.execute(
                delete(BulkImportJob).where(BulkImportJob.id.in_(bulk_ids))
            )
        if job_ids:
            await session.execute(
                delete(JobItem).where(JobItem.job_id.in_(job_ids))
            )
            await session.execute(delete(Job).where(Job.id.in_(job_ids)))
        await session.commit()
    await engine.dispose()


async def _create_import(db_factory, tmp_path, names=("a.png", "b.png", "c.png")):
    """Create staged files + BulkImportJob + durable Job/JobItem snapshot."""
    entries = []
    for name in names:
        path = tmp_path / f"{name}"
        path.write_bytes(b"fake-image-bytes")
        entries.append((name, str(path)))
    async with db_factory() as session:
        bulk = BulkImportJob(
            status="pending",
            total_count=len(entries),
            completed_count=0,
            failed_count=0,
            errors=[],
            file_manifest=[list(e) for e in entries],
        )
        session.add(bulk)
        await session.flush()
        job = await create_bulk_import_job(
            session,
            bulk_import_job=bulk,
            file_entries=entries,
            copyright=None,
            note=None,
            active=True,
            parallelism=4,
        )
        await session.commit()
        _CREATED_BULK_IDS.append(bulk.id)
        return bulk.id, job.id, entries


async def _fake_process_source_image(db_factory):
    """Stand-in for the real pipeline: mark the source image completed."""

    async def _run(source_image_id: int) -> None:
        async with db_factory() as session:
            src = await session.get(SourceImage, source_image_id)
            assert src is not None
            src.status = "completed"
            src.status_message = "Completed"
            await session.commit()

    return _run


def _patch_durable_sessions(monkeypatch, db_factory):
    """Point every durable-path session factory at the test database."""
    monkeypatch.setattr(
        "app.routers.bulk_import.async_session", db_factory
    )
    monkeypatch.setattr(
        "app.bulk_import_jobs.get_async_session", lambda: db_factory
    )


@requires_db
async def test_resume_after_mid_import_crash(
    db_factory, tmp_path, monkeypatch
) -> None:
    """#1173 regression: an API restart mid-import resumes, not restarts.

    Coordinator A claims the supervisor, drives one file to completion,
    then "crashes" leaving a second item orphaned in ``running`` and the
    supervisor lease expired. Coordinator B (a fresh claim, as a restarted
    API replica's sweep would spawn) must finish the remaining files with
    no duplicate ``SourceImage`` rows.
    """
    bulk_id, job_id, entries = await _create_import(db_factory, tmp_path)
    _patch_durable_sessions(monkeypatch, db_factory)
    monkeypatch.setattr(
        "app.routers.bulk_import.enqueue_process_source_image",
        AsyncMock(return_value=EnqueueResult("fallback", "queue_unavailable")),
    )
    monkeypatch.setattr(
        "app.routers.bulk_import.process_source_image",
        await _fake_process_source_image(db_factory),
    )

    # ── Coordinator A: claim, drive exactly one item, then die ──
    async with db_factory() as session:
        assert await try_claim_bulk_import_coordinator(
            session, job_id, token="tok-a", lease_seconds=120
        )
        await increment_coordinator_claims(session, job_id)
        claimed = await claim_job_items(session, job_id, 1, 300)
        await session.commit()
    assert len(claimed) == 1
    first = claimed[0]
    first_meta = first.metadata_ or {}
    await _track_bulk_import_item(
        bulk_import_job_id=bulk_id,
        supervisor_job_id=job_id,
        item_id=first.id,
        claim_token=first.claim_token,
        original_filename=str(first_meta["original_filename"]),
        stored_path=str(first_meta["stored_path"]),
        category_id=None,
        copyright=None,
        note=None,
        active=True,
        requested_by=None,
        batch_progress=_BulkImportProgress(
            last_child_advanced_at=time.monotonic()
        ),
    )

    # Orphan a second item mid-flight and expire the supervisor lease —
    # exactly the durable state an API crash leaves behind.
    async with db_factory() as session:
        orphan = await claim_job_items(session, job_id, 1, 300)
        assert len(orphan) == 1
        await session.commit()
        orphan_id = orphan[0].id
        past = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.execute(
            update(JobItem)
            .where(JobItem.id == orphan_id)
            .values(lease_expires_at=past)
        )
        await session.execute(
            update(Job)
            .where(Job.id == job_id)
            .values(
                coordinator_token="tok-a",
                coordinator_lease_expires_at=past,
            )
        )
        await session.commit()

    # ── Coordinator B: the post-restart sweep's fresh claim ──
    await _process_bulk_import_impl(bulk_id)

    async with db_factory() as session:
        bulk = await session.get(BulkImportJob, bulk_id)
        job = await session.get(Job, job_id)
        items = (
            await session.execute(
                select(JobItem).where(JobItem.job_id == job_id)
            )
        ).scalars().all()
        sources = (
            await session.execute(
                select(SourceImage).where(
                    SourceImage.bulk_import_job_id == bulk_id
                )
            )
        ).scalars().all()

    assert bulk.status == "completed"
    assert bulk.completed_count == 3
    assert bulk.failed_count == 0
    assert job.status == "completed"
    assert {i.status for i in items} == {"completed"}
    # No duplicate SourceImage rows: exactly one per staged file.
    assert len(sources) == 3
    assert {s.stored_path for s in sources} == {p for _, p in entries}
    # Every manifest file became a SourceImage — nothing orphaned.
    for _, stored in entries:
        assert Path(stored).exists()

    # A second coordinator pass is a no-op: the terminal domain row ends it.
    await _process_bulk_import_impl(bulk_id)
    async with db_factory() as session:
        sources_after = (
            await session.execute(
                select(SourceImage).where(
                    SourceImage.bulk_import_job_id == bulk_id
                )
            )
        ).scalars().all()
    assert len(sources_after) == 3


@requires_db
async def test_abandoned_import_cleans_orphaned_staged_files(
    db_factory, tmp_path, monkeypatch
) -> None:
    """Claim-cap abandonment terminates durable state AND staged files.

    A crash-looping import that exhausts ``max_coordinator_claims`` must
    reach a correct terminal state: ``BulkImportJob`` failed, ``Job``
    failed, items cancelled — and staged files that never became
    ``SourceImage`` rows removed from disk.
    """
    bulk_id, job_id, entries = await _create_import(
        db_factory, tmp_path, names=("x.png", "y.png")
    )
    _patch_durable_sessions(monkeypatch, db_factory)

    # Simulate repeated crashes: claims already at the cap.
    async with db_factory() as session:
        job = await session.get(Job, job_id)
        metadata = dict(job.metadata_ or {})
        metadata["coordinator_claims"] = metadata[
            "max_coordinator_claims"
        ]
        job.metadata_ = metadata
        await session.commit()

    await _process_bulk_import_impl(bulk_id)

    async with db_factory() as session:
        bulk = await session.get(BulkImportJob, bulk_id)
        job = await session.get(Job, job_id)
        items = (
            await session.execute(
                select(JobItem).where(JobItem.job_id == job_id)
            )
        ).scalars().all()
        sources = (
            await session.execute(
                select(SourceImage).where(
                    SourceImage.bulk_import_job_id == bulk_id
                )
            )
        ).scalars().all()

    assert bulk.status == "failed"
    assert job.status == "failed"
    assert {i.status for i in items} == {"cancelled"}
    assert sources == []
    # No orphaned staged files left on disk.
    for _, stored in entries:
        assert not Path(stored).exists()


@requires_db
async def test_requeue_orphaned_items_on_takeover(db_factory, tmp_path) -> None:
    """A new coordinator claim returns the dead coordinator's running
    items to ``queued`` so they are re-driven exactly once."""
    bulk_id, job_id, _ = await _create_import(
        db_factory, tmp_path, names=("only.png",)
    )
    async with db_factory() as session:
        assert await try_claim_bulk_import_coordinator(
            session, job_id, token="tok-old", lease_seconds=120
        )
        claimed = await claim_job_items(session, job_id, 1, 300)
        await session.commit()
        assert len(claimed) == 1
        item_id = claimed[0].id

    async with db_factory() as session:
        # New coordinator wins after lease expiry (forced here by direct
        # requeue, which is what takeover does unconditionally).
        requeued = await requeue_orphaned_bulk_import_items(session, job_id)
        await session.commit()
        item = await session.get(JobItem, item_id)

    assert requeued == 1
    assert item.status == "queued"
    assert item.claim_token is None
