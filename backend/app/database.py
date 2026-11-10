from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Session
from sqlalchemy.pool import NullPool, Pool


MAX_REBUILD_CHILD_TIMEOUT_SECONDS = 86400


class AppSession(Session):
    pass


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://hriv:hriv@db:5432/hriv"
    data_dir: str = "/data"
    source_images_dir: str = "/data/source_images"
    tiles_dir: str = "/data/tiles"
    export_pigz_threads: int = Field(default=2, ge=0)
    azure_read_sas_url: str = ""
    azure_backup_prefix: str = ""
    cors_origins: str = "*"
    db_pool_size: int = Field(default=10, ge=1)
    db_max_overflow: int = Field(default=20, ge=0)

    # Redis URL for task queue (Phase 5 — arq worker) and rate limiting
    redis_url: str = "redis://redis:6379"
    task_execution_mode: Literal["local", "required"] = "local"
    worker_max_jobs: int = Field(default=4, ge=2)
    rebuild_parallel_enabled: bool = False
    rebuild_parallelism: int = Field(default=2, ge=1)
    rebuild_child_timeout_seconds: int = Field(
        default=3600,
        ge=60,
        le=MAX_REBUILD_CHILD_TIMEOUT_SECONDS,
    )
    rebuild_lease_seconds: int = Field(default=3900, ge=120)
    rebuild_heartbeat_seconds: int = Field(default=30, ge=5)
    rebuild_pump_cadence_seconds: int = Field(default=60, ge=60, le=3600)
    rebuild_max_attempts: int = Field(default=2, ge=1)
    rebuild_retry_backoff_base_seconds: int = Field(default=60, ge=1)
    rebuild_retry_backoff_cap_seconds: int = Field(default=900, ge=1)

    # Resumable bulk-import coordination (#1173). The coordinator stays
    # API-hosted but is now claimed through a PostgreSQL lease on its
    # ``Job`` supervisor row, so an API restart/crash/rollout resumes the
    # import instead of abandoning it. Heartbeats must stay well under the
    # lease; the periodic sweep re-spawns coordinators for active durable
    # jobs and bounds crash-looping imports via the claim cap.
    bulk_import_coordinator_lease_seconds: int = Field(default=120, ge=30)
    bulk_import_coordinator_heartbeat_seconds: int = Field(default=30, ge=5)
    bulk_import_item_lease_seconds: int = Field(default=300, ge=30)
    bulk_import_max_coordinator_claims: int = Field(default=10, ge=1)
    bulk_import_max_item_attempts: int = Field(default=3, ge=1)
    bulk_import_coordinator_sweep_seconds: int = Field(default=30, ge=5)

    # Dark-launch flag for the collections feature (epic #1409). When off the
    # collections router answers 404 and the frontend hides the tab; the chart
    # defaults it off and the `latest` overlay turns it on (docs/collections.md).
    collections_enabled: bool = False
    collections_student_access: bool = True

    # My collections Browse shelf (#1583), gated by collections_enabled.
    collections_home_shelf: bool = False

    # Announcements stream (epic #1832): dark-launch flag for the new
    # /api/announcements surface and the Announcements UI. The legacy
    # /api/announcement and /api/changelog shims ignore it. Chart default off;
    # the `latest` overlay turns it on; removed by the epic's closing issue (#1838).
    announcements_enabled: bool = False

    # Object counting (epic #1661): dark-launch flag, dedicated arq
    # queue/worker, pre-flight pixel budget, per-user job cap and ephemeral
    # Redis result policy. Job state never touches Postgres. The budget,
    # downsample and margin defaults are placeholders until the outliner
    # spike (#1662) produces measured numbers — see docs/object-counting.md.
    counting_enabled: bool = False
    counting_queue_name: str = "arq:counting"
    counting_max_pixels: int = Field(default=750_000, ge=65_536)
    # Classical (scikit-image watershed) outliners are ~20x faster per MP
    # than the ML outliners, so they get a larger pixel budget before a
    # selection is rejected as too_large (#1719).
    counting_classical_max_pixels: int = Field(default=2_000_000, ge=65_536)
    counting_max_downsample: int = Field(default=8, ge=1)
    counting_margin_px: int = Field(default=32, ge=0)
    counting_torch_threads: int = Field(default=2, ge=1)
    counting_models_dir: str = "/opt/hriv-models"
    counting_cells_outliner: Literal["classical", "stub"] = "classical"
    counting_nuclei_outliner: Literal["instanseg", "classical", "stub"] = "instanseg"
    counting_max_active_per_user: int = Field(default=3, ge=1)
    counting_result_ttl_seconds: int = Field(default=600, ge=60)
    counting_job_timeout_seconds: int = Field(default=60, ge=5)
    counting_max_objects: int = Field(default=3000, ge=1)

    # Audit middleware: comma-separated list of URL paths whose request logs are
    # emitted at DEBUG instead of INFO. Entries without a trailing slash match
    # the exact path or a subpath (e.g. /api/metrics matches /api/metrics but not
    # /api/metrics_custom). Entries with a trailing slash match any path under
    # that prefix. Intended for high-volume, low-signal endpoints (container
    # healthchecks, tile serving, Prometheus scrapes, etc.). Operators can
    # extend the list per deployment by setting the AUDIT_EXCLUDE_PREFIXES env var.
    audit_exclude_prefixes: str = "/api/health,/api/tiles/,/api/metrics,/api/_probe"

    # Retention policy for retained filesystem-import archives. Applied after
    # a successful files import and once at startup. Count keeps only the
    # newest N distinct archives; days deletes archives older than the given
    # age. 0 (the default) disables that dimension, so archives are retained
    # indefinitely unless an operator opts in.
    files_import_archive_retention_count: int = Field(default=0, ge=0)
    files_import_archive_retention_days: int = Field(default=0, ge=0)

    # Number of trusted reverse proxies that append to X-Forwarded-For before
    # a request reaches the backend. The client IP is taken this many entries
    # from the RIGHT of the header (the leftmost entry is client-controlled).
    # 1 = frontend nginx only (docker compose). The fleet deployment chain is
    # HAProxy gateway (overwrites XFF with the client IP) -> ingress-nginx
    # (appends) -> frontend nginx (appends) -> uvicorn, i.e. 3. 0 = ignore
    # forwarding headers and use the direct connection address.
    # See docs/deployment-proxy-chain.md.
    trusted_proxy_hops: int = Field(default=1, ge=0)

    # Set the ``Secure`` flag on cookies the backend issues (admin download
    # token). Deployments always serve over TLS at the edge, so this defaults
    # on and is only switched off for plain-http docker-compose development.
    secure_cookies: bool = True

    # Login rate limiting (Phase 5). Two sliding-window budgets: a
    # per-(client IP, email) budget so one shared campus NAT does not lock
    # out unrelated users, and a longer account-scoped per-email budget that
    # does not depend on the client IP at all, bounding password guessing
    # against a single account even if the caller can vary its apparent
    # source address.
    rate_limit_login_max: int = 5
    rate_limit_login_window: int = 60  # seconds
    rate_limit_login_email_max: int = 20
    rate_limit_login_email_window: int = 900  # seconds

    # Telemetry ingestion rate limiting. Batches are small and best-effort, so
    # the window is generous; this only guards against a misbehaving or
    # malicious client flooding the structured-log pipeline. Two budgets are
    # enforced over the same window: a per-tab (user + session) limit that
    # stops an accidental tab loop, and a higher per-user aggregate cap so a
    # client rotating ``X-Session-ID`` cannot mint unlimited throughput while
    # legitimately shared student accounts still retain plenty of headroom.
    rate_limit_telemetry_max: int = 60
    rate_limit_telemetry_user_max: int = 600
    rate_limit_telemetry_window: int = 60  # seconds

    # Shared static credential accepted by POST /api/telemetry/synthetic-result
    # as an alternative to the monitor account's user JWT. The same secret is
    # delivered to the synthetic-monitoring CronJob and the backend (flux-fleet
    # ``hriv-synthetic-ingest`` VaultStaticSecret). Validation is a
    # constant-time compare requiring no database access, so failure reports
    # still land during authentication/database outages (#1495) — precisely
    # when a user JWT cannot be obtained. Empty disables the token path so
    # only JWT-authenticated synthetic accounts may report (local dev).
    synthetic_ingest_token: str = ""

    # Sliding-window rate limit for the synthetic-result ingest endpoint,
    # enforced identically for both credential paths. The monitor posts at
    # most a few results per CronJob run, so the budget only bounds abuse of
    # a leaked ingest token or a misbehaving monitor.
    rate_limit_synthetic_ingest_max: int = 30
    rate_limit_synthetic_ingest_window: int = 60  # seconds

    # OIDC / OAuth settings (Phase 3 — Identity)
    oidc_enabled: bool = False
    oidc_issuer: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: str = ""
    oidc_redirect_uri: str = ""
    oidc_scopes: str = "openid email profile"
    oidc_role_mapping: str = "{}"  # JSON: {"idp-group": "hriv-role"}
    oidc_post_login_redirect: str = ""  # Frontend URL to redirect to after OIDC login
    oidc_trust_email: bool = False  # Skip email_verified check (for IdPs like Vault that don't emit it)

    @field_validator("counting_max_downsample")
    @classmethod
    def _check_power_of_two(cls, value: int) -> int:
        """``COUNTING_MAX_DOWNSAMPLE`` steps through DZI levels, which halve
        per level — only powers of two land on real pyramid levels."""
        if value & (value - 1):
            raise ValueError(
                "COUNTING_MAX_DOWNSAMPLE must be a power of two"
            )
        return value

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

    @model_validator(mode="after")
    def _validate_rebuild_scheduler(self) -> "Settings":
        if self.rebuild_heartbeat_seconds >= self.rebuild_lease_seconds:
            raise ValueError(
                "REBUILD_HEARTBEAT_SECONDS must be shorter than "
                "REBUILD_LEASE_SECONDS"
            )
        if self.rebuild_child_timeout_seconds >= self.rebuild_lease_seconds:
            raise ValueError(
                "REBUILD_CHILD_TIMEOUT_SECONDS must be shorter than "
                "REBUILD_LEASE_SECONDS"
            )
        if self.rebuild_pump_cadence_seconds % 60:
            raise ValueError(
                "REBUILD_PUMP_CADENCE_SECONDS must be a multiple of 60"
            )
        if (
            self.rebuild_retry_backoff_base_seconds
            > self.rebuild_retry_backoff_cap_seconds
        ):
            raise ValueError(
                "REBUILD_RETRY_BACKOFF_BASE_SECONDS must not exceed "
                "REBUILD_RETRY_BACKOFF_CAP_SECONDS"
            )
        if (
            self.bulk_import_coordinator_heartbeat_seconds
            >= self.bulk_import_coordinator_lease_seconds
        ):
            raise ValueError(
                "BULK_IMPORT_COORDINATOR_HEARTBEAT_SECONDS must be shorter "
                "than BULK_IMPORT_COORDINATOR_LEASE_SECONDS"
            )
        if (
            self.bulk_import_coordinator_heartbeat_seconds
            >= self.bulk_import_item_lease_seconds
        ):
            raise ValueError(
                "BULK_IMPORT_COORDINATOR_HEARTBEAT_SECONDS must be shorter "
                "than BULK_IMPORT_ITEM_LEASE_SECONDS"
            )
        return self


settings = Settings()

_engine = None
_async_session = None


def get_engine() -> AsyncEngine:
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


def get_engine_pool() -> Pool | None:
    """Return the shared engine's connection pool, or ``None`` before first use.

    Unlike :func:`get_engine`, this never creates the engine — telemetry
    observers use it so that reporting metrics cannot itself create the
    resource being observed.
    """
    return _engine.pool if _engine is not None else None


_probe_engine = None


def get_probe_engine() -> AsyncEngine:
    """Return the dedicated unpooled engine used by readiness probes.

    ``NullPool`` means every ``connect()`` establishes a brand-new PostgreSQL
    session and closes it on release. Probes must test *connection
    establishment* — a pooled checkout can silently reuse a session that
    authenticated before database credentials were revoked or rotated, which
    reported pods Ready through the 2026-10-02 dynamic-credential outage
    while every new connection failed (#1496).
    """
    global _probe_engine
    if _probe_engine is None:
        _probe_engine = create_async_engine(
            settings.database_url,
            echo=False,
            poolclass=NullPool,
        )
    return _probe_engine


async def dispose_probe_engine() -> None:
    """Close the probe engine if it was ever created (app shutdown)."""
    global _probe_engine
    if _probe_engine is not None:
        engine = _probe_engine
        _probe_engine = None
        await engine.dispose()


def get_async_session() -> async_sessionmaker[AsyncSession]:
    """Return the session factory, creating it on first call."""
    global _async_session
    if _async_session is None:
        _async_session = async_sessionmaker(
            get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
            sync_session_class=AppSession,
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
