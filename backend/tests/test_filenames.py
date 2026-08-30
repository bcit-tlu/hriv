"""Tests for client-supplied filename normalization."""

import unicodedata

from app.filenames import (
    FILENAME_PLACEHOLDER,
    MAX_FILENAME_LENGTH,
    sanitize_upload_filename,
)


def test_ordinary_filenames_round_trip_unchanged() -> None:
    for name in (
        "slide.tif",
        "Liver biopsy 2024.svs",
        "H&E stain (case 12).tiff",
        "échantillon rénal.png",
        "case.1.final.jpeg",
        "标本.tif",
    ):
        assert sanitize_upload_filename(name) == name


def test_path_components_are_dropped() -> None:
    assert sanitize_upload_filename("../../etc/passwd.tif") == "passwd.tif"
    assert sanitize_upload_filename("/var/tmp/slide.tif") == "slide.tif"
    assert sanitize_upload_filename(r"C:\Users\me\slide.tif") == "slide.tif"
    assert sanitize_upload_filename("dir/") == FILENAME_PLACEHOLDER


def test_control_characters_and_newlines_are_stripped() -> None:
    assert sanitize_upload_filename("slide\n.tif") == "slide .tif"
    assert sanitize_upload_filename("sli\x00de.tif") == "slide.tif"
    assert sanitize_upload_filename("a\tb\r\nc.tif") == "a b c.tif"


def test_whitespace_is_collapsed_and_trimmed() -> None:
    assert sanitize_upload_filename("  spaced   out .tif  ") == "spaced out .tif"


def test_markup_is_preserved_as_plain_text() -> None:
    # Ingestion stores a clean plain-text name; renderers escape.
    assert (
        sanitize_upload_filename("<img src=x onerror=alert(1)>.tif")
        == "<img src=x onerror=alert(1)>.tif"
    )


def test_unicode_is_nfc_normalized() -> None:
    decomposed = unicodedata.normalize("NFD", "café.tif")
    assert sanitize_upload_filename(decomposed) == "café.tif"


def test_truncated_to_column_limit() -> None:
    long_name = "a" * 600 + ".tif"
    result = sanitize_upload_filename(long_name)
    assert len(result) == MAX_FILENAME_LENGTH
    assert result == "a" * MAX_FILENAME_LENGTH


def test_placeholder_when_nothing_usable_remains() -> None:
    assert sanitize_upload_filename(None) == FILENAME_PLACEHOLDER
    assert sanitize_upload_filename("") == FILENAME_PLACEHOLDER
    assert sanitize_upload_filename("   ") == FILENAME_PLACEHOLDER
    assert sanitize_upload_filename("\x00\x01") == FILENAME_PLACEHOLDER
    assert sanitize_upload_filename("..") == FILENAME_PLACEHOLDER
    assert sanitize_upload_filename(".") == FILENAME_PLACEHOLDER


def test_custom_max_length_and_placeholder() -> None:
    assert sanitize_upload_filename("abcdef.tif", max_length=3) == "abc"
    assert sanitize_upload_filename("", placeholder="none") == "none"
