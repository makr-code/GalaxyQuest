-- migrate_pirates_v3.sql — Pirate Contracts & Standing System (PHASE 3.1)
-- Run once.  Uses information_schema guards instead of IF NOT EXISTS for MySQL 8.4.

SET NAMES utf8mb4;

-- ── pirate_contracts ─────────────────────────────────────────────────────
-- Stores active tributary / mercenary / non-aggression agreements between
-- players and pirate factions.

SELECT COUNT(*) INTO @tbl_exists
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'pirate_contracts';

SET @create_contracts = IF(@tbl_exists = 0,
    'CREATE TABLE pirate_contracts (
        id             INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id        INT UNSIGNED NOT NULL,
        faction_id     INT UNSIGNED NOT NULL,
        contract_type  ENUM(''tributary'',''mercenary'',''non_aggression'') NOT NULL DEFAULT ''tributary'',
        credit_payment INT UNSIGNED NOT NULL DEFAULT 0,
        duration_days  TINYINT UNSIGNED NOT NULL DEFAULT 30,
        status         ENUM(''active'',''expired'',''broken'') NOT NULL DEFAULT ''active'',
        created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        expires_at     DATETIME NOT NULL,
        UNIQUE KEY uq_user_faction (user_id, faction_id),
        INDEX idx_user_status (user_id, status),
        INDEX idx_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'SELECT 1');
PREPARE stmt FROM @create_contracts; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── pirate_standing_history ───────────────────────────────────────────────
-- Audit log for standing changes with pirate factions.

SELECT COUNT(*) INTO @tbl2_exists
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'pirate_standing_history';

SET @create_history = IF(@tbl2_exists = 0,
    'CREATE TABLE pirate_standing_history (
        id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id      INT UNSIGNED NOT NULL,
        faction_id   INT UNSIGNED NOT NULL,
        delta        SMALLINT NOT NULL,
        reason       VARCHAR(64) NOT NULL DEFAULT ''unknown'',
        note         VARCHAR(255) NULL,
        created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_faction (user_id, faction_id),
        INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'SELECT 1');
PREPARE stmt2 FROM @create_history; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;
