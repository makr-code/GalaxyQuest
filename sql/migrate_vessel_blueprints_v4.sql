-- GalaxyQuest - Vessel blueprint runtime migration v4
-- Adds explicit energy economy baseline fields to vessel_hulls.
-- Safe to run multiple times.

USE galaxyquest;

SET @has_col := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vessel_hulls' AND COLUMN_NAME = 'base_energy_output'
);
SET @sql := IF(@has_col = 0,
    'ALTER TABLE vessel_hulls ADD COLUMN base_energy_output DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER base_speed',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vessel_hulls' AND COLUMN_NAME = 'base_energy_capacity'
);
SET @sql := IF(@has_col = 0,
    'ALTER TABLE vessel_hulls ADD COLUMN base_energy_capacity DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER base_energy_output',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vessel_hulls' AND COLUMN_NAME = 'base_energy_upkeep'
);
SET @sql := IF(@has_col = 0,
    'ALTER TABLE vessel_hulls ADD COLUMN base_energy_upkeep DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER base_energy_capacity',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vessel_hulls' AND COLUMN_NAME = 'base_weapon_efficiency'
);
SET @sql := IF(@has_col = 0,
    'ALTER TABLE vessel_hulls ADD COLUMN base_weapon_efficiency DECIMAL(8,4) NOT NULL DEFAULT 1.0 AFTER base_energy_upkeep',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vessel_hulls' AND COLUMN_NAME = 'base_shield_efficiency'
);
SET @sql := IF(@has_col = 0,
    'ALTER TABLE vessel_hulls ADD COLUMN base_shield_efficiency DECIMAL(8,4) NOT NULL DEFAULT 1.0 AFTER base_weapon_efficiency',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vessel_hulls' AND COLUMN_NAME = 'base_attack_energy_share'
);
SET @sql := IF(@has_col = 0,
    'ALTER TABLE vessel_hulls ADD COLUMN base_attack_energy_share DECIMAL(6,4) NOT NULL DEFAULT 0.5 AFTER base_shield_efficiency',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
