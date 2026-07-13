# syntax=docker/dockerfile:1.4
FROM mcr.microsoft.com/playwright:v1.50.0-noble

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY playwright.config.ts ./
COPY tests ./tests

ENTRYPOINT ["npx", "playwright", "test"]
CMD ["--reporter=list"]
