# HRIV Disaster Recovery Backup Service
#
# Base: python:3.13-slim-trixie (Debian 13). Trixie ships libraries
# that moved past the zlib/sqlite/expat/openssl CVEs still present in
# bookworm (notably CVE-2023-45853 zlib minizip and CVE-2025-7458
# libsqlite3 — both criticals for this image) and receives security
# updates directly from Debian's trixie-security mirror.
#
# Multi-stage layout: a ``builder`` stage resolves the poetry.lock into a
# requirements.txt and pip-installs it into ``/install``; the ``stable``
# runtime stage copies that prefix into ``/usr/local`` and ships only the
# pinned runtime deps — no poetry (and none of its dependencies like
# dulwich/msgpack/setuptools) in the final image.  The ``stable`` target
# name is kept so `.github/workflows/ci.yaml` can share the same
# `target: stable` matrix entry across all three components.
FROM python:3.13-slim-trixie AS builder
RUN python -m venv /opt/poetry-venv \
    && /opt/poetry-venv/bin/pip install --no-cache-dir poetry poetry-plugin-export
WORKDIR /app
COPY pyproject.toml poetry.lock ./
RUN /opt/poetry-venv/bin/poetry export --only main -f requirements.txt -o requirements.txt \
    && pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.13-slim-trixie AS stable

WORKDIR /app

# Install PostgreSQL 16 client tools (pg_dump, psql) – pinned to match the
# postgres:16-alpine server image used by the db service.  PG 17's pg_dump
# emits SET transaction_timeout which PG 16 does not recognise, so we must
# use the matching major version.
#
# ``apt-get -y upgrade`` before the install pulls any trixie-security
# patches that have landed since the base-image digest was built, so
# each CI build of this image is at least as current as the Debian
# security mirror at build time (rather than as current as the last
# time the python docker-library rebuilt its base digest).
RUN apt-get update \
    && apt-get -y upgrade \
    && apt-get install -y --no-install-recommends \
       curl ca-certificates gnupg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt trixie-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-16 \
    && apt-get purge -y --auto-remove curl gnupg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local

# pip is only needed to install packages (done in ``builder``); nothing in
# the shipped image invokes it.  Its vendored copies of
# msgpack/setuptools (pip/_vendor/vendor.txt) carry open Trivy
# CRITICAL/HIGH findings that pip upgrades cannot clear (the newest pip
# still vendors them), so we drop pip from the image entirely.
RUN python -m pip uninstall -y pip

COPY backup.py ./
# Ship third-party license notices for the bundled Python packages.
COPY THIRD-PARTY-LICENSES.txt ./THIRD-PARTY-LICENSES.txt

# No build-time ``ARG APP_VERSION``. ``backup.py`` doesn't consume
# ``APP_VERSION`` at runtime — the backup version reported via
# ``/api/admin/version`` is published by this chart's
# ``version-configmap`` ConfigMap (read from the ``.Values.image.tag``
# the chart was rendered with, not baked into the image). Baking here
# would leak the main-build ``-rc.<short>`` identity into retag-promoted
# production images (see ``.github/workflows/release-retag.yaml``). The
# chart's Deployment template renders ``APP_VERSION`` as an env var for
# ``docker inspect`` / ``kubectl describe pod`` parity with the backend
# and frontend containers.

# ── OpenTelemetry disable-by-default ────────────────────────
# Mirror the backend's pattern: pin all OTEL exporters to ``none`` at
# the image level so ``opentelemetry-instrument`` is a true no-op
# unless the Helm chart overrides these env vars.  Without these
# defaults the distro would attempt gRPC connections to localhost:4317
# on every startup, producing connection-error noise.
ENV OTEL_TRACES_EXPORTER=none \
    OTEL_METRICS_EXPORTER=none \
    OTEL_LOGS_EXPORTER=none

# Default: run on cron schedule, wrapped by the OTEL auto-instrumentation
# agent so that Python logging is bridged to the OTEL logs pipeline when
# the chart enables ``otel.enabled``.
ENTRYPOINT ["opentelemetry-instrument", "python", "backup.py"]
CMD ["cron"]
