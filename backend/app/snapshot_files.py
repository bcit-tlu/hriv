"""Saved-view JPEGs are authoritative snapshots, not derived DZI tiles."""

import re
from pathlib import Path
from collections.abc import Iterator

SNAPSHOT_NAMESPACES = ("markers", "collection_slots")
# Pre-Marker archives store saved-view JPEGs under the former namespace.
# Legacy dirs enumerate first: a restore maps both to ``markers/``, so
# yielding canonical files last lets them win a same-target conflict.
LEGACY_SNAPSHOT_NAMESPACES = {"inuksuks": "markers"}


def snapshot_files(tiles: Path) -> Iterator[Path]:
    if not tiles.is_dir():
        return
    for source in sorted(tiles.iterdir()):
        if source.is_symlink() or not source.is_dir() or not re.fullmatch(r"[0-9]+", source.name):
            continue
        for namespace in (*LEGACY_SNAPSHOT_NAMESPACES, *SNAPSHOT_NAMESPACES):
            directory = source / namespace
            if directory.is_symlink() or not directory.is_dir():
                continue
            for path in sorted(directory.iterdir()):
                if not path.is_symlink() and path.is_file() and re.fullmatch(r"[1-9][0-9]*\.jpg", path.name):
                    yield path


def snapshot_relative_target(path: Path) -> Path:
    """Map a tiles-relative snapshot path to its restore target.

    Legacy ``inuksuks`` JPEGs promote into the canonical ``markers``
    directory so a pre-rename archive restores straight to the new
    namespace instead of reviving the old one.
    """
    parts = path.parts
    if len(parts) >= 2 and parts[1] in LEGACY_SNAPSHOT_NAMESPACES:
        return Path(parts[0], LEGACY_SNAPSHOT_NAMESPACES[parts[1]], *parts[2:])
    return path
