"""Tests for Pydantic schemas, especially model validators."""

from datetime import datetime, timezone
from types import SimpleNamespace

from app.schemas import ImageOut, ImageUpdate, SourceImageOut


def test_image_out_extracts_program_ids_from_orm() -> None:
    """ImageOut.extract_program_ids converts ORM programs list to IDs."""
    now = datetime.now(timezone.utc)
    orm_obj = SimpleNamespace(
        id=1,
        name="test-img",
        thumb="/thumb.jpg",
        tile_sources="/tiles/1",
        category_id=None,
        copyright=None,
        note=None,
        active=True,
        metadata_={"key": "val"},
        version=1,
        width=1024,
        height=768,
        file_size=5.25,
        created_at=now,
        updated_at=now,
        programs=[SimpleNamespace(id=10), SimpleNamespace(id=20)],
    )
    out = ImageOut.model_validate(orm_obj)
    assert out.program_ids == [10, 20]
    assert out.name == "test-img"
    assert out.metadata_extra == {"key": "val"}


def test_image_out_handles_empty_programs() -> None:
    now = datetime.now(timezone.utc)
    orm_obj = SimpleNamespace(
        id=2,
        name="no-progs",
        thumb="/thumb.jpg",
        tile_sources="/tiles/2",
        category_id=5,
        copyright="CC",
        note="a note",
        active=False,
        metadata_=None,
        version=1,
        width=None,
        height=None,
        file_size=None,
        created_at=now,
        updated_at=now,
        programs=[],
    )
    out = ImageOut.model_validate(orm_obj)
    assert out.program_ids == []


def test_image_out_from_dict() -> None:
    """ImageOut also works when given a plain dict (no 'programs' attr)."""
    now = datetime.now(timezone.utc)
    data = {
        "id": 3,
        "name": "dict-img",
        "thumb": "/thumb.jpg",
        "tile_sources": "/tiles/3",
        "category_id": None,
        "copyright": None,
        "note": None,
        "active": True,
        "metadata_": None,
        "created_at": now,
        "updated_at": now,
        "program_ids": [1, 2, 3],
    }
    out = ImageOut.model_validate(data)
    assert out.program_ids == [1, 2, 3]


def test_source_image_out_parses_program_json_from_orm() -> None:
    """SourceImageOut extracts program_ids from JSON string."""
    now = datetime.now(timezone.utc)
    orm_obj = SimpleNamespace(
        id=1,
        original_filename="test.tiff",
        status="completed",
        progress=100,
        error_message=None,
        name="test",
        category_id=None,
        copyright=None,
        note=None,
        active=True,
        program="[10, 20]",
        image_id=5,
        file_size=1048576,
        created_at=now,
        updated_at=now,
    )
    out = SourceImageOut.model_validate(orm_obj)
    assert out.program_ids == [10, 20]
    assert out.progress == 100
    assert out.file_size == 1048576


def test_source_image_out_handles_null_program() -> None:
    now = datetime.now(timezone.utc)
    orm_obj = SimpleNamespace(
        id=2,
        original_filename="test2.png",
        status="pending",
        progress=0,
        error_message=None,
        name=None,
        category_id=None,
        copyright=None,
        note=None,
        active=True,
        program=None,
        image_id=None,
        file_size=None,
        created_at=now,
        updated_at=now,
    )
    out = SourceImageOut.model_validate(orm_obj)
    assert out.program_ids == []
    assert out.progress == 0
    assert out.file_size is None


def test_source_image_out_handles_invalid_json_program() -> None:
    now = datetime.now(timezone.utc)
    orm_obj = SimpleNamespace(
        id=3,
        original_filename="bad.png",
        status="pending",
        progress=0,
        error_message=None,
        name=None,
        category_id=None,
        copyright=None,
        note=None,
        active=True,
        program="not-json",
        image_id=None,
        file_size=None,
        created_at=now,
        updated_at=now,
    )
    out = SourceImageOut.model_validate(orm_obj)
    assert out.program_ids == []


def test_source_image_out_from_dict() -> None:
    now = datetime.now(timezone.utc)
    data = {
        "id": 4,
        "original_filename": "dict.png",
        "status": "pending",
        "error_message": None,
        "name": None,
        "category_id": None,
        "copyright": None,
        "note": None,
        "active": True,
        "program": "[1, 2]",
        "image_id": None,
        "created_at": now,
        "updated_at": now,
    }
    out = SourceImageOut.model_validate(data)
    assert out.program_ids == [1, 2]


def test_source_image_out_non_list_json_program() -> None:
    """If program JSON parses to a non-list, program_ids should be empty."""
    now = datetime.now(timezone.utc)
    orm_obj = SimpleNamespace(
        id=5,
        original_filename="obj.png",
        status="pending",
        progress=0,
        error_message=None,
        name=None,
        category_id=None,
        copyright=None,
        note=None,
        active=True,
        program='{"key": "value"}',
        image_id=None,
        file_size=None,
        created_at=now,
        updated_at=now,
    )
    out = SourceImageOut.model_validate(orm_obj)
    assert out.program_ids == []


# ── locked_overlays validation ────────────────────────────


def test_validate_locked_overlays_valid() -> None:
    """Valid overlay rects should pass through unchanged."""
    body = ImageUpdate(
        metadata_extra={"locked_overlays": [{"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4}]}
    )
    overlays = body.metadata_extra["locked_overlays"]
    assert len(overlays) == 1
    assert overlays[0] == {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4}


def test_validate_locked_overlays_filters_malformed() -> None:
    """Entries missing required numeric properties should be dropped."""
    body = ImageUpdate(
        metadata_extra={
            "locked_overlays": [
                {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
                {"x": "bad", "y": 0.2, "w": 0.3, "h": 0.4},
                {"x": 0.1},
                "not-an-object",
            ]
        }
    )
    overlays = body.metadata_extra["locked_overlays"]
    assert len(overlays) == 1
    assert overlays[0]["x"] == 0.1


def test_validate_locked_overlays_all_invalid_removes_key() -> None:
    """When all overlays are invalid, the key should be removed."""
    body = ImageUpdate(
        metadata_extra={"locked_overlays": [{"bad": True}], "other": "kept"}
    )
    assert "locked_overlays" not in body.metadata_extra
    assert body.metadata_extra["other"] == "kept"


def test_validate_locked_overlays_non_list_removes_key() -> None:
    """Non-list locked_overlays should be removed."""
    body = ImageUpdate(
        metadata_extra={"locked_overlays": "not-a-list", "other": "kept"}
    )
    assert "locked_overlays" not in body.metadata_extra


def test_validate_locked_overlays_merge_valid() -> None:
    """Overlay validation also applies to metadata_extra_merge."""
    body = ImageUpdate(
        metadata_extra_merge={"locked_overlays": [{"x": 1, "y": 2, "w": 3, "h": 4}]}
    )
    overlays = body.metadata_extra_merge["locked_overlays"]
    assert len(overlays) == 1


def test_validate_locked_overlays_merge_filters() -> None:
    """Merge overlay validation should filter malformed entries."""
    body = ImageUpdate(
        metadata_extra_merge={"locked_overlays": [{"bad": True}]}
    )
    assert "locked_overlays" not in body.metadata_extra_merge


def test_metadata_extra_and_merge_mutually_exclusive() -> None:
    """Providing both metadata_extra and metadata_extra_merge should raise."""
    import pytest as _pt

    with _pt.raises(Exception, match="mutually exclusive"):
        ImageUpdate(
            metadata_extra={"key": "val"},
            metadata_extra_merge={"other": "val"},
        )


def test_metadata_extra_null_and_merge_mutually_exclusive() -> None:
    """Even explicit null metadata_extra with merge should raise."""
    import pytest as _pt

    with _pt.raises(Exception, match="mutually exclusive"):
        ImageUpdate(
            metadata_extra=None,
            metadata_extra_merge={"key": "val"},
        )
