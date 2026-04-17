# ── Stage 0: Poetry tooling (shared by builder + ``backend_poetry``) ─
# Standalone venv with poetry + poetry-plugin-export.  Reused by:
#   * ``builder`` below (via COPY --from=poetry-tools), so poetry is
#     installed exactly once across a full ``docker compose build``.
#   * ``backend_poetry`` in docker-compose.yml (``profiles: [tools]``)
#     which mounts the source tree and runs poetry commands directly.
# Because ``builder`` depends on this stage, BuildKit AND non-BuildKit
# Docker both treat it as a real dependency rather than a leaf — no
# wasted build work even when targeting ``prod`` directly.
FROM python:3.13-slim AS poetry-tools
# No WORKDIR here: this stage only ships a venv at /opt/poetry-venv that is
# consumed by ``builder`` via COPY --from=poetry-tools, and by the
# ``backend_poetry`` docker-compose service which sets its own
# ``working_dir: /app`` at runtime.  An image-baked WORKDIR would be
# redundant (builder/backend_poetry both override it) and misleading.
RUN python -m venv /opt/poetry-venv \
    && /opt/poetry-venv/bin/pip install --no-cache-dir poetry poetry-plugin-export

# ── Stage 1: Builder (install deps, then discarded) ──────
FROM python:3.13-slim AS builder
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       libvips-dev pkg-config gcc \
    && rm -rf /var/lib/apt/lists/*

# Reuse the poetry venv built in the ``poetry-tools`` stage instead of
# installing poetry+poetry-plugin-export a second time.  Saves ~30s of
# pip install on every full build with no behavioural change.
COPY --from=poetry-tools /opt/poetry-venv /opt/poetry-venv

COPY pyproject.toml poetry.lock ./
RUN /opt/poetry-venv/bin/poetry export --only main -f requirements.txt -o requirements.txt \
    && pip install --no-cache-dir -r requirements.txt

# ── Stage 2: Runtime base (slim, no compiler or dev headers) ─
FROM python:3.13-slim AS base
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libvips42t64 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/lib/python3.13/site-packages /usr/local/lib/python3.13/site-packages
COPY --from=builder /usr/local/bin/uvicorn /usr/local/bin/arq /usr/local/bin/alembic /usr/local/bin/opentelemetry-instrument /usr/local/bin/

COPY app ./app
COPY alembic.ini ./alembic.ini

# ── OpenTelemetry disable-by-default ────────────────────────
# ``opentelemetry-distro`` (via OpenTelemetryDistro._configure) calls
# ``os.environ.setdefault(OTEL_*_EXPORTER, "otlp")`` and
# ``os.environ.setdefault(OTEL_EXPORTER_OTLP_PROTOCOL, "grpc")`` at import
# time.  Without the defaults below, running the image without explicit
# OTEL_* configuration would make the SDK attempt a gRPC connection to the
# hard-coded default ``localhost:4317`` on every startup — producing
# connection-error log noise and idle batch processors.  We pin the
# exporters to ``none`` at the image level so that:
#
#   * ``opentelemetry-instrument`` on the dev/prod CMDs is a true no-op
#     unless telemetry is explicitly enabled;
#   * the migration container (``docker-compose migrate`` and the Helm
#     ``initContainers: [migrate]`` entry) — which runs ``python -m
#     app.migrations_bootstrap`` directly without the wrapper — still
#     inherits safe defaults;
#   * the Helm chart activates telemetry by overriding these env vars
#     from the container's ``env:`` block when ``.Values.otel.enabled`` is
#     true, which always wins over ``ENV`` defaults in the image.
ENV OTEL_TRACES_EXPORTER=none \
    OTEL_METRICS_EXPORTER=none \
    OTEL_LOGS_EXPORTER=none

# ── Stage 3: Development (hot-reload, used by docker compose)
FROM base AS dev
RUN pip install --no-cache-dir 'pytest>=8.3.3,<9' 'pytest-asyncio>=0.24.0,<0.25' 'pytest-cov>=5.0.0,<6'
# Wrap with ``opentelemetry-instrument`` for parity with the prod stage so
# developers can exercise the OTel auto-instrumentation pipeline locally
# just by overriding ``OTEL_TRACES_EXPORTER``/``OTEL_EXPORTER_OTLP_ENDPOINT``
# in their ``backend/.env``.  The base stage pins all exporters to
# ``none`` (see above), so the wrapper is a true no-op at startup and adds
# no runtime overhead until the developer opts in.
CMD ["opentelemetry-instrument", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ── Stage 4: Production ─────────────────────────────────
FROM base AS prod
EXPOSE 8000
# Run uvicorn in single-process mode (--workers 1) and scale horizontally
# via Kubernetes replicas (charts/backend/values.yaml: replicaCount)
# instead of uvicorn's multi-worker mode.
#
# Why single-process: with --workers 1 uvicorn takes its single-process
# code path entirely (the Multiprocess manager is only started when
# ``config.workers > 1``), so there is no fork/spawn of worker children
# at all.  This is the OTel-safe configuration: ``opentelemetry-instrument``
# initialises the SDK (exporter connections, batch processors, gRPC
# channels, background threads) in the parent process at startup, and
# those stateful resources are not safe to inherit across fork.  If we
# ran --workers >1, uvicorn would spawn worker children that inherit
# the already-initialised exporter state from the parent, which can
# corrupt gRPC/HTTP exporter connections and produce duplicate or lost
# telemetry.  --workers 1 avoids the problem by never forking.
CMD ["opentelemetry-instrument", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
