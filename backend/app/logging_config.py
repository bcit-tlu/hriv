"""Structured JSON logging configuration for the Corgi backend.

Emits newline-delimited JSON (NDJSON) to stdout so that cluster operators can
easily differentiate application logs from nginx access logs and feed them
into log aggregation pipelines (e.g. Loki, Elasticsearch, CloudWatch).

Each log record is a single JSON object with at minimum:
  - timestamp  (ISO-8601 with timezone)
  - level      (DEBUG / INFO / WARNING / ERROR / CRITICAL)
  - logger     (Python logger name, e.g. "app.processing")
  - message    (human-readable description)

Additional contextual fields are included when the caller passes them via
the ``extra`` dict on standard logging calls, for example:

    logger.info("Upload complete", extra={"event": "image.uploaded", "source_image_id": 42})
"""

import json
import logging
import sys
from datetime import datetime, timezone


class JSONFormatter(logging.Formatter):
    """Format log records as single-line JSON objects."""

    def format(self, record: logging.LogRecord) -> str:
        log_entry: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(
                record.created, tz=timezone.utc
            ).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        # Promote well-known extra fields to top level
        _EXTRA_KEYS = {
            "event",
            "source_image_id",
            "image_id",
            "job_id",
            "filename",
            "category_id",
            "user_id",
            "user_email",
            "duration_ms",
            "total_count",
            "completed_count",
            "failed_count",
            "detail",
        }
        for key in _EXTRA_KEYS:
            value = getattr(record, key, None)
            if value is not None:
                log_entry[key] = value

        # Include exception info if present
        if record.exc_info and record.exc_info[1] is not None:
            log_entry["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_entry, default=str)


def setup_logging(level: int = logging.INFO) -> None:
    """Configure the root logger to emit structured JSON to stdout.

    This should be called once at application startup (before any other
    logging calls).  It:

    1. Replaces the root logger's handlers with a single ``StreamHandler``
       that writes JSON to ``sys.stdout``.
    2. Quiets noisy third-party loggers (uvicorn, sqlalchemy) to WARNING
       so that operator-relevant application logs are not drowned out.
    3. Configures uvicorn's access logger to also emit JSON so that all
       stdout output from the container is consistently machine-parseable.
    """
    root = logging.getLogger()
    root.setLevel(level)

    # Remove any pre-existing handlers (e.g. from basicConfig)
    for handler in root.handlers[:]:
        root.removeHandler(handler)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())
    root.addHandler(handler)

    # Quiet third-party loggers
    logging.getLogger("uvicorn").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

    # Ensure uvicorn's access log also uses our JSON formatter when it
    # does emit (e.g. on errors).
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uv_logger = logging.getLogger(name)
        uv_logger.handlers.clear()
        uv_logger.addHandler(handler)
        uv_logger.propagate = False
