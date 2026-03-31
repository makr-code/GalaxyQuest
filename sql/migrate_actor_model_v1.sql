-- Actor model v1
-- Keep all actors in users, but distinguish who controls the avatar via
-- control_type instead of relying only on is_npc.
-- Safe to run multiple times (info_schema guards).

SET @dbname = DATABASE();

SET @col_check = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND COLUMN_NAME = 'control_type'
);
SET @sql = IF(@col_check = 0,
    'ALTER TABLE users ADD COLUMN control_type VARCHAR(24) NOT NULL DEFAULT ''human'' AFTER is_npc, ADD INDEX idx_users_control_type (control_type)',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_check = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND COLUMN_NAME = 'auth_enabled'
);
SET @sql = IF(@col_check = 0,
    'ALTER TABLE users ADD COLUMN auth_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER control_type',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE users
SET control_type = CASE
    WHEN deleted_at IS NOT NULL THEN 'npc_engine'
    WHEN is_npc = 1 THEN 'npc_engine'
    ELSE 'human'
    END,
    auth_enabled = CASE
        WHEN deleted_at IS NOT NULL THEN 0
        WHEN is_npc = 1 THEN 0
        ELSE 1
    END
WHERE control_type IS NULL
   OR control_type = ''
   OR auth_enabled IS NULL
   OR control_type <> CASE
       WHEN deleted_at IS NOT NULL THEN 'npc_engine'
       WHEN is_npc = 1 THEN 'npc_engine'
       ELSE 'human'
    END
   OR auth_enabled <> CASE
        WHEN deleted_at IS NOT NULL THEN 0
        WHEN is_npc = 1 THEN 0
        ELSE 1
    END;