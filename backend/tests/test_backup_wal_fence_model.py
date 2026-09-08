"""Metadata contract for the internal production-backup WAL fence table."""

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime

from app.database import Base
from app.models import backup_recovery_wal_fence


def test_backup_recovery_wal_fence_metadata_matches_migration_shape() -> None:
    table = Base.metadata.tables["backup_recovery_wal_fence"]

    assert table is backup_recovery_wal_fence
    assert table.schema is None
    assert list(table.c.keys()) == ["singleton", "generation", "fenced_at"]

    singleton = table.c.singleton
    assert isinstance(singleton.type, Boolean)
    assert singleton.primary_key is True
    assert singleton.nullable is False

    generation = table.c.generation
    assert isinstance(generation.type, BigInteger)
    assert generation.primary_key is False
    assert generation.nullable is False

    fenced_at = table.c.fenced_at
    assert isinstance(fenced_at.type, DateTime)
    assert fenced_at.type.timezone is True
    assert fenced_at.primary_key is False
    assert fenced_at.nullable is False

    checks = [
        constraint
        for constraint in table.constraints
        if isinstance(constraint, CheckConstraint)
    ]
    assert len(checks) == 1
    assert checks[0].name == "ck_backup_recovery_wal_fence_singleton"
    assert str(checks[0].sqltext) == "singleton"
    assert {column.name for column in table.primary_key.columns} == {"singleton"}
