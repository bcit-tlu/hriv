"""Independent collection membership snapshots, including real PostgreSQL writes."""

import importlib
import os
from types import SimpleNamespace as NS
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import httpx
import pyvips
import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app import auth
from app.collection_slots import (
    cleanup_slot_thumbs, export_slots, image_slot_thumbs, import_slots,
    SlotPlan, finish_slot_changes, slot_thumb_file, snapshot_thumbnail,
)
from app.database import get_db, settings
from app.models import Board, BoardInuksuk, BoardSection, Category, Collection, CollectionImage, Image, Inuksuk, User
from app.routers import collections, images
from app.schemas import CollectionCreate, CollectionImagesUpdate, CollectionViewportUpdate, SlotViewport
from app.tile_tokens import TileTokenError, append_slot_thumb_token, issue_slot_thumb_token, validate_tile_token

DB_URL = os.environ.get("TEST_DATABASE_URL", "")
VIEW = {"x": .5, "y": .375, "zoom": 2.0}


@pytest.mark.parametrize("field,value", [("x", float("nan")), ("y", float("inf")), ("zoom", 0), ("rotation", float("inf")), ("x", True), ("zoom", "2")])
def test_viewport_validation(field, value):
    with pytest.raises(ValidationError):
        SlotViewport.model_validate({**VIEW, field: value})


@pytest.mark.parametrize("payload", [{"slots": []}, {"source_board_id": 1}, {"inuksuk_ids": []}, {"image_ids": [1, 1]}])
def test_flag_off_rejects_new_writes(monkeypatch, payload):
    monkeypatch.setattr(settings, "inuksuks_enabled", False)
    with pytest.raises(ValidationError):
        CollectionCreate(name="test", type="sequence", **payload)
    with pytest.raises(ValidationError):
        CollectionImagesUpdate(version=1, **payload)
    with pytest.raises(ValidationError):
        CollectionViewportUpdate(version=1, slot_viewports={})
    with pytest.raises(ValidationError):
        CollectionViewportUpdate(version=1)


@pytest.mark.parametrize("path", ["image.dzi", "image_files/1/0_0.jpeg", "inuksuks/8.jpg", "thumbnail.jpeg", "collection_slots/9.jpg", "collection_slots/../collection_slots/8.jpg"])
def test_slot_token_exact_scope(path):
    token = issue_slot_thumb_token(42, 8)
    validate_tile_token(token, 42, "collection_slots/8.jpg")
    with pytest.raises(TileTokenError) as error:
        validate_tile_token(token, 42, path)
    assert error.value.status_code == 403
    with pytest.raises(TileTokenError):
        validate_tile_token(token, 43, "collection_slots/8.jpg")


def test_slot_tokenizer_and_invalid_id():
    url = append_slot_thumb_token("/api/tiles/42/collection_slots/8.jpg?tile_token=old")
    token = parse_qs(urlsplit(url).query)["tile_token"]
    assert len(token) == 1
    validate_tile_token(token[0], 42, "collection_slots/8.jpg")
    assert append_slot_thumb_token("/legacy.jpg") == "/legacy.jpg"
    with pytest.raises(ValueError):
        issue_slot_thumb_token(42, 0)


@pytest.mark.parametrize("enabled", [False, True])
def test_export_import_slots_and_legacy(monkeypatch, enabled):
    monkeypatch.setattr(settings, "inuksuks_enabled", enabled)
    original = Collection(image_links=[CollectionImage(image_id=7, viewport_state=VIEW, label="first", thumb="/api/tiles/42/collection_slots/8.jpg"), CollectionImage(image_id=7, label="second")])
    dump = export_slots(original, {7})
    restored = Collection(image_links=import_slots({"slots": dump, "image_ids": [999]}))
    assert export_slots(restored, {7}) == dump
    assert [row.sort_order for row in restored.image_links] == [0, 1]
    assert export_slots(original, {999}) == []
    assert [row.image_id for row in import_slots({"image_ids": [8, 7]})] == [8, 7]
    assert import_slots({"slots": []}) == []
    with pytest.raises(ValueError):
        import_slots({"slots": [{"image_id": 7, "thumb": "../../private"}]})
    assert [row.image_id for row in import_slots({"image_ids": [7, 7]})] == [7, 7]


async def test_cleanup_only_canonical_slot_paths(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "tiles_dir", str(tmp_path))
    directory = tmp_path / "42" / "collection_slots"
    directory.mkdir(parents=True)
    target = directory / "8.jpg"
    target.write_bytes(b"test")
    await cleanup_slot_thumbs(["/api/tiles/42/collection_slots/8.jpg", None, "../../etc/passwd"])
    assert not target.exists()
    assert slot_thumb_file("/api/tiles/42/inuksuks/8.jpg") is None


def test_thumbnail_unavailable_and_symlink_safe(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "tiles_dir", str(tmp_path))
    image = Image(tile_sources="https://example.test/image.dzi")
    slot = CollectionImage(id=8, viewport_state=VIEW)
    assert snapshot_thumbnail(image, slot, None) is None
    (tmp_path / "42").mkdir()
    (tmp_path / "42" / "collection_slots").symlink_to(tmp_path, target_is_directory=True)
    assert slot_thumb_file("/api/tiles/42/collection_slots/8.jpg") is None


@pytest.fixture
async def world(monkeypatch, tmp_path):
    if not DB_URL:
        pytest.skip("TEST_DATABASE_URL not set")
    monkeypatch.setattr(settings, "inuksuks_enabled", True)
    monkeypatch.setattr(settings, "collections_student_access", True)
    monkeypatch.setattr(settings, "collections_enabled", True)
    monkeypatch.setattr(settings, "tiles_dir", str(tmp_path))
    root = tmp_path / "42"
    root.mkdir()
    pyvips.Image.black(640, 480).new_from_image([255, 255, 255]).dzsave(str(root / "image"), tile_size=126, overlap=1, suffix=".png")
    (root / "inuksuks").mkdir()
    engine = create_async_engine(DB_URL)
    async with engine.connect() as connection:
        transaction = await connection.begin()
        async with AsyncSession(bind=connection, expire_on_commit=False) as db:
            suffix = uuid4().hex
            users = {role: User(name=role, email=f"{suffix}-{role}@example.test", role=role, groups=[], programs=[]) for role in ("admin", "student")}
            other = User(name="other", email=f"{suffix}-other@example.test", role="student", groups=[], programs=[])
            hidden = Category(label="Hidden", status="hidden", groups=[], programs=[])
            category = Category(label="Visible", groups=[], programs=[])
            image = Image(name="visible", active=True, tile_sources="/api/tiles/42/image.dzi", thumb="/api/tiles/42/thumbnail.jpeg")
            secret = Image(name="hidden", active=True, category=hidden, tile_sources="/api/tiles/42/image.dzi", thumb="/api/tiles/42/thumbnail.jpeg")
            public = Board(name="public", visibility="public", owners=[users["student"]], groups=[], programs=[])
            private = Board(name="private", visibility="private", owners=[other], groups=[], programs=[])
            db.add_all([*users.values(), other, image, secret, public, private, category])
            await db.flush()
            sections = [BoardSection(board_id=public.id, name=name, sort_order=order) for name, order in (("late", 20), ("early", 10))]
            db.add_all(sections)
            await db.flush()
            items = [Inuksuk(image=image, title=f"view-{i}", x=.1 + i * .2, y=.25, zoom=2, rotation=i * 10, owners=[users["student"]]) for i in range(3)]
            hidden_item = Inuksuk(image=secret, title="secret", x=.5, y=.3, zoom=2, owners=[users["student"]])
            private_item = Inuksuk(image=image, title="private", x=.5, y=.3, zoom=2, owners=[other])
            db.add_all([*items, hidden_item, private_item])
            await db.flush()
            for i, item in enumerate(items):
                item.thumb = f"/api/tiles/42/inuksuks/{item.id}.jpg"
                pyvips.Image.black(8, 8).new_from_image([i * 70, 0, 0]).jpegsave(str(root / "inuksuks" / f"{item.id}.jpg"))
                db.add(BoardInuksuk(board_id=public.id, inuksuk_id=item.id, section_id=sections[i].id if i < 2 else None, sort_order=i))
            db.add_all([BoardInuksuk(board_id=public.id, inuksuk_id=hidden_item.id, sort_order=4), BoardInuksuk(board_id=private.id, inuksuk_id=private_item.id)])
            await db.flush()
            caller = {"role": "admin"}
            app = FastAPI()
            app.include_router(collections.router, prefix="/api")
            app.include_router(images.router, prefix="/api")

            async def current_user():
                return users[caller["role"]]

            async def session():
                yield db

            app.dependency_overrides[auth.get_current_user] = current_user
            app.dependency_overrides[get_db] = session
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                yield NS(db=db, client=client, image=image, secret=secret, items=items, hidden=hidden_item, private=private_item, board=public, sections=sections, private_board=private, root=root, caller=caller, users=users, category=category)
        await transaction.rollback()
    await engine.dispose()


async def create(world, **payload):
    filing = {"category_id": world.category.id} if world.caller["role"] == "admin" else {}
    result = await world.client.post("/api/collections", json={"name": "slots", "type": "sequence", **filing, **payload})
    assert result.status_code == 201, result.text
    return result.json()


async def test_three_inuksuks_same_image_are_independent_snapshots(world):
    result = await create(world, inuksuk_ids=[item.id for item in world.items])
    assert [row["id"] for row in result["images"]] == [world.image.id] * 3
    slots = [row["slot"] for row in result["images"]]
    assert len({slot["id"] for slot in slots}) == 3
    assert result["member_count"] == 3
    assert [slot["label"] for slot in slots] == [item.title for item in world.items]
    assert [slot["viewport_state"]["x"] for slot in slots] == [item.x for item in world.items]
    for slot, item in zip(slots, world.items):
        path = urlsplit(slot["thumb"]).path
        assert slot_thumb_file(path).read_bytes() == (world.root / "inuksuks" / f"{item.id}.jpg").read_bytes()
        token = parse_qs(urlsplit(slot["thumb"]).query)["tile_token"][0]
        validate_tile_token(token, 42, f"collection_slots/{slot['id']}.jpg")
    members = await world.client.get("/api/images/collections-map")
    assert members.status_code == 200
    assert len(members.json()[str(world.image.id)]) == 1
    graph = await world.client.get("/api/collections/graph?order=2")
    assert graph.status_code == 200
    image = next(row for row in graph.json()["images"] if row["id"] == world.image.id)
    assert image["collection_ids"] == [result["id"]]
    graph = await world.client.get(f"/api/collections/{result['id']}/graph?order=2")
    assert graph.status_code == 200
    assert len(graph.json()["images"]) == 1


async def test_section_source_and_invalid_slot_references(world):
    result = await create(world, source_board_id=world.board.id, source_section_id=world.sections[1].id)
    assert [row["slot"]["label"] for row in result["images"]] == [world.items[1].title]
    other = await create(world, image_ids=[world.image.id])
    url = f"/api/collections/{result['id']}/images"
    foreign = {"id": other["images"][0]["slot"]["id"], "image_id": world.image.id}
    denied = await world.client.put(url, json={"version": result["version"], "slots": [foreign]})
    assert denied.status_code == 422
    slot = {"id": result["images"][0]["slot"]["id"], "image_id": world.image.id}
    denied = await world.client.put(url, json={"version": result["version"], "slots": [slot, slot]})
    assert denied.status_code == 422
    denied = await world.client.post("/api/collections", json={"name": "bad", "type": "sequence", "category_id": world.category.id, "source_board_id": world.board.id, "source_section_id": 99999999})
    assert denied.status_code == 404


async def test_flag_disabled_on_existing_slots_returns_unique_images(world, monkeypatch):
    result = await create(world, image_ids=[world.image.id] * 3)
    monkeypatch.setattr(settings, "inuksuks_enabled", False)
    response = await world.client.get(f"/api/collections/{result['id']}")
    assert response.status_code == 200
    assert len(response.json()["images"]) == response.json()["member_count"] == 1
    assert "slot" not in response.json()["images"][0]


async def test_sync_slot_viewports_occ_and_inuksuks_unchanged(world):
    result = await create(world, type="synchronized", inuksuk_ids=[item.id for item in world.items[:2]])
    before = [(item.x, item.y, item.zoom, item.rotation, item.title) for item in world.items]
    slot_id = result["images"][0]["slot"]["id"]
    response = await world.client.put(f"/api/collections/{result['id']}/viewport", json={"version": result["version"], "slot_viewports": {str(slot_id): VIEW}})
    assert response.status_code == 200, response.text
    assert response.json()["images"][0]["slot"]["viewport_state"] == VIEW
    assert response.json()["viewport_state"] == result["viewport_state"]
    assert response.json()["version"] == result["version"] + 1
    for item in world.items:
        await world.db.refresh(item)
    assert before == [(item.x, item.y, item.zoom, item.rotation, item.title) for item in world.items]
    stale = await world.client.put(f"/api/collections/{result['id']}/viewport", json={"version": result["version"], "slot_viewports": {str(slot_id): None}})
    assert stale.status_code == 409
    invalid = await world.client.put(f"/api/collections/{result['id']}/viewport", json={"version": response.json()["version"], "slot_viewports": {"999999999": VIEW}})
    assert invalid.status_code == 422


async def test_student_filters_slots_and_board_seeds(world):
    result = await create(world, visibility="public", inuksuk_ids=[world.items[0].id, world.hidden.id, world.items[1].id])
    world.caller["role"] = "student"
    visible = await world.client.get(f"/api/collections/{result['id']}")
    assert visible.status_code == 200
    assert visible.json()["member_count"] == 2
    assert len(visible.json()["images"]) == 2
    seeded = await create(world, source_board_id=world.board.id)
    assert [row["slot"]["label"] for row in seeded["images"]] == [world.items[i].title for i in (1, 0, 2)]
    for item_id in (world.hidden.id, world.private.id):
        denied = await world.client.post("/api/collections", json={"name": "bad", "type": "sequence", "inuksuk_ids": [item_id]})
        assert denied.status_code == 404
    denied = await world.client.post("/api/collections", json={"name": "bad", "type": "sequence", "source_board_id": world.private_board.id})
    assert denied.status_code == 404


async def test_legacy_matching_explicit_slot_override_and_cleanup(world):
    result = await create(world, inuksuk_ids=[item.id for item in world.items])
    old_slots = [row["slot"] for row in result["images"]]
    url = f"/api/collections/{result['id']}/images"
    result2 = await world.client.put(url, json={"version": result["version"], "image_ids": [world.image.id] * 3})
    assert result2.status_code == 200, result2.text
    for old, row in zip(old_slots, result2.json()["images"]):
        new = row["slot"]
        assert {key: value for key, value in old.items() if key != "thumb"} == {key: value for key, value in new.items() if key != "thumb"}
        assert urlsplit(old["thumb"]).path == urlsplit(new["thumb"]).path
    kept = old_slots[1]
    updated = await world.client.put(url, json={"version": result2.json()["version"], "slots": [{"id": kept["id"], "image_id": world.image.id, "label": "edited"}]})
    assert updated.status_code == 200, updated.text
    assert updated.json()["images"][0]["slot"]["viewport_state"] == kept["viewport_state"]
    assert updated.json()["images"][0]["slot"]["label"] == "edited"
    assert not slot_thumb_file(urlsplit(old_slots[0]["thumb"]).path).exists()
    path = slot_thumb_file(urlsplit(kept["thumb"]).path)
    assert path.exists()
    deleted = await world.client.delete(f"/api/collections/{result['id']}")
    assert deleted.status_code == 204
    assert not path.exists()


@pytest.mark.parametrize("bulk", [False, True])
async def test_missing_source_regenerates_and_image_delete_cleans(world, bulk):
    (world.root / "inuksuks" / f"{world.items[0].id}.jpg").unlink()
    result = await create(world, inuksuk_ids=[world.items[0].id])
    slot = result["images"][0]["slot"]
    path = slot_thumb_file(urlsplit(slot["thumb"]).path)
    assert pyvips.Image.new_from_file(str(path)).width == 320
    deleted = await world.client.request("DELETE", "/api/images/bulk", json={"image_ids": [world.image.id]}) if bulk else await world.client.delete(f"/api/images/{world.image.id}")
    assert deleted.status_code == 204, deleted.text
    assert not path.exists()


async def test_replacement_clear_preserves_slots_and_labels(world):
    result = await create(world, inuksuk_ids=[world.items[0].id])
    slot = result["images"][0]["slot"]
    paths = await image_slot_thumbs(world.db, [world.image.id], clear=True)
    await world.db.commit()
    await cleanup_slot_thumbs(paths)
    link = await world.db.get(CollectionImage, slot["id"])
    assert link is not None and link.viewport_state is None and link.thumb is None
    assert link.label == slot["label"]
    assert not slot_thumb_file(urlsplit(slot["thumb"]).path).exists()


async def test_replacement_without_snapshot_keeps_legacy_version(world, monkeypatch):
    result = await create(world, image_ids=[world.image.id])
    monkeypatch.setattr(settings, "inuksuks_enabled", False)
    await image_slot_thumbs(world.db, [world.image.id], clear=True)
    await world.db.commit()
    collection = await world.db.get(Collection, result["id"])
    await world.db.refresh(collection)
    assert collection.version == result["version"]


@pytest.mark.parametrize("count, status", [(0, 422), (1, 422), (2, 201), (4, 201), (5, 422)])
async def test_synchronized_caps_count_slots(world, count, status):
    response = await world.client.post("/api/collections", json={
        "name": "caps", "type": "synchronized", "category_id": world.category.id,
        "slots": [{"image_id": world.image.id}] * count,
    })
    assert response.status_code == status, response.text
    if status == 201:
        assert len(response.json()["images"]) == count


async def test_student_reorder_is_by_slot_identity_and_preserves_hidden(world):
    result = await create(world, image_ids=[world.image.id] * 21)
    collection = await world.db.get(Collection, result["id"])
    collection.owners = [world.users["student"]]
    await world.db.commit()
    world.caller["role"] = "student"
    slots = [{"id": row["slot"]["id"], "image_id": row["id"]} for row in reversed(result["images"])]
    url = f"/api/collections/{result['id']}/images"
    reordered = await world.client.put(url, json={"version": result["version"], "slots": slots})
    assert reordered.status_code == 200, reordered.text
    added = await world.client.put(url, json={"version": reordered.json()["version"], "slots": [*slots[:20], {"image_id": world.image.id}]})
    assert added.status_code == 422


async def test_hidden_slot_survives_student_replacement(world):
    result = await create(world, inuksuk_ids=[world.items[0].id, world.hidden.id, world.items[1].id])
    collection = await world.db.get(Collection, result["id"])
    collection.owners = [world.users["student"]]
    await world.db.commit()
    hidden_id = result["images"][1]["slot"]["id"]
    world.caller["role"] = "student"
    kept = result["images"][0]
    updated = await world.client.put(f"/api/collections/{result['id']}/images", json={"version": result["version"], "slots": [{"id": kept["slot"]["id"], "image_id": kept["id"]}]})
    assert updated.status_code == 200, updated.text
    assert updated.json()["member_count"] == 1
    assert await world.db.get(CollectionImage, hidden_id) is not None


async def test_source_changes_regenerate_original_snapshot(world):
    result = await create(world, inuksuk_ids=[world.items[0].id])
    link = await world.db.get(CollectionImage, result["images"][0]["slot"]["id"])
    original_view = dict(link.viewport_state)
    world.items[0].x += .2
    await world.db.commit()
    await finish_slot_changes(world.db, [], [SlotPlan(link, original_view, link.label, render=True, source=world.items[0].thumb)])
    assert link.viewport_state == original_view
    assert pyvips.Image.new_from_file(str(slot_thumb_file(link.thumb))).width == 320


async def test_flag_off_response_shape_legacy_payloads_and_caps(world, monkeypatch):
    monkeypatch.setattr(settings, "inuksuks_enabled", False)
    result = await create(world, image_ids=[world.image.id])
    assert "slot" not in result["images"][0]
    assert result["viewport_state"] == {}
    with pytest.raises(ValidationError):
        CollectionImagesUpdate(version=1)
    monkeypatch.setattr(settings, "inuksuks_enabled", True)
    too_many = await world.client.post("/api/collections", json={"name": "bad", "type": "synchronized", "inuksuk_ids": [world.items[0].id] * 5})
    assert too_many.status_code == 422
    world.caller["role"] = "student"
    too_many = await world.client.post("/api/collections", json={"name": "bad", "type": "sequence", "inuksuk_ids": [world.items[0].id] * 21})
    assert too_many.status_code == 422


async def test_migration_preserves_members_and_collection_viewport():
    if not DB_URL:
        pytest.skip("TEST_DATABASE_URL not set")
    migration = importlib.import_module("app.migrations.versions.0047_collection_image_slots")
    engine = create_async_engine(DB_URL)
    async with engine.connect() as connection:
        transaction = await connection.begin()
        schema = f"slot_migration_{uuid4().hex}"
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        await connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
        await connection.execute(text("CREATE TABLE collections (id integer PRIMARY KEY, viewport_state jsonb)"))
        await connection.execute(text("CREATE TABLE images (id integer PRIMARY KEY)"))
        await connection.execute(text("CREATE TABLE collection_images (collection_id integer REFERENCES collections(id) ON DELETE CASCADE, image_id integer REFERENCES images(id) ON DELETE CASCADE, sort_order integer NOT NULL DEFAULT 0, PRIMARY KEY(collection_id,image_id))"))
        await connection.execute(text("CREATE INDEX idx_collection_images_order ON collection_images(collection_id,sort_order)"))
        await connection.execute(text("INSERT INTO collections VALUES (1, CAST(:viewport AS jsonb))"), {"viewport": '{"7":{"zoom":2}}'})
        await connection.execute(text("INSERT INTO images VALUES (7),(8)"))
        await connection.execute(text("INSERT INTO collection_images VALUES (1,7,0),(1,8,1)"))

        def upgrade(sync):
            with Operations.context(MigrationContext.configure(sync)):
                migration.upgrade()

        def downgrade(sync):
            with Operations.context(MigrationContext.configure(sync)):
                migration.downgrade()

        await connection.run_sync(upgrade)
        rows = (await connection.execute(text("SELECT id,collection_id,image_id,sort_order,viewport_state FROM collection_images ORDER BY sort_order"))).all()
        assert [(row.collection_id, row.image_id, row.sort_order, row.viewport_state) for row in rows] == [(1, 7, 0, None), (1, 8, 1, None)]
        assert len({row.id for row in rows}) == 2
        assert (await connection.execute(text("SELECT viewport_state FROM collections"))).scalar_one() == {"7": {"zoom": 2}}
        await connection.execute(text("INSERT INTO collection_images(collection_id,image_id,sort_order) VALUES (1,7,9)"))
        await connection.run_sync(downgrade)
        assert (await connection.execute(text("SELECT collection_id,image_id,sort_order FROM collection_images ORDER BY sort_order"))).all() == [(1, 7, 0), (1, 8, 1)]
        await transaction.rollback()
    await engine.dispose()
