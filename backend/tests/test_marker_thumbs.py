"""Real DZI viewport rendering and derived-file lifecycle tests."""

import math
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pyvips
import pytest

from app import marker_thumbs as thumbs
from app import processing
from app.counting.stitch import DziInfo, MissingTiles, Rect
from app.models import Image, SourceImage
from app.routers import images as images_router
from app.schemas import ImageBulkDelete


@pytest.fixture
def pyramid(tmp_path: Path) -> tuple[Image, Path, Path]:
    root = tmp_path / "42"
    root.mkdir()
    source = pyvips.Image.black(640, 480).new_from_image([255, 255, 255])
    marker = pyvips.Image.black(40, 40).new_from_image([240, 0, 0])
    source = source.insert(marker, 220, 180)
    source.dzsave(str(root / "image"), tile_size=126, overlap=1, suffix=".png")
    image = Image(id=1, tile_sources="/api/tiles/42/image.dzi")
    return image, tmp_path, root


def _render(pyramid, **kwargs) -> pyvips.Image:
    image, base, root = pyramid
    url = thumbs.generate_marker_thumbnail(
        image, 7, kwargs.pop("x", .5), kwargs.pop("y", .375),
        kwargs.pop("zoom", 2), tiles_dir=base, **kwargs,
    )
    assert url == "/api/tiles/42/markers/7.jpg"
    result = pyvips.Image.new_from_file(str(root / "markers/7.jpg"))
    assert (result.width, result.height, result.bands) == (320, 240, 3)
    return result


def test_plan_width_based_y_and_coarsest_level():
    dzi = DziInfo(1280, 960, 254, 1, "png", 11)
    plan = thumbs.plan_thumbnail(dzi, .5, .375, 1, 0)
    assert plan.downsample == 4
    assert plan.window == Rect(0, 0, 320, 240)
    assert thumbs.plan_thumbnail(dzi, .5, .25, 2, 0).window == Rect(160, 40, 320, 240)
    assert thumbs.plan_thumbnail(dzi, .5, .375, 100, 0).downsample == 1
    assert thumbs.plan_thumbnail(dzi, 0, 0, 2, 0).window == Rect(-160, -120, 320, 240)
    rotated = thumbs.plan_thumbnail(dzi, .5, .375, 2, 37)
    assert rotated.window.width == rotated.window.height == math.ceil(320 * math.sqrt(2))


@pytest.mark.parametrize("zoom", [0, -1, float("nan"), float("inf"), 1e-300])
def test_invalid_zoom(zoom):
    with pytest.raises(ValueError):
        thumbs.plan_thumbnail(DziInfo(640, 480, 254, 1, "png", 10), .5, .375, zoom, 0)


@pytest.mark.parametrize("x,y,rotation", [(float("inf"), 0, 0), (0, float("nan"), 0), (0, 0, float("inf"))])
def test_nonfinite_viewport(x, y, rotation):
    with pytest.raises(ValueError):
        thumbs.plan_thumbnail(DziInfo(640, 480, 254, 1, "png", 10), x, y, 2, rotation)


@pytest.mark.parametrize("angle,point", [(0, (80, 80)), (90, (200, 40)), (37, (120, 40)), (-270, (200, 40))])
def test_clockwise_asymmetric_marker(pyramid, angle, point):
    result = _render(pyramid, rotation=angle)
    red, green, blue = result(*point)
    assert red > 200 and green < 30 and blue < 30
    # The opposite quadrant stays white, disproving counterclockwise rotation.
    assert min(result(320 - point[0], 240 - point[1])) > 230


@pytest.mark.parametrize("x,y,outside,inside", [
    (0, .375, (40, 120), (240, 120)),
    (1, .375, (280, 120), (80, 120)),
    (.5, 0, (160, 40), (160, 200)),
    (.5, .75, (160, 200), (160, 40)),
    (0, 0, (40, 40), (240, 200)),
    (1, 0, (280, 40), (80, 200)),
    (0, .75, (40, 200), (240, 40)),
    (1, .75, (280, 200), (80, 40)),
])
def test_edges_and_corners_are_padded_not_shifted(pyramid, x, y, outside, inside):
    result = _render(pyramid, x=x, y=y)
    assert result(*outside) == pytest.approx(thumbs.VIEWER_BACKGROUND, abs=3)
    assert min(result(*inside)) > 245


def test_entirely_outside_viewport(pyramid):
    result = _render(pyramid, x=5, y=5, rotation=45)
    assert result(160, 120) == pytest.approx(thumbs.VIEWER_BACKGROUND, abs=3)


def test_arbitrary_rotation_has_no_artificial_blank_corners(pyramid):
    result = _render(pyramid, rotation=37)
    for point in [(5, 5), (315, 5), (5, 235), (315, 235)]:
        assert min(result(*point)) > 230


def test_fractional_crop_resize(pyramid):
    _render(pyramid, zoom=1.75)


@pytest.mark.parametrize("url", [None, "/api/tiles/999/image.dzi", "https://catalog.example/image.dzi", "/api/tiles/../image.dzi"])
def test_missing_local_dzi_returns_none(tmp_path, url):
    image = Image(tile_sources=url)
    assert thumbs.generate_marker_thumbnail(image, 1, .5, .5, 2, tiles_dir=tmp_path) is None
    assert list(tmp_path.iterdir()) == []


def test_corrupt_and_missing_intersecting_tiles_raise(pyramid):
    image, base, root = pyramid
    (root / "image.dzi").write_text("not xml")
    with pytest.raises(MissingTiles):
        thumbs.generate_marker_thumbnail(image, 1, .5, .375, 2, tiles_dir=base)


def test_missing_tile_raises(pyramid):
    image, base, root = pyramid
    for tile in (root / "image_files/10").iterdir():
        tile.unlink()
    with pytest.raises(MissingTiles):
        thumbs.generate_marker_thumbnail(image, 1, .5, .375, 2, tiles_dir=base)


def test_delete_one_and_delete_all_are_idempotent(pyramid):
    image, base, root = pyramid
    _render(pyramid)
    thumbs.generate_marker_thumbnail(image, 8, .5, .375, 2, tiles_dir=base)
    thumbs.remove_marker_thumbnail(image, 7, tiles_dir=base)
    thumbs.remove_marker_thumbnail(image, 7, tiles_dir=base)
    assert not (root / "markers/7.jpg").exists()
    assert (root / "markers/8.jpg").exists()
    thumbs.remove_image_marker_thumbnails(image, tiles_dir=base)
    thumbs.remove_image_marker_thumbnails(image, tiles_dir=base)
    assert not (root / "markers").exists()
    assert (root / "image.dzi").exists()


@pytest.mark.parametrize("bad_id", [0, -1, "../x", True])
def test_invalid_file_id_is_rejected(pyramid, bad_id):
    image, base, _ = pyramid
    with pytest.raises(ValueError):
        thumbs.generate_marker_thumbnail(image, bad_id, .5, .375, 2, tiles_dir=base)
    with pytest.raises(ValueError):
        thumbs.remove_marker_thumbnail(image, bad_id, tiles_dir=base)


def test_symlink_thumbnail_directory_does_not_escape(pyramid, tmp_path):
    image, base, root = pyramid
    outside = tmp_path / "outside"
    outside.mkdir()
    sentinel = outside / "7.jpg"
    sentinel.write_text("keep")
    (root / "markers").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        _render(pyramid)
    thumbs.remove_marker_thumbnail(image, 7, tiles_dir=base)
    thumbs.remove_image_marker_thumbnails(image, tiles_dir=base)
    assert sentinel.read_text() == "keep"
    assert not (root / "markers").exists()


@pytest.mark.parametrize("bulk", [False, True])
@pytest.mark.parametrize("commit_fails", [False, True])
async def test_image_deletion_cleanup_after_commit(pyramid, monkeypatch, bulk, commit_fails):
    image, base, root = pyramid
    _render(pyramid)
    db = AsyncMock()
    db.get.return_value = image
    result = db.execute.return_value
    result.scalars = lambda: SimpleNamespace(all=lambda: [image])
    monkeypatch.setattr(thumbs.settings, "tiles_dir", str(base))
    monkeypatch.setattr(images_router, "image_ids_in_collections", AsyncMock(return_value=set()))
    if commit_fails:
        db.commit.side_effect = RuntimeError("commit failed")
    user = SimpleNamespace(id=1, role="admin", metadata_={})

    async def delete():
        if bulk:
            await images_router.bulk_delete_images(ImageBulkDelete(image_ids=[1]), user, db=db)
        else:
            await images_router.delete_image(1, user, db=db)

    if commit_fails:
        with pytest.raises(RuntimeError, match="commit failed"):
            await delete()
    else:
        await delete()
    assert (root / "markers").exists() == commit_fails
    assert (root / "image.dzi").exists()


@pytest.mark.parametrize("commit_fails", [False, True])
async def test_replacement_cleanup_after_commit(pyramid, monkeypatch, commit_fails):
    image, base, root = pyramid
    _render(pyramid)
    directory = root / "collection_slots"
    directory.mkdir()
    slot_file = directory / "9.jpg"
    slot_file.write_bytes(b"snapshot")
    slot_paths = AsyncMock(return_value=["/api/tiles/42/collection_slots/9.jpg"])
    monkeypatch.setattr(processing, "image_slot_thumbs", slot_paths)
    image.version = 1
    image.metadata_ = {}
    src = SourceImage(id=43, status="pending", original_filename="new.tiff", stored_path="/unused", file_size=1)
    db = AsyncMock()
    db.__aenter__.return_value = db
    db.get.side_effect = lambda model, key: src if model is SourceImage else image
    commits = 0

    async def commit():
        nonlocal commits
        commits += 1
        if commit_fails and commits == 5:
            raise RuntimeError("commit failed")

    db.commit.side_effect = commit
    monkeypatch.setattr(processing, "async_session", lambda: db)
    monkeypatch.setattr(processing.settings, "tiles_dir", str(base))
    monkeypatch.setattr(processing, "detect_pyramid_info", lambda _: None)
    monkeypatch.setattr(processing, "generate_tiles", lambda *args: ("image.dzi", "thumbnail.jpeg", 640, 480))
    monkeypatch.setattr(processing, "_flush_tracker_progress", AsyncMock())
    monkeypatch.setattr(processing, "_best_effort_source_checksum", AsyncMock(return_value=None))
    monkeypatch.setattr(processing, "image_ids_in_collections", AsyncMock(return_value=set()))
    monkeypatch.setattr(processing, "scan_after_processing", AsyncMock())
    await processing.process_replace_image(43, 1)
    assert src.status == ("failed" if commit_fails else "completed")
    assert (root / "markers").exists() == commit_fails
    assert slot_file.exists() == commit_fails
    slot_paths.assert_awaited_once_with(db, [1], clear=True)
    updates = [str(call.args[0]) for call in db.execute.call_args_list]
    assert any("DELETE FROM markers" in stmt for stmt in updates)
    if commit_fails:
        db.rollback.assert_awaited_once()
    else:
        assert image.tile_sources == "/api/tiles/43/image.dzi"
