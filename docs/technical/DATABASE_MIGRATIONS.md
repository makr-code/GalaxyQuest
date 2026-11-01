# Database Migrations – GalaxyQuest

## Overview

GalaxyQuest uses a **manifest-based migration runner** for database schema changes.
Every migration is a plain `.sql` file stored in `sql/`.  The runner tracks applied migrations in a
`schema_migrations` table and supports dry-run preview, step-limited execution, and rollback via
companion `_down.sql` files.

---

## Quick Start

```bash
# Show which migrations are applied / pending
php scripts/migrate.php status

# Apply all pending migrations
php scripts/migrate.php up

# Verify the deployed image's full manifest and exact stored checksums without writing SQL
php scripts/migrate.php verify

# Preview (no DB changes)
php scripts/migrate.php up --dry-run

# Apply only the next 3 pending migrations
php scripts/migrate.php up --step=3

# Roll back the last applied migration
php scripts/migrate.php rollback

# Roll back the last 2 applied migrations
php scripts/migrate.php rollback --step=2

# Roll back (dry-run)
php scripts/migrate.php rollback --dry-run
```

Set `GQ_ENV=PROD` (or any label) to tag migrations in the tracking table:

```bash
GQ_ENV=PROD php scripts/migrate.php up
```

### CLI validation and exit codes

Arguments are validated before loading database configuration or connecting.
Commands are exactly `status`, `verify`, `up` and `rollback`; unknown arguments (including
misspelled `--dry-run`), extra commands and duplicate options fail with exit 1.
`--step` must be a positive decimal integer within PHP's integer range; zero,
negative, fractional and overflowing values are rejected, never clamped.
The runner also rejects nonpositive step counts for direct callers.
`status` and `verify` reject `--step` and `--dry-run`, since neither has a defined effect.
Options may precede the command. `--env` / `GQ_ENV` must contain 1-20 ASCII
letters, digits, underscores or hyphens, matching the tracking-column capacity;
labels are stored uppercase. `--sql-dir` must identify a readable directory.

`--help` exits 0 without database dependencies. Successful commands exit 0.
Connection, manifest, lock, integrity and SQL failures are reported on stderr
and exit 1 without an unhandled stack trace or success-shaped summary.
CLI diagnostic details are operator-only, not HTTP responses. Programming
errors are not broadly caught as expected operational failures.
Unit subprocess tests use the actual CLI source with isolated configuration,
DB and runner fixtures to verify routing and error exits; they do not replace
the real MySQL migration gate.

---

## Files

| File | Purpose |
|------|---------|
| `scripts/migrate.php` | CLI entry point |
| `lib/MigrationRunner.php` | Core runner class (apply / rollback / status / deployment verification) |
| `config/migrations_manifest.php` | Canonical ordered list of all migration files |
| `sql/schema_migrations.sql` | DDL for the tracking table |
| `sql/migrate_*.sql` | Forward (up) migration files |
| `sql/migrate_*_down.sql` | Rollback (down) migration files (optional) |
| `docs/technical/DATABASE_MIGRATIONS.md` | This document |

---

## Migration Tracking Table

The `schema_migrations` table is created by explicit bootstrap, CLI `status`
and non-preview migration operations when absent. `verify` never creates it:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    migration_name  VARCHAR(255)  NOT NULL,
    applied_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    checksum        VARCHAR(64)   NOT NULL,   -- MD5 of SQL at application time
    environment     VARCHAR(20)   NOT NULL DEFAULT 'unknown',
    execution_ms    INT           NOT NULL DEFAULT 0,
    UNIQUE KEY uq_migration_name (migration_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## Read-only deployment integrity gate

Run `php scripts/migrate.php verify --env=PROD` **from the candidate image**
against the target database after reviewed migrations and before admitting
gameplay traffic. Exit 0 prints the verified forward-migration count only when:

1. The tracking table already exists and can be read.
2. Every tracked name belongs exactly to the candidate's canonical manifest.
3. All applied manifest files are readable and their exact MD5 bytes match
   the stored checksums, using the existing Up/Rollback integrity helper.
4. No manifest migration is pending.

Verification holds the same DB-scoped advisory lock (`GET_LOCK`, timeout 0)
as Up/Rollback from before the tracking probe through checksum comparison.
A competing migration, active MySQL caller transaction, missing selected DB,
rights error, drift, pending migration or manifest-foreign history blocks the
gate. The lock is released on success and failure. SQLite unit fixtures have
no advisory-lock equivalent; MySQL behavior is tested separately.

The gate never executes migration or rollback SQL, creates tracking storage,
rewrites checksums, deletes foreign history, or acquires DDL/DML privileges.
A SELECT-only MySQL test account can verify an already migrated DB; denied
SELECT fails with the original PDO error. CLI `--env` is accepted for consistency
but verification records nothing. `--sql-dir` selects bytes to verify, not an
alternative manifest. A fresh database fails even with an empty manifest unless
existing empty tracking storage is present.

Manifest-foreign history is deliberately stricter than the existing Up/Rollback
preflight and informational `status`: it also prevents an older candidate with
a shorter manifest from being automatically approved against a newer DB.
Do not delete rows or rewrite checksums to pass. Restore the originally applied
release SQL, then use reviewed append-only upgrades. An intentional older-image
rollback needs a reviewed schema-compatibility/recovery process; this gate does
not infer backward compatibility.

**Limits:** matching migration bytes and tracking records do not prove that
every statement previously completed, that nobody manually modified schema/data,
or that the image is authentic. MD5 is historical change detection, not a
cryptographic release attestation. Down-file hashes, full schema diff,
backup/restore rehearsal and gameplay/native-renderer readiness remain separate
gates. Direct SQL and other independent DB servers are not coordinated by this
lock. CLI verification has no end-to-end deadline; do not substitute it for the
bounded public readiness probe or run it on every request.

CI smoke runs Up, second Up, informational Status, then Verify before bounded
HTTP readiness, user seed and browser tests. Local validation includes 119
focused runner/actual-CLI fixture tests and 16 real MySQL tests / 366 assertions:
the complete 64-entry fresh install verifies and its second Up is empty,
SELECT-only verification leaves tracking/data unchanged, drift/foreign/pending
and absent tracking fail, concurrent locks and caller transactions are respected.
Canonical fixture SQL omits hardcoded `USE galaxyquest` for DB-name isolation;
checksums correspond to those executed fixture bytes. This is not a new
production-image or remote-CI certification.

---

## Canonical Migration Order

The canonical migration order is maintained in `config/migrations_manifest.php`.
**New migrations must always be appended to the end** of that array; reordering
existing entries would break incremental upgrades on existing deployments.
The runner rejects non-list manifests, duplicate filenames (including case-only
collisions), paths, non-SQL filenames and `_down.sql` entries at construction.
Only plain forward filenames composed of letters, numbers, `_` and `-` are
accepted; companion rollback files are discovered separately.

### All Migrations (current manifest)

| # | File | Category |
|---|------|----------|
| 1 | `migrate_v2.sql` | Core schema (legacy v2 path) |
| 2 | `migrate_gameplay_model_v1.sql` | Gameplay base model |
| 3 | `migrate_politics_model_v1.sql` | Politics model |
| 4 | `migrate_economy_v1.sql` | Economy |
| 5 | `migrate_economy_v2.sql` | Economy |
| 6 | `migrate_economy_v3.sql` | Economy |
| 7 | `migrate_economy_policies_v1.sql` | Economy policies |
| 8 | `migrate_economy_shortage_v1.sql` | Economy shortages |
| 9 | `migrate_empire_categories_v1.sql` | Empire categories |
| 10 | `migrate_security_v1.sql` | Security / auth |
| 11 | `migrate_security_v2_totp.sql` | TOTP 2FA |
| 12 | `migrate_admin_user_crud_v1.sql` | Admin user CRUD |
| 13 | `migrate_rbac_v1.sql` | Role-based access control |
| 14 | `migrate_actor_model_v1.sql` | NPC actor model |
| 15 | `migrate_actor_model_v2_drop_is_npc.sql` | Actor model v2 |
| 16 | `migrate_colonization_v1.sql` | Colonization |
| 17 | `migrate_colonization_v2.sql` | Colonization v2 |
| 18 | `migrate_colony_buildings_v1.sql` | Colony buildings |
| 19 | `migrate_unified_bodies_v1.sql` | Unified celestial bodies |
| 20 | `migrate_unified_bodies_v2_hardcut.sql` | Unified bodies v2 |
| 21 | `migrate_orbital_polar_coordinates_v1.sql` | Orbital coordinates |
| 22 | `migrate_galaxies_metadata.sql` | Galaxy metadata |
| 23 | `migrate_fog_of_war.sql` | Fog of war |
| 24 | `migrate_vessel_blueprints_v1.sql` | Vessel blueprints v1 |
| 25 | `migrate_vessel_blueprints_v2.sql` | Vessel blueprints v2 |
| 26 | `migrate_vessel_blueprints_v3.sql` | Vessel blueprints v3 |
| 27 | `migrate_vessel_blueprints_v4.sql` | Vessel blueprints v4 |
| 28 | `migrate_vessel_blueprints_v5.sql` | Vessel blueprints v5 |
| 29 | `migrate_vessel_blueprints_v6_planetary_events.sql` | Planetary events |
| 30 | `migrate_vessel_blueprints_v7_research_phase5.sql` | Research phase 5 |
| 31 | `migrate_vessel_blueprints_v8_wormholes.sql` | Wormholes |
| 32 | `migrate_vessel_blueprints_v9_wormhole_beacons.sql` | Wormhole beacons |
| 33 | `migrate_vessel_blueprints_v10_ftl_drives.sql` | FTL drives |
| 34 | `migrate_vessel_blueprints_v11_ftl_phase4.sql` | FTL phase 4 |
| 35 | `migrate_vessel_blueprints_v12_npc_ftl.sql` | NPC FTL |
| 36 | `migrate_combat_model_v1.sql` | Combat model |
| 37 | `migrate_combat_v1_wars.sql` | Wars (combat v1) |
| 38 | `migrate_npc_wars_v1.sql` | NPC wars |
| 39 | `migrate_war_v3.sql` | War v3 |
| 40 | `migrate_fleet_labels_v1.sql` | Fleet labels |
| 41 | `migrate_transport_generic_v1.sql` | Generic transport |
| 42 | `migrate_faction_species_v1.sql` | Faction species |
| 43 | `migrate_faction_agreements_v1.sql` | Faction agreements |
| 44 | `migrate_npc_pve_controller_v1.sql` | NPC PvE controller v1 |
| 45 | `migrate_npc_pve_controller_v2.sql` | NPC PvE controller v2 |
| 46 | `migrate_llm_soc_v1.sql` | LLM SoC / prompt catalog |
| 47 | `migrate_npc_chat_history_v1.sql` | NPC chat history |
| 48 | `migrate_pirates_v2.sql` | Pirate system v2 |
| 49 | `migrate_pirates_v3.sql` | Pirate system v3 |
| 50 | `migrate_traders_system_v1.sql` | Traders system |
| 51 | `migrate_trade_proposals_v1.sql` | Trade proposals |
| 52 | `migrate_marketplace_advisor.sql` | Marketplace advisor |
| 53 | `migrate_projection_system_snapshot_v1.sql` | System snapshots |
| 54 | `migrate_projection_user_overview_v1.sql` | User overview projections |
| 55 | `migrate_projection_runtime_v2.sql` | Runtime projections v2 |
| 56 | `migrate_tts_v1.sql` | Text-to-Speech |
| 57 | `migrate_prolog_quests_v1.sql` | Prolog / onboarding quests |
| 58 | `migrate_world_scenarios_v1.sql` | World scenarios |

> **Note:** `migrate_regen_spiral.sql` is a special maintenance migration that
> is only applied on demand via `setup.php --regen-galaxy`.  It is intentionally
> excluded from the regular manifest.

---

## Writing a New Migration

1. Create `sql/migrate_<feature>_v<N>.sql` with the forward SQL.
2. Optionally create `sql/migrate_<feature>_v<N>_down.sql` with the rollback SQL.
3. Append the filename to the **end** of the array in `config/migrations_manifest.php`.
4. Document the migration in this file (append a row to the table above).

### Example: `sql/migrate_example_v1.sql`

```sql
-- migrate_example_v1.sql
-- Adds the `example` table.
CREATE TABLE IF NOT EXISTS example (
    id   INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### Example: `sql/migrate_example_v1_down.sql`

```sql
-- migrate_example_v1_down.sql
-- Removes the `example` table (rollback for migrate_example_v1.sql).
DROP TABLE IF EXISTS example;
```

### Working with ALTER TABLE and Data Manipulation

For detailed guidance on ALTER migrations and data manipulation patterns, see:
- **[ALTER_MIGRATIONS_GUIDE.md](./ALTER_MIGRATIONS_GUIDE.md)** — Comprehensive patterns for:
  - Adding/modifying/removing columns
  - Managing indexes and constraints
  - Backfilling data
  - Data cleanup and validation
  - Foreign key management
  - Handling transactions and rollbacks

Example patterns:
- [Pattern 1: Adding New Columns](./ALTER_MIGRATIONS_GUIDE.md#pattern-1-adding-new-columns)
- [Pattern 2: Modifying Existing Columns](./ALTER_MIGRATIONS_GUIDE.md#pattern-2-modifying-existing-columns)
- [Pattern 6: Data Backfilling](./ALTER_MIGRATIONS_GUIDE.md#pattern-6-data-backfilling)

### Reference Migrations

For concrete examples of complex migrations, see:
- **`sql/migrate_alter_examples_v1.sql`** — 15 patterns for ALTER TABLE operations with detailed comments
- **`sql/migrate_data_manipulation_patterns_v1.sql`** — 15 patterns for data manipulation with use cases

> **Note:** These reference migrations are for documentation/learning and should NOT be applied to production databases. They are included only to show best practices.

---

## Rollback Behaviour

| Scenario | Behaviour |
|----------|-----------|
| `_down.sql` exists | Runs the rollback SQL, removes the row from `schema_migrations` only after all statements succeed. MySQL DDL may commit implicitly. |
| Any selected `_down.sql` missing | Reports `no_down_file` for the barrier and blocks the entire selected rollback before SQL; all tracking records are preserved. CLI exits 1, including dry-run. |
| Selected companion exists but is not a readable file | Preflight fails before rollback SQL; no selected migration is reverted. |
| SQL error during rollback | Rolls back any still-active transaction and preserves the tracking record; throws the original SQL error with migration context. Already committed DDL changes remain. |

> **Note:** Many legacy migrations (pre-Sprint 1.4) do not have companion
> `_down.sql` files and cannot be automatically rolled back.  For those,
> manual SQL or a point-in-time backup restore is required.

Rollback preflight examines companions for all selected applied migrations
under the advisory lock before executing the first one. It never skips an
irreversible newer migration to roll back an older dependency, and a barrier
later in the selected range also prevents reverting the newer ones first.
The result remains `no_down_file` for API compatibility, but CLI treats that
result as an explicit blocked operation, not successful completion.
Unknown result statuses also fail instead of printing a successful summary.
Step-limited rollback checks only its selected range: an older barrier outside
that range does not prevent reverting a newer, reversible migration.

This preflight checks existence and readability, not SQL correctness or
semantic reversibility. Once execution begins, invalid SQL can still leave
partially committed DDL. A companion file is not proof that data recovery is
possible; use reviewed recovery procedures and tested backups.

---

## Transaction Safety

The runner begins a `PDO` transaction for each migration (up or down), but
**MySQL/MariaDB DDL is not transactionally reversible**:

- Pure DML against transactional tables (InnoDB) and the tracking update commit
  together; an SQL error rolls back the active transaction.
- Statements such as `CREATE TABLE`, `ALTER TABLE` and `DROP TABLE` implicitly
  commit on MySQL. Earlier changes and subsequent autocommitted statements can
  persist even if a later statement fails.
- The runner commits or rolls back only while `PDO::inTransaction()` is true.
  This prevents a secondary "There is no active transaction" error from masking
  the original failure.
- On failure after an implicit commit, the exception warns that changes may
  already be committed. A failed up-migration is not marked applied; a failed
  down-migration keeps its tracking record. Tracking therefore identifies
  completed migrations, not proof that no partial changes exist.

Back up the database before schema changes. Inspect and reconcile partial DDL
changes before retrying; do not blindly rerun a failed migration or assume a
companion down-file provides atomic recovery.

### Concurrent migration protection

`MigrationRunner::bootstrap()`, `runUp()` and `runRollback()` acquire a
nonblocking MySQL/MariaDB session advisory lock **before** tracking-table DDL
or reading the applied-migration list. The lock covers the entire run, not
individual migrations, including dry runs and final tracking updates.
Nested bootstrap calls use the already-held lock. Lock names are
`gq:migrations:` followed by the first 48 SHA256 characters of `DATABASE()`,
so different databases on the same server do not share a lock. Environment
labels, manifest paths and filesystem locations do not change its identity.

`GET_LOCK(name, 0)` returns immediately. If another connection owns the lock,
the runner fails explicitly; the CLI exits nonzero. Wait for the owning
deployment to finish, inspect its result, then retry. Do not delete tracking
rows or use `RELEASE_ALL_LOCKS` to bypass contention.

Session locks survive commits, rollbacks and MySQL DDL implicit commits.
They are released in `finally` and when the database connection closes.
A failed release is an error after an otherwise successful run. If an
operation already failed, release failures are logged without replacing the
original exception. Use a dedicated nonpersistent connection with a selected
database and no caller transaction; active MySQL transactions are rejected
before any changes so bootstrap cannot implicitly commit caller work.

This coordinates cooperating runners on one MySQL/MariaDB server, not
independent servers, manual SQL, old migration paths, base-schema import or
runtime DDL outside this runner. SQLite keeps the isolated unit-test behavior
and does not provide this advisory-lock guarantee; other drivers fail
explicitly. Status reads are informational snapshots, not locked migration
transactions. Migrations must not change the selected database or manipulate
these session locks.

### Applied-file integrity and deployment preflight

Before up or rollback, including previews and no-op runs, the runner validates
every **applied entry still in the current manifest** against its stored MD5
checksum under the migration lock. Missing/unreadable forward SQL or a checksum
mismatch stops the run before pending migrations or rollback statements execute.
All selected pending forward files are also checked for readability before the
first migration executes; a missing later file cannot leave an earlier DDL
migration applied. Step-limited up checks only the selected pending files, but
always verifies all manifest-listed applied files.

Checksums cover exact file bytes, including comments, whitespace and line endings.
Use immutable release files and consistent checkout line endings across
deployments. MD5 is retained for compatibility with existing tracking records;
this detects drift, not cryptographic authenticity. Files must not be modified
while a deployment is running. Pending SQL is not executed or syntax-validated
by preflight, so syntax errors can still leave partially committed DDL.

If a check fails, restore the originally applied SQL from its release artifact
and investigate the difference. Do not automatically overwrite checksums or
delete tracking rows. Fixes for already-deployed migrations belong in reviewed
new append-only migrations, with schema/data-specific upgrade verification.
Earlier source corrections documented here do not grant permission to rewrite
applied history: existing deployments with those older bytes now fail explicitly
until their original history and a reviewed upgrade path are reconciled.

`status` remains an informational tracking snapshot, not an integrity
certification; use `up --dry-run` to exercise integrity checks without applying
pending migrations. Up/rollback previews on a fresh database treat missing
tracking storage as empty and do not create any tables or execute migration
SQL. They still acquire/release the session advisory lock. Explicit `bootstrap()`,
CLI `status` and real up/rollback runs can create tracking storage on first use.
Only an actual missing-table error triggers bootstrap: MySQL SQLSTATE `42S02`
with driver code 1146, or SQLite's specific missing `schema_migrations` error.
Permission failures, disconnections, locks and unrelated SQL errors propagate
unchanged rather than being replaced by bootstrap errors.
Tracking rows absent from the current manifest are not validated by this
check; reconciliation of historical/alternative migration paths remains open.
Rollback companions have no stored checksum and are not authenticated by the
forward-file check. A backup/restore rehearsal remains mandatory.

### MySQL regression gate

`tests/Integration/MigrationRunnerMySqlTest.php` creates a randomly named
`gq_migration_test_*` database per test and drops only that database afterwards.
It requires an explicitly configured MySQL test server and credentials with
CREATE/DROP DATABASE privileges:

```powershell
$env:GQ_MIGRATION_TEST_DSN = 'mysql:host=127.0.0.1;port=3306;charset=utf8mb4'
$env:GQ_MIGRATION_TEST_USER = 'root'
$env:GQ_MIGRATION_TEST_PASSWORD = '<test-server-password>'
php vendor/bin/phpunit tests/Integration/MigrationRunnerMySqlTest.php --no-coverage --do-not-cache-result --fail-on-warning --fail-on-risky --fail-on-phpunit-deprecation
```

Without `GQ_MIGRATION_TEST_DSN`, these tests are explicitly skipped. CI sets all
three variables and runs this gate before legacy schema initialization, against
its disposable MySQL 8.4 service.

This gate includes runner regression tests and a complete fresh-install test.
It also verifies contention using separate PDO connections, rejection before
tracking-table creation, ownership through DDL and rollback, release after
bootstrap/up/down failures, caller-transaction preservation and database-scope
isolation. `tests/Unit/MigrationLockTest.php` covers unavailable locks, nested
acquisition and release-failure handling with fault injection.
Checksum regressions verify up/rollback previews, unchanged data and tracking
after rejection, removal of an applied file and missing later pending files,
including lock release. SQLite tests additionally cover manifest validation
and checksum failure before any pending SQL.
Fresh-preview tests omit or invalidate bootstrap SQL and verify zero tables,
then verify normal execution still bootstraps. A real MySQL account with CREATE
but no SELECT privilege verifies that tracking permission errors remain 1142
in both normal and preview modes and that the advisory lock is released.
This test additionally requires CREATE USER / DROP USER / GRANT privileges on
the explicitly disposable test server.
The fresh-install test uses a randomly named database, removes only the explicit
`CREATE DATABASE galaxyquest` / `USE galaxyquest` directives from test copies,
and preserves canonical manifest order. It verifies every applied name, tracking
checksum, environment and a no-op second run. Checksums in this isolated fixture
refer to these test copies; deployment tracking uses the original SQL files.
All 84 MariaDB-only conditional ALTER operations in the canonical manifest now
use the existing `information_schema` + `PREPARE` pattern. Each column, index
or constraint is checked independently, so partially applied ALTER groups can
be resumed without adding already-existing objects. Six MySQL test cases read
the actual SQL guards, verify every object exists after application and check
that column definitions, defaults, comments and indexes survive reexecution.
These tests isolate the guards; they do not validate all migration data changes.
A database-independent test rejects reintroduced conditional ALTER syntax.

The complete `migrate_v2.sql` now applies to the current `schema.sql` in a
randomly named MySQL test database. Four legacy data backfills check for their
source columns before execution: `planets.user_id`, `buildings.planet_id`,
`ships.planet_id` and `fleets.origin_planet_id`. When those columns are absent,
the current colony-based model is already in use and no legacy data is copied.
When present, the original backfills still run; missing other required columns
remain errors rather than silently discarding data. Regression fixtures verify
ownership, resources, homeworld flags and timestamps, preserve non-null colony
links, exclude unowned planets and check repeat execution.

The v2 TEXT defaults use MySQL's expression-default syntax (`DEFAULT ('{}')`).
The colony-building-slot foreign key uses signed `INT` to match `colonies.id`;
actual MySQL tests verify cascading colony-ID updates and deletion of slots
and their upgrade queue.

The unified-bodies hardcut also checks for legacy report source columns:
`battle_reports.planet_id` and `spy_reports.target_planet_id`. If present, these
legacy values refer to colony IDs and are mapped through `colonies.body_id`.
Only null target body IDs are backfilled; existing body identities are retained.
Unmatched reports remain null rather than receiving an invented identity.
Adding `spy_reports.target_body_id` no longer depends on a legacy column's
position. MySQL fixtures cover both report schemas, missing target columns,
repeat application and the complete hardcut on the actual current base schema.

NPC FTL assignment uses the canonical `npc_faction_memberships` user-to-faction
mapping, also written by the homeworld seeder. The v12 migration creates this
table before assignment with the same definition as the later homeworld
migration; no existing manifest entry is reordered. It does not invent
memberships for unaffiliated users or rely on an undefined `faction_colonies`
table. The NPC assignment runtime and fleet diplomacy's primary faction lookup
use the same membership source. Database errors in these primary lookups
propagate instead of silently acting as missing membership.

Both migration and runtime preserve human accounts and existing non-default
drives. Tests verify the five faction drive mappings, their `pve_*` aliases,
unaffiliated NPCs and repeat runtime assignment. Runtime assignment checks
the NPC control type and default drive again in its UPDATE.
Already tracked v12 migrations are not automatically replayed; use the corrected
NPC runtime for assignment after canonical memberships have been populated.
Deploy the membership schema before the updated runtime.

The marketplace/advisor migration no longer contains duplicated sections or
stored procedures requiring client `DELIMITER` handling. Eight profile columns
use independent `information_schema` guards, compatible with both the runner
and SQL clients. MySQL fixtures start with an existing rarity column and verify
that missing columns are added while profile values, marketplace entries and
advisor hints survive reexecution. Marketplace backstory remains required with
no default, matching the original first table definition.

Projection timestamp backfill now compares legacy zero dates as strings, avoiding
invalid DATETIME coercion under strict SQL mode. The migration remembers whether
`created_at` existed before ALTERs: newly added timestamps receive historical
`enqueued_at` values, while valid preexisting timestamps are preserved. NULL and
zero-date values are repaired from `enqueued_at`. Regression fixtures verify both
schema states and repetition; the migration does not relax the session SQL mode.

All MySQL regression tests use native PDO prepares, matching `get_db()`.
The SQL splitter preserves backslash-escaped quotes and backslashes in strings,
so species names such as `Vor\'Tak` do not merge adjacent INSERT statements.
World-scenario TEXT defaults use expression syntax, retaining `[]` and `{}`.

Update-system administrator references now target `users`, the actor-model
storage table. Seed configuration entries are inserted only when missing;
reexecution preserves configured values. Tests verify configuration retention
and `ON DELETE SET NULL` for history and configuration audit references.

The complete current manifest now applies **64 migrations / 1,039 statements**
to a fresh MySQL 8.4 database using native prepares. The actual
`php scripts/migrate.php up --env=TEST` CLI was also validated with credentials
restricted to the application test schema: the second run is empty and `status`
reports 64 applied, 0 pending. This is not a populated legacy-upgrade or
production restore rehearsal.

CI initializes `sql/schema.sql`, then runs the canonical migration CLI instead
of an alphabetical wildcard loop. Down migrations, maintenance SQL and learning
examples are therefore not accidentally executed. The remote CI run remains
to be verified, and runtime schema completeness beyond the manifest is a
separate audit requirement.
Do not mark a failed migration as applied to bypass this incompatibility.

The corrected SQL files have new checksums. Existing applied tracking records
are retained and migrations are not automatically replayed; do not delete those
records simply to update checksums. Review partial schema changes before retrying
a previously failed migration.

---

## Environments

The `--env` flag (or `GQ_ENV` environment variable) tags each migration
record.  Recommended labels: `DEV`, `TEST`, `PROD`.  This allows you to audit
which environment first applied each migration.

---

## Relationship to `setup.php`

`setup.php` is the **initial bootstrap** script (fresh install + NPC seeding).
`scripts/migrate.php` is the **incremental upgrade** tool for existing
deployments.  In a typical CI/CD pipeline:

1. **Fresh install:** `php setup.php`
2. **Incremental upgrade:** `php scripts/migrate.php up`
3. **Preview before release:** `php scripts/migrate.php up --dry-run`

---

## CI/CD Integration Example

```yaml
# .github/workflows/deploy.yml (excerpt)
- name: Run pending DB migrations
  run: GQ_ENV=PROD php scripts/migrate.php up
  env:
    DB_HOST: ${{ secrets.DB_HOST }}
    DB_NAME: ${{ secrets.DB_NAME }}
    DB_USER: ${{ secrets.DB_USER }}
    DB_PASS: ${{ secrets.DB_PASS }}
```
