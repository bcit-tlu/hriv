# syntax=docker/dockerfile:1.4

# ── Stage 1: Install dependencies ────────────────────────
FROM node:22-slim AS deps
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
RUN rm /etc/nginx/conf.d/default.conf
# The nginx config template is supplied at deploy time via a ConfigMap
# mounted at /etc/nginx/templates/.  A baked-in fallback is kept for
# local development (docker compose) where no ConfigMap is available.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=755 dns-resolver.envsh /docker-entrypoint.d/12-dns-resolver.envsh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
# nginx docker image auto-processes templates in /etc/nginx/templates/
# using envsubst, writing output to /etc/nginx/conf.d/
# See: https://hub.docker.com/_/nginx  ("Using environment variables in nginx configuration")
ENV BACKEND_URL=http://backend:8000
