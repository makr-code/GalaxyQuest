FROM php:8.2-apache

RUN docker-php-ext-install pdo_mysql \
    && pecl install xdebug \
    && docker-php-ext-enable xdebug \
    && a2enmod rewrite headers

COPY docker/apache/vhost.conf /etc/apache2/sites-available/000-default.conf
COPY docker/php/conf.d/dev.ini /usr/local/etc/php/conf.d/zz-dev.ini
COPY docker/php/conf.d/xdebug.ini /usr/local/etc/php/conf.d/zz-xdebug.ini

WORKDIR /var/www/html