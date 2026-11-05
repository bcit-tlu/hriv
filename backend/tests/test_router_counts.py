"""Tests for the ephemeral count-job API (#1664): feature-flag gating,
create/poll/cancel semantics, visibility, budget, cap and queue health."""

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pyvips
import pytest
from arq.constants import health_check_key_suffix
from fakeredis import aioredis as fake_aioredis
from fastapi import HTTPException
from pydantic import ValidationError
from redis.exceptions import ConnectionError as RedisConnectionError

from app.counting import jobs
from app.counting.stitch import (
    InvalidSelection,
    RegionTooLarge,
    plan_region,
    Rect,
    read_dzi,
)
from app.database import settings
from app.routers import counts as counts_router
from app.routers.counts import (
    create_count,
    delete_count,
    get_count,
    require_counting_enabled,
)
from app.schemas import CountCreate, CountSelection

SID = 7
IMAGE_ID = 11
TILE_SIZE = 254
TILE_OVERLAP = 1


# ── fixtures & helpers ────────────────────────────────────


@pytest.fixture(scope="module")
def counting_tiles(tmp_path_factory) -> Path:
    """A real 800x800 DZI pyramid for source image 7."""
    base = tmp_path_factory.mktemp("count-tiles")
    src = pyvips.Image.black(800, 800).new_from_image([180, 200, 220])
    root = base / str(SID)
    root.mkdir()
    src.dzsave(
        str(root / "image"),
        tile_size=TILE_SIZE,
        overlap=TILE_OVERLAP,
        suffix=".png",
    )
    return base


@pytest.fixture
async def pool():
    pool = fake_aioredis.FakeRedis(decode_responses=True)
    yield pool
    await pool.aclose()


def _user(role: str = "admin", id: int = 1) -> SimpleNamespace:
    return SimpleNamespace(
        id=id,
        role=role,
        name=f"user{id}",
        email=f"u{id}@e.com",
        active=True,
        programs=[SimpleNamespace(id=1)],
        groups=[SimpleNamespace(id=2)],
        metadata_=None,
    )


def _image(
    *,
    active: bool = True,
    tile_sources: str = f"/api/tiles/{SID}/image.dzi",
) -> SimpleNamespace:
    return SimpleNamespace(
        id=IMAGE_ID,
        name="slide",
        active=active,
        tile_sources=tile_sources,
        category_id=3,
    )


def _db(img: SimpleNamespace | None) -> AsyncMock:
    db = AsyncMock()
    db.get.return_value = img
    return db


def _body(width: int = 200, height: int = 200, mode: str = "cells") -> CountCreate:
    return CountCreate(
        mode=mode, selection=CountSelection(x=10, y=10, width=width, height=height)
    )


def _enable(monkeypatch: pytest.MonkeyPatch, tiles_dir: Path) -> None:
    monkeypatch.setattr(settings, "counting_enabled", True)
    monkeypatch.setattr(settings, "tiles_dir", str(tiles_dir))
    monkeypatch.setattr(settings, "counting_queue_name", "arq:counting")


def _mock_pool(monkeypatch: pytest.MonkeyPatch, pool) -> None:
    monkeypatch.setattr(
        counts_router, "get_pool", AsyncMock(return_value=pool)
    )
    if not hasattr(pool, "enqueue_job"):
        pool.enqueue_job = AsyncMock(return_value=SimpleNamespace())


async def _live_worker(pool) -> None:
    await pool.set("arq:counting" + health_check_key_suffix, "alive")


# ── feature flag / schema surface ─────────────────────────


@pytest.mark.parametrize("reason,outcome", [
    ("selection_too_large", "rejected_too_large"),
    ("too_many_active_counts", "rejected_rate_limited"),
    ("counting_unavailable", "queue_unavailable"),
    ("invalid_selection", "rejected"),
    ("tiles_not_ready", "rejected"),
])
def test_rejection_outcome_increments_counter(monkeypatch, reason, outcome) -> None:
    counter = Mock()
    monkeypatch.setattr(jobs, "_count_jobs_counter", counter)
    counts_router._reject("nuclei", reason, image_id=IMAGE_ID)
    counter.add.assert_called_once_with(
        1, {"mode": "nuclei", "outcome": outcome, "reason": reason}
    )


def test_require_counting_enabled_404_when_off(monkeypatch) -> None:
    monkeypatch.setattr(settings, "counting_enabled", False)
    with pytest.raises(HTTPException) as exc:
        require_counting_enabled()
    assert exc.value.status_code == 404
    assert exc.value.detail == "Not Found"


def test_require_counting_enabled_passes_when_on(monkeypatch) -> None:
    monkeypatch.setattr(settings, "counting_enabled", True)
    assert require_counting_enabled() is None


def test_router_gated_by_counting_enabled_dependency() -> None:
    gates = [dep.dependency for dep in counts_router.router.dependencies]
    assert require_counting_enabled in gates


async def test_features_reports_counting_flag(monkeypatch) -> None:
    from app.main import features

    monkeypatch.setattr(settings, "counting_enabled", False)
    assert (await features()).counting is False
    monkeypatch.setattr(settings, "counting_enabled", True)
    assert (await features()).counting is True


def test_count_selection_requires_positive_size() -> None:
    with pytest.raises(ValidationError):
        CountSelection(x=0, y=0, width=0, height=10)
    with pytest.raises(ValidationError):
        CountSelection(x=0, y=0, width=10, height=-1)


# ── POST /images/{id}/counts ──────────────────────────────


@pytest.mark.parametrize("role", ["admin", "instructor", "staff", "student"])
async def test_create_count_202_for_every_role(
    monkeypatch, counting_tiles, pool, role
) -> None:
    """Any authenticated role gets 202 on a visible, tiled image."""
    _enable(monkeypatch, counting_tiles)
    _mock_pool(monkeypatch, pool)
    # Student role goes through the category-visibility gate; let it pass.
    monkeypatch.setattr(
        "app.routers.images.is_category_visible_to_student",
        AsyncMock(return_value=True),
    )
    await _live_worker(pool)
    counter = Mock()
    monkeypatch.setattr(jobs, "_count_jobs_counter", counter)

    out = await create_count(
        IMAGE_ID, _body(), _user(role=role, id=5), False, _db(_image())
    )
    assert out.status == "queued"
    counter.add.assert_called_once_with(1, {"mode": "cells", "outcome": "enqueued"})
    assert out.job_id
    record = await jobs.get_record(pool, out.job_id)
    assert record["user_id"] == 5
    assert record["image_id"] == IMAGE_ID
    assert record["source_image_id"] == SID
    assert record["mode"] == "cells"
    assert record["status"] == "queued"
    kwargs = pool.enqueue_job.await_args.kwargs
    assert kwargs["_job_id"] == out.job_id
    assert kwargs["_queue_name"] == "arq:counting"
    assert kwargs["_expires"] == settings.counting_result_ttl_seconds
    assert kwargs["mode"] == "cells"
    assert kwargs["image_id"] == IMAGE_ID
    # The record exists before the enqueue and carries the owner set entry.
    assert await pool.sismember("count:user:5", out.job_id)


async def test_create_count_student_hidden_image_404(
    monkeypatch, counting_tiles, pool
) -> None:
    """A student gets 404 (not 403) on an image hidden by visibility."""
    _enable(monkeypatch, counting_tiles)
    _mock_pool(monkeypatch, pool)
    monkeypatch.setattr(
        "app.routers.images.is_category_visible_to_student",
        AsyncMock(return_value=False),
    )
    with pytest.raises(HTTPException) as exc:
        await create_count(
            IMAGE_ID, _body(), _user(role="student"), False, _db(_image())
        )
    assert exc.value.status_code == 404


async def test_create_count_student_inactive_image_404(
    monkeypatch, counting_tiles, pool
) -> None:
    _enable(monkeypatch, counting_tiles)
    _mock_pool(monkeypatch, pool)
    with pytest.raises(HTTPException) as exc:
        await create_count(
            IMAGE_ID, _body(), _user(role="student"), False,
            _db(_image(active=False)),
        )
    assert exc.value.status_code == 404


async def test_create_count_missing_image_404(
    monkeypatch, counting_tiles, pool
) -> None:
    _enable(monkeypatch, counting_tiles)
    _mock_pool(monkeypatch, pool)
    with pytest.raises(HTTPException) as exc:
        await create_count(IMAGE_ID, _body(), _user(), False, _db(None))
    assert exc.value.status_code == 404


async def test_create_count_external_dzi_409(
    monkeypatch, counting_tiles, pool
) -> None:
    """External/catalogued DZI URLs have no local tile tree -> 409."""
    _enable(monkeypatch, counting_tiles)
    _mock_pool(monkeypatch, pool)
    img = _image(tile_sources="https://example.com/tiles/image.dzi")
    with pytest.raises(HTTPException) as exc:
        await create_count(IMAGE_ID, _body(), _user(), False, _db(img))
    assert exc.value.status_code == 409
    assert exc.value.detail == "tiles_not_ready"


async def test_create_count_missing_tiles_409(
    monkeypatch, counting_tiles, pool
) -> None:
    """A parseable tile URL with no pyramid on disk -> 409."""
    _enable(monkeypatch, counting_tiles)
    _mock_pool(monkeypatch, pool)
    img = _image(tile_sources="/api/tiles/999/image.dzi")
    with pytest.raises(HTTPException) as exc:
        await create_count(IMAGE_ID, _body(), _user(), False, _db(img))
    assert exc.value.status_code == 409
    assert exc.value.detail == "tiles_not_ready"


async def test_create_count_invalid_selection_422(
    monkeypatch, counting_tiles, pool
) -> None:
    """A selection fully outside the image -> 422 invalid_selection."""
    _enable(monkeypatch, counting_tiles)
    _mock_pool(monkeypatch, pool)
    await _live_worker(pool)
    body = CountCreate(
        mode="cells",
        selection=CountSelection(x=9000, y=9000, width=50, height=50),
    )
    with pytest.raises(HTTPException) as exc:
        await create_count(IMAGE_ID, body, _user(), False, _db(_image()))
    assert exc.value.status_code == 422
    assert exc.value.detail == "invalid_selection"


async def test_create_count_selection_too_large_422(
    monkeypatch, counting_tiles, pool
) -> None:
    """Over-budget selection -> 422 selection_too_large."""
    _enable(monkeypatch, counting_tiles)
    _mock_pool(monkeypatch, pool)
    await _live_worker(pool)
    monkeypatch.setattr(settings, "counting_max_pixels", 65_536)
    monkeypatch.setattr(settings, "counting_classical_max_pixels", 65_536)
    monkeypatch.setattr(settings, "counting_max_downsample", 1)
    body = CountCreate(
        mode="nuclei",
        selection=CountSelection(x=0, y=0, width=800, height=800),
    )
    with pytest.raises(HTTPException) as exc:
        await create_count(IMAGE_ID, body, _user(), False, _db(_image()))
    assert exc.value.status_code == 422
    assert exc.value.detail == "selection_too_large"


async def test_create_count_pool_unavailable_503(
    monkeypatch, counting_tiles
) -> None:
    _enable(monkeypatch, counting_tiles)
    monkeypatch.setattr(counts_router, "get_pool", AsyncMock(return_value=None))
    with pytest.raises(HTTPException) as exc:
        await create_count(IMAGE_ID, _body(), _user(), False, _db(_image()))
    assert exc.value.status_code == 503
    assert exc.value.detail == "counting_unavailable"


async def test_create_count_no_live_worker_503(
    monkeypatch, counting_tiles, pool
) -> None:
    """Redis is up but no counting worker heartbeat -> 503."""
    _enable(monkeypatch, counting_tiles)
    _mock_pool(monkeypatch, pool)
    with pytest.raises(HTTPException) as exc:
        await create_count(IMAGE_ID, _body(), _user(), False, _db(_image()))
    assert exc.value.status_code == 503
    assert exc.value.detail == "counting_unavailable"


class _BrokenRedis:
    """A cached pool whose Redis connection has gone away."""

    def __getattr__(self, name):
        async def _fail(*_args, **_kwargs):
            raise RedisConnectionError("Connection refused")

        return _fail


async def test_create_count_redis_down_after_pool_cached_503(
    monkeypatch, counting_tiles
) -> None:
    """A stale cached pool answers 503, never a 500 (review finding)."""
    _enable(monkeypatch, counting_tiles)
    monkeypatch.setattr(
        counts_router, "get_pool", AsyncMock(return_value=_BrokenRedis())
    )
    with pytest.raises(HTTPException) as exc:
        await create_count(IMAGE_ID, _body(), _user(), False, _db(_image()))
    assert exc.value.status_code == 503
    assert exc.value.detail == "counting_unavailable"


async def test_create_count_redis_drops_before_record_503(
    monkeypatch, counting_tiles, pool
) -> None:
    """Redis failing after the heartbeat check still maps to 503."""
    _enable(monkeypatch, counting_tiles)
    _mock_pool(monkeypatch, pool)
    await _live_worker(pool)
    monkeypatch.setattr(
        jobs, "create_record",
        AsyncMock(side_effect=RedisConnectionError("gone")),
    )
    with pytest.raises(HTTPException) as exc:
        await create_count(IMAGE_ID, _body(), _user(), False, _db(_image()))
    assert exc.value.status_code == 503


async def test_get_and_delete_count_redis_down_503(monkeypatch) -> None:
    monkeypatch.setattr(settings, "counting_enabled", True)
    monkeypatch.setattr(
        counts_router, "get_pool", AsyncMock(return_value=_BrokenRedis())
    )
    for make_call in (
        lambda: get_count("j", _user()),
        lambda: delete_count("j", _user(), False),
    ):
        with pytest.raises(HTTPException) as exc:
            await make_call()
        assert exc.value.status_code == 503
        assert exc.value.detail == "counting_unavailable"


async def test_write_result_inherits_record_ttl(pool) -> None:
    """Results expire with their record, not a fresh TTL (review finding)."""
    await jobs.create_record(
        pool, job_id="jt", user_id=1, image_id=IMAGE_ID,
        source_image_id=SID, mode="cells",
        selection={"x": 0, "y": 0, "width": 1, "height": 1},
        ttl_seconds=120,
    )
    await jobs.write_result(pool, "jt", {"total": 0}, 600)
    assert 0 < await pool.ttl("count:result:jt") <= 120
    # No record to inherit from -> the configured TTL is the fallback.
    await jobs.write_result(pool, "orphan", {"total": 0}, 600)
    assert 120 < await pool.ttl("count:result:orphan") <= 600


async def test_create_count_enqueue_failure_503_and_cleanup(
    monkeypatch, counting_tiles, pool
) -> None:
    """An enqueue failure deletes the record and frees the reservation."""
    _enable(monkeypatch, counting_tiles)
    _mock_pool(monkeypatch, pool)
    await _live_worker(pool)
    pool.enqueue_job = AsyncMock(side_effect=RuntimeError("redis gone"))
    with pytest.raises(HTTPException) as exc:
        await create_count(IMAGE_ID, _body(), _user(), False, _db(_image()))
    assert exc.value.status_code == 503
    # No job record or user-set residue left behind.
    assert await pool.smembers("count:user:1") == set()
    keys = await pool.keys("count:job:*")
    assert keys == []


async def test_create_count_per_user_cap_429(
    monkeypatch, counting_tiles, pool
) -> None:
    """Fourth concurrent active job -> 429 + Retry-After."""
    _enable(monkeypatch, counting_tiles)
    _mock_pool(monkeypatch, pool)
    await _live_worker(pool)
    for i in range(3):
        jid = f"existing-{i}"
        await jobs.create_record(
            pool, job_id=jid, user_id=1, image_id=IMAGE_ID,
            source_image_id=SID, mode="cells",
            selection={"x": 0, "y": 0, "width": 5, "height": 5},
            ttl_seconds=600,
        )
        await pool.sadd("count:user:1", jid)
    with pytest.raises(HTTPException) as exc:
        await create_count(IMAGE_ID, _body(), _user(), False, _db(_image()))
    assert exc.value.status_code == 429
    assert exc.value.detail == "too_many_active_counts"
    assert exc.value.headers["Retry-After"] == "10"
    # The failed reservation was rolled back.
    assert await pool.scard("count:user:1") == 3


async def test_create_count_prunes_dead_reservations(
    monkeypatch, counting_tiles, pool
) -> None:
    """Done/failed jobs in the user set don't consume the cap."""
    _enable(monkeypatch, counting_tiles)
    _mock_pool(monkeypatch, pool)
    await _live_worker(pool)
    for i in range(3):
        jid = f"dead-{i}"
        await jobs.create_record(
            pool, job_id=jid, user_id=1, image_id=IMAGE_ID,
            source_image_id=SID, mode="cells",
            selection={"x": 0, "y": 0, "width": 5, "height": 5},
            ttl_seconds=600,
        )
        await pool.sadd("count:user:1", jid)
        await jobs.update_status(pool, jid, jobs.STATUS_DONE)
    out = await create_count(
        IMAGE_ID, _body(), _user(), False, _db(_image())
    )
    assert out.status == "queued"
    # Dead members were pruned; only the new job remains.
    assert await pool.smembers("count:user:1") == {out.job_id}


# ── GET /counts/{job_id} ──────────────────────────────────


async def test_get_count_queued_shows_position(
    monkeypatch, pool
) -> None:
    monkeypatch.setattr(settings, "counting_enabled", True)
    _mock_pool(monkeypatch, pool)
    await jobs.create_record(
        pool, job_id="j1", user_id=1, image_id=IMAGE_ID,
        source_image_id=SID, mode="nuclei",
        selection={"x": 1, "y": 2, "width": 3, "height": 4},
        ttl_seconds=600,
    )
    await pool.zadd("arq:counting", {"other-job": 1.0, "j1": 2.0})
    out = await get_count("j1", _user())
    assert out.job_id == "j1"
    assert out.status == "queued"
    assert out.queue_position == 1
    assert out.mode == "nuclei"
    assert out.selection.x == 1
    assert out.total is None
    assert out.preview is None


async def test_get_count_done_returns_result(monkeypatch, pool) -> None:
    monkeypatch.setattr(settings, "counting_enabled", True)
    _mock_pool(monkeypatch, pool)
    await jobs.create_record(
        pool, job_id="j2", user_id=1, image_id=IMAGE_ID,
        source_image_id=SID, mode="cells",
        selection={"x": 0, "y": 0, "width": 10, "height": 10},
        ttl_seconds=600,
    )
    await jobs.update_status(pool, "j2", jobs.STATUS_DONE)
    result = {
        "total": 2,
        "groups": [{"group": 0, "count": 2}],
        "objects": [
            {"group": 0, "centroid": [1.0, 2.0],
             "polygon": [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]},
            {"group": 0, "centroid": [5.0, 5.0],
             "polygon": [[4.0, 4.0], [5.0, 4.0], [5.0, 5.0]]},
        ],
        "preview": "data:image/jpeg;base64,AAAA",
    }
    await jobs.write_result(pool, "j2", result, 600)
    out = await get_count("j2", _user())
    assert out.status == "done"
    assert out.queue_position is None
    assert out.total == 2
    assert out.groups[0].count == 2
    assert len(out.objects) == 2
    assert out.objects[0].centroid == [1.0, 2.0]
    assert out.preview == "data:image/jpeg;base64,AAAA"
    assert out.error is None


async def test_get_count_failed_shows_error(monkeypatch, pool) -> None:
    monkeypatch.setattr(settings, "counting_enabled", True)
    _mock_pool(monkeypatch, pool)
    await jobs.create_record(
        pool, job_id="j3", user_id=1, image_id=IMAGE_ID,
        source_image_id=SID, mode="cells",
        selection={"x": 0, "y": 0, "width": 10, "height": 10},
        ttl_seconds=600,
    )
    await jobs.update_status(pool, "j3", jobs.STATUS_FAILED, error="no_tiles")
    out = await get_count("j3", _user())
    assert out.status == "failed"
    assert out.error == "no_tiles"


async def test_get_count_other_user_404(monkeypatch, pool) -> None:
    monkeypatch.setattr(settings, "counting_enabled", True)
    _mock_pool(monkeypatch, pool)
    await jobs.create_record(
        pool, job_id="j4", user_id=1, image_id=IMAGE_ID,
        source_image_id=SID, mode="cells",
        selection={"x": 0, "y": 0, "width": 10, "height": 10},
        ttl_seconds=600,
    )
    with pytest.raises(HTTPException) as exc:
        await get_count("j4", _user(id=99))
    assert exc.value.status_code == 404


async def test_get_count_missing_404(monkeypatch, pool) -> None:
    monkeypatch.setattr(settings, "counting_enabled", True)
    _mock_pool(monkeypatch, pool)
    with pytest.raises(HTTPException) as exc:
        await get_count("nope", _user())
    assert exc.value.status_code == 404


async def test_get_count_pool_unavailable_503(monkeypatch) -> None:
    monkeypatch.setattr(settings, "counting_enabled", True)
    monkeypatch.setattr(counts_router, "get_pool", AsyncMock(return_value=None))
    with pytest.raises(HTTPException) as exc:
        await get_count("j", _user())
    assert exc.value.status_code == 503


# ── DELETE /counts/{job_id} ───────────────────────────────


async def test_delete_count_cancels_and_removes_keys(
    monkeypatch, pool
) -> None:
    monkeypatch.setattr(settings, "counting_enabled", True)
    _mock_pool(monkeypatch, pool)
    await jobs.create_record(
        pool, job_id="j5", user_id=1, image_id=IMAGE_ID,
        source_image_id=SID, mode="cells",
        selection={"x": 0, "y": 0, "width": 10, "height": 10},
        ttl_seconds=600,
    )
    await jobs.write_result(pool, "j5", {"total": 0}, 600)
    await pool.sadd("count:user:1", "j5")
    await pool.zadd("arq:counting", {"j5": 1.0})

    resp = await delete_count("j5", _user(), False)
    assert resp.status_code == 204
    assert await jobs.get_record(pool, "j5") is None
    assert await jobs.get_result(pool, "j5") is None
    assert await pool.smembers("count:user:1") == set()
    # The abort request landed on arq's abort sorted set.
    from arq.constants import abort_jobs_ss

    assert await pool.zrank(abort_jobs_ss, "j5") is not None


@pytest.mark.parametrize("status_key", ["queued", "running"])
async def test_delete_count_active_records_cancelled(
    monkeypatch, pool, status_key, caplog
) -> None:
    """DELETE of a queued/running job counts one `cancelled` outcome."""
    monkeypatch.setattr(settings, "counting_enabled", True)
    _mock_pool(monkeypatch, pool)
    counter = Mock()
    monkeypatch.setattr(jobs, "_count_jobs_counter", counter)
    await jobs.create_record(
        pool, job_id="ja", user_id=1, image_id=IMAGE_ID,
        source_image_id=SID, mode="cells",
        selection={"x": 0, "y": 0, "width": 10, "height": 10},
        ttl_seconds=600,
    )
    # create_record makes status queued; flip to running when asked.
    if status_key == "running":
        await jobs.update_status(pool, "ja", jobs.STATUS_RUNNING)

    with caplog.at_level("INFO"):
        resp = await delete_count("ja", _user(), False)
    assert resp.status_code == 204
    counter.add.assert_called_once_with(1, {"mode": "cells", "outcome": "cancelled"})
    event = next(r for r in caplog.records if getattr(r, "event", None) == "count.cancelled")
    assert event.duration_ms >= 0


@pytest.mark.parametrize("status_key", ["done", "failed"])
async def test_delete_count_finished_records_no_metric(
    monkeypatch, pool, status_key
) -> None:
    """Clearing a done/failed job removes keys without a `cancelled` outcome."""
    monkeypatch.setattr(settings, "counting_enabled", True)
    _mock_pool(monkeypatch, pool)
    calls = []
    monkeypatch.setattr(
        jobs, "record_count_job",
        lambda mode, outcome, **kw: calls.append((mode, outcome)),
    )
    await jobs.create_record(
        pool, job_id="jf", user_id=1, image_id=IMAGE_ID,
        source_image_id=SID, mode="cells",
        selection={"x": 0, "y": 0, "width": 10, "height": 10},
        ttl_seconds=600,
    )
    await jobs.update_status(pool, "jf", status_key)
    await jobs.write_result(pool, "jf", {"total": 0}, 600)
    await pool.sadd("count:user:1", "jf")

    resp = await delete_count("jf", _user(), False)
    assert resp.status_code == 204
    assert calls == []
    assert await jobs.get_record(pool, "jf") is None
    assert await jobs.get_result(pool, "jf") is None


async def test_delete_count_racing_worker_done_not_cancelled(
    monkeypatch, pool
) -> None:
    """Worker finishing mid-delete wins: `done` is not double-counted as
    `cancelled` — the status comes from the atomic delete_job."""
    monkeypatch.setattr(settings, "counting_enabled", True)
    _mock_pool(monkeypatch, pool)
    calls = []
    monkeypatch.setattr(
        jobs, "record_count_job",
        lambda mode, outcome, **kw: calls.append((mode, outcome)),
    )
    await jobs.create_record(
        pool, job_id="jr", user_id=1, image_id=IMAGE_ID,
        source_image_id=SID, mode="cells",
        selection={"x": 0, "y": 0, "width": 10, "height": 10},
        ttl_seconds=600,
    )
    await jobs.update_status(pool, "jr", jobs.STATUS_RUNNING)

    async def _worker_finishes(self, timeout=0):  # Job.abort stand-in
        await jobs.update_status(pool, "jr", jobs.STATUS_DONE)

    monkeypatch.setattr(counts_router.Job, "abort", _worker_finishes)

    resp = await delete_count("jr", _user(), False)
    assert resp.status_code == 204
    assert all(o != jobs.COUNT_OUTCOME_CANCELLED for _m, o in calls)
    assert await jobs.get_record(pool, "jr") is None
    assert await jobs.get_result(pool, "jr") is None


async def test_delete_job_returns_record_then_none(pool) -> None:
    await jobs.create_record(
        pool, job_id="jd", user_id=1, image_id=IMAGE_ID,
        source_image_id=SID, mode="cells",
        selection={"x": 0, "y": 0, "width": 10, "height": 10},
        ttl_seconds=600,
    )
    deleted = await jobs.delete_job(pool, job_id="jd", user_id=1)
    assert deleted is not None
    assert deleted["status"] == jobs.STATUS_QUEUED
    assert await jobs.delete_job(pool, job_id="jd", user_id=1) is None


async def test_delete_count_missing_is_idempotent_204(
    monkeypatch, pool
) -> None:
    monkeypatch.setattr(settings, "counting_enabled", True)
    _mock_pool(monkeypatch, pool)
    resp = await delete_count("ghost", _user(), False)
    assert resp.status_code == 204


async def test_delete_count_other_user_404(monkeypatch, pool) -> None:
    monkeypatch.setattr(settings, "counting_enabled", True)
    _mock_pool(monkeypatch, pool)
    await jobs.create_record(
        pool, job_id="j6", user_id=1, image_id=IMAGE_ID,
        source_image_id=SID, mode="cells",
        selection={"x": 0, "y": 0, "width": 10, "height": 10},
        ttl_seconds=600,
    )
    with pytest.raises(HTTPException) as exc:
        await delete_count("j6", _user(id=99), False)
    assert exc.value.status_code == 404
    # The victim's keys survive someone else's cancel attempt.
    assert await jobs.get_record(pool, "j6") is not None


# ── middleware 404 (flag off) ─────────────────────────────


async def _invoke_mw(path: str, method: str = "POST") -> int:
    from app.middleware import CountingFeatureMiddleware

    messages: list[dict] = []

    async def inner(scope, receive, send):
        messages.append({"type": "http.response.start", "status": 200})
        return None

    async def receive():
        return {"type": "http.request", "body": b"not-json"}

    async def send(message):
        messages.append(message)

    mw = CountingFeatureMiddleware(app=inner)
    scope = {"type": "http", "method": method, "path": path, "headers": []}
    await mw(scope, receive, send)
    starts = [m for m in messages if m["type"] == "http.response.start"]
    return starts[-1]["status"]


async def test_middleware_404s_counting_paths_when_off(monkeypatch) -> None:
    monkeypatch.setattr(settings, "counting_enabled", False)
    for path in (
        "/api/counts",
        "/api/counts/",
        "/api/counts/abc123",
        "/api/images/7/counts",
        "/api/images/-1/counts",
    ):
        assert await _invoke_mw(path) == 404, path


async def test_middleware_404s_malformed_post_before_parsing(
    monkeypatch,
) -> None:
    """A malformed body still answers 404 — never a 422 — while off."""
    monkeypatch.setattr(settings, "counting_enabled", False)
    assert await _invoke_mw("/api/images/7/counts") == 404


async def test_middleware_ignores_unrelated_paths(monkeypatch) -> None:
    monkeypatch.setattr(settings, "counting_enabled", False)
    for path in (
        "/api/countsx",
        "/api/images/7",
        "/api/images/counts",
        "/api/images/7/countsx",
        "/api/features",
    ):
        assert await _invoke_mw(path) == 200, path


async def test_middleware_passes_through_when_on(monkeypatch) -> None:
    monkeypatch.setattr(settings, "counting_enabled", True)
    assert await _invoke_mw("/api/counts/abc") == 200
    assert await _invoke_mw("/api/images/7/counts") == 200


# ── plan_region reuse sanity (API pre-flight params) ──────


def test_plan_region_rejects_what_router_rejects(counting_tiles) -> None:
    """The 422 paths above exercise these through the router directly."""
    dzi = read_dzi(counting_tiles / str(SID))
    with pytest.raises(InvalidSelection):
        plan_region(
            dzi, Rect(9000, 9000, 10, 10),
            margin_px=32, max_pixels=4_000_000, max_downsample=4,
        )
    with pytest.raises(RegionTooLarge):
        plan_region(
            dzi, Rect(0, 0, 800, 800),
            margin_px=32, max_pixels=65_536, max_downsample=1,
        )


async def test_create_count_preflight_classical_budget_202(
    monkeypatch, counting_tiles, pool
) -> None:
    """#1719: cells/classical selections over the ML budget but under the
    classical budget pre-flight OK (the fast outliner can run them)."""
    _enable(monkeypatch, counting_tiles)
    _mock_pool(monkeypatch, pool)
    await _live_worker(pool)
    monkeypatch.setattr(settings, "counting_max_pixels", 65_536)
    monkeypatch.setattr(settings, "counting_classical_max_pixels", 2_000_000)
    monkeypatch.setattr(settings, "counting_max_downsample", 1)
    # 800x800 = 640k: over the ML budget, under the classical one.
    body = CountCreate(
        mode="cells",
        selection=CountSelection(x=0, y=0, width=800, height=800),
    )
    result = await create_count(
        IMAGE_ID, body, _user(), False, _db(_image())
    )
    assert result.status == "queued"


async def test_create_count_preflight_instanseg_budget_422(
    monkeypatch, counting_tiles, pool
) -> None:
    """#1719: nuclei/instanseg selections between the budgets are rejected
    up front — the mode-aware pre-flight must not queue them to fail."""
    _enable(monkeypatch, counting_tiles)
    _mock_pool(monkeypatch, pool)
    await _live_worker(pool)
    monkeypatch.setattr(settings, "counting_max_pixels", 65_536)
    monkeypatch.setattr(settings, "counting_classical_max_pixels", 2_000_000)
    monkeypatch.setattr(settings, "counting_max_downsample", 1)
    body = CountCreate(
        mode="nuclei",
        selection=CountSelection(x=0, y=0, width=800, height=800),
    )
    with pytest.raises(HTTPException) as exc:
        await create_count(IMAGE_ID, body, _user(), False, _db(_image()))
    assert exc.value.status_code == 422
    assert exc.value.detail == "selection_too_large"


async def test_create_count_nuclei_no_mpp_too_large_422(
    monkeypatch, counting_tiles, pool
) -> None:
    """#1728 review: nuclei selections without mpp are pre-flighted at
    d=1 (the level rule can't coarsen them), so an over-budget box is
    rejected immediately instead of queueing to fail."""
    _enable(monkeypatch, counting_tiles)
    _mock_pool(monkeypatch, pool)
    await _live_worker(pool)
    monkeypatch.setattr(settings, "counting_nuclei_outliner", "instanseg")
    monkeypatch.setattr(settings, "counting_max_pixels", 65_536)
    monkeypatch.setattr(settings, "counting_classical_max_pixels", 2_000_000)
    monkeypatch.setattr(settings, "counting_max_downsample", 8)
    # The seeded image's mpp_x must not rescue this path — force it off.
    img = _image()
    img.metadata_ = {"mpp_x": None}
    body = CountCreate(
        mode="nuclei",
        selection=CountSelection(x=0, y=0, width=800, height=800),
    )
    with pytest.raises(HTTPException) as exc:
        await create_count(IMAGE_ID, body, _user(), False, _db(img))
    assert exc.value.status_code == 422
    assert exc.value.detail == "selection_too_large"


async def test_create_count_nuclei_malformed_mpp_treated_as_absent(
    monkeypatch, counting_tiles, pool
) -> None:
    """#1728 review: nuclei selections without mpp are pre-flighted at
    d=1 (the level rule can't coarsen them), so an over-budget box is
    rejected immediately instead of queueing to fail."""
    _enable(monkeypatch, counting_tiles)
    _mock_pool(monkeypatch, pool)
    await _live_worker(pool)
    monkeypatch.setattr(settings, "counting_nuclei_outliner", "instanseg")
    monkeypatch.setattr(settings, "counting_max_pixels", 65_536)
    monkeypatch.setattr(settings, "counting_classical_max_pixels", 2_000_000)
    monkeypatch.setattr(settings, "counting_max_downsample", 8)
    # The seeded image's mpp_x must not rescue this path — force it off.
    img = _image()
    img.metadata_ = {"mpp_x": "0.25um"}
    body = CountCreate(
        mode="nuclei",
        selection=CountSelection(x=0, y=0, width=800, height=800),
    )
    with pytest.raises(HTTPException) as exc:
        await create_count(IMAGE_ID, body, _user(), False, _db(img))
    assert exc.value.status_code == 422
    assert exc.value.detail == "selection_too_large"
