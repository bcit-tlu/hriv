from __future__ import annotations

import json
import math
import re
from typing import Any

MAX_DOCUMENT_BYTES = 512 * 1024
DNS_RE = re.compile(r"^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$")
RFC3339_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$")
LSN_RE = re.compile(r"^[0-9A-Fa-f]{1,8}/[0-9A-Fa-f]{1,8}$")
UID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class ValidationError(ValueError):
    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(f"{code}: {message}" if message else code)
        self.code = code


def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValidationError("DUPLICATE_KEY", key)
        result[key] = value
    return result


def parse_json(raw: str | bytes, *, max_bytes: int = MAX_DOCUMENT_BYTES) -> Any:
    encoded = raw if isinstance(raw, bytes) else raw.encode("utf-8")
    if len(encoded) > max_bytes:
        raise ValidationError("DOCUMENT_TOO_LARGE")
    try:
        text = encoded.decode("utf-8")
        value = json.loads(
            text,
            object_pairs_hook=_pairs,
            parse_constant=lambda value: (_ for _ in ()).throw(
                ValidationError("NONFINITE_NUMBER", value)
            ),
        )
    except UnicodeDecodeError as exc:
        raise ValidationError("INVALID_UTF8") from exc
    except json.JSONDecodeError as exc:
        raise ValidationError("INVALID_JSON") from exc
    _reject_nonfinite(value)
    return value


def _reject_nonfinite(value: Any) -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise ValidationError("NONFINITE_NUMBER")
    if isinstance(value, dict):
        for item in value.values():
            _reject_nonfinite(item)
    elif isinstance(value, list):
        for item in value:
            _reject_nonfinite(item)


def exact_object(value: Any, *, required: set[str], optional: set[str] = set()) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValidationError("SCHEMA_INVALID", "object required")
    keys = set(value)
    if not required <= keys or keys - required - optional:
        raise ValidationError("SCHEMA_INVALID", "unexpected or missing field")
    return value


def bounded_string(value: Any, name: str, maximum: int = 256, pattern: re.Pattern[str] | None = None) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise ValidationError("SCHEMA_INVALID", name)
    if pattern is not None and pattern.fullmatch(value) is None:
        raise ValidationError("SCHEMA_INVALID", name)
    return value


def integer(value: Any, name: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValidationError("SCHEMA_INVALID", name)
    return value


def canonical_json(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    if len(raw.encode()) > MAX_DOCUMENT_BYTES:
        raise ValidationError("STATE_SIZE_EXCEEDED")
    return raw
