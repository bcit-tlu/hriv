"""Read API integration tests against migrated PostgreSQL, without service mocks."""

import os
from types import SimpleNamespace as NS
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import httpx
import jwt
import pytest
from fastapi import FastAPI
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app import auth, board_views
from app.database import get_db, settings
from app.middleware import InuksuksFeatureMiddleware
from app.models import (
    Board, BoardInuksuk, BoardSection, Category, Group, Image, Inuksuk, Program, User,
)
from app.routers import boards, images, inuksuks
from app.tile_tokens import TileTokenError, validate_tile_token

DB_URL = os.environ.get("TEST_DATABASE_URL", "")


def make_app() -> FastAPI:
    app = FastAPI()
    app.include_router(boards.router, prefix="/api")
    app.include_router(inuksuks.router, prefix="/api")
    app.include_router(images.router, prefix="/api")
    return app


@pytest.mark.parametrize("path", [
    "/api/boards", "/api/boards/1", "/api/inuksuks", "/api/inuksuks/1", "/api/images/1/inuksuks",
])
async def test_router_dependency_flag_off_before_auth_or_database(monkeypatch, path):
    monkeypatch.setattr(settings, "inuksuks_enabled", False)
    app = make_app()

    def forbidden():
        raise AssertionError("Feature gate must run first")

    app.dependency_overrides[auth.get_current_user] = forbidden
    app.dependency_overrides[get_db] = forbidden
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        result = await client.get(path)
    assert result.status_code == 404
    assert result.json() == {"detail": "Not Found"}


def test_main_registers_read_routes(tmp_path, monkeypatch):
    from app import admin_ops

    monkeypatch.setattr(settings, "tiles_dir", str(tmp_path / "tiles"))
    monkeypatch.setattr(settings, "source_images_dir", str(tmp_path / "source_images"))
    monkeypatch.setattr(admin_ops, "_TASKS_DIR", str(tmp_path / "admin_tasks"))
    from app.main import app

    paths = set(app.openapi()["paths"])
    assert {
        "/api/boards", "/api/boards/{board_id}", "/api/inuksuks",
        "/api/images/{image_id}/inuksuks", "/api/inuksuks/{inuksuk_id}",
    } <= paths


@pytest.fixture
async def world(monkeypatch):
    if not DB_URL:
        pytest.skip("TEST_DATABASE_URL not set")
    monkeypatch.setattr(settings, "inuksuks_enabled", True)
    monkeypatch.setattr(board_views.time, "time", lambda: 10000)
    engine = create_async_engine(DB_URL)
    async with engine.connect() as connection:
        transaction = await connection.begin()
        async with AsyncSession(bind=connection, expire_on_commit=False) as db:
            suffix = uuid4().hex
            p1, p2 = [Program(name=f"board-read-{suffix}-{i}") for i in range(2)]
            users = {
                role: User(
                    name=role, email=f"{suffix}-{role}@example.test", role=role,
                    programs=[p1], groups=[],
                )
                for role in ("admin", "instructor", "staff", "student")
            }
            other = User(name="other", email=f"{suffix}-other@example.test", role="student", programs=[], groups=[])
            g1 = Group(name=f"board-read-{suffix}-g1", members=[users["student"]], instructors=[users["instructor"]])
            g2 = Group(name=f"board-read-{suffix}-g2", members=[], instructors=[users["instructor"]])
            db.add_all([p1, p2, *users.values(), other, g1, g2])
            await db.flush()
            await db.refresh(users["student"], ["groups"])
            hidden = Category(label="hidden", status="hidden", programs=[], groups=[])
            program = Category(label="wrong program", programs=[p2], groups=[])
            group = Category(label="wrong group", programs=[p1], groups=[g2])
            db.add_all([hidden, program, group])
            await db.flush()
            child = Category(label="hidden child", parent_id=hidden.id, programs=[], groups=[])
            db.add(child)
            await db.flush()
            imgs = {
                key: Image(
                    name=key, active=active, category_id=cat,
                    thumb="/api/tiles/42/thumbnail.jpeg", tile_sources="/api/tiles/42/image.dzi",
                )
                for key, active, cat in [
                    ("visible", True, None), ("inactive", False, None),
                    ("hidden", True, child.id), ("program", True, program.id),
                    ("group", True, group.id),
                ]
            }
            bs = {
                "private": Board(name="Private student", visibility="private", owners=[other]),
                "mine": Board(name="Mine", visibility="private", owners=[users["student"]]),
                "public": Board(name="Alpha public", visibility="public", owners=[other]),
                "instructor": Board(name="Instructor", visibility="public", owners=[users["instructor"]]),
                "restricted": Board(name="Restricted", visibility="restricted", owners=[other], programs=[p1], groups=[g1]),
                "wrong_program": Board(name="Wrong program", visibility="restricted", owners=[other], programs=[p2]),
                "wrong_group": Board(name="Wrong group", visibility="restricted", owners=[other], programs=[p1], groups=[g2]),
                "empty_scope": Board(name="Empty scope", visibility="restricted", owners=[]),
                "program": Board(name="Program owned", visibility="restricted", owner_program=p1, owners=[]),
                "private_instructor": Board(name="Private instructor", visibility="private", owners=[users["instructor"]]),
            }
            db.add_all([*imgs.values(), *bs.values()])
            await db.flush()
            sections = [
                BoardSection(board_id=bs["public"].id, name="Late", sort_order=2),
                BoardSection(board_id=bs["public"].id, name="Early", sort_order=1),
            ]
            db.add_all(sections)
            await db.flush()
            items = {}

            def add(key, *, owner=None, image="visible", on=("public",), favourite=False, thumb=False):
                item = Inuksuk(
                    title=key, image=imgs[image], x=.5, y=.375, zoom=2,
                    owners=[owner] if owner is not None else [other],
                    favourite=favourite, sort_order=100,
                )
                db.add(item)
                items[key] = (item, on, thumb)
                return item

            add("mine", owner=users["student"], on=("private", "public", "instructor"), favourite=True, thumb=True)
            add("instructor", on=("public", "instructor"))
            add("program", on=("program",))
            add("public", on=("public", "private_instructor"))
            add("restricted", on=("restricted",))
            add("private", on=("private",))
            add("owner_only", owner=users["student"], on=("private",))
            for key in ("inactive", "hidden", "program", "group"):
                add(f"image_{key}", image=key, owner=users["student"])
            await db.flush()
            for item, on, thumb in items.values():
                if thumb:
                    item.thumb = f"/api/tiles/42/inuksuks/{item.id}.jpg"
                for index, key in enumerate(on):
                    db.add(BoardInuksuk(
                        board_id=bs[key].id, inuksuk_id=item.id,
                        section_id=sections[1].id if key == "public" else None,
                        sort_order=item.id % 10 + index,
                    ))
            await db.flush()
            # Fresh identities force the API to prove every relationship load.
            ids = {key: value.id for key, value in users.items()}
            item_ids = {key: item.id for key, (item, _, _) in items.items()}
            board_ids = {key: board.id for key, board in bs.items()}
            image_ids = {key: img.id for key, img in imgs.items()}
            section_ids = [section.id for section in sections]
            db.expunge_all()
            caller = {"role": "student"}

            async def current_user():
                result = await db.execute(select(User).where(User.id == ids[caller["role"]]))
                return result.scalars().unique().one()

            async def session():
                yield db

            app = make_app()
            app.add_middleware(InuksuksFeatureMiddleware)
            app.dependency_overrides[auth.get_current_user] = current_user
            app.dependency_overrides[get_db] = session
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                yield NS(
                    client=client, db=db, engine=engine, caller=caller,
                    boards=board_ids, items=item_ids, images=image_ids, sections=section_ids,
                )
        await transaction.rollback()
    await engine.dispose()


def by_title(response):
    assert response.status_code == 200, response.text
    return {row["title"]: row for row in response.json()}


async def test_inuksuk_detail_projection_and_conditional_get(world):
    item_id = world.items["mine"]
    url = f"/api/inuksuks/{item_id}"
    response = await world.client.get(url)
    assert response.status_code == 200, response.text
    row = response.json()
    assert row["id"] == item_id
    assert row["board_ids"] == sorted([world.boards["public"], world.boards["instructor"]])
    assert row["permissions"]["can_edit"] is True
    token = parse_qs(urlsplit(row["thumb"]).query)["tile_token"][0]
    payload = jwt.decode(token, options={"verify_signature": False})
    assert payload["purpose"] == "thumb"
    assert response.headers["cache-control"] == "private, no-cache"
    cached = await world.client.get(url, headers={"If-None-Match": response.headers["etag"]})
    assert cached.status_code == 304
    assert cached.content == b""


@pytest.mark.parametrize("key", ["image_hidden", "image_inactive", "image_program", "image_group", "private", "missing"])
async def test_inuksuk_detail_conceals_invisible_or_missing_items(world, key):
    response = await world.client.get(f"/api/inuksuks/{world.items.get(key, -1)}")
    assert response.status_code == 404
    assert response.json() == {"detail": "Inuksuk not found"}


async def test_inuksuk_detail_owner_without_visible_board_matches_list(world):
    response = await world.client.get(f"/api/inuksuks/{world.items['owner_only']}")
    assert response.status_code == 200
    assert response.json()["board_ids"] == []


@pytest.mark.parametrize("role", ["admin", "instructor", "staff", "student"])
async def test_board_list_visibility_and_image_gate(world, role):
    world.caller["role"] = role
    response = await world.client.get("/api/boards?sort=name&order=asc")
    assert response.status_code == 200, response.text
    ids = {row["id"] for row in response.json()}
    expected = set(world.boards.values())
    if role == "student":
        expected -= {world.boards[key] for key in ("private", "wrong_program", "wrong_group", "private_instructor")}
    assert ids == expected
    public = next(row for row in response.json() if row["id"] == world.boards["public"])
    # Inactive/hidden/program/group image gates apply only to students.
    assert public["inuksuk_count"] == (3 if role == "student" else 7)


async def test_invisible_board_404_and_visible_detail_order(world):
    hidden = await world.client.get(f"/api/boards/{world.boards['private']}")
    assert hidden.status_code == 404
    filtered = await world.client.get(f"/api/inuksuks?board_id={world.boards['private']}")
    assert filtered.status_code == 404
    missing = await world.client.get("/api/boards/2147483647")
    assert missing.status_code == 404
    result = await world.client.get(f"/api/boards/{world.boards['public']}")
    assert result.status_code == 200, result.text
    body = result.json()
    assert [s["name"] for s in body["sections"]] == ["Early", "Late"]
    assert len(body["inuksuks"]) == 3
    assert [r["sort_order"] for r in body["inuksuks"]] == sorted(r["sort_order"] for r in body["inuksuks"])
    assert all(r["section_id"] == world.sections[1] and r["sort_order"] != 100 for r in body["inuksuks"])


async def test_drawer_source_precedence_and_visible_board_ids(world):
    rows = by_title(await world.client.get(f"/api/images/{world.images['visible']}/inuksuks"))
    assert {key: row["source"] for key, row in rows.items()} == {
        "mine": "mine", "owner_only": "mine", "instructor": "instructor",
        "program": "instructor", "public": "public",
    }
    assert rows["mine"]["board_ids"] == sorted([world.boards["public"], world.boards["instructor"]])
    assert rows["owner_only"]["board_ids"] == []
    assert rows["public"]["board_ids"] == [world.boards["public"]]
    assert len({row["id"] for row in rows.values()}) == len(rows)
    world.caller["role"] = "staff"
    rows = by_title(await world.client.get(f"/api/images/{world.images['visible']}/inuksuks"))
    assert "private" not in rows and "restricted" not in rows
    assert rows["public"]["source"] == "instructor"
    assert "owner_only" not in rows


@pytest.mark.parametrize("key", ["inactive", "hidden", "program", "group"])
async def test_image_restrictions_hide_owned_public_inuksuks_and_drawer(world, key):
    rows = by_title(await world.client.get("/api/inuksuks"))
    assert f"image_{key}" not in rows
    result = await world.client.get(f"/api/images/{world.images[key]}/inuksuks")
    assert result.status_code == 404


@pytest.mark.parametrize("role", ["admin", "instructor", "staff"])
async def test_non_students_see_inactive_image_inuksuks(world, role):
    world.caller["role"] = role
    image_id = world.images["inactive"]
    rows = by_title(await world.client.get(f"/api/inuksuks?image_id={image_id}"))
    assert set(rows) == {"image_inactive"}
    drawer = by_title(await world.client.get(f"/api/images/{image_id}/inuksuks"))
    assert set(drawer) == {"image_inactive"}
    assert drawer["image_inactive"]["source"] == "public"
    detail = await world.client.get(f"/api/boards/{world.boards['public']}")
    assert detail.status_code == 200
    assert "image_inactive" in {row["title"] for row in detail.json()["inuksuks"]}


async def test_inuksuk_filters_and_unlabelled_items(world):
    rows = by_title(await world.client.get("/api/inuksuks"))
    assert "restricted" in rows and rows["restricted"]["source"] is None
    assert "private" not in rows and rows["owner_only"]["source"] == "mine"
    for scope in ("mine", "instructor", "public"):
        filtered = by_title(await world.client.get(f"/api/inuksuks?scope={scope}"))
        assert filtered and all(row["source"] == scope for row in filtered.values())
    fav = by_title(await world.client.get("/api/inuksuks?favourite=true"))
    assert set(fav) == {"mine"}
    section = by_title(await world.client.get(f"/api/inuksuks?section_id={world.sections[1]}"))
    assert set(section) == {"mine", "public", "instructor"}
    filtered = by_title(await world.client.get(f"/api/inuksuks?board_id={world.boards['public']}&section_id={world.sections[0]}"))
    assert filtered == {}
    assert by_title(await world.client.get(f"/api/inuksuks?image_id={world.images['inactive']}")) == {}
    world.caller["role"] = "staff"
    rows = by_title(await world.client.get("/api/inuksuks"))
    assert rows["private"]["source"] is None


async def test_thumbnail_scopes_are_never_full_tile_tokens(world):
    rows = by_title(await world.client.get("/api/inuksuks"))
    for key, iid in [("mine", world.items["mine"]), ("public", None)]:
        token = parse_qs(urlsplit(rows[key]["thumb"]).query)["tile_token"][0]
        payload = jwt.decode(token, auth.auth_settings.jwt_secret, algorithms=[auth.auth_settings.jwt_algorithm])
        assert payload["purpose"] == "thumb"
        assert payload.get("iid") == iid
        path = f"inuksuks/{iid}.jpg" if iid else "thumbnail.jpeg"
        validate_tile_token(token, 42, path)
        for denied in ("image_files/0/0_0.jpeg", f"inuksuks/{world.items['instructor']}.jpg"):
            with pytest.raises(TileTokenError):
                validate_tile_token(token, 42, denied)


@pytest.mark.parametrize("endpoint", ["boards", "board", "inuksuks", "drawer"])
async def test_conditional_get_and_viewer_binding(world, endpoint):
    url = {
        "boards": "/api/boards",
        "board": f"/api/boards/{world.boards['public']}",
        "inuksuks": "/api/inuksuks",
        "drawer": f"/api/images/{world.images['visible']}/inuksuks",
    }[endpoint]
    response = await world.client.get(url)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-cache"
    etag = response.headers["etag"]
    cached = await world.client.get(url, headers={"If-None-Match": f'"unrelated", {etag.removeprefix("W/")}'})
    assert cached.status_code == 304 and cached.content == b""
    world.caller["role"] = "staff"
    changed = await world.client.get(url, headers={"If-None-Match": etag})
    assert changed.status_code == 200 and changed.headers["etag"] != etag


async def test_etag_changes_after_visibility_update_and_token_epoch(world, monkeypatch):
    first = await world.client.get("/api/inuksuks")
    item = await world.db.get(Image, world.images["visible"])
    item.active = False
    await world.db.flush()
    changed = await world.client.get("/api/inuksuks", headers={"If-None-Match": first.headers["etag"]})
    assert changed.status_code == 200
    assert changed.headers["etag"] != first.headers["etag"]
    monkeypatch.setattr(board_views.time, "time", lambda: 100000)
    renewed = await world.client.get("/api/inuksuks", headers={"If-None-Match": changed.headers["etag"]})
    assert renewed.status_code == 200


async def test_search_sort_pagination_and_validation(world):
    result = await world.client.get("/api/boards?q=  PUBLIC &sort=name&order=asc&page=1&page_size=1")
    assert result.status_code == 200, result.text
    assert [b["name"] for b in result.json()] == ["Alpha public"]
    assert result.headers["x-total-count"] == "1"
    result = await world.client.get("/api/inuksuks?q=mine&sort=title&order=asc&limit=1")
    assert set(by_title(result)) == {"mine"}
    result = await world.client.get("/api/boards?page=999&page_size=1")
    assert result.status_code == 200 and result.json() == []
    assert int(result.headers["x-total-count"]) > 0
    for url in [
        "/api/boards?sort=bad", "/api/boards?visibility=bad",
        "/api/boards?order=bad", "/api/boards?page=1",
        "/api/boards?limit=1&page_size=1", "/api/inuksuks?scope=bad",
        "/api/inuksuks?sort=bad", "/api/inuksuks?limit=0",
        "/api/inuksuks?order=asc&direction=desc",
    ]:
        response = await world.client.get(url)
        assert response.status_code == 422, (url, response.text)


async def test_all_known_sort_accessors_preserve_order(world):
    for endpoint, fields in [
        ("boards", boards._SORTS), ("inuksuks", inuksuks._SORTS),
    ]:
        response = await world.client.get(f"/api/{endpoint}")
        assert response.status_code == 200
        rows = response.json()

        for field in fields:
            def key(row):
                value = (
                    ", ".join(owner["name"] for owner in row["owners"])
                    if field == "owner" else row[field]
                )
                if value is None:
                    value = ""
                if isinstance(value, str):
                    value = value.casefold()
                return value, row["id"]

            for direction in ("asc", "desc"):
                expected = sorted(rows, key=key, reverse=direction == "desc")
                result = await world.client.get(
                    f"/api/{endpoint}?sort={field}&order={direction}"
                )
                assert result.status_code == 200, result.text
                assert [r["id"] for r in result.json()] == [r["id"] for r in expected]


async def test_empty_reads_and_no_n_plus_one(world):
    world.caller["role"] = "staff"
    statements = []

    def count(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(world.engine.sync_engine, "before_cursor_execute", count)
    try:
        response = await world.client.get("/api/inuksuks")
    finally:
        event.remove(world.engine.sync_engine, "before_cursor_execute", count)
    assert response.status_code == 200, response.text
    # Eager loaders batch related sets; no single-row image/owner queries.
    image_selects = [s for s in statements if "FROM images" in s]
    assert len(image_selects) == 1
    assert " IN (" in image_selects[0]
    empty = await world.client.get(f"/api/boards/{world.boards['empty_scope']}")
    assert empty.status_code == 200
    assert empty.json()["sections"] == empty.json()["inuksuks"] == []
    assert empty.json()["cover_thumb"] is None
