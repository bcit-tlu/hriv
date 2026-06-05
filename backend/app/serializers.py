"""Helpers for converting ORM objects into response-shaped dicts.

Kept separate from ``schemas`` (Pydantic models) and from any single router so
that multiple routers can share serialization without importing each other's
private helpers.
"""

from .models import User


def user_to_out(user: User) -> dict:
    """Convert a User ORM object to a dict with program info resolved."""
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "program_ids": [p.id for p in user.programs],
        "program_names": [p.name for p in user.programs],
        "metadata_extra": user.metadata_,
        "last_access": user.last_access,
        "created_at": user.created_at,
        "updated_at": user.updated_at,
    }
