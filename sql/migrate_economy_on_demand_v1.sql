-- Enable ON_DEMAND_ECONOMY_ENABLED only after this migration.
-- No historical production is inferred for the new processed-goods model.
SET @economy_has_credits = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'credits'
);
SET @economy_credits_sql = IF(
    @economy_has_credits = 0,
    'ALTER TABLE users ADD COLUMN credits DECIMAL(20,4) NOT NULL DEFAULT 1000',
    'SELECT 1'
);
PREPARE economy_credits_stmt FROM @economy_credits_sql;
EXECUTE economy_credits_stmt;
DEALLOCATE PREPARE economy_credits_stmt;

CREATE TABLE IF NOT EXISTS colony_economy_state (
    colony_id INT NOT NULL PRIMARY KEY,
    settled_at BIGINT NOT NULL,
    state_json JSON NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_economy_state_colony FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS economy_construction_slots (
    queue_id INT NOT NULL PRIMARY KEY,
    slot_id INT UNSIGNED NOT NULL,
    target_level INT NOT NULL,
    CONSTRAINT fk_economy_construction_queue FOREIGN KEY (queue_id) REFERENCES building_upgrade_queue(id) ON DELETE CASCADE,
    CONSTRAINT fk_economy_construction_slot FOREIGN KEY (slot_id) REFERENCES colony_building_slots(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS economy_colony_market (
    colony_id INT NOT NULL,
    good_type VARCHAR(64) NOT NULL,
    galaxy_index INT NOT NULL,
    system_index INT NOT NULL,
    quantity DOUBLE NOT NULL DEFAULT 0,
    production DOUBLE NOT NULL DEFAULT 0,
    consumption DOUBLE NOT NULL DEFAULT 0,
    settled_at BIGINT NOT NULL,
    PRIMARY KEY (colony_id, good_type),
    KEY idx_economy_galaxy_good (galaxy_index, good_type),
    KEY idx_economy_system_good (galaxy_index, system_index, good_type),
    CONSTRAINT fk_economy_market_colony FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE CASCADE
) ENGINE=InnoDB;
