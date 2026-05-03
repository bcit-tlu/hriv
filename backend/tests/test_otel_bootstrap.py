"""Tests for the OTEL bootstrap module (app.otel_bootstrap)."""

from unittest.mock import MagicMock, patch


def test_noop_when_sdk_already_configured() -> None:
    """_bootstrap() does nothing when a real TracerProvider is set."""
    from app.otel_bootstrap import _bootstrap

    mock_provider = MagicMock()  # not a ProxyTracerProvider
    env = {"OTEL_TRACES_EXPORTER": "console"}
    with (
        patch("app.otel_bootstrap.trace.get_tracer_provider", return_value=mock_provider),
        patch.dict("os.environ", env, clear=True),
        patch(
            "opentelemetry.instrumentation.auto_instrumentation.initialize"
        ) as mock_init,
    ):
        _bootstrap()

    # Provider is not ProxyTracerProvider → early return, initialize never called.
    mock_init.assert_not_called()


def test_noop_when_all_exporters_none() -> None:
    """_bootstrap() does nothing when all exporters are 'none'."""
    from opentelemetry import trace

    from app.otel_bootstrap import _bootstrap

    proxy = trace.ProxyTracerProvider()
    env = {
        "OTEL_TRACES_EXPORTER": "none",
        "OTEL_METRICS_EXPORTER": "none",
        "OTEL_LOGS_EXPORTER": "none",
    }
    with (
        patch("app.otel_bootstrap.trace.get_tracer_provider", return_value=proxy),
        patch.dict("os.environ", env, clear=True),
    ):
        # Should return without calling initialize
        _bootstrap()


def test_noop_when_exporters_missing_from_env() -> None:
    """_bootstrap() treats missing exporter env vars as 'none' (default)."""
    from opentelemetry import trace

    from app.otel_bootstrap import _bootstrap

    proxy = trace.ProxyTracerProvider()
    with (
        patch("app.otel_bootstrap.trace.get_tracer_provider", return_value=proxy),
        patch.dict("os.environ", {}, clear=True),
    ):
        _bootstrap()


def test_calls_initialize_when_sdk_missing_and_exporter_set() -> None:
    """_bootstrap() calls initialize() when SDK is not configured but OTEL is desired."""
    from opentelemetry import trace

    from app.otel_bootstrap import _bootstrap

    proxy = trace.ProxyTracerProvider()
    env = {"OTEL_TRACES_EXPORTER": "console"}
    with (
        patch("app.otel_bootstrap.trace.get_tracer_provider", return_value=proxy),
        patch.dict("os.environ", env, clear=True),
        patch(
            "opentelemetry.instrumentation.auto_instrumentation.initialize"
        ) as mock_init,
    ):
        _bootstrap()

    mock_init.assert_called_once()


def test_swallows_initialize_exception() -> None:
    """_bootstrap() never raises even if initialize() fails."""
    from opentelemetry import trace

    from app.otel_bootstrap import _bootstrap

    proxy = trace.ProxyTracerProvider()
    env = {"OTEL_TRACES_EXPORTER": "otlp"}
    with (
        patch("app.otel_bootstrap.trace.get_tracer_provider", return_value=proxy),
        patch.dict("os.environ", env, clear=True),
        patch(
            "opentelemetry.instrumentation.auto_instrumentation.initialize",
            side_effect=RuntimeError("boom"),
        ),
    ):
        # Must not raise
        _bootstrap()


def test_triggers_on_metrics_exporter() -> None:
    """_bootstrap() activates when only OTEL_METRICS_EXPORTER is non-none."""
    from opentelemetry import trace

    from app.otel_bootstrap import _bootstrap

    proxy = trace.ProxyTracerProvider()
    env = {
        "OTEL_TRACES_EXPORTER": "none",
        "OTEL_METRICS_EXPORTER": "console",
        "OTEL_LOGS_EXPORTER": "none",
    }
    with (
        patch("app.otel_bootstrap.trace.get_tracer_provider", return_value=proxy),
        patch.dict("os.environ", env, clear=True),
        patch(
            "opentelemetry.instrumentation.auto_instrumentation.initialize"
        ) as mock_init,
    ):
        _bootstrap()

    mock_init.assert_called_once()
