"""Normalization of client-supplied upload filenames.

Filenames arrive verbatim from browsers, CLI clients, and archive members and
are persisted (``SourceImage.original_filename``, ``AdminTask.original_filename``),
returned by the API, attached to OTEL spans, and embedded in log payloads and
processing error messages. Normalizing once at ingestion keeps every consumer
in agreement on a single plain-text value.

Spaces and non-ASCII characters are preserved: they are legitimate parts of a
filename. The value is deliberately *not* HTML-escaped — renderers escape.
"""

import unicodedata

# ``SourceImage.original_filename`` / ``AdminTask.original_filename`` are
# ``String(500)`` columns.
MAX_FILENAME_LENGTH = 500

# Used when normalization leaves nothing usable (empty, all control
# characters, or a bare path such as ``../``).
FILENAME_PLACEHOLDER = "unnamed"


def sanitize_upload_filename(
    filename: str | None,
    *,
    max_length: int = MAX_FILENAME_LENGTH,
    placeholder: str = FILENAME_PLACEHOLDER,
) -> str:
    """Return a plain-text, storable form of a client-supplied *filename*.

    Takes the basename, drops control characters, collapses whitespace runs to
    single spaces, NFC-normalizes unicode, truncates to *max_length*, and falls
    back to *placeholder* when nothing usable remains.
    """
    if not filename:
        return placeholder

    normalized = unicodedata.normalize("NFC", filename)

    # Basename only: reject both POSIX and Windows path components.
    basename = normalized.replace("\\", "/").rsplit("/", 1)[-1]

    cleaned_chars = []
    for char in basename:
        if char.isspace():
            cleaned_chars.append(" ")
        elif unicodedata.category(char).startswith("C"):
            continue
        else:
            cleaned_chars.append(char)

    cleaned = " ".join("".join(cleaned_chars).split())

    if cleaned in ("", ".", ".."):
        return placeholder

    cleaned = cleaned[:max_length].strip()
    return cleaned or placeholder
