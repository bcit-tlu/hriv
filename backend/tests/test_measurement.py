"""Measurement review: RBC detector, objective calibration, service and router."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pyvips
import pytest
from fastapi import BackgroundTasks, HTTPException
from pydantic import ValidationError
from sqlalchemy import select
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


def test_scan_candidates_excludes_reviewed_images_only() -> None:
    sql = str(
        service.scan_candidates_stmt(10, category_id=4).compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )
    assert "measurement_findings.status != 'superseded'" in sql
    assert "measurement_scale" not in sql
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


async def test_approve_with_unit_correction_is_manual() -> None:
    finding, image = _finding(), _image()
    await service.approve_finding(AsyncMock(), finding, image, 3, scale=0.0073, unit="nm")
    assert image.metadata_["measurement_unit"] == "nm"
    assert image.metadata_["measurement_scale_source"] == "manual"
    assert finding.approved_unit == "nm"


def test_approve_schema_rejects_unknown_unit() -> None:
    with pytest.raises(ValidationError):
        MeasurementApprove(unit="in")


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


async def test_scan_images_skips_deleted_images(monkeypatch) -> None:
    db = AsyncMock()
    db.get.return_value = None

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
    enqueue.assert_awaited_once_with([4, 5], False)
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


# ── existing scales, slide guard, approval guard, progress ─


@pytest.mark.parametrize(
    "value, expected",
    [(4.0, True), (2, True), (None, False), (0, False), ("4", False), (True, False)],
)
def test_has_scale(value, expected) -> None:
    assert service.has_scale({"measurement_scale": value}) is expected
    assert service.has_scale(None) is False


@pytest.mark.parametrize(
    "meta, source",
    [
        ({"measurement_scale": 4.0, "measurement_unit": "um", "mpp_x": 0.25}, "embedded"),
        ({"measurement_scale": 0.5, "measurement_unit": "mm"}, "existing"),
    ],
)
async def test_scan_image_records_existing_scale_as_authoritative(meta, source) -> None:
    db = MagicMock()
    db.execute = AsyncMock()
    db.scalar = AsyncMock(return_value=None)
    image = _image(metadata_=dict(meta))
    finding = await service.scan_image(db, image)
    assert finding.status == "approved" and finding.source == source
    assert finding.confidence == 1.0
    assert finding.proposed_scale == finding.approved_scale == meta["measurement_scale"]
    assert finding.approved_unit == meta["measurement_unit"]
    assert finding.reviewed_by is None and finding.reviewed_at is not None
    assert image.metadata_ == meta
    # Row lock, then retire any proposal made before the scale was stored.
    assert db.execute.await_count == 2
    assert "FOR UPDATE" in str(db.execute.await_args_list[0].args[0])
    assert "superseded" in str(
        db.execute.await_args_list[1].args[0].compile(compile_kwargs={"literal_binds": True})
    )


async def test_scan_image_skips_existing_scale_already_recorded() -> None:
    db = MagicMock()
    db.execute = AsyncMock()
    db.scalar = AsyncMock(return_value=42)
    db.add = MagicMock()
    assert await service.scan_image(db, _image(metadata_={"measurement_scale": 4.0})) is None
    db.add.assert_not_called()


async def test_scan_images_rolls_back_when_scan_records_nothing(monkeypatch) -> None:
    db = AsyncMock()
    db.get.return_value = _image(metadata_={"measurement_scale": 4.0})

    class _Factory:
        async def __aenter__(self):
            return db

        async def __aexit__(self, *a):
            return False

    monkeypatch.setattr(service, "scan_image", AsyncMock(return_value=None))
    assert await service.scan_images(_Factory, [11]) == 0
    db.rollback.assert_awaited_once()
    db.commit.assert_not_awaited()


def test_has_scale_sql_requires_positive_number() -> None:
    sql = str(service.has_scale_sql().compile(dialect=postgresql.dialect()))
    assert "CASE WHEN" in sql and "jsonb_typeof" in sql and "> " in sql


async def test_scan_image_skips_rbc_on_whole_slide_images(monkeypatch) -> None:
    db = MagicMock()
    db.execute = AsyncMock()
    monkeypatch.setattr(service, "_latest_source_path", AsyncMock(return_value=__file__))
    detect = MagicMock()
    monkeypatch.setattr(service, "_detect", detect)
    finding = await service.scan_image(db, _image(width=56448, height=20783))
    assert finding.status == "pending" and finding.proposed_scale is None
    assert finding.evidence == {"reason": "slide_too_large_for_rbc"}
    detect.assert_not_called()


async def test_approve_endpoint_refuses_when_image_already_scaled() -> None:
    finding = _finding()
    image = _image(metadata_={"measurement_scale": 4.0, "canvas_annotations": []})
    db = _db_with(finding, image)
    with pytest.raises(HTTPException) as exc:
        await router.approve(5, _user(), MeasurementApprove(scale=18.7), db)
    assert exc.value.status_code == 409
    assert finding.status == "superseded"
    assert image.metadata_ == {"measurement_scale": 4.0, "canvas_annotations": []}
    db.commit.assert_awaited_once()


async def test_bulk_approve_supersedes_findings_on_scaled_images() -> None:
    finding = _finding(id=1, image_id=11)
    image = _image(id=11, metadata_={"measurement_scale": 4.0})
    db = AsyncMock()
    db.get.side_effect = lambda model, _i, **_kw: (
        finding if model is MeasurementFinding else image
    )
    out = await router.bulk_approve(MeasurementBulkApprove(ids=[1]), _user(), db)
    assert out.approved == [] and out.skipped == [1]
    assert finding.status == "superseded"
    assert image.metadata_ == {"measurement_scale": 4.0}
    db.commit.assert_awaited_once()


async def test_list_pending_hides_findings_on_scaled_images() -> None:
    db = AsyncMock()
    db.scalar.return_value = 0
    rows = MagicMock()
    rows.all.return_value = []
    db.execute.return_value = rows
    await router.list_findings(_user(), db, "pending", None, None, "confidence_desc", 50, 0)
    sql = str(db.execute.await_args.args[0].compile(dialect=postgresql.dialect()))
    assert "jsonb_typeof" in sql


async def test_scan_progress_counts_live_findings_and_deleted_images() -> None:
    db = AsyncMock()
    found, present = MagicMock(), MagicMock()
    found.scalars.return_value = [11]
    present.scalars.return_value = [11, 12]
    db.execute.side_effect = [found, present]
    out = await router.scan_progress(_user(), db, [11, 12, 13])
    assert (out.total, out.done) == (3, 2)


async def test_scan_progress_min_finding_id_filters_older_rows() -> None:
    db = AsyncMock()
    found, present = MagicMock(), MagicMock()
    found.scalars.return_value = []
    present.scalars.return_value = [11]
    db.execute.side_effect = [found, present]
    out = await router.scan_progress(_user(), db, [11], min_finding_id=9)
    assert (out.total, out.done) == (1, 0)
    sql = str(
        db.execute.await_args_list[0].args[0].compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )
    assert "measurement_findings.id > 9" in sql


# ── rescan / reset / whole-library scans ──────────────────


def test_rescan_candidates_stmt_needs_stale_finding_and_no_scale() -> None:
    sql = str(
        service.rescan_candidates_stmt(10, category_id=4).compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )
    assert "detector_version" in sql and DETECTOR_VERSION in sql
    assert "measurement_findings.status != 'superseded'" in sql
    assert "jsonb_typeof" in sql  # scaled images excluded
    assert "images.category_id = 4" in sql
    assert "LIMIT 10" in sql


def test_scan_candidates_stmt_without_limit_selects_all() -> None:
    sql = str(
        service.scan_candidates_stmt(None).compile(dialect=postgresql.dialect())
    )
    assert "LIMIT" not in sql


async def test_scan_image_rescan_supersedes_reviewed_findings() -> None:
    db = MagicMock()
    db.execute = AsyncMock()
    db.scalar = AsyncMock(return_value=None)
    db.add = MagicMock()
    await service.scan_image(db, _image(), rescan=True)
    sql = str(
        db.execute.await_args.args[0].compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )
    for status in ("pending", "approved", "rejected"):
        assert status in sql
    assert "superseded" in sql


async def test_scan_image_rescan_rerecords_scaled_image() -> None:
    """A rescan refreshes even an already-recorded stored scale."""
    db = MagicMock()
    db.execute = AsyncMock()
    db.scalar = AsyncMock(return_value=42)  # an approved finding exists
    db.add = MagicMock()
    meta = {"measurement_scale": 4.0, "measurement_unit": "um"}
    finding = await service.scan_image(db, _image(metadata_=meta), rescan=True)
    assert finding is not None and finding.status == "approved"
    assert finding.approved_scale == 4.0
    db.add.assert_called_once()


def test_reset_finding_rejected_clears_review() -> None:
    finding = _finding(status="rejected", reviewed_by=7)
    image = _image(metadata_={"measurement_scale": 9.9})
    assert service.reset_finding(finding, image) is False
    assert finding.status == "pending"
    assert finding.reviewed_by is None and finding.reviewed_at is None
    # Rejected findings never wrote metadata; an existing scale stays.
    assert image.metadata_ == {"measurement_scale": 9.9}


def test_reset_finding_approved_strips_its_own_scale() -> None:
    finding = _finding(status="approved", approved_scale=7.3, approved_unit="um")
    image = _image(
        metadata_={
            "measurement_scale": 7.3,
            "measurement_unit": "um",
            "measurement_scale_source": "rbc",
            "measurement_finding_id": 5,
            "canvas_annotations": [{"id": "x"}],
        }
    )
    assert service.reset_finding(finding, image) is True
    assert image.metadata_ == {"canvas_annotations": [{"id": "x"}]}
    assert image.version == 5
    assert finding.status == "pending"


@pytest.mark.parametrize(
    "meta",
    [
        # Scale belongs to another finding or was entered manually.
        {"measurement_scale": 7.3, "measurement_finding_id": 8},
        # The stored scale was changed after this finding promoted it.
        {
            "measurement_scale": 9.9,
            "measurement_unit": "um",
            "measurement_finding_id": 5,
        },
    ],
)
def test_reset_finding_keeps_scales_it_did_not_write(meta) -> None:
    finding = _finding(status="approved", approved_scale=7.3, approved_unit="um")
    image = _image(metadata_=dict(meta))
    assert service.reset_finding(finding, image) is False
    assert image.metadata_["measurement_scale"] == meta["measurement_scale"]
    assert image.version == 4
    assert finding.status == "pending"


async def test_reset_endpoint_rejected_to_pending() -> None:
    finding = _finding(status="rejected", reviewed_by=7)
    db = _db_with(finding, _image())
    db.scalar = AsyncMock(return_value=None)  # no other pending finding
    out = await router.reset(5, _user(), db)
    assert out.status == "pending"
    assert finding.reviewed_by is None
    db.commit.assert_awaited_once()


async def test_reset_endpoint_approved_strips_metadata_and_bumps(monkeypatch) -> None:
    bump = AsyncMock()
    monkeypatch.setattr(router, "bump_browse_revision", bump)
    finding = _finding(status="approved", approved_scale=7.3, approved_unit="um")
    image = _image(
        metadata_={
            "measurement_scale": 7.3,
            "measurement_unit": "um",
            "measurement_scale_source": "rbc",
            "measurement_finding_id": 5,
        }
    )
    db = _db_with(finding, image)
    db.scalar = AsyncMock(return_value=None)
    out = await router.reset(5, _user(), db)
    assert out.status == "pending"
    assert "measurement_scale" not in image.metadata_
    bump.assert_awaited_once()


@pytest.mark.parametrize(
    "status",
    ["pending", "superseded"],
)
async def test_reset_endpoint_rejects_non_reviewed_status(status) -> None:
    db = _db_with(_finding(status=status), _image())
    with pytest.raises(HTTPException) as exc:
        await router.reset(5, _user(), db)
    assert exc.value.status_code == 409


async def test_reset_endpoint_404s() -> None:
    db = _db_with(None, None)
    with pytest.raises(HTTPException) as exc:
        await router.reset(5, _user(), db)
    assert exc.value.status_code == 404


async def test_reset_endpoint_conflict_when_newer_pending_exists() -> None:
    finding = _finding(status="rejected")
    db = _db_with(finding, _image())
    db.scalar = AsyncMock(return_value=77)  # another pending finding
    with pytest.raises(HTTPException) as exc:
        await router.reset(5, _user(), db)
    assert exc.value.status_code == 409
    assert finding.status == "rejected"


async def test_rescan_endpoint_enqueues_image_with_rescan(monkeypatch) -> None:
    finding = _finding(status="rejected")
    db = AsyncMock()
    db.get.return_value = finding
    enqueue = AsyncMock(return_value=EnqueueResult("queued", "submitted"))
    monkeypatch.setattr(router, "enqueue_measurement_scan", enqueue)
    out = await router.rescan(5, BackgroundTasks(), _user(), db)
    assert out.image_ids == [11] and out.mode == "queued"
    enqueue.assert_awaited_once_with([11], True)


async def test_rescan_endpoint_404() -> None:
    db = AsyncMock()
    db.get.return_value = None
    with pytest.raises(HTTPException) as exc:
        await router.rescan(5, BackgroundTasks(), _user(), db)
    assert exc.value.status_code == 404


async def test_scan_rescan_uses_rescan_candidates_and_flag(monkeypatch) -> None:
    db = AsyncMock()
    db.execute.return_value = _scalars([8])
    enqueue = AsyncMock(return_value=EnqueueResult("queued", "submitted"))
    monkeypatch.setattr(router, "enqueue_measurement_scan", enqueue)
    picked = MagicMock(return_value=select(MeasurementFinding.id))
    monkeypatch.setattr(router, "rescan_candidates_stmt", picked)
    out = await router.scan(
        MeasurementScanRequest(rescan=True), BackgroundTasks(), _user(), db
    )
    picked.assert_called_once_with(10, None)
    assert out.image_ids == [8]
    enqueue.assert_awaited_once_with([8], True)


async def test_scan_all_chunks_enqueue_jobs(monkeypatch) -> None:
    db = AsyncMock()
    db.execute.return_value = _scalars(list(range(1, 121)))
    enqueue = AsyncMock(return_value=EnqueueResult("queued", "submitted"))
    monkeypatch.setattr(router, "enqueue_measurement_scan", enqueue)
    bg = BackgroundTasks()
    out = await router.scan(
        MeasurementScanRequest(all=True), bg, _user(), db
    )
    assert out.image_ids == list(range(1, 121)) and out.mode == "queued"
    assert [c.args[0] for c in enqueue.await_args_list] == [
        list(range(1, 51)),
        list(range(51, 101)),
        list(range(101, 121)),
    ]
    assert not bg.tasks


async def test_scan_mixed_queue_fallback_runs_rest_in_process(monkeypatch) -> None:
    db = AsyncMock()
    db.execute.return_value = _scalars(list(range(1, 61)))
    enqueue = AsyncMock(
        side_effect=[
            EnqueueResult("queued", "submitted"),
            EnqueueResult("fallback", "queue_unavailable"),
        ]
    )
    monkeypatch.setattr(router, "enqueue_measurement_scan", enqueue)
    bg = BackgroundTasks()
    out = await router.scan(MeasurementScanRequest(all=True), bg, _user(), db)
    assert out.mode == "queued"
    assert len(bg.tasks) == 1
    assert bg.tasks[0].func is router.scan_images
    assert bg.tasks[0].args[0] is router.async_session
    assert bg.tasks[0].args[1] == list(range(51, 61))
    assert bg.tasks[0].args[2] is False


async def test_scan_remaining_reports_candidate_count() -> None:
    db = AsyncMock()
    db.scalar.return_value = 17
    out = await router.scan_remaining(_user(), db, rescan=True, category_id=None)
    assert out.remaining == 17


async def test_scan_remaining_max_image_id_bounds_count() -> None:
    db = AsyncMock()
    db.scalar.return_value = 3
    out = await router.scan_remaining(
        _user(), db, rescan=False, category_id=None, max_image_id=42
    )
    assert out.remaining == 3
    sql = str(
        db.scalar.await_args.args[0].compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )
    assert "image.id <= 42" in sql or "images.id <= 42" in sql


async def test_scan_partial_enqueue_failure_503s_with_accepted_count(
    monkeypatch,
) -> None:
    """Mid-enqueue queue failure preserves the required-mode 503 contract and
    discloses the chunks already accepted."""
    db = AsyncMock()
    db.execute.return_value = _scalars(list(range(1, 61)))
    enqueue = AsyncMock(
        side_effect=[
            EnqueueResult("queued", "submitted"),
            TaskQueueUnavailableError("queue_unavailable"),
        ]
    )
    monkeypatch.setattr(router, "enqueue_measurement_scan", enqueue)
    bg = BackgroundTasks()
    with pytest.raises(HTTPException) as exc:
        await router.scan(MeasurementScanRequest(all=True), bg, _user(), db)
    assert exc.value.status_code == 503
    assert "50 images already accepted" in exc.value.detail
    assert enqueue.await_count == 2
    assert not bg.tasks


async def test_scan_enqueue_failure_on_first_chunk_503s(monkeypatch) -> None:
    """Nothing accepted + queue down = the plain 503 contract."""
    db = AsyncMock()
    db.execute.return_value = _scalars([1, 2, 3])
    monkeypatch.setattr(
        router,
        "enqueue_measurement_scan",
        AsyncMock(side_effect=TaskQueueUnavailableError("queue_unavailable")),
    )
    with pytest.raises(HTTPException) as exc:
        await router.scan(MeasurementScanRequest(), BackgroundTasks(), _user(), db)
    assert exc.value.status_code == 503


def test_reset_finding_keeps_scale_when_source_changed_after_approval() -> None:
    """A later edit touching only the source must not be undone by reset."""
    finding = _finding(status="approved", approved_scale=7.3, approved_unit="um")
    image = _image(
        metadata_={
            "measurement_scale": 7.3,
            "measurement_unit": "um",
            "measurement_scale_source": "manual",  # was "rbc" at approval
            "measurement_finding_id": 5,
        }
    )
    assert service.reset_finding(finding, image) is False
    assert image.metadata_["measurement_scale"] == 7.3
    assert image.metadata_["measurement_scale_source"] == "manual"
    assert finding.status == "pending"


def test_reset_finding_strips_when_reviewer_corrected_at_approval() -> None:
    """A corrected approval wrote source 'manual'; reset recognizes its own write."""
    finding = _finding(
        status="approved",
        proposed_scale=7.3,
        approved_scale=8.1,
        approved_unit="um",
    )
    image = _image(
        metadata_={
            "measurement_scale": 8.1,
            "measurement_unit": "um",
            "measurement_scale_source": "manual",
            "measurement_finding_id": 5,
        }
    )
    assert service.reset_finding(finding, image) is True
    assert image.metadata_ == {}


async def test_scan_image_rescan_repoints_scale_ownership() -> None:
    """Re-recording a scale moves measurement_finding_id to the new finding.

    The re-recorded finding inherits the stored provenance so a later reset
    can still strip the scale it now owns.
    """
    owner = _finding(
        id=9,
        status="approved",
        source="rbc",
        proposed_scale=4.0,
        approved_scale=4.0,
        approved_unit="um",
    )
    db = MagicMock()
    db.execute = AsyncMock()
    db.scalar = AsyncMock(return_value=42)
    db.add = MagicMock()
    db.get = AsyncMock(return_value=owner)

    async def _flush() -> None:  # emulate autoincrement on commit
        for call in db.add.call_args_list:
            if call.args[0].id is None:
                call.args[0].id = 77

    db.flush = AsyncMock(side_effect=_flush)
    meta = {
        "measurement_scale": 4.0,
        "measurement_unit": "um",
        "measurement_scale_source": "rbc",
        "measurement_finding_id": 9,  # the old approved finding, now superseded
    }
    image = _image(metadata_=meta)
    finding = await service.scan_image(db, image, rescan=True)
    assert finding is not None and finding.status == "approved"
    db.flush.assert_awaited_once()
    assert finding.id == 77
    assert image.metadata_["measurement_finding_id"] == 77
    assert image.metadata_["measurement_scale"] == 4.0
    assert finding.source == "rbc"
    assert image.version == 5
    # The full undo round-trip: resetting the new owner strips the scale.
    assert service.reset_finding(finding, image) is True
    assert "measurement_scale" not in image.metadata_


async def test_scan_image_rescan_keeps_edited_scale_unowned() -> None:
    """A scale edited after approval is not handed to the re-recorded
    finding — resetting that finding must leave the edit alone."""
    owner = _finding(
        id=9,
        status="approved",
        source="rbc",
        proposed_scale=4.0,
        approved_scale=4.0,
        approved_unit="um",
    )
    db = MagicMock()
    db.execute = AsyncMock()
    db.scalar = AsyncMock(return_value=42)
    db.add = MagicMock()
    db.get = AsyncMock(return_value=owner)
    db.flush = AsyncMock()
    meta = {
        "measurement_scale": 5.0,  # edited after the approval wrote 4.0
        "measurement_unit": "um",
        "measurement_scale_source": "manual",
        "measurement_finding_id": 9,
    }
    image = _image(metadata_=meta)
    finding = await service.scan_image(db, image, rescan=True)
    assert finding is not None and finding.status == "approved"
    assert image.metadata_["measurement_finding_id"] == 9  # stale pointer kept
    assert image.version == 4  # metadata untouched
    # The new finding records the edited value but cannot undo it.
    assert service.reset_finding(finding, image) is False
    assert image.metadata_["measurement_scale"] == 5.0


def test_reset_finding_strips_when_only_unit_corrected_at_approval() -> None:
    """Unit-only corrections also wrote source 'manual' and can be undone."""
    finding = _finding(
        status="approved",
        proposed_scale=7.3,
        proposed_unit="um",
        approved_scale=7.3,
        approved_unit="nm",
    )
    image = _image(
        metadata_={
            "measurement_scale": 7.3,
            "measurement_unit": "nm",
            "measurement_scale_source": "manual",
            "measurement_finding_id": 5,
        }
    )
    assert service.reset_finding(finding, image) is True
    assert image.metadata_ == {}
