-- Actor model v2
-- Drop legacy users.is_npc after all runtime paths have migrated to
-- control_type/auth_enabled.
-- Safe to run multiple times.

SET @dbname = DATABASE();

SET @col_check = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_npc'
);
SET @sql = IF(@col_check = 1,
    'ALTER TABLE users DROP COLUMN is_npc',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
