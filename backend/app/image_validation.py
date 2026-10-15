"""Shared image file validation constants and helpers.

Centralises the image-extension, MIME-type, and chunk-size constants
that were previously duplicated across the upload and image-replace
routers.
"""

import os
from pathlib import Path

# Recognised image extensions (lowercase, with dot).
# BMP is intentionally excluded: libvips has no native BMP loader and the
# ImageMagick delegate (the only path that can decode BMP in libvips) is
# disabled in the backend image's libvips source build to drop ~24
# non-reachable magickcore CVEs. See backend/Dockerfile for details.
IMAGE_EXTENSIONS = frozenset({
    ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".gif", ".webp", ".svs",
})

# Recognised image MIME types. We deliberately DO NOT accept
# ``content_type.startswith("image/")`` because browsers send
# ``image/bmp`` for BMP uploads — and BMP decoding is not available in
# this backend's libvips build (see ``IMAGE_EXTENSIONS`` comment).
# Listing the specific MIME types we support keeps extension and MIME
# validation in lock-step with the libvips loaders compiled in.
IMAGE_MIME_TYPES = frozenset({
    "image/jpeg",
    "image/png",
    "image/tiff",
    "image/gif",
    "image/webp",
})

# 1 MiB chunks for streaming large uploads to disk.
UPLOAD_CHUNK_SIZE = 1024 * 1024

# Per-file streamed-bytes cap for single-image upload and image
# replacement (#1432). The ingress intentionally accepts unlimited request
# bodies, so the read loop is the layer that bounds how much of one
# request can be written to the data volume. Multi-GB histology slides
# (.svs) are legitimate content, so the default sits well above observed
# real uploads while still bounding per-file disk usage.
UPLOAD_MAX_BYTES = int(
    os.environ.get("UPLOAD_MAX_BYTES", str(20 * 1024 * 1024 * 1024))
)
if UPLOAD_MAX_BYTES <= 0:
    raise ValueError(
        f"UPLOAD_MAX_BYTES must be a positive integer, got {UPLOAD_MAX_BYTES}"
    )


def is_valid_image(filename: str, content_type: str | None) -> bool:
    """Accept the file if it has a recognised image extension *or* MIME type."""
    if content_type and content_type in IMAGE_MIME_TYPES:
        return True
    return Path(filename).suffix.lower() in IMAGE_EXTENSIONS
