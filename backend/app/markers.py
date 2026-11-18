"""Shared feature gate for Marker and Board routers."""

from fastapi import HTTPException

from .database import settings


def require_markers_enabled() -> None:
    if not settings.markers_enabled:
        raise HTTPException(status_code=404, detail="Not Found")
