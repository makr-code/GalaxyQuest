# GalaxyQuest Administration

This is the separate WordPress **game administration** plugin. It does not depend
on the Deployment Status plugin and does not load the game application or use
the WordPress database connection to inspect the game. Its explicit connection
test opens a separate read-only session; setup and migrations never run in an
admin request.

| Plugin | Responsibility |
|---|---|
| GalaxyQuest Deployment Status | GitHub/CI, Plesk Git mirrors, release delivery and its own plugin updates |
| GalaxyQuest Administration | Game configuration, setup, schema/migration planning and future operational jobs |

Game administration belongs in WordPress rather than a second independently
built game-admin frontend. Authoritative game rules remain in the PHP game
application. WordPress is the authenticated control plane, not a second game
engine or a SQL console.

## Implemented administration controls

`wordpress-integration/gq-game-admin.php` provides its own top-level
**GalaxyQuest Administration** menu, restricted to `manage_options`.
Staging and production have separate, fixed report paths and database profiles.
Administrators can enter the Plesk-created database name, host, port, user and
password for a read-only inspection account in each environment. These are not
the credentials used by the game runtime. The UI also shows:

- Database identity, server version, visible table/view count and empty/untracked/tracked state.
- Native candidate version/commit and migration-manifest/baseline SHA-256.
- Canonically ordered pending, executed and adopted migrations, with SQL SHA-256.
- Inspection timestamp, plan digest and explicit replay/reconciliation blockers.

The **Environment** dropdown selects Staging (default) or Production. Native
WordPress tabs organize **Game overview**, **Players**, **Universe**, **Planets**, **Colonies**, **Buildings**,
**Building queue**, **Ship queue**, **Ship inventory**, **Built vessels**,
**Fleets**, **Research**,
**Content and assets**, **Database**, **Inspection**, **Controlled operations**
and **Plugin updates**; Database remains the default. Changing the environment
preserves the selected technical tab, and switching tabs preserves the
environment. Only the selected tab is rendered, and only its selected
environment's settings, report or overview snapshot are read. Database actions
redirect back to Database in the same environment with environment-specific
nonces unchanged.
Invalid environment or section selectors are rejected. Plugin updates are
shared, not environment-specific. Navigation neither saves settings nor tests a
connection.

**Game overview** explicitly reads aggregate counts of user records, star
systems, planets, colonies and fleets from the selected database using its
inspection profile. User records include NPCs and deleted accounts, not just
active players. Refresh is a `manage_options`-restricted POST with an
environment-bound nonce; it opens a separate read-only MySQL session and uses
fixed SELECT queries, never game mutations. Failures are shown without database
credentials. The result is a five-minute per-user, per-environment snapshot
labeled with its database and observation time, not live monitoring or proof
of schema, grants, deployment or operational readiness. Refresh again after a
profile or game-data change. Counts can require scanning large tables.

**Players** offers explicit, read-only inspection using the selected
environment's existing database profile. `manage_options` users can load it over
HTTPS using an environment-bound nonce. A separately enabled local-only
staging HTTP override is described in [LOCAL_HTTPS.md](LOCAL_HTTPS.md); it is
disabled by default and must never be used on shared or production systems.
Each POST reads at most
50 non-deleted user records plus one pagination sentinel, newest ID first.
It displays ID, username, control type, login-enabled and game-admin flags;
it includes NPCs but excludes email addresses, password hashes and deleted
accounts. First/next page requests query the database again; concurrent account
changes can affect the results. A username substring search and an
all-actors/humans/NPCs filter can narrow results. The search uses bound parameters
and literal substring matching (SQL wildcard characters `%` and `_` are literal);
case/accent matching follows the database collation. Search input is limited to
128 UTF-8 bytes with no control characters. All player controls are in the table
header: clickable column headings sort by ID, username, control type, login
enabled or game-admin flag in either direction. Additional dropdowns filter login
and game-admin flags. Sorting is server-side across all matching records, with ID
as a deterministic tie-breaker and a bound keyset cursor for subsequent pages.
Applying changed filters or sorting starts at the first page; next-page forms
retain sorting, filters and environment. Search terms
are submitted by POST, not put into navigation URLs.
The list is not saved in WordPress options,
transients or server-side files. It contains personal data and is visible to
WordPress administrators with inspection access, so protect their accounts and
the transport accordingly. A dedicated SELECT-only database account remains
necessary: this plugin does not verify its grants.

WordPress inspection is not a GalaxyQuest administrator session. Creating,
updating and deleting accounts remain available only through the separately
authenticated game administration. **Universe** now inspects the existing `star_systems` catalog using the same
separate read-only connection and transport policy as Players. Navigation does
not query the game database: an explicit environment-bound, nonce-protected
administrator POST loads up to 50 systems plus a pagination sentinel.
The table header searches names/catalog names, filters the galaxy index and
presence of catalog planets, and sorts every displayed column in either
direction across the entire matching catalog. Keyset pagination uses the sort
value plus ID, including empty names and zero-valued galaxy/planet fields.
The filters and ordering stay with subsequent pages; applying changed filters
starts from the first page. Zero is a supported catalog index, not an empty
filter. Name searches are literal substrings with database-collation matching.
Catalog planet counts are stored values, not live joins against planets or
colonies. Results are not stored in WordPress. The catalog view never generates
systems, settles economies, resolves fleets or modifies the game.

**Planets** inspects persisted rows in `planets`, not the complete procedurally
rendered universe: bodies generated for display without a database row do not
appear. It shows the recorded ID, galaxy, system, position, type and class.
An explicit environment-bound administrator POST reads 50 rows at a time through
the same read-only connection and transport policy as Players. The table header
offers exact coordinate filters, literal type/class substring search and
ascending or descending sorting by every column. Sorting enum values uses their
text rather than enum declaration order; keyset pagination adds ID as tie-breaker.
Subsequent pages preserve the filters, ordering and environment. As with other
live inspections, concurrent database changes may affect pagination. Data is
not stored in WordPress and no generation or game-state updates are invoked.

**Colonies** displays stored colony ID, owner ID, name, type, population and
the last economy update in database time. Population is the stored value at that
update, not a live calculation. Loading the list does not settle the on-demand
economy or change game state. It uses the same explicit, environment-bound
administrator POST and read-only database connection as Players. Search by
literal name substring, filter by exact owner ID or colony type, and sort every
column using controls in the table header. Enum sorting uses the type text;
subsequent pages preserve the filters and sort order and use ID as a tie-breaker.
Each page reads at most 50 rows plus a sentinel; concurrent changes can affect
pagination. No results are stored in WordPress. Colony names and ownership can
identify players, so restrict administrator access and protect transport.

**Buildings** displays persisted building ID, colony ID, type, level and
optional `upgrade_end` in database time. The recorded end may be overdue; this
view does not process upgrades, settle the colony economy or change game state.
The separate building-upgrade queue is not included, so the view is not a
complete queue or live status. It uses the same explicit environment-bound
administrator POST and read-only connection as Players. The table header
supports literal type search, exact colony ID and end-recorded filters and
sorting each column. Missing end times sort first ascending and last descending;
keyset pagination preserves filters and order with ID as tie-breaker. Each
request reads up to 50 rows plus a sentinel; concurrent changes can affect
pagination and unindexed searches or sorts can scan many records. Results are
not stored in WordPress. Building levels and colony IDs are sensitive gameplay
data; protect administrator access and transport.

**Building queue** reads persisted `building_upgrade_queue` entries, including
queued, running, done and cancelled records. It shows ID, colony ID, building
type, target level, stored ETA and status; costs and other queue details are not
selected. A stored status or an overdue ETA is not proof of live progress.
Reading does not create the queue table, start or finish upgrades, settle the
economy or change game state; a missing table is reported as an error. The same
explicit environment-bound administrator POST and read-only connection as
Players apply. Header controls search building type literally, filter exact
colony, status or ETA presence, and sort every column. Missing ETA values sort
first ascending and last descending; status sorts by text rather than enum
declaration order. Pagination uses an ID tie-breaker, preserves filters and
order, and reads at most 50 rows plus a sentinel; concurrent changes may affect
pages and unindexed searches or sorts can scan many records. Results are not
stored in WordPress. Queue data is sensitive gameplay information, so protect
administrator access and transport.

**Ship queue** reads persisted `ship_build_queue` entries, including queued,
running, done and cancelled records. It shows ID, colony ID, ship type, quantity,
stored ETA and status; costs and blueprint IDs are not selected. Stored status
and ETA are not proof of live progress. The view does not create the queue
table, start or finish ship construction, settle the economy or change game
state; a missing table is reported as an error. It uses the same explicit
environment-bound administrator POST and read-only connection as Players.
Header controls search ship type literally, filter exact colony, status or ETA
presence, and sort every column. Missing ETA values sort first ascending and
last descending; status sorts by text rather than enum declaration order.
Pagination uses ID as tie-breaker, preserves filters and order, and reads at
most 50 rows plus a sentinel; concurrent changes may affect pages and unindexed
searches or sorts can scan many records. Results are not stored in WordPress.
Ship queue data is sensitive gameplay information; protect administrator access
and transport.

**Ship inventory** reads stored colony ship-count rows from `ships`, including
zero and negative counts if present. It is not a complete fleet inventory:
in-transit fleets, ship-build queues and individual `built_vessels` records are
not included. It neither runs construction or fleet processing nor changes game
state. The same explicit environment-bound administrator POST and read-only
connection as Players apply. Header controls search type literally, filter
exact colony and count sign, and sort every column. Keyset pagination preserves
filters and sort order with ID as tie-breaker, and reads at most 50 rows plus
a sentinel. Concurrent changes may affect pages; unindexed searches or sorts can
scan many records. Results are not stored in WordPress. Ship counts and colony
IDs are sensitive gameplay data; protect administrator access and transport.

**Built vessels** reads individual persisted `built_vessels` records, including
destroyed entries. It shows vessel ID, owner ID, colony ID, blueprint ID, name
and stored status. These records are separate from the aggregate `ships` table
and do not show fleet assignments, component statistics or health state. The
view does not create, assign or modify vessels, and reports a missing table as
an error rather than creating it. The same explicit environment-bound
administrator POST and read-only connection as Players apply. Header controls
search names literally, filter exact owner, colony or status and sort every
column. Unnamed vessels sort as empty names; status sorts by text. Keyset
pagination uses ID as tie-breaker, preserves filters and order, and reads at
most 50 rows plus a sentinel. Bigint identifiers remain exact decimal strings.
Concurrent changes can affect pages and unindexed searches or sorts can scan
many records. Results are not stored in WordPress. Vessel names, ownership and
blueprints are sensitive gameplay data; protect administrator access and
transport.

**Fleets** displays persisted in-flight fleet records: ID, owner ID, mission,
stored returning flag, target coordinates and arrival in database time. The
values are not a calculated live position or proof that an arrival has been
resolved. Inspection neither processes arrivals nor resolves battles or changes
game state. It uses the same explicit, environment-bound administrator POST and
read-only connection as Players. The header offers literal mission substring
search, exact owner/returning filters and sorting on every column. Mission enum
sorting uses its text; keyset pagination preserves filters and order and uses
ID as a tie-breaker. Each request reads 50 rows plus a sentinel; concurrent
changes can affect pagination. Ship composition, cargo and stealth data are not
selected. Results are not stored in WordPress. Fleet targets and ownership are
sensitive gameplay data, visible to WordPress administrators with inspection
access; protect their accounts and transport.

**Research** reads stored technology records including their owner, level and
optional recorded end time. The end time is database time, not evidence that
research has completed: it may be overdue until the game processes it. This
view does not complete research or change game state. It uses the same explicit
environment-bound administrator POST and read-only connection as Players.
Header controls provide literal technology-name search, owner and end-recorded
filters and sorting on every column. Missing end times sort before recorded
times ascending and after them descending; keyset pagination retains filters,
sort order and an ID tie-breaker, including across missing values. Requests read
at most 50 rows plus a sentinel; concurrent changes can affect pagination and
unindexed searches or sorts can scan many records. Results are not stored in
WordPress. Research levels and ownership are sensitive gameplay data; protect
administrator access and transport.

**Content and assets** describes existing responsibilities and integration
boundaries; it does not enable game changes. Game news uses the separate WordPress Game News plugin.
Game-state editing, fleet actions and asset administration are not connected to
this plugin. Deployment remains in Deployment Status.

All other tables (connection profiles, snapshot metadata, overview counts,
setup checks, migration inventory and Deployment Status evidence) offer
per-column search, exact-value filtering and ascending/descending sorting
directly in their headers when JavaScript is enabled. These operate only on the
complete displayed snapshot, independently for each table. A header count
reports matching/total rows; **Reset view** restores the original order and clears
filters. Without JavaScript, the original tables remain readable. Sorting the
migration inventory changes presentation only: canonical execution and exported
review ordering are unchanged, and no operation is approved or enabled.

The **Environment setup checklist** summarizes the selected database, private
inspection credentials, fresh candidate/database snapshot, migration review and
locked execution prerequisites. It distinguishes **Observed**, **Action
required** and **Blocked**; none means operational readiness. It validates
snapshot freshness, identity and digest again before deriving checklist evidence.
An empty target requires independent verification and seed review, an untracked
schema requires audit/adoption, and pending migrations require review. Reported
migration blockers remain blocked. Even with no pending migrations, execution
requires the still-unimplemented approval, backup/restore, writer-coordination
and authorized-runner infrastructure.

The checklist does not connect to MySQL, inspect grants, save options, generate
reports or execute jobs. A configured password is not proof of a successful
connection or SELECT-only privileges. Use the explicit connection test and the
separate read-only CLI snapshot producer for their respective checks.

Reports older than 15 minutes or more than 60 seconds in the future are rejected.
Invalid JSON, wrong environments/databases, duplicate entries and changed plan
contents produce visible errors. Report files are local, bounded to 2 MiB and
never fetched from a URL supplied by a browser.

**Configuration editing, setup, migrations, backup and restore remain locked.**
Only inspection profiles and legacy database-name settings are writable; no
game/schema mutations occur. A tracked database or a fresh report is not
readiness, backup or deployment approval. The candidate must still be
`not-deployable`.

### Downloadable migration review evidence

A valid inspection report offers **Download read-only review plan (JSON)** in
the selected environment. The authenticated POST requires `manage_options` and
a nonce bound to the environment and displayed plan digest. The server rereads
its fixed report path and revalidates freshness, target identity, candidate and
digest. Changed plans or database selections require reloading and reviewing
the current page; browser-supplied paths are never used.

The download uses schema version `1`, purpose `manual-migration-review` and
`execution_allowed: false`. It includes observation/export timestamps, selected
database identity, candidate commit/version and manifest/baseline hashes,
ordered migration names/statuses/SQL hashes, and blockers. Explicit field
projection excludes unknown report metadata, credentials and SQL bodies. Its
`source_plan_sha256` identifies the inspected source; `plan_sha256` hashes the
exported plan using compact JSON with unescaped slashes and preserved field
order. These digests can differ if extra source fields were excluded.

The response is an attachment with private/no-store caching and JSON/nosniff
headers. No export file is retained on the server. Treat downloaded operational
metadata as private. This is review evidence, not an independently signed
attestation, live database check, job request, backup or production approval.
Exports may include blockers and never unlock setup, migration or restore.

This plugin is not part of the published Deployment Status 0.2.0 release.
Its own WordPress updater and release workflow are implemented; an initial
Administration release still needs to be published.

## Independent installation and updates

Requirements: WordPress 6.5+, PHP 8.2+ with `ext-zip`, writable plugin directories
and outbound HTTPS to GitHub and its public release download CDN.

Once published, upload the release asset `gq-game-admin-X.Y.Z.zip` through
**Plugins > Add New > Upload Plugin**. Do not upload GitHub's source-code ZIP.
The canonical installation contains:

```text
wp-content/plugins/gq-game-admin/gq-game-admin.php
wp-content/plugins/gq-game-admin/gq-github-plugin-updater.php
wp-content/plugins/gq-game-admin/gq-admin-tables.php
```

Both plugin ZIPs bundle the same updater engine, but neither plugin requires the
other to be installed or active. Engine class revisions must change with engine
behavior/API changes so a previously installed copy cannot shadow a newer one.
Administration accepts only published stable
`gq-game-admin-vX.Y.Z` releases; deployment/game tags, drafts and prereleases are
ignored. It uses its own cache and optional private `GQ_GAME_ADMIN_GITHUB_TOKEN`
for API calls. The token is never forwarded to release downloads.

WordPress controls updates and its normal auto-update setting; this plugin does
not force automatic installation. The Administration page links to the native
Plugins screen. Flat-file, symlink and hardlink development installs cannot
self-update. To migrate a flat-file installation, deactivate it and remove only
its plugin hardlink/file before uploading the canonical ZIP; preserve private
`wp-config.php` settings and never activate both copies.

Discovery caches results for one hour and errors for five minutes, displaying
cached failures to users with `update_plugins`. Installation rechecks the exact
release, canonical package URL and newer version, then verifies GitHub SHA-256,
size, ZIP paths/types, expanded size, plugin entrypoint/version and bundled
updater. Failed downloads are deleted. Public release assets are required.
Checksums trust the GitHub release/API, not an independent publisher signature.
Verify the checksum before the initial manual ZIP upload; recovery is a known-good
plugin ZIP or hosting backup, never a game/database rollback.

For release preparation, bump the header and `GQ_GAME_ADMIN_PLUGIN_VERSION`.
Use an immutable `gq-game-admin-vX.Y.Z` tag on a reviewed `main` commit or a
plugin-only snapshot on `release/wordpress-plugin`. The **WordPress Plugin Release**
workflow tests and packages the selected plugin, producing its ZIP, `.sha256`
and `.release.json` provenance manifest. It verifies uploaded draft assets before
publishing with `latest=false`; existing releases are never replaced. This path
does not execute migrations, install the game or change staging/production.

## Local installation

Install this alongside, not instead of, the deployment plugin. For local
development on the same NTFS volume:

```powershell
New-Item -ItemType HardLink `
  -Path C:\Projects\GalaxyQuest\wordpress\wp-content\plugins\gq-game-admin.php `
  -Target C:\Projects\GalaxyQuest\wordpress-integration\gq-game-admin.php
# Create this shared helper link once, not once per plugin.
New-Item -ItemType HardLink `
  -Path C:\Projects\GalaxyQuest\wordpress\wp-content\plugins\gq-github-plugin-updater.php `
  -Target C:\Projects\GalaxyQuest\wordpress-integration\gq-github-plugin-updater.php
New-Item -ItemType HardLink `
  -Path C:\Projects\GalaxyQuest\wordpress\wp-content\plugins\gq-admin-tables.php `
  -Target C:\Projects\GalaxyQuest\wordpress-integration\gq-admin-tables.php
```

Activate **GalaxyQuest Administration** on the WordPress Plugins page.
Recreate a hardlink if an editor replaces the source inode. The two plugin menus
and function prefixes are independent.

### Separate local databases

Use `galaxyquest` for game data and `wordpress` for WordPress. The local
`wordpress/wp-config.php` is ignored by Git and must use its own database name
and credentials, not the Compose web service's game connection defaults. The
WordPress account is scoped to `wordpress.*`; the game account is scoped to
`galaxyquest.*`. Provision the WordPress database/account separately on a fresh
MySQL volume; this plugin does not create them.

When separating an existing installation, preserve its `wp_` tables, users,
posts, options and table prefix. Back up the data and private configuration,
verify a restore, and quiesce WordPress before moving its tables and switching
credentials. Never initialize over the existing installation. Keep backups
outside webroots and Git with owner-only access.

The Administration plugin's Staging database name remains `galaxyquest`; legacy
name options live in WordPress's separate database. Game connection tests still
require explicit private inspection credentials and never reuse WordPress's
own credentials. Production must remain unset until a separate target exists.

The existing local `http://localhost:8081/wordpress` installation can continue
using its password-free legacy form, but cannot submit credentials. For the
separate loopback-only HTTPS instance and persistent private inspection profiles,
see [Local HTTPS](LOCAL_HTTPS.md). Its self-signed certificate requires explicit
local browser trust; it does not change or restart the existing web service.

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

Configure fixed report paths in the private `wp-config.php`, and configure the
expected database identities through the Administration page:

```php
define('GQ_GAME_ADMIN_STAGING_REPORT_FILE', '/srv/galaxyquest/private/staging-administration.json');
define('GQ_GAME_ADMIN_PRODUCTION_REPORT_FILE', '/srv/galaxyquest/private/production-administration.json');
```

### Plesk-created MySQL databases and connection testing

Create each database and its user/grants in **Plesk**, not in WordPress. In
**GalaxyQuest Administration**, select Staging or Production and enter the
database name, host, port, inspection user and password. **Test entered
credentials** tests the submitted values without saving them. Password-bearing
forms require HTTPS, including locally; do not enter credentials on an HTTP
site. Remote MySQL TLS is not configured by this initial probe: prefer a local
database server.

To **save an inspection profile**, an administrator must first configure the
fixed private `DB_CONFIG_FILE` path and provision an existing writable private
directory outside all webroots, owned by the PHP user with mode `0700`. Profile
files written by the plugin use mode `0600`; saving requires POSIX ownership
checks and is unavailable on Windows PHP. No submitted path, password or
credential is saved in WordPress options. The selected JSON file is updated
atomically, with a concurrent-change check and explicit confirmation before
replacing an existing profile. Leaving the password blank retains the existing
password only if the database, host, port and user are unchanged. The password
is never redisplayed. A successful save does not itself test the connection.

When a JSON profile is configured, its database name is authoritative; old
WordPress database-name options are not modified or used. Profile database names
allow 1–64 ASCII letters, digits, underscores and hyphens, matching the CLI
collector. In legacy constant-only configurations, stored database names
remain separate per environment. Legacy `GQ_GAME_ADMIN_<ENV>_EXPECTED_DATABASE`
constants remain initial defaults; an explicitly saved name takes precedence.
The separate legacy form can save a database name or test using existing
server-stored credentials without submitting a password, including on HTTP.
It cannot edit the constants or save a private JSON profile.

Each environment tab displays its server-configured host, port and database user,
plus whether a password is configured, without displaying the password. Missing
or invalid credentials produce an explicit configuration error. This display
does not open a database connection or certify connectivity or permissions:
use **Test entered database** for the read-only connection check. Profiles are
environment-specific; switching tabs never displays the other environment's
connection details.

Provide separate private credentials for the connection test. Example values
only; never use the WordPress database account:

Prefer the collector's existing private JSON connection file so that WordPress
and `inspect_game_administration.php --db-config=...` use the same credentials.
Configure its fixed absolute path per environment in `wp-config.php`:

```php
define('GQ_GAME_ADMIN_STAGING_DB_CONFIG_FILE', '/srv/galaxyquest/private/staging-inspection-db.json');
define('GQ_GAME_ADMIN_PRODUCTION_DB_CONFIG_FILE', '/srv/galaxyquest/private/production-inspection-db.json');
```

Use the environment-bound JSON format shown above, with a nonempty password.
For collector compatibility, JSON database names use only ASCII letters, digits,
underscores and hyphens (at most 64 characters).
Files must be local, readable, at most 64 KiB, and outside the WordPress,
plugin/repository and known document roots. Symlinks in the path are rejected;
resolved paths are also checked. On Unix use `0600` or `0640` (no group-write or
other-user permissions); on Windows restrict the file's ACL to its operators and
the PHP service identity. Keep these files outside every other site's webroot
and all release archives too. Manual provisioning needs read access; saving
through WordPress additionally needs the stricter owner-only POSIX access above.

A configured file takes precedence over the constants below. Missing, invalid,
wrong-environment or unsafe files fail closed: the plugin never silently falls
back to another credential source. The selected tab shows the credential source
and bound database, never the private file path or password. Review a new
profile carefully before confirming replacement: the CLI collector will use
the new credentials and target if it reads that same file.

Existing constant-only installations remain supported when no `DB_CONFIG_FILE`
is defined:

```php
define('GQ_GAME_ADMIN_STAGING_DB_HOST', '127.0.0.1');
define('GQ_GAME_ADMIN_STAGING_DB_PORT', 3306);
define('GQ_GAME_ADMIN_STAGING_DB_USER', 'galaxyquest_staging_inspector');
define('GQ_GAME_ADMIN_STAGING_DB_PASSWORD', 'REPLACE_WITH_PRIVATE_PASSWORD');
define('GQ_GAME_ADMIN_PRODUCTION_DB_HOST', '127.0.0.1');
define('GQ_GAME_ADMIN_PRODUCTION_DB_PORT', 3306);
define('GQ_GAME_ADMIN_PRODUCTION_DB_USER', 'galaxyquest_production_inspector');
define('GQ_GAME_ADMIN_PRODUCTION_DB_PASSWORD', 'REPLACE_WITH_PRIVATE_PASSWORD');
```

`DB_HOST` defaults to `localhost` and integer `DB_PORT` to `3306`; user and
nonempty password must be explicitly configured for each environment. Use a
local Plesk database server/socket and dedicated **SELECT-only** inspection
accounts. Remote database TLS configuration is not provided by this initial
probe. PHP `ext-mysqli` is required (normally already present for WordPress).
The plugin release workflow exercises valid and rejected connections against
an isolated MariaDB 11.8 service; it never uses Plesk or a game database.

**Test entered credentials** opens a fresh connection with five-second connect/read
timeouts, sets its session to `TRANSACTION READ ONLY`, then runs only
`SELECT DATABASE(), VERSION()`. It verifies the returned identity, closes the
connection, and reports success or a sanitized failure without exposing secrets.
It does not create databases/tables/users, execute migrations, persist the entered
credentials or certify setup/migration permissions. The actions require
`manage_options`, POST and an environment-specific WordPress nonce.

Saving an inspection profile does **not** rewrite the game's private runtime
configuration. If the collector is explicitly configured to read the same JSON
file, it uses the newly saved inspection profile. The game's runtime account
stays separate. Keep those reviewed server settings consistent. Existing
snapshots for a different database are rejected immediately; regenerate a
matching fresh report before relying on migration inventory. Test results are
short-lived per-user notices, not persistent readiness or deployment approvals.

Passwords are submitted only over HTTPS, never prefilled or stored in WordPress
options. No API keys, arbitrary command strings or submitted file paths are
accepted in the form. The report's plan digest
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
