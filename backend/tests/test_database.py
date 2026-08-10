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
