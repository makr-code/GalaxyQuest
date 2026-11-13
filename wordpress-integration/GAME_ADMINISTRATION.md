# GalaxyQuest Administration

This is the separate WordPress **game administration** plugin. It does not depend
on the Deployment Status plugin and does not load the game application, execute
SQL or use the WordPress database connection to inspect the game.

| Plugin | Responsibility |
|---|---|
| GalaxyQuest Deployment Status | GitHub/CI, Plesk Git mirrors, release delivery and its own plugin updates |
| GalaxyQuest Administration | Game configuration, setup, schema/migration planning and future operational jobs |

Game administration belongs in WordPress rather than a second independently
built game-admin frontend. Authoritative game rules remain in the PHP game
application. WordPress is the authenticated control plane, not a second game
engine or a SQL console.

## Implemented first stage

`wordpress-integration/gq-game-admin.php` provides its own top-level
**GalaxyQuest Administration** menu, restricted to `manage_options`.
Staging and production have separate, fixed report paths and expected database
identities. The UI shows:

- Database identity, server version, visible table/view count and empty/untracked/tracked state.
- Native candidate version/commit and migration-manifest/baseline SHA-256.
- Canonically ordered pending, executed and adopted migrations, with SQL SHA-256.
- Inspection timestamp, plan digest and explicit replay/reconciliation blockers.

Reports older than 15 minutes or more than 60 seconds in the future are rejected.
Invalid JSON, wrong environments/databases, duplicate entries and changed plan
contents produce visible errors. Report files are local, bounded to 2 MiB and
never fetched from a URL supplied by a browser.

**Configuration editing, setup, migrations, backup and restore remain locked.**
There are no mutation handlers or activation-time game/schema changes. A
tracked database or a fresh report is not readiness, backup or deployment
approval. The candidate must still be `not-deployable`.

This plugin is not part of the Deployment Status 0.2.0 release and does not
silently reuse its hardcoded updater channel. Its own packaging/update channel
must be added before distributing it as an independently updatable release.

## Local installation

Install this alongside, not instead of, the deployment plugin. For local
development on the same NTFS volume:

```powershell
New-Item -ItemType HardLink `
  -Path C:\Projects\GalaxyQuest\wordpress\wp-content\plugins\gq-game-admin.php `
  -Target C:\Projects\GalaxyQuest\wordpress-integration\gq-game-admin.php
```

Activate **GalaxyQuest Administration** on the WordPress Plugins page.
Recreate a hardlink if an editor replaces the source inode. The two plugin menus
and function prefixes are independent.

## Read-only report producer

Run the dedicated CLI script against a trusted, already extracted native
candidate. Do not call `setup.php` or `scripts/migrate.php status` from WordPress:
the legacy status command bootstraps the tracking table, and setup has its own
legacy SQL list and seed operations.

```bash
php /srv/galaxyquest/tools/scripts/inspect_game_administration.php \
  --environment=staging \
  --db-config=/srv/galaxyquest/private/staging-inspection-db.json \
  --release-dir=/srv/galaxyquest/candidates/verified-candidate \
  --output=/srv/galaxyquest/private/staging-administration.json
```

The tools copy must contain the matching `MigrationRunner::inspectReadOnly()`
implementation and adoption contracts. It reads the candidate's canonical
manifest/SQL and native manifest; it does not install or activate the candidate.

The private JSON connection configuration must explicitly identify its
environment. Example values only:

```json
{
  "environment": "staging",
  "host": "127.0.0.1",
  "port": 3306,
  "database": "galaxyquest_staging",
  "username": "galaxyquest_staging_inspector",
  "password": "REPLACE_WITH_PRIVATE_INSPECTION_PASSWORD"
}
```

Use a **dedicated SELECT-only database account**, separate from the game's
runtime/migration users and from WordPress. Provision credentials through the
server/Plesk administrator, not the plugin. Prefer a local database connection;
remote database TLS configuration is not implemented by this initial tool.
Keep credentials and reports outside every webroot and release archive.

The collector sets read-only transaction defaults and uses the existing
database-scoped migration advisory lock. It never bootstraps tracking tables,
executes SQL file contents or records/adopts history. It verifies existing
checksums/adoption provenance and rejects foreign history or missing SQL.
Without tracking it distinguishes no visible tables/views (`empty`) from
existing untracked tables/views. This does not certify complete schema emptiness:
other objects and limited privileges need independent checks by the future
privileged setup job. Neither state permits initialization or migration replay.

Reports are atomically replaced with owner-only permissions. Run the producer
under the designated account that lets WordPress read that private file; do not
make the report or credential directory world-readable. Plugin separation is a
logical/control-plane boundary, not OS isolation when both run as the same
Plesk subscription user.

The producer makes no schedules or Plesk changes. Generate a new report
explicitly or configure a reviewed server-side job later. If collection fails,
it exits nonzero and leaves the previous report intact with its original
timestamp; freshness validation eventually rejects it. A report remains only
a point-in-time observation, never execution authorization.

## WordPress configuration

Configure fixed paths and expected identities in the private `wp-config.php`:

```php
define('GQ_GAME_ADMIN_STAGING_REPORT_FILE', '/srv/galaxyquest/private/staging-administration.json');
define('GQ_GAME_ADMIN_STAGING_EXPECTED_DATABASE', 'galaxyquest_staging');
define('GQ_GAME_ADMIN_PRODUCTION_REPORT_FILE', '/srv/galaxyquest/private/production-administration.json');
define('GQ_GAME_ADMIN_PRODUCTION_EXPECTED_DATABASE', 'galaxyquest_production');
```

No database passwords, API keys, arbitrary command strings or submitted file
paths are stored in WordPress options or browser forms. The report's plan digest
binds environment, observed database, release and ordered SQL identities; it is
an integrity check, **not an independent signature**.

## Subsequent execution stages

Before enabling write operations:

1. Reconcile initial setup with the immutable canonical migration manifest.
2. Introduce a narrowly authorized job protocol bound to exact environment,
   database identity, candidate digest and reviewed plan; no arbitrary shell/SQL.
3. Implement and verify backup/restore and coordinate all game writers.
4. Require explicit production approval; run setup only against a confirmed
   empty target and migrations only through the canonical runner.
5. Verify the resulting schema before activation and application readiness.

MySQL/MariaDB DDL can commit implicitly. Switching PHP files back is not a
database rollback. Historical SQL stays immutable and append-only; already
present schema may be adopted only through the existing source-pinned,
schema/data-validating contracts. Never seed development accounts or regenerate
a production galaxy as an implicit setup/update side effect.
