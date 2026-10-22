#!/usr/bin/env python3
"""Purge orphaned failed source images (``status='failed'``, ``image_id IS NULL``).

Background: when image processing dies mid-flight — pod crash, OOM, rollout,
node drain — the startup reconciliation sweep marks the in-flight
``SourceImage`` rows ``failed`` before they ever link an ``Image``. Those rows
are terminal: there is no retry path, no viewer can request them, and
``rebuild_tiles`` cannot select them (its contract is ``status='completed'``
with a linked image). Operators normally re-upload the file, which creates a
*new* ``SourceImage``, so the failed rows only accumulate — each one holds a
preserved source file on the source-images volume plus a partial tile tree on
the tiles volume.

This script deletes the orphaned rows and their on-disk artifacts. It is a
**dry run by default**; pass ``--apply`` to execute. Run it inside the backend
container so it can reach the database and both volumes, e.g.::

    kubectl --context stable -n hriv exec -i deploy/hriv-backend -- \
        python - < scripts/purge_failed_source_images.py
    kubectl --context stable -n hriv exec -i deploy/hriv-backend -- \
        python - --apply < scripts/purge_failed_source_images.py

Safety properties:

- Only rows with ``status='failed'`` **and** ``image_id IS NULL`` are eligible.
  A ``failed`` row that still has a linked image is in scope for the
  delete-image / rebuild-tiles paths and is never touched here.
- ``--older-than-days`` (default 30) excludes recent failures an instructor
  may still want to retry or inspect.
- On-disk artifacts are removed **before** the row, and a row whose artifact
  removal fails is *retained* so the next dry run can find and retry it — the
  row is the only discoverability anchor for its tile tree. (A leftover
  stored file is additionally reported by the periodic reconciliation sweep's
  ``list_orphaned_final_files`` step, but nothing else scans ``tiles_dir``.)
- Path deletions are containment-checked against ``settings.tiles_dir`` and
  ``settings.source_images_dir`` — nothing outside the managed roots is ever
  removed.
"""

import argparse
import asyncio
import os
import shutil
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.database import get_async_session, settings
from app.models import SourceImage


def _dir_size_bytes(path: str) -> int:
    total = 0
    for dirpath, _dirnames, filenames in os.walk(path):
        for name in filenames:
            try:
                total += os.path.getsize(os.path.join(dirpath, name))
            except OSError:
                # File vanished mid-walk or is unreadable — size is
                # best-effort accounting for the report only.
                pass
    return total


def _format_bytes(n: int) -> str:
    for unit in ("B", "KiB", "MiB", "GiB"):
        if n < 1024 or unit == "GiB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} GiB"


def _contained(root: str, path: str) -> bool:
    """True when *path* resolves to a location inside *root*."""
    root_real = os.path.realpath(root)
    path_real = os.path.realpath(path)
    return os.path.commonpath([root_real, path_real]) == root_real


def _candidate_info(src: SourceImage) -> dict:
    tiles_dir = os.path.join(settings.tiles_dir, str(src.id))
    stored_exists = bool(src.stored_path) and os.path.isfile(src.stored_path)
    return {
        "id": src.id,
        "original_filename": src.original_filename,
        "created_at": src.created_at,
        "error_message": src.error_message,
        "stored_path": src.stored_path,
        "stored_exists": stored_exists,
        "stored_size": os.path.getsize(src.stored_path) if stored_exists else 0,
        "tiles_dir": tiles_dir,
        "tiles_exists": os.path.isdir(tiles_dir),
        "tiles_size": _dir_size_bytes(tiles_dir) if os.path.isdir(tiles_dir) else 0,
    }


def _print_candidate(info: dict) -> None:
    print(
        f"  src={info['id']}  created={info['created_at']}  "
        f"file={info['original_filename']!r}"
    )
    if info["error_message"]:
        print(f"    error: {str(info['error_message'])[:120]}")
    print(
        f"    stored: {'present ' + _format_bytes(info['stored_size']) if info['stored_exists'] else 'ABSENT'}"
        f"  ({info['stored_path']})"
    )
    print(
        f"    tiles:  {'present ' + _format_bytes(info['tiles_size']) if info['tiles_exists'] else 'absent'}"
        f"  ({info['tiles_dir']})"
    )


def _remove_artifacts(info: dict) -> list[str]:
    """Delete the tiles dir and stored file for one candidate.

    Returns a list of human-readable problems; a non-empty result means the
    caller must retain the source row so a later run can retry the leftover
    artifact (the row is the only discoverability anchor for its tile tree).
    """
    problems: list[str] = []
    tiles_dir = info["tiles_dir"]
    if info["tiles_exists"]:
        if not _contained(settings.tiles_dir, tiles_dir):
            problems.append(f"tiles dir outside managed root, skipped: {tiles_dir}")
        else:
            try:
                shutil.rmtree(tiles_dir)
            except OSError as exc:
                problems.append(f"failed to remove tiles dir {tiles_dir}: {exc}")
    stored_path = info["stored_path"]
    if info["stored_exists"]:
        if not _contained(settings.source_images_dir, stored_path):
            problems.append(
                f"stored file outside source-images root, skipped: {stored_path}"
            )
        else:
            try:
                os.unlink(stored_path)
            except OSError as exc:
                problems.append(f"failed to remove stored file {stored_path}: {exc}")
    return problems


async def _find_candidates(
    older_than_days: int, source_ids: list[int] | None
) -> list[dict]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=older_than_days)
    stmt = (
        select(SourceImage)
        .where(
            SourceImage.status == "failed",
            SourceImage.image_id.is_(None),
            SourceImage.created_at < cutoff,
        )
        .order_by(SourceImage.id)
    )
    if source_ids:
        stmt = stmt.where(SourceImage.id.in_(source_ids))
    async with get_async_session()() as session:
        sources = list((await session.execute(stmt)).scalars().all())
        return [_candidate_info(src) for src in sources]


async def _apply(source_ids: list[int]) -> list[str]:
    """Remove artifacts and rows for the given candidate ids.

    Rows are re-fetched inside the write session so a source deleted (or
    linked) between the dry-run scan and the delete cannot be acted on
    blindly — the eligibility predicates are re-checked per row.
    """
    problems: list[str] = []
    async with get_async_session()() as session:
        for src_id in source_ids:
            src = await session.get(SourceImage, src_id)
            if src is None:
                print(f"  src={src_id}: row vanished during purge, skipping")
                continue
            if src.status != "failed" or src.image_id is not None:
                print(
                    f"  src={src_id}: no longer eligible "
                    f"(status={src.status}, image_id={src.image_id}), skipping"
                )
                continue
            info = _candidate_info(src)
            row_problems = _remove_artifacts(info)
            problems.extend(row_problems)
            if row_problems:
                # The row is the only discoverability anchor for its tile
                # tree — nothing else scans ``tiles_dir`` — so a failed
                # artifact removal must retain the row for the next dry run
                # to find and retry rather than stranding the tree.
                print(
                    f"  src={src_id}: artifact removal failed; row retained "
                    "for retry"
                )
                continue
            await session.delete(src)
            print(f"  src={src_id}: removed artifacts + row")
        await session.commit()
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Purge orphaned failed SourceImage rows and their files."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="actually delete files and rows (default is a dry run)",
    )
    parser.add_argument(
        "--older-than-days",
        type=int,
        default=30,
        metavar="N",
        help="only consider sources failed more than N days ago (default: 30)",
    )
    parser.add_argument(
        "--source-ids",
        type=str,
        default=None,
        metavar="IDS",
        help="comma-separated SourceImage ids to narrow the purge",
    )
    args = parser.parse_args()

    source_ids = (
        [int(part) for part in args.source_ids.split(",") if part.strip()]
        if args.source_ids
        else None
    )

    infos = asyncio.run(_find_candidates(args.older_than_days, source_ids))

    mode = "APPLY" if args.apply else "DRY RUN"
    print(f"[{mode}] {len(infos)} orphaned failed source image(s) found\n")
    total_stored = total_tiles = 0
    for info in infos:
        _print_candidate(info)
        total_stored += info["stored_size"]
        total_tiles += info["tiles_size"]
    print(
        f"\nTotal reclaimable: {_format_bytes(total_stored)} source files, "
        f"{_format_bytes(total_tiles)} tiles"
    )

    if not args.apply:
        print("\nDry run only — rerun with --apply to delete.")
        return 0

    if not infos:
        print("Nothing to do.")
        return 0

    problems = asyncio.run(_apply([info["id"] for info in infos]))
    if problems:
        print("\nCompleted with leftover artifacts:")
        for problem in problems:
            print(f"  - {problem}")
        print(
            "Rows whose artifact removal failed were retained so a later "
            "dry run can find and retry them. A leftover stored file is "
            "additionally reported by the periodic reconciliation sweep "
            "(list_orphaned_final_files)."
        )
    else:
        print(f"\nDone — purged {len(infos)} orphaned failed source image(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
