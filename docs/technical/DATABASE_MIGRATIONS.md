# Database Migrations – GalaxyQuest

## Overview

GalaxyQuest uses a **manifest-based, transactional migration runner** for all database schema changes.
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

---

## Files

| File | Purpose |
|------|---------|
| `scripts/migrate.php` | CLI entry point |
| `lib/MigrationRunner.php` | Core runner class (apply / rollback / status) |
| `config/migrations_manifest.php` | Canonical ordered list of all migration files |
| `sql/schema_migrations.sql` | DDL for the tracking table |
| `sql/migrate_*.sql` | Forward (up) migration files |
| `sql/migrate_*_down.sql` | Rollback (down) migration files (optional) |
| `docs/technical/DATABASE_MIGRATIONS.md` | This document |

---

## Migration Tracking Table

The `schema_migrations` table is created automatically on first use:

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

---

## Canonical Migration Order

The canonical migration order is maintained in `config/migrations_manifest.php`.
**New migrations must always be appended to the end** of that array; reordering
existing entries would break incremental upgrades on existing deployments.

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

---

## Rollback Behaviour

| Scenario | Behaviour |
|----------|-----------|
| `_down.sql` exists | Runs the rollback SQL in a transaction, removes the row from `schema_migrations`. |
| `_down.sql` missing | Reports `no_down_file` and skips; the tracking record is preserved. |
| SQL error during rollback | Transaction is rolled back; DB remains unchanged; error is thrown. |

> **Note:** Many legacy migrations (pre-Sprint 1.4) do not have companion
> `_down.sql` files and cannot be automatically rolled back.  For those,
> manual SQL or a point-in-time backup restore is required.

---

## Transaction Safety

Every migration (up or down) runs inside a single `PDO` transaction:

- If any statement fails, the **entire migration is rolled back** — the DB is
  left in the state it was in before the migration started.
- The `schema_migrations` tracking record is inserted/deleted inside the same
  transaction, so the tracking table always reflects the true DB state.

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
