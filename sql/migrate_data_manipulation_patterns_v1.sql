-- migrate_data_manipulation_patterns_v1.sql
-- Comprehensive examples of data manipulation patterns for database migrations.
--
-- This migration demonstrates best practices for:
--   • Bulk INSERT operations
--   • Conditional UPDATE statements
--   • DELETE with safety checks
--   • Data validation and correction
--   • Audit trail creation
--   • Referential integrity maintenance
--
-- Like migrate_alter_examples_v1.sql, this is a REFERENCE migration for
-- documentation only. In production, split these into focused, targeted
-- migrations by feature.

USE galaxyquest;

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 1: Bulk INSERT with IGNORE (Safe Insert)
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: Use INSERT IGNORE when you want to skip duplicate key violations.
--                Use INSERT ... ON DUPLICATE KEY UPDATE when you want to update
--                existing rows.

-- Example 1: Insert new items without failing on duplicates
INSERT IGNORE INTO research_technologies (name, tech_class, cost_research_points)
VALUES
    ('ion_drive_v2', 'propulsion', 5000),
    ('shield_generator_v3', 'defense', 7500),
    ('laser_cannon_mk4', 'weapons', 6000);

-- Example 2: Bulk insert with ON DUPLICATE KEY UPDATE (upsert pattern)
INSERT INTO faction_standings (user_id, faction_id, standing)
VALUES
    (1, 10, 50),
    (2, 10, 75),
    (3, 10, -30)
ON DUPLICATE KEY UPDATE
    standing = VALUES(standing),
    updated_at = CURRENT_TIMESTAMP;

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 2: Conditional UPDATE with Complex Logic
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: Use CASE WHEN for complex conditional logic.
--                Break complex updates into multiple simpler UPDATE statements
--                if readability is affected.

-- Example 1: Update based on multiple conditions
UPDATE colonies
SET resource_production_rate = CASE
    WHEN status = 'development' THEN resource_production_rate * 0.8
    WHEN status = 'mature' AND population > 1000000 THEN resource_production_rate * 1.2
    WHEN status = 'abandoned' THEN 0
    ELSE resource_production_rate
END,
    population = CASE
        WHEN status = 'abandoned' THEN 0
        WHEN status = 'development' AND population > 500000 THEN population
        ELSE population * 1.05
    END
WHERE updated_at < DATE_SUB(NOW(), INTERVAL 30 DAY);

-- Example 2: Update with subquery
UPDATE players
SET rank_tier = (
    SELECT CASE
        WHEN battle_wins > 500 THEN 'legendary'
        WHEN battle_wins > 200 THEN 'elite'
        WHEN battle_wins > 100 THEN 'veteran'
        WHEN battle_wins > 50 THEN 'experienced'
        ELSE 'novice'
    END
)
WHERE is_active = 1;

-- Example 3: Update with aggregate function
UPDATE players
SET total_playtime_hours = (
    SELECT COALESCE(SUM(session_duration_minutes) / 60, 0)
    FROM player_sessions
    WHERE player_sessions.player_id = players.id
)
WHERE last_activity_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 3: Safe DELETE with Referential Integrity Checks
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: Always check if dependent records exist before deleting.
--                Use NOT IN or NOT EXISTS to verify no foreign key references.
--                Consider soft delete (mark as deleted) instead of hard delete.

-- Example 1: Delete with FK check (hard delete)
DELETE FROM temporary_session_tokens
WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
    AND id NOT IN (
        SELECT session_token_id FROM active_sessions WHERE session_token_id IS NOT NULL
    );

-- Example 2: Soft delete (preferred for audit trails)
UPDATE abandoned_vessels
SET is_deleted = 1,
    deleted_at = CURRENT_TIMESTAMP
WHERE is_deleted = 0
    AND last_activity_at < DATE_SUB(NOW(), INTERVAL 180 DAY);

-- Example 3: Cascade delete with safety check
DELETE FROM diplomacy_threats
WHERE source_actor_id IN (
    SELECT id FROM actors
    WHERE is_deleted = 1 AND deleted_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
)
AND NOT EXISTS (
    SELECT 1 FROM diplomacy_events
    WHERE diplomacy_events.threat_id = diplomacy_threats.id
);

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 4: Data Validation and Correction
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: Identify invalid data first (SELECT), then update it.
--                Always verify the fix doesn't violate other constraints.

-- Example 1: Fix out-of-range values
-- Before: check how many rows would be affected
-- SELECT COUNT(*) FROM player_scores WHERE score > 999999999;
UPDATE player_scores
SET score = 999999999
WHERE score > 999999999;

-- Example 2: Correct truncated data
-- Scenario: A migration or bug truncated strings to 50 chars, now expanding to 255
-- First, identify which records were affected (if you have a way to know)
UPDATE ship_descriptions
SET description = SUBSTRING(description, 1, 255)
WHERE LENGTH(description) = 50
    AND original_length > 50;  -- assuming we have a flag

-- Example 3: Fix inconsistent enum values
UPDATE quest_log_entries
SET quest_status = 'completed'
WHERE quest_status IN ('complete', 'finished', 'done');

-- Example 4: Correct NULL vs empty string inconsistencies
UPDATE player_profiles
SET bio = NULL
WHERE bio = '' OR bio = '   ';

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 5: Bulk Data Migration Between Tables
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: Use INSERT ... SELECT for bulk migrations.
--                Always verify source and target table structures match.
--                Use a WHERE clause to migrate data incrementally (in batches).

-- Example 1: Simple INSERT SELECT
INSERT INTO player_achievement_archive (player_id, achievement_id, earned_at)
SELECT player_id, achievement_id, earned_at
FROM player_achievements
WHERE earned_at < DATE_SUB(NOW(), INTERVAL 1 YEAR)
    AND NOT EXISTS (
        SELECT 1 FROM player_achievement_archive
        WHERE player_achievement_archive.player_id = player_achievements.player_id
            AND player_achievement_archive.achievement_id = player_achievements.achievement_id
    );

-- Example 2: Migrate with transformation
INSERT INTO world_region_audit (region_id, player_id, control_change, recorded_at)
SELECT
    region_id,
    controlling_player_id,
    'initial_claim',
    NOW()
FROM star_system_regions
WHERE controlling_player_id IS NOT NULL
    AND control_history_count = 0;

-- Example 3: Migrate from normalized to denormalized
INSERT INTO player_statistics_denorm (player_id, total_battles, total_kills, total_deaths, win_rate)
SELECT
    players.id,
    COUNT(DISTINCT battles.id),
    SUM(battle_stats.kills),
    SUM(battle_stats.deaths),
    ROUND(
        SUM(CASE WHEN battle_stats.result = 'win' THEN 1 ELSE 0 END) /
        COUNT(DISTINCT battles.id) * 100,
        2
    )
FROM players
LEFT JOIN battle_stats ON battle_stats.player_id = players.id
LEFT JOIN battles ON battles.id = battle_stats.battle_id
GROUP BY players.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 6: Creating Audit Trail Entries
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: When modifying data in migrations, record the change for audit.
--                Include metadata: who, what, when, why.

-- Example: Record that we fixed corrupted data
INSERT INTO audit_log (entity_type, entity_id, action, changed_by, reason, recorded_at)
SELECT
    'player_profile',
    players.id,
    'data_correction',
    'system-migration',
    'Fixed truncated biography field during migrate_data_manipulation_patterns_v1',
    CURRENT_TIMESTAMP
FROM players
WHERE players.id IN (
    SELECT DISTINCT id
    FROM (
        SELECT id FROM players WHERE LENGTH(bio) = 250
    ) AS truncated_bios
);

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 7: Backfilling Calculated/Derived Data
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: When adding a new column that caches/denormalizes data,
--                backfill it from the source data.
--                Ensure the calculation matches the application logic.

-- Example 1: Backfill total_points from individual transaction records
UPDATE player_accounts
SET total_credits_earned = (
    SELECT COALESCE(SUM(amount), 0)
    FROM credit_transactions
    WHERE credit_transactions.player_id = player_accounts.id
        AND transaction_type = 'earn'
        AND status = 'completed'
)
WHERE total_credits_earned IS NULL OR total_credits_earned = 0;

-- Example 2: Backfill summary statistics
UPDATE colony_statistics
SET last_update_tick = (
    SELECT MAX(tick_number)
    FROM colony_snapshots
    WHERE colony_snapshots.colony_id = colony_statistics.colony_id
)
WHERE last_update_tick IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 8: Maintaining Referential Integrity
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: When data is modified, verify that related records are valid.
--                Update cascade paths, clean up orphaned records, etc.

-- Example 1: Update parent_id to NULL for orphaned records (instead of deleting)
UPDATE quest_objectives
SET parent_quest_id = NULL
WHERE parent_quest_id NOT IN (
    SELECT id FROM quests WHERE is_deleted = 0
);

-- Example 2: Cascade update foreign key values
UPDATE player_fleet_composition
SET commander_id = (
    SELECT COALESCE(default_commander_id, NULL)
    FROM player_fleets
    WHERE player_fleets.id = player_fleet_composition.fleet_id
)
WHERE commander_id NOT IN (
    SELECT id FROM fleet_commanders WHERE is_active = 1
);

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 9: Deduplication
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: Identify duplicates by a unique key, keep one (usually the oldest),
--                delete the rest.

-- Example 1: Keep the oldest record (MIN ID or MIN created_at)
DELETE FROM player_login_records
WHERE id NOT IN (
    SELECT MIN(id)
    FROM player_login_records
    GROUP BY player_id, login_timestamp
);

-- Example 2: Deduplicate and aggregate
DELETE FROM resource_cache
WHERE id NOT IN (
    SELECT MAX(id)
    FROM resource_cache
    GROUP BY planet_id, resource_type
);

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 10: Time-Based Data Archival
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: Move old data to an archive table before deleting.
--                Allows recovery and historical analysis.

-- Step 1: Archive old records
INSERT INTO battle_history_archive (battle_id, details, archived_at)
SELECT id, details, CURRENT_TIMESTAMP
FROM battles
WHERE completed_at < DATE_SUB(NOW(), INTERVAL 2 YEAR)
    AND NOT EXISTS (
        SELECT 1 FROM battle_history_archive WHERE battle_id = battles.id
    );

-- Step 2: Delete from live table (only after confirming archive success)
DELETE FROM battles
WHERE id IN (
    SELECT battle_id FROM battle_history_archive
    WHERE archived_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 11: Conditional Batch Updates
-- ─────────────────────────────────────────────────────────────────────────────
-- Note: In a single migration transaction, we can't do true batching.
--       But this pattern shows how applications would do incremental updates.

-- Example: Mark records as processed in groups (if this were application code)
-- UPDATE large_dataset SET processing_status = 'queued'
-- WHERE processing_status = 'pending' AND id > @last_id AND id <= @last_id + 10000
-- ORDER BY id;

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 12: Data Transformation with String Manipulation
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: Use MySQL string functions carefully; always test the formula
--                with sample data first.

-- Example 1: Extract part of a string
UPDATE player_usernames
SET first_name = SUBSTRING(full_name, 1, LOCATE(' ', full_name) - 1),
    last_name = SUBSTRING(full_name, LOCATE(' ', full_name) + 1)
WHERE full_name LIKE '% %'
    AND first_name IS NULL;

-- Example 2: Normalize string data (trim, lowercase)
UPDATE faction_names
SET normalized_name = LOWER(TRIM(name))
WHERE normalized_name IS NULL;

-- Example 3: Replace obsolete codes with new codes
UPDATE ship_modules
SET module_type = REPLACE(module_type, 'OLD_', 'NEW_')
WHERE module_type LIKE 'OLD_%';

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 13: Numeric Transformations
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: Be careful with rounding, precision, and truncation.
--                Always verify the transformation with a sample before/after query.

-- Example 1: Scale numeric values
UPDATE colony_resources
SET storage_capacity = ROUND(storage_capacity * 1.15, 2)
WHERE colony_size = 'large';

-- Example 2: Normalize to 0-100 scale
UPDATE player_satisfaction_ratings
SET rating = CASE
    WHEN rating > 100 THEN 100
    WHEN rating < 0 THEN 0
    ELSE rating
END
WHERE rating NOT BETWEEN 0 AND 100;

-- Example 3: Convert from one unit to another
UPDATE ship_specifications
SET max_speed_kps = ROUND(max_speed_ms * 1000, 2)
WHERE max_speed_ms IS NOT NULL
    AND max_speed_kps IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 14: Ensuring Data Consistency After Complex Changes
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: After a complex data migration, run a verification query
--                to ensure data integrity. In migrations, this serves as
--                documentation of what was checked.

-- Example: Verify that all colonies have valid parent references
-- (This wouldn't fail the migration, but documents the constraint)
SELECT COUNT(*) as orphaned_colonies
FROM colonies
WHERE parent_sector_id NOT IN (
    SELECT id FROM star_sectors WHERE is_deleted = 0
);
-- ^ If this returns > 0, the previous UPDATE BEFORE THIS LINE didn't work correctly

-- ─────────────────────────────────────────────────────────────────────────────
-- PATTERN 15: Using Temporary Variables for Complex Logic
-- ─────────────────────────────────────────────────────────────────────────────
-- Best practice: User variables (@var) can help with multi-step logic.
--                However, they're not as clean as application code; use sparingly.

-- Example: Counter for verification
SET @updated_count = 0;
UPDATE player_achievements
SET unlock_count = unlock_count + 1
WHERE achievement_code = 'FIRST_COLONY'
    AND unlock_count < 10;
SET @updated_count = ROW_COUNT();

-- Verification (this line wouldn't actually be in the migration, just for doc)
-- SELECT @updated_count as rows_affected;

-- ─────────────────────────────────────────────────────────────────────────────
-- BEST PRACTICES SUMMARY
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. KEEP MIGRATIONS FOCUSED
--    One migration = one logical feature/change
--    Don't combine unrelated schema + data changes
--
-- 2. TEST DATA CHANGES THOROUGHLY
--    Run on a copy of production data before deploying
--    Check row counts before/after
--    Verify foreign key integrity
--
-- 3. MAKE CHANGES IDEMPOTENT
--    Use IF NOT EXISTS, WHERE conditions to make re-runs safe
--    IF a migration runs twice, it should produce the same result
--
-- 4. DOCUMENT YOUR INTENTIONS
--    Add comments explaining WHY a change is needed
--    Reference issue numbers or design decisions
--
-- 5. PROVIDE ROLLBACK COMPATIBILITY
--    Create a *_down.sql companion file when possible
--    Document what cannot be rolled back
--
-- 6. VALIDATE CONSTRAINTS
--    Check foreign keys, unique constraints, NOT NULL rules
--    Remove conflicting data BEFORE adding stricter constraints
--
-- 7. MINIMIZE LOCK TIME
--    Split large changes into multiple migrations
--    Run on off-peak hours for production
--    Test execution time on a replica
--
-- 8. BACKUP BEFORE PRODUCTION MIGRATIONS
--    Always have a recent backup before applying migrations
--    Document the backup location and recovery procedure
