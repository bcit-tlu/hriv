"""Saved-view JPEGs are authoritative snapshots, not derived DZI tiles."""

import re
from pathlib import Path
from collections.abc import Iterator

SNAPSHOT_NAMESPACES = ("inuksuks", "collection_slots")


def snapshot_files(tiles: Path) -> Iterator[Path]:
    if not tiles.is_dir():
        return
    for source in sorted(tiles.iterdir()):
        if source.is_symlink() or not source.is_dir() or not re.fullmatch(r"[0-9]+", source.name):
            continue
        for namespace in SNAPSHOT_NAMESPACES:
            directory = source / namespace
            if directory.is_symlink() or not directory.is_dir():
                continue
            for path in sorted(directory.iterdir()):
                if not path.is_symlink() and path.is_file() and re.fullmatch(r"[1-9][0-9]*\.jpg", path.name):
                    yield path
