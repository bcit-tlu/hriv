from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from pydantic import model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://corgi:corgi@db:5432/corgi"
    source_images_dir: str = "/data/source_images"
    tiles_dir: str = "/data/tiles"

    @model_validator(mode="after")
    def _normalize_database_scheme(self) -> "Settings":
        """Rewrite ``postgresql://`` to ``postgresql+asyncpg://`` so that
        connection strings from CloudNative-PG (which omit the driver) work
        with SQLAlchemy's async engine."""
        if self.database_url.startswith("postgresql://"):
            self.database_url = self.database_url.replace(
                "postgresql://", "postgresql+asyncpg://", 1
            )
        return self


settings = Settings()

engine = create_async_engine(settings.database_url, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:  # type: ignore[misc]
    async with async_session() as session:
        yield session
