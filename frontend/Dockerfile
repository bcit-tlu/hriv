# syntax=docker/dockerfile:1.4

# ── Stage 1: Install dependencies ────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then \
        npm ci; \
    else \
        npm install; \
    fi

# ── Stage 2: Development server (used by docker compose) ─
FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]

# ── Stage 3: Production build ────────────────────────────
FROM deps AS build
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
ARG VITE_APP_VERSION
ENV VITE_APP_VERSION=${VITE_APP_VERSION}
RUN npm run build

# ── Stage 4: Production server (nginx) ───────────────────
FROM nginx:1.27-alpine AS prod
# Pull fresh Alpine package updates on every rebuild so the image
# picks up published security patches without waiting on the nginx
# maintainers' base-image tag cadence. Combined with the nightly
# rebuild in ``.github/workflows/ci.yaml``, this keeps the
# ``hriv-frontend:head`` image within ~24h of the Alpine security
# mirror for libxml2 / libssl3 / libcrypto3 / libpng / zlib / musl
# / libexpat.
RUN apk --no-cache upgrade && rm /etc/nginx/conf.d/default.conf
# Bake in a fallback nginx template so the prod image is self-sufficient
# for ad-hoc `docker run` while keeping **one** physical source of truth
# for the config.  The canonical file lives in the Helm chart at
# ``charts/frontend/files/default.conf.template`` and is also rendered
# into the ConfigMap the chart mounts over this path at deploy time —
# the ConfigMap, when present, shadows the baked-in copy.  The chart
# directory is supplied to BuildKit as a named build context; build the
# image with:
#
#     docker buildx build \
#         --build-context nginx-config=charts/frontend/files \
#         -t hriv-frontend:dev -f frontend/Dockerfile frontend
#
# CI wires this up automatically via ``build-contexts:`` in
# ``.github/workflows/ci.yaml`` for the ``frontend`` matrix entry.
# See issue #37 for the rationale.
COPY --from=nginx-config default.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=755 dns-resolver.envsh /docker-entrypoint.d/12-dns-resolver.envsh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
# nginx docker image auto-processes templates in /etc/nginx/templates/
# using envsubst, writing output to /etc/nginx/conf.d/
# See: https://hub.docker.com/_/nginx  ("Using environment variables in nginx configuration")
ENV BACKEND_URL=http://backend:8000
