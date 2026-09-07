import pytest
from pydantic import ValidationError

from app.database import Settings


def test_normalize_database_scheme_rewrites_postgresql_url() -> None:
    settings = Settings(database_url="postgresql://user:pass@localhost:5432/hriv")

    assert (
        settings.database_url == "postgresql+asyncpg://user:pass@localhost:5432/hriv"
    )


def test_normalize_database_scheme_keeps_asyncpg_url_unchanged() -> None:
    original = "postgresql+asyncpg://user:pass@localhost:5432/hriv"

    settings = Settings(database_url=original)

    assert settings.database_url == original


def test_normalize_database_scheme_keeps_non_postgres_url_unchanged() -> None:
    original = "sqlite+aiosqlite:///./test.db"

    settings = Settings(database_url=original)

    assert settings.database_url == original


def test_normalize_database_scheme_only_replaces_leading_scheme() -> None:
    settings = Settings(
        database_url="postgresql://user:pass@localhost:5432/hriv?note=postgresql://example"
    )

    assert settings.database_url.startswith("postgresql+asyncpg://")
    assert "note=postgresql://example" in settings.database_url


def test_export_pigz_threads_rejects_negative_values() -> None:
    with pytest.raises(ValidationError):
        Settings(export_pigz_threads=-1)


def test_export_pigz_threads_accepts_zero_and_positive_values() -> None:
    zero = Settings(export_pigz_threads=0)
    four = Settings(export_pigz_threads=4)

    assert zero.export_pigz_threads == 0
    assert four.export_pigz_threads == 4


def test_parallel_rebuild_scheduler_is_disabled_by_default() -> None:
    settings = Settings()

    assert settings.rebuild_parallel_enabled is False
    assert settings.rebuild_parallelism == 2
    assert settings.rebuild_parallelism != settings.worker_max_jobs
    assert settings.rebuild_max_attempts == 2
    assert settings.rebuild_retry_backoff_base_seconds == 60
    assert settings.rebuild_retry_backoff_cap_seconds == 900


def test_parallel_rebuild_scheduler_requires_timeout_below_lease() -> None:
    with pytest.raises(ValidationError):
        Settings(
            rebuild_child_timeout_seconds=120,
            rebuild_lease_seconds=120,
        )


def test_parallel_rebuild_scheduler_requires_heartbeat_below_lease() -> None:
    with pytest.raises(ValidationError):
        Settings(
            rebuild_heartbeat_seconds=120,
            rebuild_lease_seconds=120,
        )


def test_parallel_rebuild_pump_cadence_uses_whole_minutes() -> None:
    with pytest.raises(ValidationError):
        Settings(rebuild_pump_cadence_seconds=61)


def test_parallel_rebuild_retry_backoff_requires_valid_bounds() -> None:
    with pytest.raises(ValidationError):
        Settings(
            rebuild_retry_backoff_base_seconds=61,
            rebuild_retry_backoff_cap_seconds=60,
        )
