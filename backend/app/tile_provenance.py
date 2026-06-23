"""Tile-cache provenance and staleness evaluation.

Generated DZI tiles are *derived* data: they can always be regenerated from
the authoritative source image (see issue #738). To treat tiles as recoverable
without manual filesystem inspection, each :class:`~app.models.SourceImage`
records enough provenance to answer one question after a restore, replacement,
or pipeline change: *does the tile tree on disk still match the current source
file and the current tile-generation settings?*

This module centralises:

- the DZI generation parameters (so the settings hash truly reflects them),
- a content fingerprint for the source file (``source_checksum``),
- a settings/version fingerprint (``tile_settings_hash``), and
- :func:`evaluate_tile_cache_status`, which derives a ``current`` / ``missing``
  / ``stale`` / ``failed`` status purely from stored fields plus the current
  in-process settings (no filesystem access required).

Bump :data:`TILE_GENERATION_VERSION` whenever a change to tile output would make
previously generated tiles incompatible (format, layout, or any dzsave
parameter). Existing tile sets then evaluate as ``stale`` automatically, which
keeps restore/rebuild state unambiguous.
"""

import hashlib
import logging
from datetime import datetime

logger = logging.getLogger(__name__)


# ── DZI generation parameters ─────────────────────────────
#
# These are the single source of truth for ``dzsave`` parameters; importing
# them into ``processing.generate_tiles`` guarantees the settings hash always
# describes the tiles that were actually written.

DZI_TILE_SIZE = 254
DZI_OVERLAP = 1
DZI_TILE_SUFFIX = ".jpeg[Q=85]"

# Increment when a pipeline change makes previously generated tiles
# incompatible. Existing tile sets then evaluate as ``stale``.
TILE_GENERATION_VERSION = 1


# ── Tile cache status values ──────────────────────────────

TILE_CACHE_CURRENT = "current"
TILE_CACHE_MISSING = "missing"
TILE_CACHE_STALE = "stale"
TILE_CACHE_FAILED = "failed"


# Number of bytes read per chunk when fingerprinting a source file.
_CHECKSUM_CHUNK_SIZE = 1024 * 1024


def current_tile_settings_hash() -> str:
    """Return a stable fingerprint of the current tile-generation settings.

    The hash incorporates :data:`TILE_GENERATION_VERSION` and every ``dzsave``
    parameter, so any change that alters tile output changes the hash. Tile
    sets generated under a different hash are considered :data:`TILE_CACHE_STALE`.
    """
    payload = (
        f"v={TILE_GENERATION_VERSION}"
        f"|tile_size={DZI_TILE_SIZE}"
        f"|overlap={DZI_OVERLAP}"
        f"|suffix={DZI_TILE_SUFFIX}"
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def compute_source_checksum(source_path: str) -> str | None:
    """Return the SHA-256 hex digest of *source_path*, or ``None`` on error.

    Best-effort: a checksum is provenance metadata, never a precondition for
    tile generation, so any I/O error is swallowed and logged rather than
    aborting processing.
    """
    try:
        digest = hashlib.sha256()
        with open(source_path, "rb") as handle:
            for chunk in iter(lambda: handle.read(_CHECKSUM_CHUNK_SIZE), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        logger.debug(
            "Source checksum unavailable (non-critical)",
            extra={
                "event": "tiles.checksum_unavailable",
                "source_path": source_path,
            },
        )
        return None


def evaluate_tile_cache_status(
    *,
    processing_status: str | None,
    tiles_generated_at: datetime | None,
    tile_settings_hash: str | None,
    current_settings_hash: str | None = None,
) -> str:
    """Derive the effective tile-cache status from stored provenance.

    Resolution order (no filesystem access required):

    - ``failed`` — processing failed, or tiles were never generated while the
      source is in a terminal ``failed`` state.
    - ``missing`` — tiles have never been generated (no ``tiles_generated_at``).
    - ``stale`` — tiles exist but were generated under different settings/version
      than the current pipeline.
    - ``current`` — tiles exist and match the current pipeline settings.
    """
    if tiles_generated_at is None:
        return TILE_CACHE_FAILED if processing_status == "failed" else TILE_CACHE_MISSING

    if processing_status == "failed":
        return TILE_CACHE_FAILED

    expected = current_settings_hash if current_settings_hash is not None else current_tile_settings_hash()
    if tile_settings_hash != expected:
        return TILE_CACHE_STALE

    return TILE_CACHE_CURRENT
