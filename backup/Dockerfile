# HRIV Disaster Recovery Backup Service
#
# Base: python:3.13-slim-trixie (Debian 13). Trixie ships libraries
# that moved past the zlib/sqlite/expat/openssl CVEs still present in
# bookworm (notably CVE-2023-45853 zlib minizip and CVE-2025-7458
# libsqlite3 — both criticals for this image) and receives security
# updates directly from Debian's trixie-security mirror.
FROM python:3.13-slim-trixie

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

RUN pip install --no-cache-dir poetry \
    && poetry config virtualenvs.create false

COPY pyproject.toml poetry.lock* ./
RUN poetry install --no-root --no-interaction

COPY backup.py ./

# Default: run on cron schedule
ENTRYPOINT ["python", "backup.py"]
CMD ["cron"]
