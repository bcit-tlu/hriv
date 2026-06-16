"""Shared OpenTelemetry helpers."""

from fastapi import HTTPException
from opentelemetry.trace import Span, StatusCode


def record_exception_if_server_error(span: Span, exc: Exception) -> None:
    """Record an exception on a span only when it represents a server error.

    4xx ``HTTPException`` instances are expected application behaviour (not-found,
    conflict, bad-request) and should not inflate error metrics in observability
    dashboards.  Only 5xx ``HTTPException`` instances and non-HTTP exceptions are
    recorded as span errors.
    """
    if isinstance(exc, HTTPException) and exc.status_code < 500:
        return
    span.record_exception(exc)
    span.set_status(StatusCode.ERROR, str(exc))
