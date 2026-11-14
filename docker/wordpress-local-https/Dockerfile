# Reuse the already-built local PHP runtime without rebuilding/restarting shared web.
FROM galaxyquest-web

USER root
RUN a2enmod ssl headers rewrite \
    && rm -f /etc/apache2/sites-enabled/* \
    && printf 'Listen 8443\n' > /etc/apache2/ports.conf \
    && command -v openssl

COPY docker/wordpress-local-https/apache.conf /etc/apache2/sites-enabled/wordpress-local-https.conf
COPY docker/wordpress-local-https/entrypoint.sh /usr/local/bin/gq-local-https
COPY docker/wordpress-local-https/*.php /usr/local/lib/gq-local-https/
RUN sed -i 's/\r$//' /usr/local/bin/gq-local-https \
    && chmod 0755 /usr/local/bin/gq-local-https

EXPOSE 8443
USER www-data
ENTRYPOINT ["/usr/local/bin/gq-local-https"]
