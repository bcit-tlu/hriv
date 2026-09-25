# Multi-stage layout: ``builder`` resolves poetry.lock into a
# requirements.txt (with a poetry version new enough to clear
# CVE-2026-34591) and pip-installs it into ``/install``; the ``stable``
# runtime stage copies that prefix into ``/usr/local`` and ships only the
# pinned runtime deps — no poetry (and none of its dependencies like
# dulwich/msgpack/setuptools) in the final image.
FROM python:3.13-slim-trixie AS builder
RUN python -m venv /opt/poetry-venv \
    && /opt/poetry-venv/bin/pip install --no-cache-dir 'poetry==2.4.3' poetry-plugin-export
WORKDIR /app
COPY pyproject.toml poetry.lock ./
RUN /opt/poetry-venv/bin/poetry export --only main -f requirements.txt -o requirements.txt \
    && pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.13-slim-trixie AS stable

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OTEL_TRACES_EXPORTER=none \
    OTEL_METRICS_EXPORTER=none \
    OTEL_LOGS_EXPORTER=none \
    HOME=/nonexistent
WORKDIR /app

# Pick up any trixie-security patches published since the base-image
# digest was built.
RUN apt-get update \
    && apt-get -y upgrade \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local

# pip is only needed to install packages (done in ``builder``); nothing in
# the shipped image invokes it.  Its vendored copies of
# msgpack/setuptools (pip/_vendor/vendor.txt) carry open Trivy
# CRITICAL/HIGH findings that pip upgrades cannot clear (the newest pip
# still vendors them), so we drop pip from the image entirely.
RUN python -m pip uninstall -y pip \
    && addgroup --system --gid 65532 hriv \
    && adduser --system --uid 65532 --ingroup hriv --home /nonexistent --no-create-home hriv
COPY --chown=65532:65532 hriv_restore_validation ./hriv_restore_validation
COPY --chown=65532:65532 THIRD-PARTY-LICENSES.txt ./THIRD-PARTY-LICENSES.txt
USER 65532:65532
ENTRYPOINT ["opentelemetry-instrument", "python", "-m", "hriv_restore_validation.cli"]
CMD ["run"]
