-- GalaxyQuest - Vessel blueprint runtime migration v2
-- Adds ship class metadata and slot variation support for hulls and compiled blueprints.
-- Safe to run multiple times.

USE galaxyquest;

SET @has_col := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vessel_hulls' AND COLUMN_NAME = 'ship_class'
);
SET @sql := IF(@has_col = 0,
    'ALTER TABLE vessel_hulls ADD COLUMN ship_class VARCHAR(32) NOT NULL DEFAULT ''corvette'' AFTER role',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vessel_hulls' AND COLUMN_NAME = 'slot_variation_json'
);
SET @sql := IF(@has_col = 0,
    'ALTER TABLE vessel_hulls ADD COLUMN slot_variation_json JSON DEFAULT NULL AFTER slot_profile_json',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vessel_hulls' AND INDEX_NAME = 'idx_vessel_hulls_class'
);
SET @sql := IF(@has_idx = 0,
    'ALTER TABLE vessel_hulls ADD KEY idx_vessel_hulls_class (ship_class, tier, is_active)',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vessel_blueprints' AND COLUMN_NAME = 'slot_layout_code'
);
SET @sql := IF(@has_col = 0,
    'ALTER TABLE vessel_blueprints ADD COLUMN slot_layout_code VARCHAR(64) NOT NULL DEFAULT ''default'' AFTER version',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vessel_blueprints' AND COLUMN_NAME = 'compiled_slot_profile_json'
);
SET @sql := IF(@has_col = 0,
    'ALTER TABLE vessel_blueprints ADD COLUMN compiled_slot_profile_json JSON DEFAULT NULL AFTER compiled_cost_json',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
