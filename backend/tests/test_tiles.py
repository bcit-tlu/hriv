"""Tests for the authorized tile-delivery boundary (issues #1069 / #1064).

Covers the stateless tile-token module, token issuance at image
serialization time (``ImageOut``), the FastAPI-authorized tile route that
replaced the unauthenticated ``StaticFiles`` mount, and the nginx
``auth_request`` validator ``GET /api/tiles-auth``.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from jose import jwt

import app.auth as auth
from app.auth import auth_settings
from app.routers import images as images_router
from app.routers import tiles as tiles_router
from app.schemas import ImageOut
from app.tile_tokens import (
    TileTokenError,
    append_tile_token,
    issue_tile_token,
    source_image_id_from_tile_url,
    validate_tile_token,
)


def _expired_token(source_image_id: int) -> str:
    payload = {
        "purpose": "tile",
        "sid": source_image_id,
        "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
    }
    return jwt.encode(
        payload, auth_settings.jwt_secret, algorithm=auth_settings.jwt_algorithm
    )


def _wrong_purpose_token(source_image_id: int) -> str:
    payload = {
        "purpose": "task-download",
        "sid": source_image_id,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
    }
    return jwt.encode(
        payload, auth_settings.jwt_secret, algorithm=auth_settings.jwt_algorithm
    )


# ── tile_tokens module ────────────────────────────────────


def test_issue_and_validate_roundtrip() -> None:
    token = issue_tile_token(42)
    validate_tile_token(token, 42)  # does not raise


def test_validate_rejects_wrong_image_id_with_403() -> None:
    token = issue_tile_token(42)
    with pytest.raises(TileTokenError) as exc:
        validate_tile_token(token, 43)
    assert exc.value.status_code == 403


def test_validate_rejects_expired_token_with_401() -> None:
    with pytest.raises(TileTokenError) as exc:
        validate_tile_token(_expired_token(42), 42)
    assert exc.value.status_code == 401


def test_validate_rejects_tampered_token_with_401() -> None:
    token = issue_tile_token(42) + "x"
    with pytest.raises(TileTokenError) as exc:
        validate_tile_token(token, 42)
    assert exc.value.status_code == 401


def test_validate_rejects_wrong_purpose_with_401() -> None:
    with pytest.raises(TileTokenError) as exc:
        validate_tile_token(_wrong_purpose_token(42), 42)
    assert exc.value.status_code == 401


def test_source_image_id_from_tile_url() -> None:
    assert source_image_id_from_tile_url("/api/tiles/42/image.dzi") == 42
    assert (
        source_image_id_from_tile_url(
            "/api/tiles/7/image_files/12/3_4.jpeg?tile_token=abc"
        )
        == 7
    )
    assert source_image_id_from_tile_url("/api/tiles/abc/image.dzi") is None
    assert source_image_id_from_tile_url("/thumb.jpg") is None
    assert source_image_id_from_tile_url("/tiles/reorder-fixture/1") is None


def test_append_tile_token_tokenizes_tile_urls() -> None:
    url = append_tile_token("/api/tiles/42/image.dzi")
    assert url.startswith("/api/tiles/42/image.dzi?tile_token=")
    token = url.split("tile_token=", 1)[1]
    validate_tile_token(token, 42)


def test_append_tile_token_uses_ampersand_with_existing_query() -> None:
    url = append_tile_token("/api/tiles/42/image.dzi?v=1")
    assert "?v=1&tile_token=" in url


def test_append_tile_token_leaves_non_tile_urls_unchanged() -> None:
    assert append_tile_token("/thumb.jpg") == "/thumb.jpg"
    assert append_tile_token("/tiles/reorder-fixture/1") == "/tiles/reorder-fixture/1"


# ── Issuance at serialization time (ImageOut) ─────────────


def _make_image(
    id: int = 1,
    name: str = "test-img",
    category_id: int | None = None,
    active: bool = True,
    thumb: str = "/api/tiles/9/thumbnail.jpeg",
    tile_sources: str = "/api/tiles/9/image.dzi",
) -> SimpleNamespace:
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=id,
        name=name,
        thumb=thumb,
        tile_sources=tile_sources,
        category_id=category_id,
        copyright=None,
        note=None,
        active=active,
        sort_order=0,
        metadata_=None,
        version=1,
        width=None,
        height=None,
        file_size=None,
        created_at=now,
        updated_at=now,
    )


def test_image_out_serialization_appends_tile_token() -> None:
    data = ImageOut.model_validate(_make_image()).model_dump()
    assert data["tile_sources"].startswith("/api/tiles/9/image.dzi?tile_token=")
    assert data["thumb"].startswith("/api/tiles/9/thumbnail.jpeg?tile_token=")
    validate_tile_token(data["tile_sources"].split("tile_token=", 1)[1], 9)
    validate_tile_token(data["thumb"].split("tile_token=", 1)[1], 9)


def test_image_out_serialization_keeps_non_tile_urls() -> None:
    img = _make_image(thumb="/thumb.jpg", tile_sources="/tiles/legacy/1")
    data = ImageOut.model_validate(img).model_dump()
    assert data["thumb"] == "/thumb.jpg"
    assert data["tile_sources"] == "/tiles/legacy/1"


def test_image_out_does_not_mutate_persisted_columns() -> None:
    img = _make_image()
    ImageOut.model_validate(img).model_dump()
    assert img.tile_sources == "/api/tiles/9/image.dzi"
    assert img.thumb == "/api/tiles/9/thumbnail.jpeg"


# ── End-to-end: issuance sits behind auth + visibility ────


def _make_user(
    role: str = "admin",
    programs: list | None = None,
    groups: list | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=1,
        role=role,
        email=f"{role}@example.com",
        programs=programs or [],
        groups=groups or [],
    )


def _images_test_app(user_role: str, db: AsyncMock) -> FastAPI:
    app = FastAPI()
    app.include_router(images_router.router, prefix="/api")

    async def override_db():
        yield db

    app.dependency_overrides[auth.get_current_user] = lambda: _make_user(user_role)
    app.dependency_overrides[images_router.get_db] = override_db
    return app


async def test_visible_student_receives_tokenized_urls() -> None:
    img = _make_image(id=1, category_id=None, active=True)
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)

    transport = httpx.ASGITransport(app=_images_test_app("student", db))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/images/1")
    assert resp.status_code == 200
    body = resp.json()
    assert body["tile_sources"].startswith("/api/tiles/9/image.dzi?tile_token=")
    assert body["thumb"].startswith("/api/tiles/9/thumbnail.jpeg?tile_token=")
    validate_tile_token(body["tile_sources"].split("tile_token=", 1)[1], 9)


async def test_hidden_category_student_receives_no_token() -> None:
    """A student behind a hidden ancestor gets a 404, never a token."""
    img = _make_image(id=1, category_id=5)
    cat = SimpleNamespace(id=5, status="hidden", programs=[], groups=[], parent_id=None)

    db = AsyncMock()
    db.get = AsyncMock(side_effect=[img, cat])

    transport = httpx.ASGITransport(app=_images_test_app("student", db))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/images/1")
    assert resp.status_code == 404
    assert "tile_token" not in resp.text


async def test_program_restricted_student_receives_no_token() -> None:
    """Wrong program → 404 on detail, no token in the response."""
    img = _make_image(id=1, category_id=5)
    cat = SimpleNamespace(
        id=5,
        status="active",
        programs=[SimpleNamespace(id=77)],
        groups=[],
        parent_id=None,
    )

    db = AsyncMock()
    db.get = AsyncMock(side_effect=[img, cat])

    transport = httpx.ASGITransport(app=_images_test_app("student", db))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/images/1")
    assert resp.status_code == 404
    assert "tile_token" not in resp.text


async def test_group_restricted_student_receives_no_token() -> None:
    """Wrong group → 404 on detail, no token in the response."""
    img = _make_image(id=1, category_id=5)
    cat = SimpleNamespace(
        id=5,
        status="active",
        programs=[],
        groups=[SimpleNamespace(id=88)],
        parent_id=None,
    )

    db = AsyncMock()
    db.get = AsyncMock(side_effect=[img, cat])

    transport = httpx.ASGITransport(app=_images_test_app("student", db))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/images/1")
    assert resp.status_code == 404
    assert "tile_token" not in resp.text


async def test_inactive_image_student_receives_no_token() -> None:
    img = _make_image(id=1, active=False)
    db = AsyncMock()
    db.get = AsyncMock(return_value=img)

    transport = httpx.ASGITransport(app=_images_test_app("student", db))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/images/1")
    assert resp.status_code == 404
    assert "tile_token" not in resp.text


async def test_list_images_student_only_visible_images_tokenized() -> None:
    """List responses carry tokens only for images that pass the filter."""
    imgs = [_make_image(id=1, active=True)]
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = imgs

    # Visibility helper's categories query: no exclusions.
    cat_result = MagicMock()
    cat_result.scalars.return_value.unique.return_value.all.return_value = []

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[cat_result, mock_result])

    transport = httpx.ASGITransport(app=_images_test_app("student", db))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/images/")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert "tile_token=" in body[0]["tile_sources"]


# ── Tile route (StaticFiles replacement) ──────────────────


@pytest.fixture()
def tiles_app(tmp_path, monkeypatch: pytest.MonkeyPatch) -> FastAPI:
    tiles_dir = tmp_path / "tiles"
    image_dir = tiles_dir / "42"
    (image_dir / "image_files" / "0").mkdir(parents=True)
    (image_dir / "image.dzi").write_text("<?xml version='1.0'?><Image/>")
    (image_dir / "thumbnail.jpeg").write_bytes(b"\xff\xd8jpegdata")
    (image_dir / "image_files" / "0" / "0_0.jpeg").write_bytes(b"\xff\xd8tile")
    # A file outside the image directory that traversal must not reach.
    (tiles_dir / "secret.txt").write_text("secret")
    monkeypatch.setattr(tiles_router.settings, "tiles_dir", str(tiles_dir))

    app = FastAPI()
    app.include_router(tiles_router.router, prefix="/api")
    return app


def _client(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


async def test_tile_route_without_token_returns_401(tiles_app: FastAPI) -> None:
    async with _client(tiles_app) as client:
        resp = await client.get("/api/tiles/42/image.dzi")
    assert resp.status_code == 401


async def test_tile_route_wrong_image_token_returns_403(tiles_app: FastAPI) -> None:
    token = issue_tile_token(43)
    async with _client(tiles_app) as client:
        resp = await client.get(f"/api/tiles/42/image.dzi?tile_token={token}")
    assert resp.status_code == 403


async def test_tile_route_expired_token_returns_401(tiles_app: FastAPI) -> None:
    token = _expired_token(42)
    async with _client(tiles_app) as client:
        resp = await client.get(f"/api/tiles/42/image.dzi?tile_token={token}")
    assert resp.status_code == 401


async def test_tile_route_serves_dzi_with_private_cache(tiles_app: FastAPI) -> None:
    token = issue_tile_token(42)
    async with _client(tiles_app) as client:
        resp = await client.get(f"/api/tiles/42/image.dzi?tile_token={token}")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/xml")
    assert resp.headers["cache-control"] == "private, max-age=2592000"
    assert "<Image/>" in resp.text


async def test_tile_route_serves_jpeg_tile(tiles_app: FastAPI) -> None:
    token = issue_tile_token(42)
    async with _client(tiles_app) as client:
        resp = await client.get(
            f"/api/tiles/42/image_files/0/0_0.jpeg?tile_token={token}"
        )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/jpeg"
    assert resp.headers["cache-control"] == "private, max-age=2592000"


async def test_tile_route_missing_file_returns_404(tiles_app: FastAPI) -> None:
    token = issue_tile_token(42)
    async with _client(tiles_app) as client:
        resp = await client.get(f"/api/tiles/42/missing.jpeg?tile_token={token}")
    assert resp.status_code == 404


async def test_tile_route_blocks_path_traversal(tiles_app: FastAPI) -> None:
    token = issue_tile_token(42)
    async with _client(tiles_app) as client:
        resp = await client.get(
            f"/api/tiles/42/%2e%2e/secret.txt?tile_token={token}"
        )
    assert resp.status_code in (400, 404)
    assert "secret" not in resp.text


async def test_tile_route_traversal_helper_direct() -> None:
    """Belt-and-braces: the handler rejects traversal even if a raw ``..``
    path segment reaches it (bypassing HTTP-layer normalization)."""
    with pytest.raises(HTTPException) as exc:
        await tiles_router.serve_tile(
            42, "../secret.txt", tile_token=issue_tile_token(42)
        )
    assert exc.value.status_code == 404


# ── GET /api/tiles-auth (nginx auth_request contract) ─────


@pytest.fixture()
def auth_app() -> FastAPI:
    app = FastAPI()
    app.include_router(tiles_router.router, prefix="/api")
    return app


async def test_tiles_auth_valid_token_in_original_uri_returns_204(
    auth_app: FastAPI,
) -> None:
    token = issue_tile_token(42)
    async with _client(auth_app) as client:
        resp = await client.get(
            "/api/tiles-auth",
            headers={
                "X-Original-URI": f"/api/tiles/42/image.dzi?tile_token={token}"
            },
        )
    assert resp.status_code == 204


async def test_tiles_auth_valid_token_in_header_returns_204(
    auth_app: FastAPI,
) -> None:
    token = issue_tile_token(42)
    async with _client(auth_app) as client:
        resp = await client.get(
            "/api/tiles-auth",
            headers={
                "X-Original-URI": "/api/tiles/42/image_files/0/0_0.jpeg",
                "X-Tile-Token": token,
            },
        )
    assert resp.status_code == 204


async def test_tiles_auth_valid_token_in_query_returns_204(
    auth_app: FastAPI,
) -> None:
    token = issue_tile_token(42)
    async with _client(auth_app) as client:
        resp = await client.get(
            f"/api/tiles-auth?tile_token={token}",
            headers={"X-Original-URI": "/api/tiles/42/image.dzi"},
        )
    assert resp.status_code == 204


async def test_tiles_auth_missing_original_uri_returns_401(
    auth_app: FastAPI,
) -> None:
    async with _client(auth_app) as client:
        resp = await client.get("/api/tiles-auth")
    assert resp.status_code == 401


async def test_tiles_auth_missing_token_returns_401(auth_app: FastAPI) -> None:
    async with _client(auth_app) as client:
        resp = await client.get(
            "/api/tiles-auth",
            headers={"X-Original-URI": "/api/tiles/42/image.dzi"},
        )
    assert resp.status_code == 401


async def test_tiles_auth_expired_token_returns_401(auth_app: FastAPI) -> None:
    token = _expired_token(42)
    async with _client(auth_app) as client:
        resp = await client.get(
            "/api/tiles-auth",
            headers={
                "X-Original-URI": f"/api/tiles/42/image.dzi?tile_token={token}"
            },
        )
    assert resp.status_code == 401


async def test_tiles_auth_wrong_image_returns_403(auth_app: FastAPI) -> None:
    token = issue_tile_token(43)
    async with _client(auth_app) as client:
        resp = await client.get(
            "/api/tiles-auth",
            headers={
                "X-Original-URI": f"/api/tiles/42/image.dzi?tile_token={token}"
            },
        )
    assert resp.status_code == 403


async def test_tiles_auth_non_tile_uri_returns_403(auth_app: FastAPI) -> None:
    token = issue_tile_token(42)
    async with _client(auth_app) as client:
        resp = await client.get(
            "/api/tiles-auth",
            headers={
                "X-Original-URI": f"/api/admin/export?tile_token={token}"
            },
        )
    assert resp.status_code == 403
