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
        assert len(root.handlers) == 1
        assert isinstance(root.handlers[0].formatter, JSONFormatter)

        # Check third-party loggers are quieted
        assert logging.getLogger("uvicorn").level == logging.WARNING
        assert logging.getLogger("sqlalchemy.engine").level == logging.WARNING
    finally:
        # Restore original state
        root.handlers = original_handlers
        root.setLevel(original_level)
