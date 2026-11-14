# Local-only HTTPS inspection profiles

This opt-in, independent Compose project uses the existing local WordPress files
and its separate WordPress database. It does **not** restart shared `web`, `db`,
or AI services, change database users, or edit the source `wp-config.php`.
It is not a production deployment or Plesk configuration.

Prerequisites: the existing `galaxyquest-web` image, `galaxyquest_default` network,
running local database, and already-installed `wordpress/` including its private
`wp-config.php`. Run from the repository root:

```powershell
docker compose -f docker-compose.wordpress-local-https.yml --profile wordpress-local-https up -d --build
docker compose -f docker-compose.wordpress-local-https.yml --profile wordpress-local-https ps
```

For this existing local installation, explicitly provision staging once from its
already-configured staging constants and database-name setting, without displaying
credentials or connecting to the game database:

```powershell
docker compose -f docker-compose.wordpress-local-https.yml exec --user www-data wordpress-https php /usr/local/lib/gq-local-https/provision-staging.php --from-existing-local-staging
```

This refuses to overwrite an existing profile. It is never run automatically on
restart. No production profile is copied or created; enter production only via
its separate HTTPS form if required.

Open **https://localhost:8443/wordpress/wp-admin/admin.php?page=gq-game-admin**.
Log in with your existing local WordPress administrator account. The certificate
is self-signed for localhost: browsers initially warn. Verify that you are using
exactly localhost:8443 before accepting it locally; never disable certificate
checks globally. The public certificate can be exported for deliberate local
trust (never export/share its key):

```powershell
docker compose -f docker-compose.wordpress-local-https.yml cp wordpress-https:/var/lib/gq-local-tls/localhost.crt .\localhost-wordpress.crt
```

Do not commit the exported certificate. This is native Apache TLS, not a proxy:
no HTTP listener exists, forwarded HTTPS headers are discarded, and the isolated
WordPress home/site/admin form URLs are fixed to HTTPS without changing database
URL options. No HSTS is sent, so the existing localhost HTTP site is unaffected.
Only `127.0.0.1:8443` is published; other Host values are rejected.

The administration plugin source is mounted read-only from `wordpress-integration/`;
the existing local site's copied plugin remains untouched. It must already be
active in WordPress. No activation or account changes are performed by setup.

## Private storage and first entry

Three project-scoped named volumes live **outside the webroot**:

* `inspection-profiles`: fixed staging and production JSON paths under
  `/var/lib/gq-inspection/`;
* `local-tls`: certificate and private key;
* `local-config`: a private derived WordPress config, preserving original DB and
  staging constants while replacing only this instance's URL/security/path constants.

The startup hook makes these directories `0700`, owned by the image's actual
`www-data` UID (not an assumed UID); files are `0600`. The PHP worker runs as that
non-root account. No profile is created or migrated automatically. The explicit
staging provisioning above preserves the existing staging connection in private
JSON before using the UI. Missing, deleted, unsafe or malformed profiles fail
closed: they never fall back to constants. A missing production profile remains
unconfigured until an explicit HTTPS form save.
Production source configuration remains untouched. Enter only dedicated read-only
inspection credentials; the form never displays stored passwords. Saving changes
only the matching private JSON, not game data, accounts, or WordPress URL options.

Container recreation retains these named volumes. Do **not** use `down -v`,
volume pruning, or delete the volumes: this loses profiles, the local TLS identity
and the derived config. Do not mount these volumes into the shared webroot.
The source config is privately re-derived on each start; profile JSON is retained.
After editing source configuration, recreate only this independent service.

Stop only this local endpoint:

```powershell
docker compose -f docker-compose.wordpress-local-https.yml --profile wordpress-local-https stop wordpress-https
```

Never combine this Compose file with the shared Compose files. There is no need
to run `up`, `restart`, `down`, or migrations against the shared services.

## Optional local HTTP read-inspection override

The HTTPS endpoint above is preferred. For isolated local development only,
the **Players**, **Universe**, **Planets**, **Colonies**, **Buildings**,
**Building queue**, **Ship queue**, **Ship inventory**, **Built vessels**,
**Fleets** and **Research** tabs also support an
explicit, staging-only HTTP override.
It is off by default. In the local private `wordpress/wp-config.php`, before
WordPress loads, an operator may define:

```php
define('GQ_GAME_ADMIN_LOCAL_HTTP_STAGING', true);
define('GQ_GAME_ADMIN_LOCAL_HTTP_PEER', '172.20.0.1');
```

The peer is the actual address Apache observes for the direct host connection,
not the browser's Host header or a forwarded client address. The example is
specific to one Docker network; verify it for the local installation and update
it if that network changes. The override also requires an HTTP WordPress admin
URL on `localhost` or `127.0.0.1`, a matching Host and port, the exact configured
peer, no forwarded-client headers, the staging selection, `manage_options`
and an environment-bound nonce. The UI displays an unencrypted-transport warning.

These checks do **not** prove that the ultimate client is local behind a proxy
or port forward. Enable this only when the WordPress listener is loopback-only,
the Docker network and host are trusted, no untrusted reverse proxy or tunnel
can reach it, and staging contains only appropriate test data. Player data and
WordPress login cookies are sent without encryption. Never enable it in Plesk,
production or shared environments. Removing the two definitions disables it.
It does not bypass HTTPS for database-credential entry or enable game writes.
