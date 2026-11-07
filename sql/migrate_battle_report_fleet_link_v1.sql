-- Link resolved battle reports to the arriving attacker fleet.
-- Safe to apply repeatedly; historical reports remain unlinked.
USE galaxyquest;

SET @has_col := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'battle_reports'
      AND COLUMN_NAME = 'fleet_id'
);
SET @sql := IF(
    @has_col = 0,
    'ALTER TABLE battle_reports ADD COLUMN fleet_id INT DEFAULT NULL AFTER body_id',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'battle_reports'
      AND INDEX_NAME = 'idx_battle_fleet_id'
);
SET @sql := IF(
    @has_idx = 0,
    'ALTER TABLE battle_reports ADD KEY idx_battle_fleet_id (fleet_id)',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
