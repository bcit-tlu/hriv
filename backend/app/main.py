import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .database import settings
from .logging_config import setup_logging
from .routers import admin, announcement, auth, bulk_import, categories, images, issues, programs, upload, users

# Initialise structured JSON logging before anything else runs.
setup_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
