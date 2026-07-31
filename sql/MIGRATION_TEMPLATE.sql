-- migrate_TEMPLATE_v1.sql
-- 
-- INSTRUCTIONS:
-- 1. Copy this file to a real migration name: migrate_<feature>_v<N>.sql
-- 2. Replace all UPPERCASE placeholders with your actual values
-- 3. Delete sections you don't need (DDL, DML, Indexes, etc.)
-- 4. Add this filename to config/migrations_manifest.php
-- 5. Create companion migrate_<feature>_v<N>_down.sql if reversible
-- 6. Test with: php scripts/migrate.php up --dry-run
-- 7. See docs/technical/ALTER_MIGRATIONS_GUIDE.md for detailed patterns
--

-- Database: galaxyquest
USE galaxyquest;

-- ═════════════════════════════════════════════════════════════════════════════
-- MIGRATION METADATA
-- ═════════════════════════════════════════════════════════════════════════════
-- Name:        migrate_FEATURE_NAME_v1.sql
-- Description: DESCRIBE_WHAT_THIS_MIGRATION_DOES
-- Issue:       ISSUE_NUMBER_IF_APPLICABLE
-- Author:      YOUR_NAME
-- Date:        TODAY_DATE
--
-- Affected Tables: TABLE1, TABLE2, TABLE3
-- Data Loss:       YES/NO (be explicit)
-- Estimated Time:  ROUGH_ESTIMATE_MS
-- Lock Duration:   ROUGH_ESTIMATE_MS
-- Down Migration:  YES/NO (companion file exists)
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 1: DDL CHANGES (CREATE/ALTER/DROP)
-- ─────────────────────────────────────────────────────────────────────────────
-- These changes run BEFORE data manipulation to ensure schema is ready.

-- Example: Adding a new column
ALTER TABLE TABLE_NAME
    ADD COLUMN IF NOT EXISTS column_name DATA_TYPE NOT NULL DEFAULT 'DEFAULT_VALUE'
        AFTER existing_column;

-- Example: Removing an old column
-- ALTER TABLE TABLE_NAME
--     DROP COLUMN IF EXISTS deprecated_column;

-- Example: Adding an index
-- ALTER TABLE TABLE_NAME
--     ADD INDEX idx_column_name (column_name);

-- Example: Adding a foreign key constraint
-- ALTER TABLE TABLE_NAME
--     ADD CONSTRAINT fk_constraint_name
--         FOREIGN KEY (column_id) REFERENCES foreign_table(id)
--         ON DELETE RESTRICT;

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 2: DATA VALIDATION & CLEANUP
-- ─────────────────────────────────────────────────────────────────────────────
-- Remove any data that would violate new constraints BEFORE adding them.

-- Example: Remove rows that would violate foreign key
-- DELETE FROM TABLE_NAME
-- WHERE foreign_key_id NOT IN (
--     SELECT id FROM foreign_table WHERE is_active = 1
-- );

-- Example: Normalize inconsistent data
-- UPDATE TABLE_NAME
-- SET status = 'normalized_value'
-- WHERE status IN ('old_value1', 'old_value2');

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 3: DATA BACKFILL
-- ─────────────────────────────────────────────────────────────────────────────
-- Populate new columns with calculated/derived data.

-- Example: Simple constant fill
-- UPDATE TABLE_NAME
-- SET new_column = 'default_value'
-- WHERE new_column IS NULL OR new_column = '';

-- Example: Conditional fill
-- UPDATE TABLE_NAME
-- SET new_column = CASE
--     WHEN condition1 THEN 'value1'
--     WHEN condition2 THEN 'value2'
--     ELSE 'default'
-- END
-- WHERE new_column IS NULL;

-- Example: Fill from related table
-- UPDATE TABLE_NAME
-- SET new_column = (
--     SELECT related_value FROM related_table
--     WHERE related_table.id = TABLE_NAME.related_id
-- )
-- WHERE new_column IS NULL;

-- Example: Bulk migrate data between tables
-- INSERT INTO archive_table (id, name, created_at)
-- SELECT id, name, created_at
-- FROM active_table
-- WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 YEAR)
--     AND NOT EXISTS (
--         SELECT 1 FROM archive_table
--         WHERE archive_table.id = active_table.id
--     );

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 4: CONSTRAINT ADDITIONS
-- ─────────────────────────────────────────────────────────────────────────────
-- Add or modify constraints after data is clean and backfilled.

-- Example: Add NOT NULL constraint (only after backfill)
-- ALTER TABLE TABLE_NAME
--     MODIFY COLUMN column_name DATA_TYPE NOT NULL;

-- Example: Add UNIQUE constraint (only after removing duplicates)
-- ALTER TABLE TABLE_NAME
--     ADD UNIQUE KEY uq_column_name (column_name);

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 5: INDEX CREATION
-- ─────────────────────────────────────────────────────────────────────────────
-- Add indexes AFTER backfilling (indexes slow down inserts).

-- Example: Single column index
-- ALTER TABLE TABLE_NAME
--     ADD INDEX idx_column (column_name);

-- Example: Composite index (order by most selective first)
-- ALTER TABLE TABLE_NAME
--     ADD INDEX idx_composite (primary_column, secondary_column);

-- Example: Unique index
-- ALTER TABLE TABLE_NAME
--     ADD UNIQUE KEY uq_column (column_name);

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 6: CLEANUP & VALIDATION
-- ─────────────────────────────────────────────────────────────────────────────
-- Final cleanup, deduplication, or soft deletion of obsolete data.

-- Example: Remove temporary or test data
-- DELETE FROM TABLE_NAME
-- WHERE status = 'temporary' AND created_at < DATE_SUB(NOW(), INTERVAL 1 DAY);

-- Example: Soft delete old records (preferred over hard delete)
-- UPDATE TABLE_NAME
-- SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP
-- WHERE is_deleted = 0 AND updated_at < DATE_SUB(NOW(), INTERVAL 2 YEAR);

-- ─────────────────────────────────────────────────────────────────────────────
-- END OF MIGRATION
-- ─────────────────────────────────────────────────────────────────────────────
-- 
-- Testing:
--   php scripts/migrate.php status           # Check pending
--   php scripts/migrate.php up --dry-run     # Preview
--   php scripts/migrate.php up --step=1      # Apply this one
--   php scripts/migrate.php rollback --dry-run  # Preview rollback
--
-- Verification (run these after migration succeeds):
--   SELECT COUNT(*) FROM TABLE_NAME;
--   SELECT * FROM TABLE_NAME WHERE column_name IS NULL;  -- check backfill
--   
-- If rollback needed:
--   php scripts/migrate.php rollback  # Requires migrate_TEMPLATE_v1_down.sql
--
