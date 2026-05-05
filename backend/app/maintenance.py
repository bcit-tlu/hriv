"""File-based maintenance mode flag.

Both the backend and the backup pod share the ``/data`` PVC.  The
maintenance flag is a plain file at ``<DATA_DIR>/.maintenance``.  The
backup service writes this file before a restore and removes it
afterwards; the backend middleware checks for its presence on every
request to gate traffic with a 503.

Using the filesystem (rather than the database or Redis) is intentional:
the database is dropped and recreated during a restore, and Redis may
not be available in all deployments.
"""

import logging
from pathlib import Path

from .database import settings

logger = logging.getLogger(__name__)

MAINTENANCE_FILENAME = ".maintenance"


def _flag_path() -> Path:
    return Path(settings.source_images_dir).parent / MAINTENANCE_FILENAME


def is_maintenance_mode() -> bool:
    return _flag_path().exists()


def enable_maintenance_mode() -> None:
    path = _flag_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch()
    logger.info(
        "Maintenance mode ENABLED",
        extra={"event": "maintenance.enabled", "flag_path": str(path)},
    )


def disable_maintenance_mode() -> None:
    path = _flag_path()
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass
    logger.info(
        "Maintenance mode DISABLED",
        extra={"event": "maintenance.disabled", "flag_path": str(path)},
    )
