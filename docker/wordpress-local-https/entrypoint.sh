#!/bin/sh
set -eu
umask 077

for directory in /var/lib/gq-inspection /var/lib/gq-local-tls /var/lib/gq-local-config; do
    test ! -L "$directory"
    test -d "$directory"
    chmod 0700 "$directory"
done

if [ ! -f /var/lib/gq-local-tls/localhost.key ] && [ ! -f /var/lib/gq-local-tls/localhost.crt ]; then
    openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 365 \
        -keyout /var/lib/gq-local-tls/localhost.key \
        -out /var/lib/gq-local-tls/localhost.crt \
        -subj '/CN=localhost' \
        -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null
fi
test -s /var/lib/gq-local-tls/localhost.key
test -s /var/lib/gq-local-tls/localhost.crt
chmod 0600 /var/lib/gq-local-tls/localhost.key /var/lib/gq-local-tls/localhost.crt

php /usr/local/lib/gq-local-https/prepare-config.php
exec apache2-foreground
