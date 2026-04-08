"""Tests for Pydantic schemas, especially model validators."""

from datetime import datetime, timezone
from types import SimpleNamespace

from app.schemas import ImageOut, SourceImageOut


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
        error_message=None,
        name="test",
        category_id=None,
        copyright=None,
        note=None,
        active=True,
        program="[10, 20]",
        image_id=5,
        created_at=now,
        updated_at=now,
    )
    out = SourceImageOut.model_validate(orm_obj)
    assert out.program_ids == [10, 20]


def test_source_image_out_handles_null_program() -> None:
    now = datetime.now(timezone.utc)
    orm_obj = SimpleNamespace(
        id=2,
        original_filename="test2.png",
        status="pending",
        error_message=None,
        name=None,
        category_id=None,
        copyright=None,
        note=None,
        active=True,
        program=None,
        image_id=None,
        created_at=now,
        updated_at=now,
    )
    out = SourceImageOut.model_validate(orm_obj)
    assert out.program_ids == []


def test_source_image_out_handles_invalid_json_program() -> None:
    now = datetime.now(timezone.utc)
    orm_obj = SimpleNamespace(
        id=3,
        original_filename="bad.png",
        status="pending",
        error_message=None,
        name=None,
        category_id=None,
        copyright=None,
        note=None,
        active=True,
        program="not-json",
        image_id=None,
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
        error_message=None,
        name=None,
        category_id=None,
        copyright=None,
        note=None,
        active=True,
        program='{"key": "value"}',
        image_id=None,
        created_at=now,
        updated_at=now,
    )
    out = SourceImageOut.model_validate(orm_obj)
    assert out.program_ids == []
