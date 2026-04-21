# ── Stage 0: Poetry tooling (shared by builder + ``backend_poetry``) ─
# Standalone venv with poetry + poetry-plugin-export.  Reused by:
#   * ``builder`` below (via COPY --from=poetry-tools), so poetry is
#     installed exactly once across a full ``docker compose build``.
#   * ``backend_poetry`` in docker-compose.yml (``profiles: [tools]``)
#     which mounts the source tree and runs poetry commands directly.
# Because ``builder`` depends on this stage, BuildKit AND non-BuildKit
# Docker both treat it as a real dependency rather than a leaf — no
# wasted build work even when targeting ``stable`` directly.
FROM python:3.13-slim AS poetry-tools
# No WORKDIR here: this stage only ships a venv at /opt/poetry-venv that is
# consumed by ``builder`` via COPY --from=poetry-tools, and by the
# ``backend_poetry`` docker-compose service which sets its own
# ``working_dir: /app`` at runtime.  An image-baked WORKDIR would be
# redundant (builder/backend_poetry both override it) and misleading.
RUN python -m venv /opt/poetry-venv \
    && /opt/poetry-venv/bin/pip install --no-cache-dir poetry poetry-plugin-export

# ── Stage 1a: libvips build (custom, slim delegate chain) ──
# The Debian ``libvips42t64`` package has hard ``Depends`` on
# ``libheif1``, ``libjxl0.11``, ``libopenexr-3-1-30``, ``libmatio13``,
# ``libpoppler-glib8t64``, ``libmagickcore-7.q16-10`` (which in turn
# hard-depends on ``libraw23t64``) and a handful of other codec
# libraries.  Those Depends cannot be purged post-install without
# breaking ``libvips.so.42`` symbol resolution (``libvips.so.42`` is
# directly linked against ``libmatio.so.13`` / ``libOpenEXR-3_1.so.30``
# by Debian's build).  HRIV only ever decodes TIFF/JPEG/PNG/WebP/GIF
# plus Aperio ``.svs`` (routed through libopenslide, which uses
# libtiff internally) — every one of those codecs is unreachable, so
# the only way to remove the CVE surface is to rebuild libvips with
# those delegates compiled out.
FROM python:3.13-slim AS libvips-build
ARG VIPS_VERSION=8.18.2
ARG VIPS_SHA256=a30d4aede16f1c2899c1a2241870f8a7409feafa38484bcdcdac113d6d6f8ff5
RUN apt-get update \
    && apt-get -y upgrade \
    && apt-get install -y --no-install-recommends \
       build-essential meson ninja-build pkg-config \
       ca-certificates curl xz-utils \
       libglib2.0-dev libexpat1-dev \
       libjpeg-dev libspng-dev libtiff-dev libwebp-dev libexif-dev liblcms2-dev \
       libopenslide-dev libfftw3-dev liborc-0.4-dev libcgif-dev libhwy-dev libimagequant-dev \
       libarchive-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN curl -fsSL -o vips.tar.xz \
        "https://github.com/libvips/libvips/releases/download/v${VIPS_VERSION}/vips-${VIPS_VERSION}.tar.xz" \
    && echo "${VIPS_SHA256}  vips.tar.xz" | sha256sum -c - \
    && tar -xJf vips.tar.xz \
    && rm vips.tar.xz
WORKDIR /build/vips-${VIPS_VERSION}
# Delegates enabled:   jpeg, spng(png), tiff, webp, exif, lcms, openslide,
#                      fftw, orc, cgif(gif), hwy, imagequant, archive(dzsave)
# Delegates disabled:  magick, heif, jpeg-xl, openexr, matio, poppler,
#                      pdfium, nifti, quantizr, openjpeg, rsvg, pangocairo,
#                      fontconfig, cfitsio — none of the disabled delegates'
#                      formats are in HRIV's accepted upload set (see
#                      ``backend/app/routers/upload.py::_IMAGE_EXTENSIONS``;
#                      note that ``.bmp`` was removed from that set alongside
#                      this build change because libvips has no native BMP
#                      loader and the only delegate that can decode BMP is
#                      ``magick``, which is disabled here).  libopenslide is
#                      the only codec in the allow-list that isn't a simple
#                      libtiff / libjpeg / libpng / libwebp path.
RUN meson setup build --prefix=/usr/local --libdir=lib --buildtype=release \
      -Ddeprecated=false -Dintrospection=disabled -Dexamples=false \
      -Dcplusplus=false -Ddocs=false -Dmodules=disabled \
      -Dmagick=disabled -Dheif=disabled -Djpeg-xl=disabled -Dopenexr=disabled \
      -Dmatio=disabled -Dpoppler=disabled -Dpdfium=disabled -Dnifti=disabled \
      -Dquantizr=disabled -Dopenjpeg=disabled -Drsvg=disabled \
      -Dpangocairo=disabled -Dfontconfig=disabled -Dcfitsio=disabled -Dspng=enabled \
      -Dradiance=false -Dppm=false -Danalyze=false \
    && meson compile -C build -j "$(nproc)" \
    && DESTDIR=/tmp/vips meson install -C build

# ── Stage 1b: Python dependency builder (discarded) ──────
FROM python:3.13-slim AS builder
WORKDIR /app

# ``apt-get -y upgrade`` before the install chain picks up any
# trixie-security patches published since the ``python:3.13-slim``
# base-image digest was built.  The builder stage is discarded, but
# upgrading here keeps the pip-built wheels linked against the same
# library versions the runtime ``base`` stage will use.  pyvips is a
# pure-Python cffi binding — it ``dlopen``s ``libvips.so.42`` at
# runtime — so no libvips headers are needed to install the wheel.
RUN apt-get update \
    && apt-get -y upgrade \
    && apt-get install -y --no-install-recommends \
       pkg-config gcc \
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

# ``apt-get -y upgrade`` pulls any trixie-security deltas that have
# landed since the ``python:3.13-slim`` base digest was built, so the
# runtime image is at least as current as the Debian security mirror
# at build time rather than as current as the last docker-library
# python rebuild.
#
# We deliberately do NOT install ``libvips42t64`` from Debian: its hard
# Depends pull in libraw / libheif / libjxl / openexr / matio / poppler
# / magickcore, whose CVE counts dominate the code-scanning alert list
# and whose codec paths HRIV never reaches.  Instead we install only
# the runtime codec libraries corresponding to the delegates enabled
# in the ``libvips-build`` stage, and copy the custom-built
# ``libvips.so.42`` in from there.
RUN apt-get update \
    && apt-get -y upgrade \
    && apt-get install -y --no-install-recommends \
       libglib2.0-0t64 libexpat1 \
       libjpeg62-turbo libspng0 libtiff6 libwebp7 libwebpdemux2 libwebpmux3 \
       libexif12 liblcms2-2 libopenslide0 libfftw3-double3 liborc-0.4-0t64 \
       libcgif0 libhwy1t64 libimagequant0 libarchive13t64 \
    && rm -rf /var/lib/apt/lists/*

# Custom libvips from the ``libvips-build`` stage.  ``ldconfig`` picks
# up ``/usr/local/lib`` via Debian's default ``/etc/ld.so.conf.d``
# entry, so pyvips' ``ffi.dlopen('libvips.so.42')`` resolves to the
# slim build.
COPY --from=libvips-build /tmp/vips/usr/local /usr/local
RUN ldconfig

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
#   * ``opentelemetry-instrument`` on the dev/stable CMDs is a true no-op
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

# Stamp the release-please-managed app version into the image so the
# /api/admin/version endpoint can report it without any runtime
# deployment-side configuration.  Defaults to ``dev`` for local builds
# that don't pass the build-arg (e.g. ``docker compose build``).  CI
# passes ``--build-arg APP_VERSION=<versions-job output>`` alongside
# ``VITE_APP_VERSION`` so frontend/backend/backup all share the same
# component-scoped version string at build time.
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

# ── Stage 3: Development (hot-reload, used by docker compose)
FROM base AS dev
RUN pip install --no-cache-dir 'pytest>=8.3.3,<9' 'pytest-asyncio>=0.24.0,<0.25' 'pytest-cov>=5.0.0,<6'
# Wrap with ``opentelemetry-instrument`` for parity with the stable stage so
# developers can exercise the OTel auto-instrumentation pipeline locally
# just by overriding ``OTEL_TRACES_EXPORTER``/``OTEL_EXPORTER_OTLP_ENDPOINT``
# in their ``backend/.env``.  The base stage pins all exporters to
# ``none`` (see above), so the wrapper is a true no-op at startup and adds
# no runtime overhead until the developer opts in.
CMD ["opentelemetry-instrument", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ── Stage 4: Stable ─────────────────────────────────
FROM base AS stable
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
