"""Production-shaped tile-rebuild scale fixture (issue #1189).

Pads an environment's source-image population with deterministic, completed,
linked sources so the durable parallel tile-rebuild scheduler can be rehearsed
at production item count (3,400+) without needing thousands of real slide
scans. Each fixture source points at a tiny valid deflate-compressed TIFF
(~1 KiB) written under ``settings.source_images_dir/rebuild-fixture/`` so
children exercise the real decode → dzsave → promote path end to end.

Fixture rows are marked by:

- deterministic IDs in reserved high ranges (never collide with
  sequence-assigned rows);
- the ``TRF-`` name/filename prefix;
- files confined to the ``rebuild-fixture`` subdirectory.

Seeding is idempotent: ``--purge`` (or a reseed) removes every fixture row,
source file, generated tile tree, and rebuild temporary tree before re-inserting.
Fixture mutation holds the source-volume archive lock shared with backups and
filesystem exports; ``--count 0`` leaves no active fixture directory.

CLI usage (requires ``DATABASE_URL`` and a writable ``SOURCE_IMAGES_DIR``)::

    python -m app.rebuild_fixture --count 3000   # purge + seed
    python -m app.rebuild_fixture --purge        # purge only

Throughput measurements should still be taken from real sources — fixture
items exist to exercise pump batching, lease churn, and aggregate updates at
production item scale, not to represent real libvips cost.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import fcntl
import hashlib
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO

from sqlalchemy import delete, or_
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from .browse_state import bump_browse_revision
from .database import settings
from .models import Image, SourceImage
from .tile_provenance import current_tile_settings_hash

FIXTURE_PREFIX = "TRF-"
FIXTURE_DIRNAME = "rebuild-fixture"
FIXTURE_ARCHIVE_LOCK_FILENAME = ".rebuild-fixture-archive.lock"

# Reserved ID ranges, disjoint from reorder_fixture's 9_100_000/9_200_000.
SOURCE_IMAGE_ID_BASE = 9_300_000
IMAGE_ID_BASE = 9_400_000

DEFAULT_FIXTURE_COUNT = 3000

# A deterministic 256x256 RGB deflate-compressed TIFF (~1 KiB), generated once
# with ``pyvips.Image.black(256, 256).new_from_image([64, 128, 192])
# .tiffsave_buffer(compression="deflate")``. Valid input for the real
# decode/dzsave path while costing almost nothing to store or rebuild.
_FIXTURE_TIFF_B64 = (
    "SUkqAL4CAAB4nO3SAQEAMAjAIKMZzWiP9iCDDOy9gar1nzD/KfOfMv8p858y/ynznzL/"
    "KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p85"
    "8y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/"
    "KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y"
    "/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOf"
    "Mv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynz"
    "nzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p"
    "858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/"
    "KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y"
    "/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOf"
    "Mv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynz"
    "nzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p"
    "858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/"
    "KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynzn7IPAWfAAXic7dIB"
    "AQAwCMAgoxnNaI/2IIMM7L2BqvWfMP8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p"
    "858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/"
    "KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y"
    "/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOf"
    "Mv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynz"
    "nzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p"
    "858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/"
    "KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y/ynznzL/KfOfMv8p858y"
    "/ynznzL/KfOfsg8BZ8ABEAAAAQMAAQAAAAABAAABAQMAAQAAAAABAAACAQMAAwAAAJQDAAAD"
    "AQMAAQAAAAgAAAAGAQMAAQAAAAIAAAARAQQAAgAAAKIDAAASAQMAAQAAAAEAAAAVAQMAAQAA"
    "AAMAAAAWAQMAAQAAAIAAAAAXAQQAAgAAAJoDAAAaAQUAAQAAAIQDAAAbAQUAAQAAAIwDAAAc"
    "AQMAAQAAAAEAAAAoAQMAAQAAAAIAAAA9AQMAAQAAAAIAAABTAQMAAwAAAKoDAAAAAAAAMzPL"
    "AAAACAAzM8sAAAAIAAgACAAIAFsBAABbAQAACAAAAGMBAAABAAEAAQA="
)

FIXTURE_TIFF_BYTES = base64.b64decode(_FIXTURE_TIFF_B64)


@dataclass(frozen=True)
class RebuildFixtureSpec:
    """One deterministic (image, source_image, file) tuple."""

    image_id: int
    source_image_id: int
    name: str
    filename: str


def build_fixture_spec(count: int) -> list[RebuildFixtureSpec]:
    """Build the deterministic fixture specification (no I/O)."""
    if count < 0:
        raise ValueError("count must be >= 0")
    return [
        RebuildFixtureSpec(
            image_id=IMAGE_ID_BASE + index,
            source_image_id=SOURCE_IMAGE_ID_BASE + index,
            name=f"{FIXTURE_PREFIX}Image-{index:05d}",
            filename=f"{FIXTURE_PREFIX}{index:05d}.tif",
        )
        for index in range(count)
    ]


def fixture_source_dir() -> Path:
    """Directory holding the fixture source files (and nothing else)."""
    return Path(settings.source_images_dir) / FIXTURE_DIRNAME


def _acquire_archive_lock(source_images_dir: str | Path | None = None) -> TextIO:
    root = (
        Path(source_images_dir)
        if source_images_dir is not None
        else fixture_source_dir().parent
    )
    root.mkdir(parents=True, exist_ok=True)
    handle = (root / FIXTURE_ARCHIVE_LOCK_FILENAME).open("a+")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
    except Exception:
        handle.close()
        raise
    return handle


async def acquire_rebuild_fixture_archive_lock(
    source_images_dir: str | Path | None = None,
) -> TextIO:
    return await asyncio.to_thread(_acquire_archive_lock, source_images_dir)


async def release_rebuild_fixture_archive_lock(handle: TextIO) -> None:
    def release() -> None:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()

    await asyncio.to_thread(release)


def write_fixture_files(spec: list[RebuildFixtureSpec]) -> Path:
    """Write one tiny TIFF per fixture source and return the directory."""
    fixture_dir = fixture_source_dir()
    fixture_dir.mkdir(parents=True, exist_ok=True)
    for item in spec:
        path = fixture_dir / item.filename
        if not path.is_file() or path.read_bytes() != FIXTURE_TIFF_BYTES:
            path.write_bytes(FIXTURE_TIFF_BYTES)
    return fixture_dir


def purge_fixture_files() -> None:
    """Remove fixture source files and generated tile trees."""
    shutil.rmtree(fixture_source_dir(), ignore_errors=True)
    tiles_dir = Path(settings.tiles_dir)
    if not tiles_dir.is_dir():
        return
    for path in tiles_dir.iterdir():
        name = path.name
        source_id = None
        if name.isdigit():
            source_id = int(name)
        elif name.startswith(".rebuild-"):
            try:
                source_id = int(name.split("-", 2)[1])
            except (IndexError, ValueError):
                source_id = None
        elif ".old-" in name:
            prefix, _separator, _suffix = name.partition(".old-")
            if prefix.isdigit():
                source_id = int(prefix)
        if source_id is not None and source_id >= SOURCE_IMAGE_ID_BASE:
            if path.is_symlink() or not path.is_dir():
                path.unlink(missing_ok=True)
            else:
                shutil.rmtree(path)


async def purge_rebuild_fixture(session: AsyncSession) -> None:
    """Delete every fixture row (reserved ID range or ``TRF-`` prefix)."""
    # ``synchronize_session="fetch"`` keeps the identity map consistent with
    # the bulk delete so reseeding in the same session cannot conflict.
    await session.execute(
        delete(SourceImage)
        .where(
            or_(
                SourceImage.id >= SOURCE_IMAGE_ID_BASE,
                SourceImage.original_filename.like(f"{FIXTURE_PREFIX}%"),
            )
        )
        .execution_options(synchronize_session="fetch")
    )
    await session.execute(
        delete(Image)
        .where(
            or_(
                Image.id >= IMAGE_ID_BASE,
                Image.name.like(f"{FIXTURE_PREFIX}%"),
            )
        )
        .execution_options(synchronize_session="fetch")
    )
    # Deleted fixture images must invalidate browse caches too.
    await bump_browse_revision(session)
    await session.commit()


async def _seed_rebuild_fixture_locked(
    session: AsyncSession,
    count: int,
) -> list[RebuildFixtureSpec]:
    """Idempotently (re-)create *count* linked fixture sources."""
    spec = build_fixture_spec(count)
    await purge_rebuild_fixture(session)
    await asyncio.to_thread(purge_fixture_files)
    fixture_dir = fixture_source_dir()
    if spec:
        fixture_dir = await asyncio.to_thread(write_fixture_files, spec)

    checksum = hashlib.sha256(FIXTURE_TIFF_BYTES).hexdigest()
    settings_hash = current_tile_settings_hash()
    file_size = len(FIXTURE_TIFF_BYTES)

    for item in spec:
        session.add(
            Image(
                id=item.image_id,
                name=item.name,
                thumb=(
                    f"/api/tiles/{item.source_image_id}/thumbnail.jpeg"
                ),
                tile_sources=(
                    f"/api/tiles/{item.source_image_id}/image.dzi"
                ),
                active=True,
                metadata_={"rebuild_fixture": True},
                width=256,
                height=256,
                file_size=file_size,
            )
        )
    await session.flush()

    for item in spec:
        session.add(
            SourceImage(
                id=item.source_image_id,
                original_filename=item.filename,
                stored_path=str(fixture_dir / item.filename),
                status="completed",
                progress=100,
                status_message="Completed",
                name=item.name,
                active=True,
                image_id=item.image_id,
                file_size=file_size,
                source_checksum=checksum,
                tile_settings_hash=settings_hash,
                # ``tiles_generated_at`` stays NULL: the fixture's tile tree
                # is genuinely missing until a rebuild produces it.
            )
        )
    await bump_browse_revision(session)
    await session.commit()
    return spec


async def seed_rebuild_fixture(
    session: AsyncSession,
    count: int,
) -> list[RebuildFixtureSpec]:
    lock = await acquire_rebuild_fixture_archive_lock()
    try:
        return await _seed_rebuild_fixture_locked(session, count)
    finally:
        await release_rebuild_fixture_archive_lock(lock)


def _resolve_database_url() -> str:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise SystemExit(
            "DATABASE_URL is required to load the rebuild fixture"
        )
    # The chart stores the driverless ``postgresql://`` form; mirror the
    # Settings normalization so the async engine gets asyncpg.
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


async def _run_cli(*, count: int, purge_only: bool) -> None:
    engine = create_async_engine(_resolve_database_url())
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_factory() as session:
            if purge_only:
                lock = await acquire_rebuild_fixture_archive_lock()
                try:
                    await purge_rebuild_fixture(session)
                    await asyncio.to_thread(purge_fixture_files)
                finally:
                    await release_rebuild_fixture_archive_lock(lock)
                print("Rebuild fixture purged.")
            else:
                spec = await seed_rebuild_fixture(session, count)
                print(
                    f"Rebuild fixture seeded: {len(spec)} linked source images "
                    f"under {fixture_source_dir()}."
                )
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--count",
        type=int,
        default=DEFAULT_FIXTURE_COUNT,
        help=(
            "Number of deterministic linked fixture sources to create "
            f"(default: {DEFAULT_FIXTURE_COUNT})."
        ),
    )
    parser.add_argument(
        "--purge",
        action="store_true",
        help="Remove fixture rows, sources, and tiles without reseeding.",
    )
    args = parser.parse_args(argv)
    asyncio.run(_run_cli(count=args.count, purge_only=args.purge))


if __name__ == "__main__":  # pragma: no cover
    main()
