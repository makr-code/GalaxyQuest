-- Migration: Create economy_policies table
-- For user-specific economic policies, tax rates, and subsidies
-- Created: 2026-04-05

SET @tableExists := (
    SELECT COUNT(1)
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'economy_policies'
);

SELECT IF(@tableExists = 0,
    'Creating economy_policies table',
    'economy_policies table already exists'
) AS status;

CREATE TABLE IF NOT EXISTS economy_policies (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id         INT NOT NULL UNIQUE,
    
    -- Global policies (0-100, percentage)
    global_policy   INT DEFAULT 50,
    
    -- Tax rates (0-100, percentage of income)
    tax_income      INT DEFAULT 20,
    tax_trade       INT DEFAULT 15,
    tax_resources   INT DEFAULT 10,
    
    -- Subsidies (0-100, percentage boost to production)
    subsidy_agriculture    INT DEFAULT 5,
    subsidy_research       INT DEFAULT 10,
    subsidy_military       INT DEFAULT 3,
    
    -- Happiness factors
    happiness_policy_weight FLOAT DEFAULT 0.5,
    
    -- Timestamps
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_economy_policies_user_id
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @indexExists := (
    SELECT COUNT(1)
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'economy_policies'
    AND INDEX_NAME = 'idx_economy_policies_user_id'
);

SET @sql := IF(@indexExists = 0,
    'CREATE INDEX idx_economy_policies_user_id ON economy_policies(user_id)',
    'SELECT "Index already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration complete: economy_policies table' AS result;
