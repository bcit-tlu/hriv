"""Shared feature gate for Inuksuk and Board routers."""

from fastapi import HTTPException

from .database import settings


def require_inuksuks_enabled() -> None:
    if not settings.inuksuks_enabled:
        raise HTTPException(status_code=404, detail="Not Found")
