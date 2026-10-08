"""Metadata contract for the ``collections`` tables (migration ``0030_collections``)."""

from sqlalchemy import CheckConstraint
from sqlalchemy.dialects.postgresql import JSONB

from app.database import Base
from app.models import (
    COLLECTION_TYPES,
    COLLECTION_VISIBILITIES,
    STUDENT_MAX_COLLECTIONS_PER_TYPE,
    STUDENT_SEQUENCE_MAX_IMAGES,
    SYNCHRONIZED_COLLECTION_MAX_IMAGES,
    Collection,
    CollectionImage,
    collection_groups,
    collection_owners,
    collection_programs,
)


def _fk(column):
    return next(iter(column.foreign_keys))


def _check_names(table) -> dict[str, str]:
    return {
        c.name: str(c.sqltext)
        for c in table.constraints
        if isinstance(c, CheckConstraint)
    }


def test_collection_constants() -> None:
    assert COLLECTION_TYPES == ("synchronized", "sequence")
    assert COLLECTION_VISIBILITIES == ("private", "public", "restricted")
    assert SYNCHRONIZED_COLLECTION_MAX_IMAGES == 4
    assert STUDENT_SEQUENCE_MAX_IMAGES == 20
    assert STUDENT_MAX_COLLECTIONS_PER_TYPE == 10


def test_collection_table_shape() -> None:
    table = Collection.__table__
    assert table.name == "collections"
    c = table.c
    assert c.name.nullable is False and c.name.type.length == 255
    assert c.type.nullable is False
    assert c.visibility.nullable is False
    assert c.visibility.server_default.arg.text == "'private'"
    assert c.user_id.nullable is True
    # Creator-only audit column since #1531: SET NULL so a departing creator
    # does not delete collections other users co-own.
    assert _fk(c.user_id).ondelete == "SET NULL"
    assert c.owner_program_id.nullable is True
    assert _fk(c.owner_program_id).ondelete == "SET NULL"
    assert isinstance(c.viewport_state.type, JSONB)
    assert c.viewport_state.nullable is False
    assert c.viewport_state.server_default.arg.text == "'{}'::jsonb"
    assert c.version.server_default.arg == "1"
    assert c.created_at.type.timezone is True
    assert c.updated_at.type.timezone is True

    checks = _check_names(table)
    assert checks["ck_collections_type"] == "type IN ('synchronized', 'sequence')"
    assert (
        checks["ck_collections_visibility"]
        == "visibility IN ('private', 'public', 'restricted')"
    )
    # The single-owner check was dropped in #1531 — user owners (via
    # collection_owners) and a program owner may coexist.
    assert "ck_collections_single_owner" not in checks
    assert {i.name for i in table.indexes} >= {
        "idx_collections_user",
        "idx_collections_owner_program",
    }


def test_collection_image_table_shape() -> None:
    table = CollectionImage.__table__
    assert table.name == "collection_images"
    assert {col.name for col in table.primary_key.columns} == {
        "collection_id",
        "image_id",
    }
    assert _fk(table.c.collection_id).ondelete == "CASCADE"
    assert _fk(table.c.image_id).ondelete == "CASCADE"
    assert table.c.sort_order.nullable is False
    assert table.c.sort_order.server_default.arg == "0"
    assert {i.name for i in table.indexes} == {"idx_collection_images_order"}


def test_collection_scope_junctions() -> None:
    assert Base.metadata.tables["collection_programs"] is collection_programs
    assert Base.metadata.tables["collection_groups"] is collection_groups
    assert Base.metadata.tables["collection_owners"] is collection_owners
    for table, other in (
        (collection_programs, "program_id"),
        (collection_groups, "group_id"),
        (collection_owners, "user_id"),
    ):
        assert {col.name for col in table.primary_key.columns} == {
            "collection_id",
            other,
        }
        assert _fk(table.c.collection_id).ondelete == "CASCADE"
        assert _fk(table.c[other]).ondelete == "CASCADE"


def test_collection_relationships_ordered_and_cascading() -> None:
    links = Collection.__mapper__.relationships["image_links"]
    assert links.cascade.delete_orphan is True
    assert [str(o) for o in links.order_by] == ["collection_images.sort_order"]
    assert Collection.__mapper__.relationships["programs"].secondary is collection_programs
    assert Collection.__mapper__.relationships["groups"].secondary is collection_groups
    assert CollectionImage.__mapper__.relationships["image"].lazy == "selectin"
    owners = Collection.__mapper__.relationships["owners"]
    assert owners.secondary is collection_owners
    assert owners.lazy == "selectin"
