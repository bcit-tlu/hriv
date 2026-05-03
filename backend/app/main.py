import app.otel_bootstrap  # noqa: F401 — side-effect: configure OTEL SDK

import logging
import os
from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .admin_ops import reconcile_stale_tasks
from .auth import auth_settings
from .database import get_async_session, get_db, settings
from .logging_config import setup_logging
from .middleware import AuditMiddleware
from .routers import admin, announcement, auth, bulk_import, categories, images, issues, oidc, programs, upload, users

logger = logging.getLogger(__name__)


async def _check_oidc_connectivity() -> None:
    """Best-effort startup probe for the OIDC provider.

    Fetches the OpenID Connect discovery document so operators see a clear
    log message immediately at boot when the pod cannot reach the IdP,
    rather than discovering the problem only when a user clicks *Sign in*.
    """
    metadata_url = (
        f"{settings.oidc_issuer.rstrip('/')}/.well-known/openid-configuration"
    )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(metadata_url)
            resp.raise_for_status()
        logger.info(
            "OIDC provider is reachable",
            extra={
                "event": "oidc.connectivity_ok",
                "metadata_url": metadata_url,
            },
        )
    except (httpx.ConnectError, httpx.TimeoutException):
        logger.error(
            "OIDC provider is UNREACHABLE — login will fail. "
            "Verify that the pod can connect to %s "
            "(DNS resolution, network policies, firewall rules).",
            settings.oidc_issuer,
            extra={
                "event": "oidc.connectivity_failed",
                "metadata_url": metadata_url,
                "issuer": settings.oidc_issuer,
            },
        )
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "OIDC metadata endpoint returned HTTP %s — "
            "the provider may be misconfigured.",
            exc.response.status_code,
            extra={
                "event": "oidc.metadata_http_error",
                "metadata_url": metadata_url,
                "status": exc.response.status_code,
            },
        )
    except Exception as exc:
        logger.warning(
            "OIDC connectivity check failed: %s",
            exc,
            extra={
                "event": "oidc.connectivity_error",
                "metadata_url": metadata_url,
                "error": str(exc),
            },
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialise structured JSON logging inside the lifespan handler so it
    # runs *after* uvicorn has applied its default logging.config.dictConfig.
    # This ensures our JSON formatter and level overrides stick.
    setup_logging()

    logger.info(
        "Application started (version %s)",
        os.environ.get("APP_VERSION", "dev"),
        extra={
            "event": "app.started",
            "version": os.environ.get("APP_VERSION", "dev"),
            "tiles_dir": settings.tiles_dir,
            "source_images_dir": settings.source_images_dir,
        },
    )

    if settings.oidc_enabled:
        await _check_oidc_connectivity()

    # Reconcile admin tasks orphaned by a previous pod crash/rollout so
    # their concurrency guard doesn't permanently block new imports or
    # exports.  Stale-timestamp protection keeps multi-replica deployments
    # safe (sibling pods still writing progress will not be clobbered).
    try:
        async with get_async_session()() as session:
            await reconcile_stale_tasks(session)
    except Exception as exc:  # pragma: no cover - best effort on startup
        logger.warning(
            "Stale admin task reconciliation failed: %s",
            exc,
            extra={"event": "admin_task.reconcile_failed", "error": str(exc)},
        )

    yield
    logger.info("Application shutting down", extra={"event": "app.shutdown"})


app = FastAPI(
    title="HRIV Image Library API",
    version=os.environ.get("APP_VERSION", "dev"),
    lifespan=lifespan,
)

# CORS: read allowed origins from the CORS_ORIGINS env var (comma-separated).
# Defaults to "*" for local development; production deployments should set
# this to the actual frontend origin(s), e.g. "https://hriv.bcit.ca".
_cors_origins = [
    o.strip() for o in settings.cors_origins.split(",") if o.strip()
] or ["*"]

app.add_middleware(AuditMiddleware)

# Starlette session middleware — required by authlib's OIDC client to store
# the OAuth state/nonce between the login redirect and the callback.
app.add_middleware(SessionMiddleware, secret_key=auth_settings.jwt_secret)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*", "X-Request-ID", "X-Session-ID"],
    expose_headers=["X-Request-ID"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(oidc.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(bulk_import.router, prefix="/api")
app.include_router(announcement.router, prefix="/api")
app.include_router(categories.router, prefix="/api")
app.include_router(images.router, prefix="/api")
app.include_router(issues.router, prefix="/api")
app.include_router(programs.router, prefix="/api")
app.include_router(upload.router, prefix="/api")
app.include_router(users.router, prefix="/api")

# Serve generated DZI tiles as static files
os.makedirs(settings.tiles_dir, exist_ok=True)
app.mount("/api/tiles", StaticFiles(directory=settings.tiles_dir), name="tiles")


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": app.version}


@app.get("/api/health/ready")
async def readiness(db: AsyncSession = Depends(get_db)):
    """Readiness probe: verifies the database connection is alive."""
    await db.execute(text("SELECT 1"))
    return {"status": "ready", "version": app.version}
