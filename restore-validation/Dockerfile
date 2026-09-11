FROM python:3.13-slim-trixie AS stable

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OTEL_TRACES_EXPORTER=none \
    OTEL_METRICS_EXPORTER=none \
    OTEL_LOGS_EXPORTER=none \
    HOME=/nonexistent
WORKDIR /app
RUN pip install --no-cache-dir poetry==2.1.3 \
    && poetry config virtualenvs.create false
COPY pyproject.toml poetry.lock ./
RUN poetry install --only main --no-root --no-interaction \
    && addgroup --system --gid 65532 hriv \
    && adduser --system --uid 65532 --ingroup hriv --home /nonexistent --no-create-home hriv
COPY --chown=65532:65532 hriv_restore_validation ./hriv_restore_validation
COPY --chown=65532:65532 THIRD-PARTY-LICENSES.txt ./THIRD-PARTY-LICENSES.txt
USER 65532:65532
ENTRYPOINT ["opentelemetry-instrument", "python", "-m", "hriv_restore_validation.cli"]
CMD ["run"]
