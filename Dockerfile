FROM node:24-bookworm-slim AS frontend

WORKDIR /frontend
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run vite:build

FROM php:8.2-apache

ARG APP_UID=1001
ARG APP_GID=1001
ARG INSTALL_XDEBUG=0
ARG PHP_CONFIG=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libpng-dev \
        libjpeg62-turbo-dev \
        libfreetype6-dev \
        libcurl4-openssl-dev \
        libonig-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install gd mbstring mysqli pdo_mysql curl opcache \
    && if [ "$INSTALL_XDEBUG" = "1" ]; then pecl install xdebug && docker-php-ext-enable xdebug; fi \
    && a2enmod rewrite headers \
    && sed -i 's/^Listen 80$/Listen 8080/' /etc/apache2/ports.conf \
    && groupmod --gid "$APP_GID" www-data \
    && usermod --uid "$APP_UID" --gid "$APP_GID" www-data \
    && mkdir -p /var/run/apache2 /var/lock/apache2 \
    && rm -rf /var/lib/apt/lists/*

COPY docker/apache/vhost.conf /etc/apache2/sites-available/000-default.conf
COPY docker/apache/security.conf /etc/apache2/conf-available/zzz-gq-security.conf
COPY docker/php/conf.d/${PHP_CONFIG}.ini /usr/local/etc/php/conf.d/zz-runtime.ini
COPY docker/php/conf.d/security.ini /usr/local/etc/php/conf.d/zz-security.ini
COPY docker/php/conf.d/xdebug.ini /tmp/gq-xdebug.ini

RUN a2enconf zzz-gq-security \
    && if [ "$INSTALL_XDEBUG" = "1" ]; then cp /tmp/gq-xdebug.ini /usr/local/etc/php/conf.d/zz-xdebug.ini; fi \
    && rm /tmp/gq-xdebug.ini

WORKDIR /var/www/html
COPY --chown=www-data:www-data . /var/www/html/
COPY --from=frontend --chown=www-data:www-data /frontend/dist /var/www/html/dist
RUN cp dist/index.html index.html \
    && mkdir -p assets cache generated /var/lib/php/sessions \
    && cp -a dist/assets/. assets/ \
    && chown www-data:www-data cache generated /var/lib/php/sessions \
    && chown -R www-data:www-data assets index.html /var/run/apache2 /var/lock/apache2 /var/log/apache2

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD php -r "exit(@file_get_contents('http://127.0.0.1:8080/health/live', false, stream_context_create(['http' => ['timeout' => 3]])) === false ? 1 : 0);"

USER www-data
