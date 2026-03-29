-- GalaxyQuest - Combat model migration v1
-- Adds combat metadata columns for battle reports and persistent modifier storage.
-- Safe to run multiple times.

USE galaxyquest;

-- ---------------------------------------------------------------------------
-- Battle report combat metadata
-- ---------------------------------------------------------------------------
SET @has_col := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battle_reports' AND COLUMN_NAME = 'battle_seed'
);
SET @sql := IF(@has_col = 0,
    'ALTER TABLE battle_reports ADD COLUMN battle_seed VARCHAR(64) DEFAULT NULL AFTER report_json',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battle_reports' AND COLUMN_NAME = 'report_version'
);
SET @sql := IF(@has_col = 0,
    'ALTER TABLE battle_reports ADD COLUMN report_version TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER battle_seed',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battle_reports' AND COLUMN_NAME = 'attacker_power_rating'
);
SET @sql := IF(@has_col = 0,
    'ALTER TABLE battle_reports ADD COLUMN attacker_power_rating INT UNSIGNED DEFAULT NULL AFTER report_version',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battle_reports' AND COLUMN_NAME = 'defender_power_rating'
);
SET @sql := IF(@has_col = 0,
    'ALTER TABLE battle_reports ADD COLUMN defender_power_rating INT UNSIGNED DEFAULT NULL AFTER attacker_power_rating',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battle_reports' AND COLUMN_NAME = 'dice_variance_index'
);
SET @sql := IF(@has_col = 0,
    'ALTER TABLE battle_reports ADD COLUMN dice_variance_index DECIMAL(6,4) DEFAULT NULL AFTER defender_power_rating',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battle_reports' AND COLUMN_NAME = 'explainability_json'
);
SET @sql := IF(@has_col = 0,
    'ALTER TABLE battle_reports ADD COLUMN explainability_json JSON DEFAULT NULL AFTER dice_variance_index',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battle_reports' AND INDEX_NAME = 'idx_battle_seed'
);
SET @sql := IF(@has_idx = 0,
    'ALTER TABLE battle_reports ADD KEY idx_battle_seed (battle_seed)',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battle_reports' AND INDEX_NAME = 'idx_battle_version_time'
);
SET @sql := IF(@has_idx = 0,
    'ALTER TABLE battle_reports ADD KEY idx_battle_version_time (report_version, created_at)',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Combat modifiers (data-driven source of bonuses/maluses)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS combat_modifiers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    scope ENUM('empire','fleet','vessel','module','battle') NOT NULL DEFAULT 'fleet',
    source_type ENUM('race','fraction','faction','leader','commander','research','doctrine','event','situation','manual') NOT NULL,
    source_ref VARCHAR(128) NOT NULL,
    modifier_key VARCHAR(96) NOT NULL,
    operation ENUM('add_flat','add_pct','mult','clamp_min','clamp_max') NOT NULL DEFAULT 'add_pct',
    value DECIMAL(12,6) NOT NULL DEFAULT 0,
    condition_json JSON DEFAULT NULL,
    priority SMALLINT NOT NULL DEFAULT 50,
    starts_at DATETIME DEFAULT NULL,
    expires_at DATETIME DEFAULT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_combat_mod_scope_active (scope, active),
    INDEX idx_combat_mod_source (source_type, source_ref),
    INDEX idx_combat_mod_key (modifier_key),
    INDEX idx_combat_mod_time (starts_at, expires_at)
) ENGINE=InnoDB;

-- Optional link table for user-owned dynamic modifiers.
CREATE TABLE IF NOT EXISTS user_combat_modifiers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    combat_modifier_id BIGINT NOT NULL,
    granted_by VARCHAR(64) NOT NULL DEFAULT 'system',
    granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (combat_modifier_id) REFERENCES combat_modifiers(id) ON DELETE CASCADE,
    UNIQUE KEY uq_user_combat_modifier (user_id, combat_modifier_id),
    INDEX idx_ucm_user (user_id)
) ENGINE=InnoDB;
