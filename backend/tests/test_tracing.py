"""Tests for app.tracing helpers."""

from unittest.mock import MagicMock

from fastapi import HTTPException

from app.tracing import record_exception_if_server_error


def _make_span() -> MagicMock:
    return MagicMock()


def test_skips_4xx_http_exceptions():
    for status in (400, 401, 403, 404, 409, 422):
        span = _make_span()
        exc = HTTPException(status_code=status, detail="client error")
        record_exception_if_server_error(span, exc)
        span.record_exception.assert_not_called()
        span.set_status.assert_not_called()


def test_records_5xx_http_exceptions():
    for status in (500, 502, 503):
        span = _make_span()
        exc = HTTPException(status_code=status, detail="server error")
        record_exception_if_server_error(span, exc)
        span.record_exception.assert_called_once_with(exc)
        span.set_status.assert_called_once()


def test_records_non_http_exceptions():
    span = _make_span()
    exc = RuntimeError("unexpected")
    record_exception_if_server_error(span, exc)
    span.record_exception.assert_called_once_with(exc)
    span.set_status.assert_called_once()
