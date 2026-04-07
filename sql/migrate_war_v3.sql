-- migrate_war_v3.sql
-- War System Phase P1.2 — Supply Mechanics & Attrition
--
-- Adds supply chain tracking for wars:
--   1. Supply lines (routes from home colony to war theater)
--   2. Distance-based logistics costs
--   3. Attrition mechanics (damage without direct combat)
--   4. Supply interdiction (enemy blocking supply routes)
--
-- Uses information_schema + PREPARE pattern for MySQL 8.4 compatibility

-- 1. Create supply_lines table for tracking logistics
CREATE TABLE IF NOT EXISTS war_supply_lines (
    id                  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    war_id              INT UNSIGNED    NOT NULL,
    from_colony_id      INT UNSIGNED    NOT NULL,
    to_system_index     INT UNSIGNED    NOT NULL,
    distance_ly         DECIMAL(8,2)    NOT NULL,
    logistics_cost      DECIMAL(12,4)   NOT NULL COMMENT "credits per tick",
    supply_capacity     INT UNSIGNED    NOT NULL DEFAULT 100 COMMENT "% efficiency",
    interdiction_level  INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT "0-100 blocked",
    status              ENUM('active','blocked','destroyed') NOT NULL DEFAULT 'active',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_interdict_at   TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_war (war_id),
    KEY idx_from_colony (from_colony_id),
    KEY idx_system (to_system_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Supply routes for war theaters';

-- 2. Create attrition tracking table
CREATE TABLE IF NOT EXISTS war_attrition_events (
    id                  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    war_id              INT UNSIGNED    NOT NULL,
    attacker_id         INT UNSIGNED    NOT NULL,
    defender_id         INT UNSIGNED    NOT NULL,
    attrition_rate      DECIMAL(5,2)    NOT NULL COMMENT "% units lost per tick",
    cause               VARCHAR(64)     NOT NULL COMMENT "supply_shortage, exhaustion, disease",
    attacker_losses     INT UNSIGNED    NOT NULL DEFAULT 0,
    defender_losses     INT UNSIGNED    NOT NULL DEFAULT 0,
    calculated_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_war (war_id),
    KEY idx_war_side (war_id, attacker_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Attrition damage per war';

-- 3. Create table for supply route interdictions (enemy blockades)
CREATE TABLE IF NOT EXISTS war_supply_interdictions (
    id                  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    supply_line_id      INT UNSIGNED    NOT NULL,
    war_id              INT UNSIGNED    NOT NULL,
    interdicting_user   INT UNSIGNED    NOT NULL COMMENT "who is blocking",
    interdiction_strength INT UNSIGNED   NOT NULL COMMENT "blockade force level",
    intercepted_cargo   INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT "cargo units captured",
    active_from         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    active_until        TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (supply_line_id) REFERENCES war_supply_lines(id) ON DELETE CASCADE,
    KEY idx_war (war_id),
    KEY idx_interdicting_user (interdicting_user)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Enemy blockades of supply routes';

-- 4. Add columns to wars table for supply tracking (if not exists)
SET @col_exists = (
    SELECT COUNT(1) FROM information_schema.COLUMNS
    WHERE table_schema = DATABASE()
      AND table_name   = 'wars'
      AND column_name  = 'total_supply_lines'
);

SET @sql = IF(@col_exists = 0,
    CONCAT(
        'ALTER TABLE wars ',
        'ADD COLUMN total_supply_lines       INT UNSIGNED    NOT NULL DEFAULT 0, ',
        'ADD COLUMN total_logistics_cost     DECIMAL(14,4)   NOT NULL DEFAULT 0, ',
        'ADD COLUMN avg_attrition_rate       DECIMAL(5,2)    NOT NULL DEFAULT 0.5 COMMENT "% per tick"'
    ),
    'SELECT 1 /* migrate_war_v3: columns already present */'
);

PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- 5. Index for efficient supply line querying
ALTER TABLE war_supply_lines ADD INDEX idx_status_war (status, war_id);
