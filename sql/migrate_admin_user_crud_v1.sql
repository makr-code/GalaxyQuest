-- Admin User CRUD v1
-- Adds soft-delete support to the users table.
-- When a user is "deleted" via admin, their PII is scrubbed and the row is
-- converted to an NPC placeholder so all FK-linked game data (colonies,
-- fleets, research, …) is transparently preserved without schema changes.
-- Safe to run multiple times (IF NOT EXISTS / info_schema guards).

SET @dbname = DATABASE();

-- deleted_at: set when a user account is administratively deleted.
-- Login is refused for any row where deleted_at IS NOT NULL.
SET @col_check = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND COLUMN_NAME = 'deleted_at'
);
SET @sql = IF(@col_check = 0,
    'ALTER TABLE users
        ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL
            COMMENT ''Soft-delete timestamp; NULL means active'' AFTER last_npc_tick,
        ADD INDEX idx_users_deleted (deleted_at)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- deleted_by: which admin performed the deletion (nullable, audit trail).
SET @col_check = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND COLUMN_NAME = 'deleted_by'
);
SET @sql = IF(@col_check = 0,
    'ALTER TABLE users
        ADD COLUMN deleted_by INT NULL DEFAULT NULL
            COMMENT ''Admin user_id who deleted this account'' AFTER deleted_at',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
