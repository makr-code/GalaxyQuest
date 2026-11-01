-- GalaxyQuest – Leader Marketplace & Advisor Role Migration
-- MySQL 8.x compatible.
-- NOTE: Each ADD COLUMN step uses an information_schema guard for MySQL.
-- The leader_marketplace and advisor_hints tables use CREATE TABLE IF NOT EXISTS.

USE galaxyquest;

-- ── 1. Extend leaders role ENUM ───────────────────────────────────────────────
ALTER TABLE leaders
    MODIFY COLUMN role ENUM(
        'colony_manager','fleet_commander','science_director',
        'diplomacy_officer','trade_director','advisor'
    ) NOT NULL;

-- ── 2. Add profile columns to leaders (guarded individually) ──────────
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leaders'
       AND COLUMN_NAME = 'rarity') = 0,
    'ALTER TABLE leaders ADD COLUMN rarity ENUM(''common'',''uncommon'',''rare'',''legendary'') NOT NULL DEFAULT ''common'' AFTER role',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leaders'
       AND COLUMN_NAME = 'portrait') = 0,
    'ALTER TABLE leaders ADD COLUMN portrait VARCHAR(8) NOT NULL DEFAULT ''👤'' AFTER rarity',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leaders'
       AND COLUMN_NAME = 'tagline') = 0,
    'ALTER TABLE leaders ADD COLUMN tagline VARCHAR(128) NOT NULL DEFAULT '''' AFTER portrait',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leaders'
       AND COLUMN_NAME = 'backstory') = 0,
    'ALTER TABLE leaders ADD COLUMN backstory TEXT NULL AFTER tagline',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leaders'
       AND COLUMN_NAME = 'trait_1') = 0,
    'ALTER TABLE leaders ADD COLUMN trait_1 VARCHAR(64) NOT NULL DEFAULT '''' AFTER backstory',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leaders'
       AND COLUMN_NAME = 'trait_2') = 0,
    'ALTER TABLE leaders ADD COLUMN trait_2 VARCHAR(64) NOT NULL DEFAULT '''' AFTER trait_1',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leaders'
       AND COLUMN_NAME = 'skill_guidance') = 0,
    'ALTER TABLE leaders ADD COLUMN skill_guidance TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER skill_efficiency',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leaders'
       AND COLUMN_NAME = 'marketplace_source_id') = 0,
    'ALTER TABLE leaders ADD COLUMN marketplace_source_id INT DEFAULT NULL AFTER skill_guidance',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- ── 3. Leader Marketplace pool (per-user, refreshed daily) ───────────────────
CREATE TABLE IF NOT EXISTS leader_marketplace (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    user_id        INT NOT NULL,
    name           VARCHAR(64)  NOT NULL,
    role           ENUM('colony_manager','fleet_commander','science_director',
                        'diplomacy_officer','trade_director','advisor') NOT NULL,
    rarity         ENUM('common','uncommon','rare','legendary') NOT NULL DEFAULT 'common',
    portrait       VARCHAR(8)   NOT NULL DEFAULT '👤',
    tagline        VARCHAR(128) NOT NULL DEFAULT '',
    backstory      TEXT         NOT NULL,
    trait_1        VARCHAR(64)  NOT NULL DEFAULT '',
    trait_2        VARCHAR(64)  NOT NULL DEFAULT '',
    skill_production   TINYINT UNSIGNED NOT NULL DEFAULT 1,
    skill_construction TINYINT UNSIGNED NOT NULL DEFAULT 1,
    skill_tactics      TINYINT UNSIGNED NOT NULL DEFAULT 1,
    skill_navigation   TINYINT UNSIGNED NOT NULL DEFAULT 1,
    skill_research     TINYINT UNSIGNED NOT NULL DEFAULT 1,
    skill_efficiency   TINYINT UNSIGNED NOT NULL DEFAULT 1,
    skill_guidance     TINYINT UNSIGNED NOT NULL DEFAULT 1,
    hire_metal         INT UNSIGNED NOT NULL DEFAULT 5000,
    hire_crystal       INT UNSIGNED NOT NULL DEFAULT 3000,
    hire_deuterium     INT UNSIGNED NOT NULL DEFAULT 1000,
    is_hired       TINYINT(1)   NOT NULL DEFAULT 0,
    hired_at       DATETIME     DEFAULT NULL,
    expires_at     DATETIME     NOT NULL,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    KEY idx_mkt_user_exp (user_id, expires_at)
) ENGINE=InnoDB;
-- ── 4. Advisor hints ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS advisor_hints (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    user_id       INT NOT NULL,
    leader_id     INT NOT NULL,
    hint_type     ENUM('quest_hint','warning','tip','action_required') NOT NULL DEFAULT 'tip',
    hint_code     VARCHAR(64)  NOT NULL DEFAULT '',
    title         VARCHAR(128) NOT NULL,
    body          TEXT         NOT NULL,
    action_label  VARCHAR(64)  DEFAULT NULL,
    action_window VARCHAR(32)  DEFAULT NULL,
    dismissed     TINYINT(1)   NOT NULL DEFAULT 0,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (leader_id)  REFERENCES leaders(id)  ON DELETE CASCADE,
    KEY idx_hints_active (user_id, dismissed),
    UNIQUE KEY uq_hint_user_leader_code (user_id, leader_id, hint_code)
) ENGINE=InnoDB;
