import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_db, settings
from .logging_config import setup_logging
from .middleware import AuditMiddleware
from .routers import admin, announcement, auth, bulk_import, categories, images, issues, programs, upload, users

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialise structured JSON logging inside the lifespan handler so it
    # runs *after* uvicorn has applied its default logging.config.dictConfig.
    # This ensures our JSON formatter and level overrides stick.
    setup_logging()

    logger.info(
        "Application started",
        extra={
            "event": "app.started",
            "tiles_dir": settings.tiles_dir,
            "source_images_dir": settings.source_images_dir,
        },
    )
    yield
    logger.info("Application shutting down", extra={"event": "app.shutdown"})


app = FastAPI(title="Corgi Image Library API", version="0.1.0", lifespan=lifespan)

# CORS: read allowed origins from the CORS_ORIGINS env var (comma-separated).
# Defaults to "*" for local development; production deployments should set
# this to the actual frontend origin(s), e.g. "https://corgi.bcit.ca".
_cors_origins = [
    o.strip() for o in settings.cors_origins.split(",") if o.strip()
] or ["*"]

app.add_middleware(AuditMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*", "X-Request-ID", "X-Session-ID"],
    expose_headers=["X-Request-ID"],
)

app.include_router(auth.router, prefix="/api")
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
    return {"status": "ok"}


@app.get("/api/health/ready")
async def readiness(db: AsyncSession = Depends(get_db)):
    """Readiness probe: verifies the database connection is alive."""
    await db.execute(text("SELECT 1"))
    return {"status": "ready"}
