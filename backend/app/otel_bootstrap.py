"""Re-run the OpenTelemetry auto-instrumentation bootstrap inside the app.

``opentelemetry-instrument`` configures the SDK (TracerProvider, exporters,
auto-instrumentors) in the *parent* process, but uvicorn's ``--reload``
flag spawns a **child** subprocess that starts a fresh Python interpreter
without that configuration.  The child inherits the ``OTEL_*`` environment
variables but never runs the SDK setup, so:

* ``trace.get_tracer_provider()`` returns a ``ProxyTracerProvider`` (no-op)
* ``inject(carrier)`` produces an empty dict (no W3C traceparent header)
* All auto-instrumentors (FastAPI, SQLAlchemy, Redis, httpx) are inactive

This module detects that situation and re-runs the same
``initialize()`` entry-point that ``opentelemetry-instrument`` itself uses,
closing the gap so trace-context propagation and auto-instrumentation work
identically in development (``--reload``) and production (``--workers 1``).

When the SDK has **already** been configured — e.g. in production where
``opentelemetry-instrument`` runs the app directly without ``--reload`` —
this module is a no-op.

Import this module **before** creating the FastAPI application so that
instrumentor hooks are installed before framework objects are instantiated::

    import app.otel_bootstrap  # noqa: F401  — side-effect: configure OTEL SDK
"""

from __future__ import annotations

import logging
import os

from opentelemetry import trace

logger = logging.getLogger(__name__)


def _bootstrap() -> None:
    # Already configured by opentelemetry-instrument → nothing to do.
    if not isinstance(trace.get_tracer_provider(), trace.ProxyTracerProvider):
        return

    # All exporters disabled → keep the zero-overhead no-op tracer.
    if all(
        os.environ.get(k, "none") == "none"
        for k in ("OTEL_TRACES_EXPORTER", "OTEL_METRICS_EXPORTER", "OTEL_LOGS_EXPORTER")
    ):
        return

    try:
        from opentelemetry.instrumentation.auto_instrumentation import initialize

        initialize()
        logger.debug(
            "OpenTelemetry SDK bootstrapped by app (uvicorn --reload child)",
            extra={"event": "otel.bootstrap"},
        )
    except Exception:
        # OTEL is strictly optional; never prevent the application from starting.
        logger.debug("OpenTelemetry bootstrap skipped", exc_info=True)


_bootstrap()
