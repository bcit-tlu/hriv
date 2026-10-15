# syntax=docker/dockerfile:1.4
FROM node:22-trixie-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install -g npm@12.1.0 \
    && npm ci \
    && npx playwright install --with-deps chromium \
    && apt-get upgrade -y \
    && rm -rf /root/.npm /var/lib/apt/lists/*

COPY playwright.config.ts ./
COPY tests ./tests

ENTRYPOINT ["npx", "playwright", "test"]
CMD ["--reporter=list"]
