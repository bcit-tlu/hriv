# syntax=docker/dockerfile:1.4

##### Frontend build ###########################################################
FROM node:22-slim AS frontend-builder

WORKDIR /corgi

ENV NODE_ENV=production \
    npm_config_loglevel=warn

COPY src/package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then \
        npm ci; \
    else \
        npm install; \
    fi

COPY src ./
RUN npm run production

##### PHP release ##############################################################
FROM php:8.4-fpm AS release

# Fail fast and keep the shell in debug mode for RUN blocks
# SHELL ["/bin/sh", "-euxo", "pipefail", "-c"]

ENV LANG=en_CA.UTF-8 \
    LANGUAGE=en_CA:en \
    LC_ALL=en_CA.UTF-8

WORKDIR /corgi

# System packages and composer
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      mariadb-client \
      locales \
      unzip \
      zip \
      supervisor \
      libldap2-dev \
      libvips-dev \
      libfreetype6-dev \
      libjpeg62-turbo-dev \
      libpng-dev \
      libwebp-dev \
      curl \
 && rm -rf /var/lib/apt/lists/*

RUN curl -sSL https://getcomposer.org/installer \
    | php -- --install-dir=/usr/local/bin --filename=composer

# Locales and timezone
RUN ln -fs /usr/share/zoneinfo/America/Vancouver /etc/localtime \
 && dpkg-reconfigure --frontend noninteractive tzdata \
 && sed -i 's/# en_CA.UTF-8 UTF-8/en_CA.UTF-8 UTF-8/' /etc/locale.gen \
 && locale-gen

# PHP extensions
RUN pecl install vips \
 && docker-php-ext-enable vips

RUN docker-php-ext-configure gd \
      --with-freetype \
      --with-webp \
      --with-jpeg \
 && docker-php-ext-configure ldap \
      --with-libdir=lib/$(uname -m)-linux-gnu/ \
 && docker-php-ext-install -j"$(nproc)" \
      mysqli \
      pdo_mysql \
      ldap \
      gd

# Composer dependencies (copy lock file if present for cache hits)
COPY src/composer.* ./
RUN composer install --no-scripts --no-autoloader --ansi --no-interaction \
 && composer clear-cache

# Application files
COPY src ./
COPY --from=frontend-builder /corgi/public ./public

RUN composer dump-autoload --optimize \
 && mkdir -p ./storage/app/public/images \
 && mkdir -p ./storage/app/public/temp \
 && mkdir -p ./storage/logs \
 && mkdir -p ./storage/framework/cache \
 && mkdir -p ./storage/framework/sessions \
 && mkdir -p ./storage/framework/views \
 && chmod -R 755 ./storage \
 && chmod -R 775 ./storage/logs ./storage/framework ./storage/app/public \
 && chown -R www-data:www-data \
      ./storage/logs \
      ./storage/framework \
      ./storage/app/public

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 9000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["supervisord", "-c", "/etc/supervisor/supervisord.conf"]
