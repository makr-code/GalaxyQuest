-- migrate_pirates_v2.sql
-- Pirates System Phase P1.3 — Colony Defense Mechanics
--
-- Adds defense systems to colonies:
--   1. Defense budget allocation (credits/tick)
--   2. Countermeasure effectiveness levels
--   3. Defense infrastructure tracking
--   4. Raid insurance/recovery mechanics
--
-- Uses information_schema + PREPARE pattern for MySQL 8.4 compatibility

SET @col_exists = (
    SELECT COUNT(1) FROM information_schema.COLUMNS
    WHERE table_schema = DATABASE()
      AND table_name   = 'colonies'
      AND column_name  = 'defense_budget'
);

SET @sql = IF(@col_exists = 0,
    CONCAT(
        'ALTER TABLE colonies ',
        'ADD COLUMN defense_budget           DECIMAL(14,4)   NOT NULL DEFAULT 1000.0 COMMENT "credits/tick for defense", ',
        'ADD COLUMN countermeasure_level     INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT "0-100 defense rating", ',
        'ADD COLUMN last_defense_calc        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP, ',
        'ADD COLUMN shield_generator_charges INT UNSIGNED    NOT NULL DEFAULT 100 COMMENT "remaining charges" '
    ),
    'SELECT 1 /* migrate_pirates_v2: columns already present */'
);

PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- Create pirate raid tracking table
CREATE TABLE IF NOT EXISTS pirate_raid_history (
    id                  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    colony_id           INT UNSIGNED    NOT NULL,
    pirate_faction_id   INT UNSIGNED    NOT NULL,
    raid_date           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    raid_intensity      DECIMAL(5,2)    NOT NULL COMMENT "0-100 threat level",
    defense_level       INT UNSIGNED    NOT NULL COMMENT "colony defense at time of raid",
    raid_success        TINYINT(1)      NOT NULL DEFAULT 0 COMMENT "1 if raid succeeded",
    goods_stolen        INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT "quantity looted",
    casualties          INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT "pop units lost",
    damage_percent      DECIMAL(5,2)    NOT NULL DEFAULT 0 COMMENT "% infrastructure damaged",
    PRIMARY KEY (id),
    KEY idx_colony_date (colony_id, raid_date),
    KEY idx_pirate_faction (pirate_faction_id),
    KEY idx_raid_success (raid_success)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Historical pirate raid records';

-- Create colony defense infrastructure table
CREATE TABLE IF NOT EXISTS colony_defense_infrastructure (
    id                  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    colony_id           INT UNSIGNED    NOT NULL,
    defense_type        VARCHAR(32)     NOT NULL COMMENT "shield_gen, turret_array, early_warning, repair_bot",
    level               INT UNSIGNED    NOT NULL DEFAULT 1,
    effectiveness       DECIMAL(5,2)    NOT NULL COMMENT "0-100% effective vs raids",
    maintenance_cost    DECIMAL(12,4)   NOT NULL DEFAULT 0 COMMENT "credits/tick",
    damage_current      INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT "damage sustained",
    damage_max          INT UNSIGNED    NOT NULL DEFAULT 100 COMMENT "hp until destroyed",
    last_activated      TIMESTAMP,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_colony_type (colony_id, defense_type),
    KEY idx_effectiveness (effectiveness)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Defense infrastructure per colony';

-- Create raid countermeasure table (response system)
CREATE TABLE IF NOT EXISTS raid_countermeasures (
    id                  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    colony_id           INT UNSIGNED    NOT NULL,
    pirate_faction_id   INT UNSIGNED,   -- NULL = any faction
    countermeasure_type VARCHAR(32)     NOT NULL COMMENT "ambassador_bribe, fake_distress, drone_swarm",
    spend_credits       DECIMAL(14,4)   NOT NULL,
    effectiveness       DECIMAL(5,2)    NOT NULL COMMENT "0-100% chance to stop raid",
    activated_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at          TIMESTAMP       NOT NULL,
    PRIMARY KEY (id),
    KEY idx_colony (colony_id),
    KEY idx_faction (pirate_faction_id),
    KEY idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Active countermeasures against pirate raids';

-- Create insurance/recovery tracking
CREATE TABLE IF NOT EXISTS pirate_damage_recovery (
    id                  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    colony_id           INT UNSIGNED    NOT NULL,
    initial_damage      DECIMAL(5,2)    NOT NULL COMMENT "% damage from raid",
    recovery_cost       DECIMAL(14,4)   NOT NULL,
    recovery_started    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    recovery_complete   TIMESTAMP,
    recovery_percent    DECIMAL(5,2)    NOT NULL DEFAULT 0 COMMENT "0-100% recovered",
    PRIMARY KEY (id),
    KEY idx_colony_complete (colony_id, recovery_complete)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Damage recovery tracking after pirate raids';

-- Create index for efficient pirate queries
ALTER TABLE pirate_raid_history ADD INDEX idx_recent_raids (raid_date DESC);
