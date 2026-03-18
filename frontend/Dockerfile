# syntax=docker/dockerfile:1.4

FROM node:22-slim

WORKDIR /app

# Install dependencies first for better layer caching
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then \
        npm ci; \
    else \
        npm install; \
    fi

# Copy source files
COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host"]
