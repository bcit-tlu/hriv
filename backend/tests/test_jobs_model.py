from datetime import datetime, timezone
from types import SimpleNamespace

from app.models import ACTIVE_JOB_STATUSES, Job, JobItem
from app.schemas import JobItemOut, JobOut


def test_job_model_defines_durable_supervisor_shape() -> None:
    assert Job.__tablename__ == "jobs"
    assert ACTIVE_JOB_STATUSES == ("queued", "running", "cancelling")

    columns = Job.__table__.c
    assert columns.job_type.nullable is False
    assert columns.status.server_default.arg.text == "'queued'"
    assert columns.progress.server_default.arg == "0"
    assert columns.skipped_count.server_default.arg == "0"
    assert columns.metadata.name == "metadata"
    assert next(iter(columns.requested_by.foreign_keys)).ondelete == "SET NULL"

    index_names = {index.name for index in Job.__table__.indexes}
    assert {"idx_jobs_status", "idx_jobs_job_type"} <= index_names


def test_job_item_model_defines_child_item_shape() -> None:
    assert JobItem.__tablename__ == "job_items"

    columns = JobItem.__table__.c
    assert columns.job_id.nullable is False
    assert next(iter(columns.job_id.foreign_keys)).ondelete == "CASCADE"
    assert columns.resource_type.nullable is False
    assert columns.resource_id.nullable is True
    assert columns.status.server_default.arg.text == "'queued'"
    assert columns.attempts.server_default.arg == "0"
    assert columns.claim_token.type.length == 64
    assert columns.arq_job_id.type.length == 255
    assert columns.metadata.name == "metadata"

    index_names = {index.name for index in JobItem.__table__.indexes}
    assert {
        "idx_job_items_job_status",
        "idx_job_items_lease",
        "idx_job_items_resource",
    } <= index_names
    constraint_names = {
        constraint.name for constraint in JobItem.__table__.constraints
    }
    assert "uq_job_items_job_resource" in constraint_names
    resource_constraint = next(
        constraint
        for constraint in JobItem.__table__.constraints
        if constraint.name == "uq_job_items_job_resource"
    )
    assert resource_constraint.dialect_options["postgresql"]["nulls_not_distinct"]


def test_job_schemas_expose_metadata_aliases() -> None:
    now = datetime.now(timezone.utc)
    job = SimpleNamespace(
        id=1,
        job_type="rebuild_tiles",
        status="running",
        progress=25,
        total_count=4,
        completed_count=1,
        failed_count=0,
        skipped_count=0,
        cancelled_count=0,
        error_message=None,
        metadata_={"scope": "missing"},
        requested_by=7,
        started_at=now,
        completed_at=None,
        created_at=now,
        updated_at=now,
    )
    item = SimpleNamespace(
        id=11,
        job_id=1,
        resource_type="source_image",
        resource_id="42",
        status="queued",
        attempts=0,
        progress=0,
        error_message=None,
        heartbeat_at=None,
        lease_expires_at=None,
        arq_job_id=None,
        metadata_={"filename": "slide.svs"},
        started_at=None,
        completed_at=None,
        created_at=now,
        updated_at=now,
    )

    assert JobOut.model_validate(job).metadata_extra == {"scope": "missing"}
    assert JobItemOut.model_validate(item).metadata_extra == {
        "filename": "slide.svs"
    }
