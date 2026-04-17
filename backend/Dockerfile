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

RUN python -m venv /opt/poetry-venv \
    && /opt/poetry-venv/bin/pip install --no-cache-dir poetry poetry-plugin-export

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
COPY --from=builder /usr/local/bin/uvicorn /usr/local/bin/arq /usr/local/bin/opentelemetry-instrument /usr/local/bin/

COPY app ./app

# ── Stage 3: Development (hot-reload, used by docker compose)
FROM base AS dev
RUN pip install --no-cache-dir 'pytest>=8.3.3,<9' 'pytest-asyncio>=0.24.0,<0.25' 'pytest-cov>=5.0.0,<6'
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ── Stage 4: Production ─────────────────────────────────
FROM base AS prod
EXPOSE 8000
CMD ["opentelemetry-instrument", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
