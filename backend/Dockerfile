# ── Stage 1: Builder (install deps, then discarded) ──────
FROM python:3.13-slim AS builder
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       libvips-dev pkg-config gcc \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir poetry \
    && poetry config virtualenvs.create false

COPY pyproject.toml poetry.lock ./
RUN poetry install --only main --no-root --no-interaction

# ── Stage 2: Runtime base (slim, no compiler or dev headers) ─
FROM python:3.13-slim AS base
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libvips42t64 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/lib/python3.13/site-packages /usr/local/lib/python3.13/site-packages
COPY --from=builder /usr/local/bin/uvicorn /usr/local/bin/uvicorn

COPY app ./app

# ── Stage 3: Development (hot-reload, used by docker compose)
FROM base AS dev
RUN pip install --no-cache-dir pytest pytest-asyncio pytest-cov
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ── Stage 4: Production ─────────────────────────────────
FROM base AS prod
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
