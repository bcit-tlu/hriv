"""Tests for Pydantic schemas, especially model validators."""

import re
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.schemas import (
    ImageBulkUpdate,
    ImageCreate,
    ImageOut,
    ImageUpdate,
    MAX_NOTE_LENGTH,
    ProgramCreate,
    ProgramUpdate,
    SourceImageOut,
)


def test_image_out_from_orm() -> None:
    """ImageOut correctly maps ORM fields (no image-level program_ids)."""
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
        sort_order=0,
        metadata_={"key": "val"},
        version=1,
        width=1024,
        height=768,
        file_size=5.25,
        created_at=now,
        updated_at=now,
    )
    out = ImageOut.model_validate(orm_obj)
    assert out.name == "test-img"
    assert out.metadata_extra == {"key": "val"}
    assert out.width == 1024


def test_image_out_from_dict() -> None:
    """ImageOut also works when given a plain dict."""
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
        "sort_order": 0,
        "metadata_": None,
        "created_at": now,
        "updated_at": now,
    }
    out = ImageOut.model_validate(data)
    assert out.name == "dict-img"
    assert out.metadata_extra is None


def test_source_image_out_from_orm() -> None:
    """SourceImageOut maps ORM fields (no image-level program_ids)."""
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
        image_id=5,
        file_size=1048576,
        source_checksum="a" * 64,
        tile_settings_hash="b" * 64,
        tiles_generated_at=now,
        tile_cache_status="current",
        created_at=now,
        updated_at=now,
    )
    out = SourceImageOut.model_validate(orm_obj)
    assert out.progress == 100
    assert out.file_size == 1048576
    assert out.image_id == 5
    assert out.tile_cache_status == "current"
    assert out.tiles_generated_at == now


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
        "image_id": None,
        "tile_cache_status": "missing",
        "created_at": now,
        "updated_at": now,
    }
    out = SourceImageOut.model_validate(data)
    assert out.original_filename == "dict.png"
    assert out.status == "pending"
    assert out.tile_cache_status == "missing"
    assert out.source_checksum is None


# ── oidc_group normalization ─────────────────────────────


def test_program_create_oidc_group_empty_string_becomes_none() -> None:
    p = ProgramCreate(name="Test", oidc_group="")
    assert p.oidc_group is None


def test_program_create_oidc_group_whitespace_becomes_none() -> None:
    p = ProgramCreate(name="Test", oidc_group="   ")
    assert p.oidc_group is None


def test_program_create_oidc_group_valid_string_preserved() -> None:
    p = ProgramCreate(name="Test", oidc_group="mrad-group")
    assert p.oidc_group == "mrad-group"


def test_program_create_oidc_group_strips_whitespace() -> None:
    p = ProgramCreate(name="Test", oidc_group="  mrad-group  ")
    assert p.oidc_group == "mrad-group"


def test_program_create_oidc_group_none_stays_none() -> None:
    p = ProgramCreate(name="Test", oidc_group=None)
    assert p.oidc_group is None


def test_program_update_oidc_group_empty_string_becomes_none() -> None:
    p = ProgramUpdate(oidc_group="")
    assert p.oidc_group is None


def test_program_update_oidc_group_whitespace_becomes_none() -> None:
    p = ProgramUpdate(oidc_group="   ")
    assert p.oidc_group is None


def test_program_update_oidc_group_valid_string_preserved() -> None:
    p = ProgramUpdate(oidc_group="mlt-group")
    assert p.oidc_group == "mlt-group"


# ── note validation ──────────────────────────────────────


def test_frontend_note_limit_matches_backend() -> None:
    frontend_constants = (
        Path(__file__).resolve().parents[2] / "frontend" / "src" / "constants.ts"
    ).read_text()
    match = re.search(
        r"export\s+const\s+MAX_NOTE_LENGTH\s*=\s*(\d+)",
        frontend_constants,
    )
    assert match is not None
    assert int(match.group(1)) == MAX_NOTE_LENGTH


def _image_create_with_note(note: str | None) -> ImageCreate:
    return ImageCreate(
        name="test-img",
        thumb="/thumb.jpg",
        tile_sources="/tiles/1",
        note=note,
    )


def _image_update_with_note(note: str | None) -> ImageUpdate:
    return ImageUpdate(note=note)


def _image_bulk_update_with_note(note: str | None) -> ImageBulkUpdate:
    return ImageBulkUpdate(image_ids=[1], note=note)


@pytest.mark.parametrize(
    ("factory", "note", "expected"),
    [
        (_image_create_with_note, "x" * 500, "x" * 500),
        (_image_create_with_note, None, None),
        (_image_create_with_note, "", None),
        (_image_create_with_note, "short note", "short note"),
        (_image_update_with_note, "x" * 500, "x" * 500),
        (_image_update_with_note, None, None),
        (_image_update_with_note, "", None),
        (_image_update_with_note, "short note", "short note"),
        (_image_bulk_update_with_note, "x" * 500, "x" * 500),
        (_image_bulk_update_with_note, None, None),
        (_image_bulk_update_with_note, "", None),
        (_image_bulk_update_with_note, "short note", "short note"),
    ],
)
def test_image_write_schemas_accept_valid_note_values(factory, note, expected) -> None:
    schema = factory(note)
    assert schema.note == expected


@pytest.mark.parametrize(
    "factory",
    [
        _image_create_with_note,
        _image_update_with_note,
        _image_bulk_update_with_note,
    ],
)
def test_image_write_schemas_reject_notes_over_500_characters(factory) -> None:
    with pytest.raises(ValueError, match="note must be 500 characters or fewer"):
        factory("x" * 501)


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

    with pytest.raises(Exception, match="mutually exclusive"):
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
