"""Shared test fixtures."""

import pytest

from app.routers.oidc import _parse_role_mapping


@pytest.fixture(autouse=True)
def _clear_role_mapping_cache():
    """Clear the ``_parse_role_mapping`` LRU cache between tests."""
    _parse_role_mapping.cache_clear()
    yield
    _parse_role_mapping.cache_clear()
