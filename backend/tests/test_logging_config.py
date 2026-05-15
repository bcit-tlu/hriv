"""Tests for the structured JSON logging configuration."""

import json
import logging
from unittest.mock import patch

from app.logging_config import JSONFormatter, setup_logging


def test_json_formatter_produces_valid_json() -> None:
    formatter = JSONFormatter()
    record = logging.LogRecord(
        name="test.logger",
        level=logging.INFO,
        pathname="test.py",
        lineno=1,
        msg="hello %s",
        args=("world",),
        exc_info=None,
    )
    output = formatter.format(record)
    parsed = json.loads(output)
    assert parsed["level"] == "INFO"
    assert parsed["logger"] == "test.logger"
    assert parsed["message"] == "hello world"
    assert "timestamp" in parsed


def test_json_formatter_includes_extra_fields() -> None:
    formatter = JSONFormatter()
    record = logging.LogRecord(
        name="test.logger",
        level=logging.WARNING,
        pathname="test.py",
        lineno=1,
        msg="event occurred",
        args=(),
        exc_info=None,
    )
    record.event = "test.event"  # type: ignore[attr-defined]
    record.source_image_id = 42  # type: ignore[attr-defined]
    output = formatter.format(record)
    parsed = json.loads(output)
    assert parsed["event"] == "test.event"
    assert parsed["source_image_id"] == 42


def test_json_formatter_includes_request_id() -> None:
    formatter = JSONFormatter()
    record = logging.LogRecord(
        name="test.logger",
        level=logging.INFO,
        pathname="test.py",
        lineno=1,
        msg="test",
        args=(),
        exc_info=None,
    )
    with patch("app.middleware.request_id_ctx") as mock_ctx:
        mock_ctx.get.return_value = "abc-123"
        output = formatter.format(record)
    parsed = json.loads(output)
    assert parsed["request_id"] == "abc-123"


def test_json_formatter_excludes_empty_request_id() -> None:
    formatter = JSONFormatter()
    record = logging.LogRecord(
        name="test.logger",
        level=logging.INFO,
        pathname="test.py",
        lineno=1,
        msg="test",
        args=(),
        exc_info=None,
    )
    with patch("app.middleware.request_id_ctx") as mock_ctx:
        mock_ctx.get.return_value = ""
        output = formatter.format(record)
    parsed = json.loads(output)
    assert "request_id" not in parsed


def test_json_formatter_includes_exception_info() -> None:
    formatter = JSONFormatter()
    try:
        raise ValueError("boom")
    except ValueError:
        import sys
        exc_info = sys.exc_info()
    record = logging.LogRecord(
        name="test.logger",
        level=logging.ERROR,
        pathname="test.py",
        lineno=1,
        msg="error",
        args=(),
        exc_info=exc_info,
    )
    output = formatter.format(record)
    parsed = json.loads(output)
    assert "exception" in parsed
    assert "ValueError" in parsed["exception"]


def test_setup_logging_configures_root_logger() -> None:
    # Save original handlers
    root = logging.getLogger()
    original_handlers = root.handlers[:]
    original_level = root.level
    try:
        setup_logging(level=logging.DEBUG)
        assert root.level == logging.DEBUG
        # At minimum the JSON StreamHandler must be present
        json_handlers = [
            h for h in root.handlers if isinstance(h.formatter, JSONFormatter)
        ]
        assert len(json_handlers) == 1

        # Check third-party loggers are quieted
        assert logging.getLogger("uvicorn").level == logging.WARNING
        assert logging.getLogger("sqlalchemy.engine").level == logging.WARNING
    finally:
        # Restore original state
        root.handlers = original_handlers
        root.setLevel(original_level)


def test_setup_logging_preserves_otel_handler() -> None:
    """OTEL LoggingHandler survives the handler reset in setup_logging()."""
    root = logging.getLogger()
    original_handlers = root.handlers[:]
    original_level = root.level

    # Create a fake handler whose type lives in an "opentelemetry" module,
    # simulating the real opentelemetry.sdk._logs.LoggingHandler.
    fake_otel_handler = logging.Handler()
    fake_otel_handler.__class__ = type(
        "LoggingHandler", (logging.Handler,), {"__module__": "opentelemetry.sdk._logs"}
    )
    root.addHandler(fake_otel_handler)

    try:
        setup_logging(level=logging.INFO)

        # The fake OTEL handler must still be attached
        assert fake_otel_handler in root.handlers

        # The JSON StreamHandler must also be present
        json_handlers = [
            h for h in root.handlers if isinstance(h.formatter, JSONFormatter)
        ]
        assert len(json_handlers) == 1

        # Exactly 2 handlers: JSON stdout + OTEL
        assert len(root.handlers) == 2
    finally:
        root.handlers = original_handlers
        root.setLevel(original_level)


def test_setup_logging_without_otel_handler() -> None:
    """When no OTEL handler is present, only the JSON StreamHandler remains."""
    root = logging.getLogger()
    original_handlers = root.handlers[:]
    original_level = root.level

    # Add a plain non-OTEL handler that should be removed
    stale_handler = logging.StreamHandler()
    root.addHandler(stale_handler)

    try:
        setup_logging(level=logging.INFO)

        assert stale_handler not in root.handlers
        assert len(root.handlers) == 1
        assert isinstance(root.handlers[0].formatter, JSONFormatter)
    finally:
        root.handlers = original_handlers
        root.setLevel(original_level)
