# syntax=docker/dockerfile:1.4
FROM mcr.microsoft.com/playwright:v1.63.0-noble

RUN npm install -g npm@12.1.0

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci && rm -rf /root/.npm

COPY playwright.config.ts ./
COPY tests ./tests

ENTRYPOINT ["npx", "playwright", "test"]
CMD ["--reporter=list"]
