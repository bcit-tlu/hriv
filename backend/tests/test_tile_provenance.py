"""Tests for tile-cache provenance and staleness evaluation."""

from datetime import datetime, timezone

from app.models import SourceImage
from app.tile_provenance import (
    TILE_CACHE_CURRENT,
    TILE_CACHE_FAILED,
    TILE_CACHE_MISSING,
    TILE_CACHE_STALE,
    TILE_GENERATION_VERSION,
    compute_source_checksum,
    current_tile_settings_hash,
    evaluate_tile_cache_status,
)


# ── current_tile_settings_hash ────────────────────────────


def test_settings_hash_is_stable() -> None:
    """The settings hash is deterministic across calls."""
    assert current_tile_settings_hash() == current_tile_settings_hash()


def test_settings_hash_is_sha256_hex() -> None:
    """The settings hash is a 64-char hex digest."""
    value = current_tile_settings_hash()
    assert len(value) == 64
    int(value, 16)  # raises if not valid hex


def test_v1_settings_hash_is_pinned() -> None:
    """Pin the v1 hash so the 0014 migration backfill constant can't drift.

    Migration ``0014_add_tile_provenance`` hardcodes this digest to backfill
    pre-existing completed rows. If the settings-hash payload format changes
    while the version is still 1, this guards against a silent mismatch.
    """
    if TILE_GENERATION_VERSION != 1:
        return
    assert current_tile_settings_hash() == (
        "60d0d2d69b3dbe1fe4af0f7318b771da937f8743822710339fd1fe97413d082f"
    )


def test_settings_hash_changes_with_version(monkeypatch) -> None:
    """Bumping the generation version changes the settings hash."""
    baseline = current_tile_settings_hash()
    monkeypatch.setattr(
        "app.tile_provenance.TILE_GENERATION_VERSION", TILE_GENERATION_VERSION + 1
    )
    assert current_tile_settings_hash() != baseline


# ── compute_source_checksum ───────────────────────────────


def test_compute_source_checksum_matches_content(tmp_path) -> None:
    """Checksum is the SHA-256 of the file content."""
    import hashlib

    path = tmp_path / "src.bin"
    payload = b"hello tiles"
    path.write_bytes(payload)

    assert compute_source_checksum(str(path)) == hashlib.sha256(payload).hexdigest()


def test_compute_source_checksum_missing_file_returns_none(tmp_path) -> None:
    """A missing/unreadable file yields None rather than raising."""
    assert compute_source_checksum(str(tmp_path / "nope.bin")) is None


# ── evaluate_tile_cache_status ────────────────────────────


def test_evaluate_missing_when_never_generated() -> None:
    """No generation timestamp on a non-failed source means missing."""
    status = evaluate_tile_cache_status(
        processing_status="completed",
        tiles_generated_at=None,
        tile_settings_hash=None,
    )
    assert status == TILE_CACHE_MISSING


def test_evaluate_failed_when_never_generated_and_failed() -> None:
    """A failed source with no tiles reports failed, not missing."""
    status = evaluate_tile_cache_status(
        processing_status="failed",
        tiles_generated_at=None,
        tile_settings_hash=None,
    )
    assert status == TILE_CACHE_FAILED


def test_evaluate_failed_overrides_existing_tiles() -> None:
    """A failed reprocess marks an existing tile set failed."""
    now = datetime.now(timezone.utc)
    status = evaluate_tile_cache_status(
        processing_status="failed",
        tiles_generated_at=now,
        tile_settings_hash=current_tile_settings_hash(),
    )
    assert status == TILE_CACHE_FAILED


def test_evaluate_current_when_hash_matches() -> None:
    """Matching settings hash on generated tiles is current."""
    now = datetime.now(timezone.utc)
    status = evaluate_tile_cache_status(
        processing_status="completed",
        tiles_generated_at=now,
        tile_settings_hash=current_tile_settings_hash(),
    )
    assert status == TILE_CACHE_CURRENT


def test_evaluate_stale_when_hash_differs() -> None:
    """A different settings hash means the tile set is stale."""
    now = datetime.now(timezone.utc)
    status = evaluate_tile_cache_status(
        processing_status="completed",
        tiles_generated_at=now,
        tile_settings_hash="stale-hash",
    )
    assert status == TILE_CACHE_STALE


def test_evaluate_accepts_explicit_current_hash() -> None:
    """An explicit current_settings_hash is used for comparison."""
    now = datetime.now(timezone.utc)
    status = evaluate_tile_cache_status(
        processing_status="completed",
        tiles_generated_at=now,
        tile_settings_hash="abc",
        current_settings_hash="abc",
    )
    assert status == TILE_CACHE_CURRENT


# ── SourceImage.tile_cache_status property ────────────────


def test_source_image_property_missing_by_default() -> None:
    """A freshly created SourceImage has no tiles -> missing."""
    src = SourceImage(original_filename="x.tiff", stored_path="/tmp/x.tiff", status="pending")
    assert src.tile_cache_status == TILE_CACHE_MISSING


def test_source_image_property_current_after_generation() -> None:
    """Recording matching provenance makes the property report current."""
    src = SourceImage(
        original_filename="x.tiff",
        stored_path="/tmp/x.tiff",
        status="completed",
        tiles_generated_at=datetime.now(timezone.utc),
        tile_settings_hash=current_tile_settings_hash(),
    )
    assert src.tile_cache_status == TILE_CACHE_CURRENT


def test_source_image_property_stale_after_settings_change() -> None:
    """Old provenance reports stale against the current settings hash."""
    src = SourceImage(
        original_filename="x.tiff",
        stored_path="/tmp/x.tiff",
        status="completed",
        tiles_generated_at=datetime.now(timezone.utc),
        tile_settings_hash="old-version-hash",
    )
    assert src.tile_cache_status == TILE_CACHE_STALE
