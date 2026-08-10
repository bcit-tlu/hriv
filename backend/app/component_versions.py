"""Helpers for resolving deployed component versions and build identifiers."""

from __future__ import annotations

import os
import re

_RC_TAG_RE = re.compile(r"-rc\.\d{14}\.(?P<sha>[0-9a-f]{7,40})$")
_SHA_TAG_RE = re.compile(r"^sha-(?P<sha>[0-9a-f]{7,40})$")


def _read_text_file(path: str | None) -> str | None:
    if not path:
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            value = handle.read().strip()
    except OSError:
        return None
    return value or None


def _coerce(value: str | None, default: str) -> str:
    if value is None:
        return default
    stripped = value.strip()
    return stripped or default


def _extract_commit_sha(tag: str | None) -> str | None:
    if not tag:
        return None
    value = tag.strip()
    if not value:
        return None

    sha_match = _SHA_TAG_RE.match(value)
    if sha_match:
        return sha_match.group("sha")

    rc_match = _RC_TAG_RE.search(value)
    if rc_match:
        return rc_match.group("sha")

    return None


def _resolve_commit_sha(*candidates: str | None) -> str:
    for candidate in candidates:
        if candidate and candidate.strip():
            return candidate.strip()
    return "unknown"


def get_backend_version() -> str:
    return _coerce(os.environ.get("APP_VERSION"), "dev")


def get_worker_version() -> str:
    return _coerce(os.environ.get("WORKER_VERSION"), get_backend_version())


def get_backup_version() -> str:
    return _coerce(
        _read_text_file(os.environ.get("BACKUP_VERSION_FILE")) or os.environ.get("BACKUP_VERSION"),
        "dev",
    )


def get_frontend_version() -> str:
    return _coerce(
        _read_text_file(os.environ.get("FRONTEND_VERSION_FILE")) or os.environ.get("FRONTEND_VERSION"),
        "unknown",
    )


def get_synthetic_version(latest_known: str | None = None) -> str:
    return _coerce(latest_known or os.environ.get("SYNTHETIC_VERSION"), "unknown")


def get_backend_commit_sha() -> str:
    return _resolve_commit_sha(
        _coerce(os.environ.get("APP_COMMIT_SHA"), "").strip() or None,
        _extract_commit_sha(os.environ.get("APP_IMAGE_TAG")),
    )


def get_worker_commit_sha() -> str:
    return _resolve_commit_sha(
        _coerce(os.environ.get("WORKER_COMMIT_SHA"), "").strip() or None,
        _extract_commit_sha(os.environ.get("WORKER_IMAGE_TAG") or os.environ.get("APP_IMAGE_TAG")),
    )


def get_backup_commit_sha() -> str:
    return _resolve_commit_sha(
        _coerce(os.environ.get("BACKUP_COMMIT_SHA"), "").strip() or None,
        _extract_commit_sha(
            _read_text_file(os.environ.get("BACKUP_IMAGE_TAG_FILE")) or os.environ.get("BACKUP_IMAGE_TAG")
        ),
    )


def get_frontend_commit_sha() -> str:
    return _resolve_commit_sha(
        _coerce(os.environ.get("FRONTEND_COMMIT_SHA"), "").strip() or None,
        _extract_commit_sha(
            _read_text_file(os.environ.get("FRONTEND_IMAGE_TAG_FILE")) or os.environ.get("FRONTEND_IMAGE_TAG")
        ),
    )


def get_synthetic_commit_sha() -> str:
    return _resolve_commit_sha(
        _coerce(os.environ.get("SYNTHETIC_COMMIT_SHA"), "").strip() or None,
        _extract_commit_sha(os.environ.get("SYNTHETIC_IMAGE_TAG")),
    )
