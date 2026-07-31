-- migrate_alter_examples_v1.sql
-- Comprehensive examples of ALTER TABLE operations and data manipulation patterns.
--
-- This migration demonstrates best practices for:
--   • Adding new columns with defaults
--   • Changing column types and constraints
--   • Adding and removing indexes
--   • Backfilling data with UPDATE statements
--   • Cleaning up legacy data
--   • Renaming columns (MySQL 8.0.14+)
--   • Adding foreign key constraints with safe execution
--
-- This is a REFERENCE migration; in production, split these operations into
-- focused, targeted migrations by feature. This file should NOT be applied
-- in a real production environment; it is purely for documentation.

USE galaxyquest;

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 1: Adding New Columns with Safe Defaults
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: Use IF NOT EXISTS to make the migration idempotent.
--                Always provide a sensible default value.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_login_at DATETIME NULL
        AFTER updated_at,
    ADD COLUMN IF NOT EXISTS login_count INT UNSIGNED NOT NULL DEFAULT 0
        AFTER last_login_at,
    ADD COLUMN IF NOT EXISTS failed_login_attempts INT UNSIGNED NOT NULL DEFAULT 0
        AFTER login_count;

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 2: Backfilling Existing Data Before Adding Constraints
-- ─────────────────────────────────────────────────────────────────────────────
-- Important: When adding a NOT NULL column to an existing table with data,
--            ensure the default is set BEFORE adding the NOT NULL constraint.
--            Then backfill any existing rows.

-- Example 1: Backfill with a calculated value
UPDATE users
SET login_count = (
    SELECT COUNT(*)
    FROM user_activity
    WHERE user_activity.user_id = users.id
        AND user_activity.event_type = 'login'
)
WHERE login_count = 0 AND id IN (
    SELECT DISTINCT user_id FROM user_activity WHERE event_type = 'login'
);

-- Example 2: Backfill with conditional logic
UPDATE colonies
SET resource_cache_expires_at = TIMESTAMPADD(HOUR, 1, NOW())
WHERE resource_cache_expires_at IS NULL
    AND status = 'active';

-- Example 3: Backfill with a constant value for legacy data
UPDATE players
SET preferred_language = 'en'
WHERE preferred_language IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 3: Changing Column Types and Constraints
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: When changing a column type, be aware that:
--   • VARCHAR → INT may truncate or cause errors for non-numeric values
--   • INT → VARCHAR is generally safe
--   • Always test with representative production data first
--   • Use MODIFY COLUMN for type changes

-- Example: Increasing precision of decimal values
ALTER TABLE economy_market_prices
    MODIFY COLUMN price_mult DECIMAL(10, 6) NOT NULL DEFAULT 1.000000;

-- Example: Adding a unique constraint to an existing column
-- First, remove duplicates (if any exist):
DELETE FROM faction_preferences
WHERE id NOT IN (
    SELECT MIN(id)
    FROM faction_preferences
    GROUP BY user_id, faction_id
);

-- Then add the unique constraint:
ALTER TABLE faction_preferences
    ADD UNIQUE KEY uq_user_faction (user_id, faction_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 4: Adding Indexes for Performance
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: Add indexes AFTER backfilling data (not before), as indexes
--                slow down bulk inserts/updates. Index creation doesn't require
--                a transaction; it can be done safely on live databases.

ALTER TABLE fleet_units
    ADD INDEX idx_fleet_status (fleet_id, status),
    ADD INDEX idx_owner_created (owner_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 5: Removing Obsolete Columns
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: Before removing a column, ensure no application code
--                references it. You can hide it first by stopping reads,
--                or deprecate it over multiple releases.

ALTER TABLE research_projects
    DROP COLUMN IF EXISTS legacy_phase_id,
    DROP COLUMN IF EXISTS deprecated_flag;

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 6: Data Cleanup - Removing Invalid or Duplicate Data
-- ─────────────────────────────────────────────────────────────────────────────
-- Important: Before deleting data, consider:
--   • Backing up the affected rows
--   • Verifying constraints won't be violated
--   • Testing the DELETE statement in dry-run first

-- Example 1: Remove rows with NULL or empty critical fields
DELETE FROM world_scenarios
WHERE title IS NULL OR title = ''
    OR description IS NULL OR description = '';

-- Example 2: Remove orphaned records (where foreign key target no longer exists)
DELETE FROM fleet_orders
WHERE fleet_id NOT IN (
    SELECT id FROM fleets WHERE is_deleted = 0
);

-- Example 3: Remove aged-out temporary data
DELETE FROM temporary_trades
WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY);

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 7: Renaming Columns (MySQL 8.0.14+)
-- ─────────────────────────────────────────────────────────────────────────────
-- MySQL 8.0.14 introduced the RENAME COLUMN syntax (safer than CHANGE COLUMN).
-- For earlier versions, use: ALTER TABLE table CHANGE COLUMN old_name new_name type;

ALTER TABLE player_profiles
    RENAME COLUMN old_avatar_url TO avatar_url_legacy;

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 8: Adding Foreign Key Constraints Safely
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: First, remove any orphaned rows that would violate the FK.
--                Then add the constraint.
--                Use ON DELETE/ON UPDATE clauses to handle future violations.

-- Step 1: Remove orphans before adding FK
DELETE FROM diplomacy_relations
WHERE actor_id NOT IN (
    SELECT id FROM actors WHERE is_deleted = 0
);

-- Step 2: Add the foreign key constraint
ALTER TABLE diplomacy_relations
    ADD CONSTRAINT fk_diplomacy_actor
        FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 9: Making a Column NOT NULL (for existing nullable columns)
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: Only do this after backfilling all NULL values.

-- Step 1: Backfill NULLs
UPDATE star_systems
SET spectral_class = 'G'
WHERE spectral_class IS NULL;

-- Step 2: Add the NOT NULL constraint
ALTER TABLE star_systems
    MODIFY COLUMN spectral_class ENUM('O','B','A','F','G','K','M') NOT NULL DEFAULT 'G';

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 10: Adding an ENUM Column with New Values
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: ENUM is efficient but inflexible. Use if the set of values
--                is truly fixed. Otherwise, prefer a separate lookup table.

ALTER TABLE combat_actions
    ADD COLUMN IF NOT EXISTS action_category ENUM('offensive','defensive','utility','passive')
        NOT NULL DEFAULT 'passive'
        AFTER action_type;

-- Backfill based on existing action_type
UPDATE combat_actions
SET action_category = CASE
    WHEN action_type IN ('laser_blast', 'missile_strike', 'ion_cannon') THEN 'offensive'
    WHEN action_type IN ('shield_boost', 'armor_repair', 'evasive_maneuver') THEN 'defensive'
    WHEN action_type IN ('emp_pulse', 'scan', 'jam_sensors') THEN 'utility'
    ELSE 'passive'
END
WHERE action_category = 'passive';

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 11: Changing Default Values for New Inserts
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: Changing DEFAULT doesn't affect existing rows.
--                Combine with UPDATE if you need to backfill.

ALTER TABLE colonies
    MODIFY COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1;

-- Backfill existing rows if needed:
UPDATE colonies
SET is_active = 1
WHERE is_active IS NULL OR is_active = 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 12: Complex Data Transformation
-- ─────────────────────────────────────────────────────────────────────────────
-- Example: Splitting data from one column into multiple columns.
--
-- Scenario: Migrating from a comma-separated list in one column to individual rows.
-- This must be done BEFORE the original column is dropped.

-- Step 1: Create the new table structure (if not already created)
CREATE TABLE IF NOT EXISTS vessel_cargo_inventory (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    vessel_id INT UNSIGNED NOT NULL,
    cargo_type VARCHAR(64) NOT NULL,
    quantity DECIMAL(14,4) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_vessel_cargo (vessel_id, cargo_type),
    KEY idx_vessel (vessel_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Step 2: Populate from legacy data (example with FIND_IN_SET or JSON parsing)
-- For comma-separated: cargo_list = "metal,5000,crystal,3000"
INSERT IGNORE INTO vessel_cargo_inventory (vessel_id, cargo_type, quantity)
SELECT 
    vessels.id,
    'metal',
    CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(cargo_list, ',', 2), ',', -1) AS DECIMAL(14,4))
FROM vessels
WHERE cargo_list IS NOT NULL
    AND cargo_list != '';

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 13: Batch Operations for Large Tables
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: For very large tables, use LIMIT to avoid locking the entire
--                table for too long. Split into multiple smaller transactions.
--
-- WARNING: In a migration context, we use a single transaction per migration.
--          If you need batch operations, consider doing them in application code
--          after the ALTER is applied, or create multiple small migration files.

-- Example structure (note: this doesn't work in a single migration transaction,
-- but shows the pattern for application-level backfills):
-- BEGIN;
-- UPDATE large_table SET status = 'processed' LIMIT 10000;
-- COMMIT;
-- (repeat until done)

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 14: Adding JSON Columns (MySQL 5.7+)
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: JSON is flexible but less queryable. Use for semi-structured
--                data like metadata that doesn't need filtering.

ALTER TABLE player_settings
    ADD COLUMN IF NOT EXISTS custom_metadata JSON NULL
        AFTER settings_updated_at;

-- Backfill with default empty object
UPDATE player_settings
SET custom_metadata = '{}'
WHERE custom_metadata IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 15: Removing Redundant Data (Normalization)
-- ─────────────────────────────────────────────────────────────────────────────
-- When denormalization is being removed, migrate the data to the normalized
-- structure first, then drop the denormalized column.

-- Example: Remove a cached_value column that's now computed
-- (Ensure the application is updated to compute this value on-the-fly)
ALTER TABLE game_metrics
    DROP COLUMN IF EXISTS cached_player_count;

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTES FOR PRODUCTION MIGRATIONS
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SPLITTING COMPLEX CHANGES:
--    In production, do NOT combine all of these into one migration.
--    Create focused migrations per feature:
--      - migrate_feature_schema_v1.sql  (CREATE/ALTER DDL)
--      - migrate_feature_backfill_v1.sql (UPDATE/INSERT data)
--      - migrate_feature_indexes_v1.sql  (add indexes)
--      - migrate_feature_cleanup_v1.sql  (remove old data)
--
-- 2. TESTING:
--    Always test migrations on a production-like copy of the database.
--    Use --dry-run mode first: php scripts/migrate.php up --dry-run
--
-- 3. TRANSACTION SAFETY:
--    Each migration runs in a single PDO transaction.
--    If any statement fails, the entire migration is rolled back.
--
-- 4. ROLLBACK PREPARATION:
--    Create a companion *_down.sql file if the changes must be reversible.
--    For destructive changes (DROP COLUMN), the down migration may not be possible.
--
-- 5. LOCKING CONCERNS:
--    ALTER TABLE operations lock the table (or part of it) for the duration.
--    On live systems, consider:
--      - Running during low-traffic windows
--      - Using pt-online-schema-change (Percona Toolkit) for large tables
--      - Testing lock time on a replica first
--
-- 6. DATA SIZE:
--    Large UPDATE statements can generate significant redo logs.
--    Monitor disk space during migration execution.
--
-- 7. INDEX CREATION:
--    Adding indexes on large tables can be slow.
--    Use ALGORITHM=INPLACE, LOCK=NONE where available (MySQL 5.6+).
