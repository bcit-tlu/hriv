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
WORKDIR /app
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

# ── Stage 3: Development (hot-reload, used by docker compose)
FROM base AS dev
RUN pip install --no-cache-dir 'pytest>=8.3.3,<9' 'pytest-asyncio>=0.24.0,<0.25' 'pytest-cov>=5.0.0,<6'
# Wrap with ``opentelemetry-instrument`` for parity with the prod stage so
# developers can exercise the OTel auto-instrumentation pipeline locally
# just by overriding ``OTEL_TRACES_EXPORTER``/``OTEL_EXPORTER_OTLP_ENDPOINT``
# in their ``backend/.env``.  With the defaults baked into the SDK
# (``OTEL_TRACES_EXPORTER=none`` etc.), the wrapper is effectively a no-op
# at startup and adds no runtime overhead.
CMD ["opentelemetry-instrument", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ── Stage 4: Production ─────────────────────────────────
FROM base AS prod
EXPOSE 8000
# Use --workers 1 and scale horizontally via Kubernetes replicas
# (charts/backend/values.yaml: replicaCount).  OpenTelemetry auto-instrumentation
# initialises SDK state (exporter connections, batch processors) in the parent
# process before uvicorn's multi-worker fork, which can corrupt gRPC/HTTP
# exporter connections and produce duplicate/lost telemetry in forked children.
CMD ["opentelemetry-instrument", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
