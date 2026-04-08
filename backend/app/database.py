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

    # Redis URL for task queue (Phase 5 — arq worker) and rate limiting
    redis_url: str = "redis://redis:6379"

    # Login rate limiting (Phase 5)
    rate_limit_login_max: int = 5
    rate_limit_login_window: int = 60  # seconds

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

_engine = None
_async_session = None


def get_engine() -> "AsyncEngine":
    """Return the async engine, creating it on first call.

    Lazy initialisation avoids executing ``create_async_engine`` at module
    import time, which lets unit tests import application modules without
    needing a live database driver or connection string.
    """
    global _engine
    if _engine is None:
        _engine = create_async_engine(
            settings.database_url,
            echo=False,
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            pool_pre_ping=True,
        )
    return _engine


def get_async_session() -> async_sessionmaker[AsyncSession]:
    """Return the session factory, creating it on first call."""
    global _async_session
    if _async_session is None:
        _async_session = async_sessionmaker(
            get_engine(), class_=AsyncSession, expire_on_commit=False
        )
    return _async_session


# Backward-compatible module-level aliases so that existing code using
# ``from .database import engine, async_session`` continues to work.
# These are lazy proxies that resolve on first attribute access.
class _LazyEngine:
    """Proxy that defers ``create_async_engine`` until first use."""
    def __getattr__(self, name: str):
        return getattr(get_engine(), name)

class _LazySession:
    """Proxy that defers session-factory creation until first use."""
    def __call__(self, *args, **kwargs):
        return get_async_session()(*args, **kwargs)
    def __getattr__(self, name: str):
        return getattr(get_async_session(), name)


engine = _LazyEngine()
async_session = _LazySession()


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:  # type: ignore[misc]
    async with get_async_session()() as session:
        yield session
