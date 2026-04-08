from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from pydantic import model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://corgi:corgi@db:5432/corgi"
    source_images_dir: str = "/data/source_images"
    tiles_dir: str = "/data/tiles"
    cors_origins: str = "*"
    db_pool_size: int = 10
    db_max_overflow: int = 20

    # OIDC / OAuth settings (Phase 3 — Identity)
    oidc_enabled: bool = False
    oidc_issuer: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: str = ""
    oidc_redirect_uri: str = ""
    oidc_scopes: str = "openid email profile"
    oidc_role_mapping: str = "{}"  # JSON: {"idp-group": "corgi-role"}
    oidc_post_login_redirect: str = ""  # Frontend URL to redirect to after OIDC login
    oidc_trust_email: bool = False  # Skip email_verified check (for IdPs like Vault that don't emit it)

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

engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_pre_ping=True,
)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:  # type: ignore[misc]
    async with async_session() as session:
        yield session
