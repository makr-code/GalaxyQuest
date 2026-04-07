-- migrate_economy_v3.sql
-- Economy System Phase P1.1 — Pop Satisfaction Mechanics
--
-- Adds satisfaction_index, employment_level, migration_rate, and policy columns
-- to economy_pop_classes to support:
--   1. Satisfaction calculation (employment, wages, happiness, culture)
--   2. Production multiplier (satisfaction → yield)
--   3. Migration between colonies/factions
--
-- Uses information_schema + PREPARE pattern for MySQL 8.4 compatibility

SET @col_exists = (
    SELECT COUNT(1) FROM information_schema.COLUMNS
    WHERE table_schema = DATABASE()
      AND table_name   = 'economy_pop_classes'
      AND column_name  = 'satisfaction_index'
);

SET @sql = IF(@col_exists = 0,
    CONCAT(
        'ALTER TABLE economy_pop_classes ',
        'ADD COLUMN satisfaction_index      DECIMAL(5,2)   NOT NULL DEFAULT 50.0 COMMENT "0-100 satisfaction level", ',
        'ADD COLUMN employment_level        DECIMAL(5,2)   NOT NULL DEFAULT 80.0 COMMENT "% of class employed", ',
        'ADD COLUMN migration_rate          DECIMAL(5,2)   NOT NULL DEFAULT 0.0  COMMENT "% per tick migrating", ',
        'ADD COLUMN wage_requirement        DECIMAL(12,4)  NOT NULL DEFAULT 100.0 COMMENT "credits per unit per tick", ',
        'ADD COLUMN last_satisfaction_calc  TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP'
    ),
    'SELECT 1 /* migrate_economy_v3: columns already present */'
);

PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- Create index for satisfaction queries (economy ticker)
ALTER TABLE economy_pop_classes ADD INDEX idx_satisfaction (colony_id, satisfaction_index);

-- Create new table for pop satisfaction history (tracking satisfaction decay)
CREATE TABLE IF NOT EXISTS economy_pop_satisfaction_history (
    id                  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    colony_id           INT UNSIGNED    NOT NULL,
    pop_class           VARCHAR(32)     NOT NULL,
    tick_number         BIGINT UNSIGNED NOT NULL,
    satisfaction_index  DECIMAL(5,2)    NOT NULL,
    employment_level    DECIMAL(5,2)    NOT NULL,
    migration_rate      DECIMAL(5,2)    NOT NULL,
    reason              VARCHAR(255),   -- 'wage_change', 'war_decree', 'policy_change', 'pirate_raid'
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_colony_tick (colony_id, tick_number),
    KEY idx_satisfaction (satisfaction_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Historical satisfaction tracking for analysis';

-- Create table for pop migration events
CREATE TABLE IF NOT EXISTS economy_pop_migrations (
    id                  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    from_colony_id      INT UNSIGNED    NOT NULL,
    to_colony_id        INT UNSIGNED,   -- NULL = leave faction entirely
    pop_class           VARCHAR(32)     NOT NULL,
    migrant_count       INT UNSIGNED    NOT NULL,
    reason              VARCHAR(255),   -- 'low_satisfaction', 'better_wages', 'faction_change'
    migration_tick      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_from_colony (from_colony_id),
    KEY idx_to_colony (to_colony_id),
    KEY idx_migration_tick (migration_tick)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Track population movements between colonies';
