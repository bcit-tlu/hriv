"""Measurement review: RBC detector, objective calibration, service and router."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pyvips
import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.dialects import postgresql

from app.measurement import service
from app.measurement.calibration import (
    CAMERA_PROFILES,
    DETECTOR_VERSION,
    RBC_APPARENT_DIAMETER_UM,
    estimate_scale,
)
from app.measurement.detector import (
    RbcMeasurement,
    load_work_image,
    measure_rbc_diameter,
)
from app.models import MeasurementFinding
from app.routers import measurements as router
from app.schemas import (
    MeasurementApprove,
    MeasurementBulkApprove,
    MeasurementScanRequest,
)
from app.worker import EnqueueResult, TaskQueueUnavailableError


# ── detector ──────────────────────────────────────────────


def _blood_film(radius: int, cols: int = 12, rows: int = 8) -> pyvips.Image:
    """Pink discs (with pale centres) on a near-white background."""
    pitch = radius * 3
    img = pyvips.Image.black(cols * pitch, rows * pitch, bands=3).new_from_image(
        [240, 236, 236]
    ).copy_memory()
    for r in range(rows):
        for c in range(cols):
            cx, cy = c * pitch + pitch // 2, r * pitch + pitch // 2
            img = img.draw_circle([215, 120, 140], cx, cy, radius, fill=True)
            img = img.draw_circle([240, 236, 236], cx, cy, max(1, radius // 3), fill=True)
    return img


def test_detector_measures_disc_diameter(tmp_path) -> None:
    path = tmp_path / "film.png"
    _blood_film(radius=10).write_to_file(str(path))
    work = load_work_image(str(path))
    m = measure_rbc_diameter(work, work.width)
    assert m is not None
    assert m.selected_count >= 90
    assert m.peak_fraction > 0.9
    assert 19 <= m.diameter_px <= 23  # 2r + 1, central pallor filled


def test_detector_scales_to_full_resolution(tmp_path) -> None:
    path = tmp_path / "film.png"
    _blood_film(radius=10).write_to_file(str(path))
    work = load_work_image(str(path))
    m = measure_rbc_diameter(work, work.width * 2)
    assert m is not None
    assert 38 <= m.diameter_px <= 46
    assert m.work_scale == pytest.approx(0.5)


def test_detector_returns_none_without_cells(tmp_path) -> None:
    path = tmp_path / "blank.png"
    pyvips.Image.black(400, 300, bands=3).new_from_image([240, 236, 236]).write_to_file(
        str(path)
    )
    assert measure_rbc_diameter(load_work_image(str(path)), 400) is None


def test_detector_returns_none_when_few_cells_dominate(tmp_path) -> None:
    """A handful of large blobs outweighing many small ones is not an RBC film."""
    img = _blood_film(radius=4, cols=6, rows=2)
    canvas = pyvips.Image.black(600, 300, bands=3).new_from_image([240, 236, 236])
    canvas = canvas.insert(img, 0, 0).copy_memory()
    for cx in (150, 300, 450):
        canvas = canvas.draw_circle([215, 120, 140], cx, 200, 40, fill=True)
    path = tmp_path / "blobs.png"
    canvas.write_to_file(str(path))
    assert measure_rbc_diameter(load_work_image(str(path)), 600) is None


# ── calibration ───────────────────────────────────────────


def _m(diameter: float, selected: int = 200, peak: float = 0.9) -> RbcMeasurement:
    return RbcMeasurement(diameter, selected, selected, peak, 1.0)


@pytest.mark.parametrize("objective", ["10", "40", "100"])
def test_estimate_picks_nearest_objective(objective: str) -> None:
    px_per_um = CAMERA_PROFILES[(2880, 2048)][objective]
    est = estimate_scale(_m(px_per_um * RBC_APPARENT_DIAMETER_UM * 1.1), 2880, 2048)
    assert est.objective == objective
    assert est.scale == px_per_um
    assert est.confidence > 0.5
    assert est.evidence["camera_profile"] == "2880x2048"


def test_binned_profile_is_half_scale() -> None:
    est = estimate_scale(_m(7.3 / 2 * RBC_APPARENT_DIAMETER_UM), 1440, 1024)
    assert est.objective == "40"
    assert est.scale == pytest.approx(3.65)


def test_confidence_drops_for_weak_or_ambiguous_measurements() -> None:
    strong = estimate_scale(_m(55), 2880, 2048).confidence
    assert estimate_scale(_m(55, selected=3), 2880, 2048).confidence < 0.3
    assert estimate_scale(_m(55, peak=0.3), 2880, 2048).confidence < strong
    # Geometric midpoint between ×10 and ×40 → no margin.
    midpoint = (2.0 * 7.3) ** 0.5 * RBC_APPARENT_DIAMETER_UM
    assert estimate_scale(_m(midpoint), 2880, 2048).confidence < 0.05
    # Far outside every objective.
    assert estimate_scale(_m(1000), 2880, 2048).confidence <= strong / 2


def test_unprofiled_camera_reports_raw_estimate_capped() -> None:
    est = estimate_scale(_m(75), 4032, 3024)
    assert est.objective is None
    assert est.scale == pytest.approx(10.0)
    assert est.confidence <= 0.3
    assert est.evidence["camera_profile"] is None


# ── service ───────────────────────────────────────────────


def test_scan_candidates_excludes_scaled_and_reviewed_images() -> None:
    sql = str(
        service.scan_candidates_stmt(10, category_id=4).compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )
    assert "measurement_findings.status != 'superseded'" in sql
    assert "NOT (images.metadata ? 'measurement_scale')" in sql
    assert "images.category_id = 4" in sql
    assert "LIMIT 10" in sql


def test_merge_preserves_unrelated_metadata() -> None:
    current = {"canvas_annotations": [{"id": "a"}], "locked_overlays": []}
    merged = service.merged_measurement_metadata(current, 7.3, "um", "rbc", 9)
    assert merged["canvas_annotations"] == [{"id": "a"}]
    assert merged["locked_overlays"] == []
    assert merged["measurement_scale"] == 7.3
    assert merged["measurement_unit"] == "um"
    assert merged["measurement_scale_source"] == "rbc"
    assert merged["measurement_finding_id"] == 9
    assert "measurement_scale" not in current


def _finding(**kw) -> SimpleNamespace:
    base = dict(
        id=5,
        image_id=11,
        status="pending",
        source="rbc",
        proposed_scale=7.3,
        proposed_unit="um",
        objective="40",
        confidence=0.8,
        evidence={},
        detector_version=DETECTOR_VERSION,
        approved_scale=None,
        approved_unit=None,
        reviewed_by=None,
        reviewed_at=None,
        created_at=datetime.now(timezone.utc),
    )
    return SimpleNamespace(**(base | kw))


def _image(**kw) -> SimpleNamespace:
    base = dict(
        id=11,
        name="slide",
        thumb="/api/tiles/3/thumb.jpeg",
        category_id=2,
        width=2880,
        height=2048,
        metadata_={"canvas_annotations": [{"id": "x"}]},
        version=4,
    )
    return SimpleNamespace(**(base | kw))


async def test_approve_finding_promotes_and_bumps_version() -> None:
    finding, image = _finding(), _image()
    await service.approve_finding(AsyncMock(), finding, image, reviewer_id=3)
    assert image.metadata_["measurement_scale"] == 7.3
    assert image.metadata_["measurement_scale_source"] == "rbc"
    assert image.metadata_["canvas_annotations"] == [{"id": "x"}]
    assert image.version == 5
    assert finding.status == "approved"
    assert finding.approved_scale == 7.3
    assert finding.reviewed_by == 3


async def test_approve_with_correction_is_manual() -> None:
    finding, image = _finding(), _image()
    await service.approve_finding(AsyncMock(), finding, image, 3, scale=18.7)
    assert image.metadata_["measurement_scale"] == 18.7
    assert image.metadata_["measurement_scale_source"] == "manual"
    assert finding.approved_scale == 18.7


async def test_approve_without_scale_raises() -> None:
    with pytest.raises(ValueError):
        await service.approve_finding(
            AsyncMock(), _finding(proposed_scale=None), _image(), 3
        )


async def test_scan_image_records_missing_source(monkeypatch) -> None:
    db = AsyncMock()
    db.add = MagicMock()
    db.scalar.return_value = None
    finding = await service.scan_image(db, _image())
    assert isinstance(finding, MeasurementFinding)
    assert finding.status == "pending"
    assert finding.proposed_scale is None
    assert finding.confidence == 0.0
    assert finding.evidence["reason"] == "source_missing"
    db.execute.assert_awaited_once()  # supersede prior pending
    db.add.assert_called_once_with(finding)


async def test_scan_image_records_estimate(monkeypatch, tmp_path) -> None:
    src = tmp_path / "s.png"
    src.write_bytes(b"x")
    db = AsyncMock()
    db.add = MagicMock()
    db.scalar.return_value = str(src)
    monkeypatch.setattr(
        service,
        "_detect",
        lambda path, w, h: estimate_scale(_m(55), w, h),
    )
    finding = await service.scan_image(db, _image())
    assert finding.objective == "40"
    assert finding.proposed_scale == 7.3
    assert finding.detector_version == DETECTOR_VERSION
    assert "reason" not in finding.evidence


async def test_scan_image_records_detector_failure(monkeypatch, tmp_path) -> None:
    src = tmp_path / "s.png"
    src.write_bytes(b"x")
    db = AsyncMock()
    db.add = MagicMock()
    db.scalar.return_value = str(src)

    def boom(*_a):
        raise pyvips.Error("bad file")

    monkeypatch.setattr(service, "_detect", boom)
    finding = await service.scan_image(db, _image())
    assert finding.evidence == {"reason": "detect_failed", "error": "Error"}


async def test_scan_images_commits_per_image(monkeypatch) -> None:
    sessions = []

    class _Session:
        def __init__(self):
            self.get = AsyncMock(side_effect=lambda _m, i: _image(id=i) if i != 2 else None)
            self.commit = AsyncMock()
            sessions.append(self)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    scan = AsyncMock()
    monkeypatch.setattr(service, "scan_image", scan)
    assert await service.scan_images(_Session, [1, 2, 3]) == 2
    assert scan.await_count == 2
    assert [s.commit.await_count for s in sessions] == [1, 0, 1]


async def test_scan_images_skips_images_scaled_since_queueing(monkeypatch) -> None:
    db = AsyncMock()
    db.get.return_value = _image(metadata_={"measurement_scale": 4.0})

    class _Factory:
        async def __aenter__(self):
            return db

        async def __aexit__(self, *a):
            return False

    scan = AsyncMock()
    monkeypatch.setattr(service, "scan_image", scan)
    assert await service.scan_images(_Factory, [11]) == 0
    scan.assert_not_awaited()


async def test_scan_images_drops_duplicate_pending_from_overlapping_scan(monkeypatch) -> None:
    from sqlalchemy.exc import IntegrityError

    db = AsyncMock()
    db.get.return_value = _image()
    db.commit.side_effect = [IntegrityError("insert", {}, Exception("dup")), None]

    class _Factory:
        async def __aenter__(self):
            return db

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(service, "scan_image", AsyncMock())
    assert await service.scan_images(_Factory, [11, 12]) == 1
    db.rollback.assert_awaited_once()


def test_reject_finding() -> None:
    f = _finding()
    service.reject_finding(f, 7)
    assert f.status == "rejected" and f.reviewed_by == 7 and f.reviewed_at


def test_model_shape() -> None:
    cols = MeasurementFinding.__table__.c
    assert next(iter(cols.image_id.foreign_keys)).ondelete == "CASCADE"
    assert next(iter(cols.reviewed_by.foreign_keys)).ondelete == "SET NULL"
    idx = {i.name: i for i in MeasurementFinding.__table__.indexes}
    pending = idx["uq_measurement_findings_pending_image"]
    assert pending.unique
    assert "status = 'pending'" in str(pending.dialect_options["postgresql"]["where"])


# ── router ────────────────────────────────────────────────


def _user(role: str = "instructor") -> SimpleNamespace:
    return SimpleNamespace(
        id=3, role=role, name="u", email="u@e.com", active=True, metadata_=None
    )


def _scalars(values):
    result = MagicMock()
    result.scalars.return_value = iter(values)
    return result


async def test_scan_enqueues(monkeypatch) -> None:
    db = AsyncMock()
    db.execute.return_value = _scalars([4, 5])
    enqueue = AsyncMock(return_value=EnqueueResult("queued", "submitted"))
    monkeypatch.setattr(router, "enqueue_measurement_scan", enqueue)
    bg = BackgroundTasks()
    out = await router.scan(MeasurementScanRequest(), bg, _user(), db)
    assert out.image_ids == [4, 5] and out.mode == "queued"
    enqueue.assert_awaited_once_with([4, 5])
    assert not bg.tasks


async def test_scan_fallback_runs_in_background(monkeypatch) -> None:
    db = AsyncMock()
    db.execute.return_value = _scalars([4])
    monkeypatch.setattr(
        router,
        "enqueue_measurement_scan",
        AsyncMock(return_value=EnqueueResult("fallback", "queue_unavailable")),
    )
    bg = BackgroundTasks()
    out = await router.scan(MeasurementScanRequest(limit=1), bg, _user(), db)
    assert out.mode == "fallback"
    assert bg.tasks[0].func is router.scan_images


async def test_scan_nothing_to_do(monkeypatch) -> None:
    db = AsyncMock()
    db.execute.return_value = _scalars([])
    enqueue = AsyncMock()
    monkeypatch.setattr(router, "enqueue_measurement_scan", enqueue)
    out = await router.scan(MeasurementScanRequest(), BackgroundTasks(), _user(), db)
    assert out.image_ids == []
    enqueue.assert_not_awaited()


async def test_scan_required_mode_unavailable(monkeypatch) -> None:
    db = AsyncMock()
    db.execute.return_value = _scalars([4])
    monkeypatch.setattr(
        router,
        "enqueue_measurement_scan",
        AsyncMock(side_effect=TaskQueueUnavailableError("queue_unavailable")),
    )
    with pytest.raises(HTTPException) as exc:
        await router.scan(MeasurementScanRequest(), BackgroundTasks(), _user(), db)
    assert exc.value.status_code == 503


def test_scan_limit_bounds() -> None:
    with pytest.raises(ValueError):
        MeasurementScanRequest(limit=0)
    with pytest.raises(ValueError):
        MeasurementScanRequest(limit=51)


async def test_list_findings_serializes_and_tokenizes_thumb() -> None:
    db = AsyncMock()
    db.scalar.return_value = 1
    rows = MagicMock()
    rows.all.return_value = [(_finding(), _image())]
    db.execute.return_value = rows
    page = await router.list_findings(
        _user(), db, "pending", None, 0.4, "confidence_desc", 50, 0
    )
    assert page.total == 1
    item = page.items[0].model_dump()
    assert item["image_name"] == "slide"
    assert "tile_token=" in item["image_thumb"]
    assert item["objective"] == "40"


def _db_with(finding, image) -> AsyncMock:
    db = AsyncMock()
    db.get.side_effect = lambda model, _id, **_kw: (
        finding if model is MeasurementFinding else image
    )
    return db


async def test_approve_endpoint(monkeypatch) -> None:
    bump = AsyncMock()
    monkeypatch.setattr(router, "bump_browse_revision", bump)
    finding, image = _finding(), _image()
    db = _db_with(finding, image)
    out = await router.approve(5, _user(), MeasurementApprove(scale=18.7), db)
    assert out.status == "approved" and out.approved_scale == 18.7
    assert image.metadata_["measurement_scale"] == 18.7
    bump.assert_awaited_once()
    db.commit.assert_awaited_once()


async def test_approve_endpoint_uncategorized_skips_browse_bump(monkeypatch) -> None:
    bump = AsyncMock()
    monkeypatch.setattr(router, "bump_browse_revision", bump)
    monkeypatch.setattr(router, "image_ids_in_collections", AsyncMock(return_value=set()))
    db = _db_with(_finding(), _image(category_id=None))
    await router.approve(5, _user(), None, db)
    bump.assert_not_awaited()


async def test_approve_endpoint_uncategorized_in_collection_bumps(monkeypatch) -> None:
    bump = AsyncMock()
    monkeypatch.setattr(router, "bump_browse_revision", bump)
    monkeypatch.setattr(router, "image_ids_in_collections", AsyncMock(return_value={11}))
    db = _db_with(_finding(), _image(category_id=None))
    await router.approve(5, _user(), None, db)
    bump.assert_awaited_once()


async def test_approve_endpoint_requires_scale() -> None:
    db = _db_with(_finding(proposed_scale=None), _image())
    with pytest.raises(HTTPException) as exc:
        await router.approve(5, _user(), None, db)
    assert exc.value.status_code == 422


@pytest.mark.parametrize(
    "finding,image,code",
    [
        (None, None, 404),
        (_finding(status="approved"), _image(), 409),
        (_finding(), None, 404),
    ],
)
async def test_approve_reject_errors(finding, image, code) -> None:
    for call in (
        lambda db: router.approve(5, _user(), None, db),
        lambda db: router.reject(5, _user(), db),
    ):
        with pytest.raises(HTTPException) as exc:
            await call(_db_with(finding, image))
        assert exc.value.status_code == code


async def test_reject_endpoint_leaves_metadata() -> None:
    finding, image = _finding(), _image()
    out = await router.reject(5, _user(), _db_with(finding, image))
    assert out.status == "rejected"
    assert "measurement_scale" not in image.metadata_


async def test_bulk_approve_skips_ineligible(monkeypatch) -> None:
    monkeypatch.setattr(router, "bump_browse_revision", AsyncMock())
    findings = {
        1: _finding(id=1, image_id=11),
        2: _finding(id=2, image_id=12, status="rejected"),
        3: _finding(id=3, image_id=13, proposed_scale=None),
    }
    images = {11: _image(id=11)}
    db = AsyncMock()
    db.get.side_effect = lambda model, i, **_kw: (
        findings.get(i) if model is MeasurementFinding else images.get(i)
    )
    out = await router.bulk_approve(
        MeasurementBulkApprove(ids=[1, 2, 3, 4, 1]), _user("admin"), db
    )
    assert out.approved == [1]
    assert out.skipped == [2, 3, 4]
    assert images[11].metadata_["measurement_scale"] == 7.3
    db.commit.assert_awaited_once()


async def test_bulk_approve_nothing_eligible_does_not_commit() -> None:
    db = AsyncMock()
    db.get.return_value = None
    out = await router.bulk_approve(MeasurementBulkApprove(ids=[9]), _user(), db)
    assert out.approved == [] and out.skipped == [9]
    db.commit.assert_not_awaited()


@pytest.mark.parametrize("role", ["student", "staff"])
async def test_reviewer_dependency_rejects_other_roles(role) -> None:
    from app.auth import require_role

    with pytest.raises(HTTPException) as exc:
        await require_role("admin", "instructor")(_user(role))
    assert exc.value.status_code == 403


def test_all_routes_require_reviewer_role() -> None:
    for route in router.router.routes:
        deps = {
            getattr(d.call, "__qualname__", "") for d in route.dependant.dependencies
        }
        assert any("require_role" in q for q in deps), route.path
