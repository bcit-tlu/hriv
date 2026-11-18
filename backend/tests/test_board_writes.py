"""PostgreSQL-backed write contracts, including filesystem commit boundaries."""

import os
import threading
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pyvips
import pytest
from fastapi import Depends, FastAPI
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import auth, board_writes, processing
from app.database import get_db, settings
from app.models import (
    Board, BoardMarker, Category, Group, Image, Marker,
    Program, SourceImage, User,
)
from app.routers import boards, images as images_router, markers, users as users_router

DB_URL = os.environ.get("TEST_DATABASE_URL", "")


@pytest.fixture
async def world(tmp_path, monkeypatch):
    if not DB_URL:
        pytest.skip("TEST_DATABASE_URL not set")
    monkeypatch.setattr(settings, "markers_enabled", True)
    monkeypatch.setattr(settings, "tiles_dir", str(tmp_path))
    engine = create_async_engine(DB_URL)
    async with engine.connect() as connection:
        outer = await connection.begin()
        sessions = async_sessionmaker(
            connection, expire_on_commit=False, join_transaction_mode="create_savepoint",
        )
        async with sessions() as db:
            suffix = uuid4().hex
            programs = [Program(name=f"write-{suffix}-{i}") for i in range(2)]
            users = {
                role: User(
                    name=role, email=f"{suffix}-{role}@example.test", role=role,
                    programs=[programs[0]], groups=[],
                )
                for role in ("admin", "instructor", "staff", "student")
            }
            users["other"] = User(
                name="other", email=f"{suffix}-other@example.test",
                role="student", programs=[], groups=[],
            )
            users["inactive"] = User(
                name="inactive", email=f"{suffix}-inactive@example.test",
                role="student", active=False, programs=[], groups=[],
            )
            groups = [
                Group(name=f"write-{suffix}-g0", instructors=[users["instructor"]], members=[users["student"]]),
                Group(name=f"write-{suffix}-g1", instructors=[], members=[]),
            ]
            hidden = Category(label="hidden-write", status="hidden", programs=[], groups=[])
            db.add_all([*programs, *users.values(), *groups, hidden])
            await db.flush()
            images = {
                key: Image(
                    name=key, active=active, category_id=category,
                    tile_sources="/api/tiles/42/image.dzi", thumb="/api/tiles/42/thumbnail.jpeg",
                )
                for key, active, category in [
                    ("visible", True, None), ("inactive", False, None), ("hidden", True, hidden.id),
                ]
            }
            bs = {
                role: Board(name=f"{role} board", owners=[users[role]], visibility="public")
                for role in ("admin", "instructor", "staff", "student", "other")
            }
            bs["private"] = Board(name="Private other", owners=[users["other"]], visibility="private")
            bs["shared"] = Board(name="Shared", owners=[users["student"], users["other"]], visibility="public")
            db.add_all([*images.values(), *bs.values()])
            await db.flush()
            user_ids = {key: value.id for key, value in users.items()}
            board_ids = {key: value.id for key, value in bs.items()}
            image_ids = {key: value.id for key, value in images.items()}
            program_ids = [program.id for program in programs]
            group_ids = [group.id for group in groups]
            await db.commit()

        caller = {"role": "student"}

        async def session():
            async with sessions() as db:
                yield db

        async def current_user(db=Depends(get_db)):
            return await db.get(User, user_ids[caller["role"]])

        app = FastAPI()
        app.include_router(boards.router, prefix="/api")
        app.include_router(markers.router, prefix="/api")
        app.include_router(images_router.router, prefix="/api")
        app.include_router(users_router.router, prefix="/api")
        app.dependency_overrides[get_db] = session
        app.dependency_overrides[auth.get_current_user] = current_user
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            async def create(*, assignments=None, image="visible", title="Point"):
                if assignments is None:
                    assignments = [{"board_id": board_ids[caller["role"]]}]
                result = await client.post("/api/markers", json={
                    "image_id": image_ids[image], "title": title, "x": .5, "y": .375, "zoom": 2,
                    "board_assignments": assignments,
                })
                assert result.status_code == 201, result.text
                return result.json()

            async def board(key):
                result = await client.get(f"/api/boards/{board_ids[key]}")
                assert result.status_code == 200, result.text
                return result.json()

            yield NS(
                client=client, sessions=sessions, caller=caller, users=user_ids,
                boards=board_ids, images=image_ids,
                programs=program_ids, groups=group_ids, root=tmp_path, engine=engine,
                create=create, board=board,
            )
        await outer.rollback()
    await engine.dispose()


@pytest.mark.parametrize("method,path,body", [
    ("POST", "/api/boards", {}), ("PATCH", "/api/boards/1", {}),
    ("DELETE", "/api/boards/1", None), ("PUT", "/api/boards/order", {}),
    ("PUT", "/api/boards/1/owners", {}), ("POST", "/api/boards/1/transfer", {}),
    ("PUT", "/api/boards/1/markers/order", {}), ("DELETE", "/api/boards/1/markers/1", None),
    ("POST", "/api/markers", {}), ("PATCH", "/api/markers/1", {}),
    ("DELETE", "/api/markers/1", None), ("PUT", "/api/markers/order", {}),
    ("PUT", "/api/markers/1/owners", {}),
])
async def test_disabled_write_dependencies_precede_parsing(monkeypatch, method, path, body):
    monkeypatch.setattr(settings, "markers_enabled", False)
    app = FastAPI()
    app.include_router(boards.router, prefix="/api")
    app.include_router(markers.router, prefix="/api")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        result = await client.request(method, path, json=body)
    assert result.status_code == 404


@pytest.mark.parametrize("role", ["admin", "instructor", "staff", "student"])
async def test_own_board_and_marker_crud_occ(world, role):
    world.caller["role"] = role
    created = await world.client.post("/api/boards", json={"name": "  New board  "})
    assert created.status_code == 201, created.text
    board = created.json()
    assert board["name"] == "New board" and board["version"] == 1
    path = f"/api/boards/{board['id']}"
    result = await world.client.patch(path, json={"name": "Missing token"})
    assert result.status_code == 428
    result = await world.client.patch(path, json={"name": "Bad token"}, headers={"If-Match": "bad"})
    assert result.status_code == 400
    changed = await world.client.patch(path, json={"name": "Renamed"}, headers={"If-Match": '"1"'})
    assert changed.status_code == 200, changed.text
    assert changed.json()["version"] == 2
    stale = await world.client.patch(path, json={"version": 1, "description": "stale"})
    assert stale.status_code == 409 and stale.json()["detail"]["version"] == 2
    result = await world.client.delete(path)
    assert result.status_code == 428
    result = await world.client.delete(path, headers={"If-Match": "1"})
    assert result.status_code == 409
    result = await world.client.delete(path, headers={"If-Match": "2"})
    assert result.status_code == 204
    item = await world.create()
    path = f"/api/markers/{item['id']}"
    result = await world.client.patch(path, json={"title": "missing"})
    assert result.status_code == 428
    changed = await world.client.patch(path, json={"version": 1, "title": "Edited", "favourite": True})
    assert changed.status_code == 200, changed.text
    assert changed.json()["version"] == 2 and changed.json()["favourite"]
    stale = await world.client.patch(path, json={"version": 1, "title": "stale"})
    assert stale.status_code == 409 and stale.json()["detail"]["title"] == "Edited"
    result = await world.client.delete(path)
    assert result.status_code == 428
    result = await world.client.delete(path, headers={"If-Match": "1"})
    assert result.status_code == 409
    result = await world.client.delete(path, headers={"If-Match": "2"})
    assert result.status_code == 204


@pytest.mark.parametrize("role", ["admin", "instructor", "staff", "student"])
async def test_non_owner_write_authority(world, role):
    world.caller["role"] = "other"
    item = await world.create()
    world.caller["role"] = role
    expected = 200 if role == "admin" else 403
    result = await world.client.patch(f"/api/boards/{world.boards['other']}", json={"version": 2, "name": "Changed"})
    assert result.status_code == expected, result.text
    result = await world.client.patch(f"/api/markers/{item['id']}", json={"version": 1, "title": "Changed"})
    assert result.status_code == expected, result.text
    if role != "admin":
        result = await world.client.delete(f"/api/markers/{item['id']}", headers={"If-Match": "1"})
        assert result.status_code == 403
    if role == "student":
        result = await world.client.patch(f"/api/boards/{world.boards['private']}", json={"version": 1, "name": "Probe"})
        assert result.status_code == 404


async def test_ownership_checks_precede_target_validation(world):
    for key, expected in [("private", 404), ("other", 403), ("student", 403)]:
        result = await world.client.put(
            f"/api/boards/{world.boards[key]}/owners",
            json={"version": 1, "user_ids": [2147483647]},
        )
        assert result.status_code == expected, result.text
    world.caller["role"] = "other"
    item = await world.create()
    world.caller["role"] = "student"
    result = await world.client.put(
        f"/api/markers/{item['id']}/owners",
        json={"version": 1, "user_ids": [2147483647]},
    )
    assert result.status_code == 403
    result = await world.client.put(
        "/api/markers/2147483647/owners",
        json={"version": 1, "user_ids": [2147483647]},
    )
    assert result.status_code == 404


async def test_reorder_checks_version_before_membership_validation(world):
    before = await world.board("student")
    path = f"/api/boards/{before['id']}"
    resource = "markers"
    order = {"items": []}
    await world.create()
    current = await world.board("student")
    result = await world.client.put(
        f"{path}/{resource}/order", json={**order, "version": before["version"]},
    )
    assert result.status_code == 409, result.text
    assert result.json()["detail"]["version"] == current["version"]
    assert len(result.json()["detail"][resource]) == len(current[resource])
    result = await world.client.put(
        f"{path}/{resource}/order", json={**order, "version": current["version"]},
    )
    assert result.status_code == 422
    after = await world.board("student")
    assert after["version"] == current["version"]


@pytest.mark.parametrize("role", ["admin", "instructor", "staff", "student"])
async def test_creation_image_visibility(world, role):
    world.caller["role"] = role
    for key in ("inactive", "hidden"):
        result = await world.client.post("/api/markers", json={
            "image_id": world.images[key], "title": "Point", "x": .5, "y": .375, "zoom": 2,
            "board_assignments": [{"board_id": world.boards[role]}],
        })
        assert result.status_code == (404 if role == "student" else 201), result.text


async def test_geometry_writes_lock_image_before_boards_and_markers(world):
    statements = []

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        statements.append(" ".join(statement.split()))

    event.listen(world.engine.sync_engine, "before_cursor_execute", capture)
    try:
        item = await world.create()
        image_lock = next(i for i, sql in enumerate(statements) if "FROM images" in sql and "FOR SHARE" in sql)
        board_lock = next(i for i, sql in enumerate(statements) if "FROM boards" in sql and "FOR UPDATE" in sql)
        insert = next(i for i, sql in enumerate(statements) if sql.startswith("INSERT INTO markers "))
        assert image_lock < board_lock < insert
        statements.clear()
        result = await world.client.patch(
            f"/api/markers/{item['id']}", json={"version": 1, "zoom": 3},
        )
        assert result.status_code == 200, result.text
        image_lock = next(i for i, sql in enumerate(statements) if "FROM images" in sql and "FOR SHARE" in sql)
        board_lock = next(i for i, sql in enumerate(statements) if "FROM boards" in sql and "FOR UPDATE" in sql)
        item_lock = next(i for i, sql in enumerate(statements) if "FROM markers" in sql and "FOR UPDATE" in sql)
        assert image_lock < board_lock < item_lock
    finally:
        event.remove(world.engine.sync_engine, "before_cursor_execute", capture)


async def test_assignment_validation_last_board_and_preservation(world):
    base = {"image_id": world.images["visible"], "title": "Point", "x": .5, "y": .375, "zoom": 2}
    result = await world.client.post("/api/markers", json=base)
    assert result.status_code == 422
    result = await world.client.post("/api/markers", json={**base, "board_assignments": []})
    assert result.status_code == 422
    for assignment, status in [
        ({"board_id": world.boards["other"]}, 403),
        ({"board_id": world.boards["private"]}, 404),
    ]:
        result = await world.client.post("/api/markers", json={**base, "board_assignments": [assignment]})
        assert result.status_code == status, result.text
    item = await world.create()
    path = f"/api/markers/{item['id']}"
    result = await world.client.patch(path, json={"version": 1, "board_assignments": []})
    assert result.status_code == 422
    board = await world.board("student")
    result = await world.client.delete(f"/api/boards/{board['id']}/markers/{item['id']}", headers={"If-Match": str(board["version"])})
    assert result.status_code == 422
    world.caller["role"] = "admin"
    result = await world.client.patch(path, json={"version": 1, "board_assignments": [
        {"board_id": world.boards["student"]},
        {"board_id": world.boards["private"], "sort_order": 77},
    ]})
    assert result.status_code == 200, result.text
    world.caller["role"] = "student"
    result = await world.client.patch(path, json={"version": 2, "board_assignments": [{"board_id": world.boards["student"]}]})
    assert result.status_code == 200, result.text
    assert result.json()["board_ids"] == [world.boards["student"]]
    result = await world.client.patch(path, json={"version": 3, "board_assignments": []})
    assert result.status_code == 200 and result.json()["board_ids"] == []
    async with world.sessions() as db:
        links = (await db.execute(select(BoardMarker).where(BoardMarker.marker_id == item["id"]))).scalars().all()
        assert [(link.board_id, link.sort_order) for link in links] == [
            (world.boards["private"], 77),
        ]


async def test_board_editor_can_reorder_and_remove_others_items(world):
    item = await world.create(assignments=[{"board_id": world.boards["student"]}])
    world.caller["role"] = "admin"
    result = await world.client.patch(f"/api/markers/{item['id']}", json={"version": 1, "board_assignments": [
        {"board_id": world.boards["student"]},
        {"board_id": world.boards["instructor"]},
    ]})
    assert result.status_code == 200, result.text
    world.caller["role"] = "instructor"
    board = await world.board("instructor")
    path = f"/api/boards/{board['id']}"
    result = await world.client.put(f"{path}/markers/order", json={
        "version": board["version"], "items": [{"marker_id": item["id"]}],
    })
    assert result.status_code == 200, result.text
    board = result.json()
    result = await world.client.delete(f"{path}/markers/{item['id']}", headers={"If-Match": str(board["version"])})
    assert result.status_code == 200 and result.json()["markers"] == []
    async with world.sessions() as db:
        assert await db.get(Marker, item["id"]) is not None


async def test_reorders_and_ownership_validation(world):
    item = await world.create()
    second = await world.create(title="Second")
    result = await world.client.put("/api/markers/order", json={"items": [
        {"marker_id": second["id"], "version": 1}, {"marker_id": item["id"], "version": 1},
    ]})
    assert result.status_code == 200, result.text
    assert [(r["id"], r["sort_order"], r["version"]) for r in result.json()] == [(second["id"], 0, 2), (item["id"], 1, 2)]
    result = await world.client.put("/api/markers/order", json={"items": [{"marker_id": item["id"]}]})
    assert result.status_code == 428
    result = await world.client.put("/api/boards/order", json={"items": [{"board_id": world.boards["student"], "version": 3}]})
    assert result.status_code == 200, result.text
    result = await world.client.put(f"/api/markers/{item['id']}/owners", json={"version": 2, "user_ids": []})
    assert result.status_code == 422
    for uid in (world.users["inactive"], 2147483647):
        result = await world.client.put(f"/api/markers/{item['id']}/owners", json={"version": 2, "user_ids": [uid]})
        assert result.status_code == 422
    result = await world.client.put(f"/api/markers/{item['id']}/owners", json={"version": 2, "user_ids": [world.users["student"], world.users["other"]]})
    assert result.status_code == 200 and len(result.json()["owners"]) == 2
    result = await world.client.put(f"/api/markers/{item['id']}/owners", json={"version": 2, "user_ids": [world.users["student"]]})
    assert result.status_code == 409
    result = await world.client.patch(f"/api/boards/{world.boards['shared']}", json={"version": 1, "visibility": "private"})
    assert result.status_code == 403
    result = await world.client.patch(f"/api/boards/{world.boards['shared']}", json={"version": 1, "name": "Edited co-owned"})
    assert result.status_code == 200
    result = await world.client.delete(f"/api/boards/{world.boards['shared']}", headers={"If-Match": "2"})
    assert result.status_code == 403


@pytest.mark.parametrize("role", ["admin", "instructor", "staff", "student"])
async def test_restricted_attach_and_board_transfer_rules(world, role):
    world.caller["role"] = role
    body = {"name": "Restricted", "visibility": "restricted", "program_ids": [world.programs[0]], "group_ids": [world.groups[0]]}
    result = await world.client.post("/api/boards", json=body)
    if role in ("staff", "student"):
        assert result.status_code == 403
        return
    assert result.status_code == 201, result.text
    board = result.json()
    result = await world.client.patch(f"/api/boards/{board['id']}", json={"version": 1, "program_ids": [world.programs[1]]})
    assert result.status_code == (200 if role == "admin" else 403)
    result = await world.client.post("/api/boards", json={**body, "group_ids": [world.groups[1]]})
    assert result.status_code == (201 if role == "admin" else 403)
    own = await world.board(role)
    path = f"/api/boards/{own['id']}"
    result = await world.client.put(f"{path}/owners", json={"version": 1, "user_ids": []})
    assert result.status_code == 422
    result = await world.client.post(f"{path}/transfer", json={"version": 1, "program_id": world.programs[0]})
    assert result.status_code == 200, result.text
    assert result.json()["owner_program_id"] == world.programs[0] and len(result.json()["owners"]) == 1
    assert result.json()["owners"][0]["program_id"] == world.programs[0]
    result = await world.client.post(f"{path}/transfer", json={"version": 2, "program_id": None})
    assert result.status_code == 422
    result = await world.client.put(f"{path}/owners", json={"version": 2, "user_ids": [world.users["student"]]})
    assert result.status_code == 200, result.text
    result = await world.client.post(f"{path}/transfer", json={"version": 3, "program_id": None})
    assert result.status_code == 200 and result.json()["owner_program_id"] is None


@pytest.mark.parametrize("kind,cap", [("board", 10), ("marker", 200)])
async def test_student_caps_include_coownership_and_owner_additions(world, kind, cap):
    async with world.sessions() as db:
        student = await db.get(User, world.users["student"])
        if kind == "board":
            count = await db.scalar(select(func.count()).select_from(Board).where(Board.owners.any(User.id == student.id)))
            db.add_all([Board(name=f"Quota {i}", owners=[student]) for i in range(cap - count)])
        else:
            items = [Marker(title=f"Quota {i}", image_id=world.images["visible"], owners=[student], x=0, y=0, zoom=1) for i in range(cap)]
            db.add_all(items)
            await db.flush()
            db.add_all([BoardMarker(board_id=world.boards["student"], marker_id=item.id) for item in items])
        await db.commit()
    if kind == "board":
        result = await world.client.post("/api/boards", json={"name": "Over cap"})
    else:
        result = await world.client.post("/api/markers", json={"image_id": world.images["visible"], "title": "Over cap", "x": 0, "y": 0, "zoom": 1, "board_assignments": [{"board_id": world.boards["student"]}]})
    assert result.status_code == 422
    world.caller["role"] = "admin"
    if kind == "board":
        result = await world.client.put(f"/api/boards/{world.boards['admin']}/owners", json={"version": 1, "user_ids": [world.users["student"]]})
    else:
        item = await world.create()
        result = await world.client.put(f"/api/markers/{item['id']}/owners", json={"version": 1, "user_ids": [world.users["student"]]})
    assert result.status_code == 422


def make_pyramid(world):
    root = world.root / "42"
    root.mkdir()
    pyvips.Image.black(640, 480).new_from_image([200, 150, 100]).dzsave(
        str(root / "image"), tile_size=126, overlap=1, suffix=".png",
    )
    return root


async def test_thumbnail_generation_regeneration_fallback_and_delete(world, monkeypatch):
    root = make_pyramid(world)
    original = board_writes.generate_marker_thumbnail
    threads = []

    def generate(*args):
        threads.append(threading.get_ident())
        return original(*args)

    monkeypatch.setattr(board_writes, "generate_marker_thumbnail", generate)
    item = await world.create()
    path = root / "markers" / f"{item['id']}.jpg"
    assert path.exists() and "/markers/" in item["thumb"]
    assert threads and threads[0] != threading.get_ident()
    result = await world.client.patch(f"/api/markers/{item['id']}", json={"version": 1, "title": "No geometry change"})
    assert result.status_code == 200 and len(threads) == 1
    result = await world.client.patch(f"/api/markers/{item['id']}", json={"version": 2, "x": .6})
    assert result.status_code == 200 and len(threads) == 2 and path.exists()

    def broken(*args):
        raise RuntimeError("thumbnail failed")

    monkeypatch.setattr(board_writes, "generate_marker_thumbnail", broken)
    result = await world.client.patch(f"/api/markers/{item['id']}", json={"version": 3, "rotation": 90})
    assert result.status_code == 200, result.text
    assert "thumbnail.jpeg" in result.json()["thumb"] and not path.exists()
    item2 = await world.create(title="Failure on create")
    assert "thumbnail.jpeg" in item2["thumb"]
    monkeypatch.setattr(board_writes, "generate_marker_thumbnail", original)
    item3 = await world.create()
    path3 = root / "markers" / f"{item3['id']}.jpg"
    assert path3.exists()
    result = await world.client.delete(f"/api/markers/{item3['id']}", headers={"If-Match": "1"})
    assert result.status_code == 204 and not path3.exists()


async def test_board_delete_orphan_cleanup_preserves_other_boards_and_files(world):
    root = make_pyramid(world)
    orphan = await world.create()
    shared = await world.create(assignments=[{"board_id": world.boards["student"]}, {"board_id": world.boards["shared"]}])
    board = await world.board("student")
    result = await world.client.delete(f"/api/boards/{board['id']}", headers={"If-Match": str(board["version"])})
    assert result.status_code == 204, result.text
    async with world.sessions() as db:
        assert await db.get(Marker, orphan["id"]) is None
        assert await db.get(Marker, shared["id"]) is not None
        assert (await db.execute(select(BoardMarker.board_id).where(BoardMarker.marker_id == shared["id"]))).scalars().all() == [world.boards["shared"]]
    assert not (root / "markers" / f"{orphan['id']}.jpg").exists()
    assert (root / "markers" / f"{shared['id']}.jpg").exists()


async def test_marker_delete_and_assignment_changes_invalidate_every_affected_board(world):
    assignment = [{"board_id": world.boards["student"]}, {"board_id": world.boards["shared"]}]
    item = await world.create(assignments=assignment)
    before_student, before_shared = await world.board("student"), await world.board("shared")
    result = await world.client.patch(f"/api/markers/{item['id']}", json={
        "version": 1, "board_assignments": [{"board_id": world.boards["shared"]}],
    })
    assert result.status_code == 200, result.text
    after_student, after_shared = await world.board("student"), await world.board("shared")
    assert after_student["version"] == before_student["version"] + 1
    assert after_shared["version"] == before_shared["version"] + 1
    result = await world.client.delete(f"/api/markers/{item['id']}", headers={"If-Match": "2"})
    assert result.status_code == 204, result.text
    final = await world.board("shared")
    assert final["version"] == after_shared["version"] + 1
    result = await world.client.patch(f"/api/boards/{final['id']}", json={"version": after_shared["version"], "name": "Stale"})
    assert result.status_code == 409 and result.json()["detail"]["version"] == final["version"]
    final_student = await world.board("student")
    assert final_student["version"] == after_student["version"]


@pytest.mark.parametrize("bulk", [False, True])
async def test_image_delete_invalidates_linked_boards(world, bulk):
    world.caller["role"] = "admin"
    await world.create()
    before = await world.board("admin")
    statements = []

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        statements.append(" ".join(statement.split()))

    event.listen(world.engine.sync_engine, "before_cursor_execute", capture)
    try:
        if bulk:
            result = await world.client.request("DELETE", "/api/images/bulk", json={"image_ids": [world.images["visible"]]})
        else:
            result = await world.client.delete(f"/api/images/{world.images['visible']}")
    finally:
        event.remove(world.engine.sync_engine, "before_cursor_execute", capture)
    assert result.status_code == 204, result.text
    image_lock = next(i for i, sql in enumerate(statements) if "FROM images" in sql and "FOR UPDATE" in sql)
    board_update = next(i for i, sql in enumerate(statements) if "UPDATE boards SET" in sql)
    assert image_lock < board_update
    after = await world.board("admin")
    assert after["version"] == before["version"] + 1 and after["markers"] == []


@pytest.mark.parametrize("bulk", [False, True])
async def test_user_deletion_cleans_board_orphans_and_sole_owned_files(world, bulk):
    root = make_pyramid(world)
    world.caller["role"] = "admin"
    orphan = await world.create(assignments=[{"board_id": world.boards["other"]}])
    shared = await world.create(assignments=[{"board_id": world.boards["other"]}, {"board_id": world.boards["admin"]}])
    world.caller["role"] = "other"
    sole = await world.create(assignments=[{"board_id": world.boards["shared"]}])
    before = await world.board("shared")
    world.caller["role"] = "admin"
    if bulk:
        result = await world.client.request("DELETE", "/api/users/bulk", json={"user_ids": [world.users["other"]]})
    else:
        result = await world.client.delete(f"/api/users/{world.users['other']}")
    assert result.status_code == 204, result.text
    async with world.sessions() as db:
        assert await db.get(Marker, orphan["id"]) is None
        assert await db.get(Marker, sole["id"]) is None
        assert await db.get(Marker, shared["id"]) is not None
    for item in (orphan, sole):
        assert not (root / "markers" / f"{item['id']}.jpg").exists()
    assert (root / "markers" / f"{shared['id']}.jpg").exists()
    after = await world.board("shared")
    assert after["version"] == before["version"] + 1


async def test_commit_failure_preserves_rows_and_thumbnails(world, monkeypatch):
    root = make_pyramid(world)
    item = await world.create()
    monkeypatch.setattr(markers, "commit_write", AsyncMock(side_effect=RuntimeError("commit failed")))
    with pytest.raises(RuntimeError, match="commit failed"):
        await world.client.delete(f"/api/markers/{item['id']}", headers={"If-Match": "1"})
    assert (root / "markers" / f"{item['id']}.jpg").exists()
    async with world.sessions() as db:
        assert await db.get(Marker, item["id"]) is not None


async def test_replace_deletes_rows_links_and_old_files(world, monkeypatch):
    root = make_pyramid(world)
    item = await world.create()
    before = await world.board("student")
    async with world.sessions() as db:
        source = SourceImage(original_filename="new.tiff", stored_path="/unused", status="pending", file_size=1)
        db.add(source)
        await db.flush()
        source_id = source.id
        await db.commit()
    monkeypatch.setattr(processing, "async_session", world.sessions)
    monkeypatch.setattr(processing, "detect_pyramid_info", lambda _: None)
    monkeypatch.setattr(processing, "generate_tiles", lambda *args: ("image.dzi", "thumbnail.jpeg", 640, 480))
    monkeypatch.setattr(processing, "_flush_tracker_progress", AsyncMock())
    monkeypatch.setattr(processing, "_best_effort_source_checksum", AsyncMock(return_value=None))
    monkeypatch.setattr(processing, "image_ids_in_collections", AsyncMock(return_value=set()))
    monkeypatch.setattr(processing, "scan_after_processing", AsyncMock())
    statements = []

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        statements.append(" ".join(statement.split()))

    event.listen(world.engine.sync_engine, "before_cursor_execute", capture)
    try:
        await processing.process_replace_image(source_id, world.images["visible"])
    finally:
        event.remove(world.engine.sync_engine, "before_cursor_execute", capture)
    image_lock = next(i for i, sql in enumerate(statements) if "FROM images" in sql and "FOR UPDATE" in sql)
    delete = next(i for i, sql in enumerate(statements) if sql.startswith("DELETE FROM markers "))
    assert image_lock < delete
    async with world.sessions() as db:
        source = await db.get(SourceImage, source_id)
        assert source.status == "completed", source.error_message
        assert await db.get(Marker, item["id"]) is None
        assert await db.scalar(select(func.count()).select_from(BoardMarker).where(BoardMarker.marker_id == item["id"])) == 0
    assert not (root / "markers").exists()
    after = await world.board("student")
    assert after["version"] == before["version"] + 1
    result = await world.client.patch(
        f"/api/boards/{after['id']}", json={"version": before["version"], "name": "Stale"},
    )
    assert result.status_code == 409 and result.json()["detail"]["version"] == after["version"]
