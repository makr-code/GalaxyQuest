-- migrate_economy_v2.sql
-- Economy System Phase E2 — Lazy-Evaluation Columns for Processed Goods
--
-- Adds production_rate_per_hour, consumption_rate_per_hour, last_calculated_at
-- to economy_processed_goods so that flush_colony_production() can accumulate
-- stock without a background tick.
--
-- Uses information_schema + PREPARE pattern because MySQL 8.4 does not support
-- ADD COLUMN IF NOT EXISTS (Syntax Error 1064).

-- Add all three columns in one statement if last_calculated_at is missing.
SET @col_exists = (
    SELECT COUNT(1) FROM information_schema.COLUMNS
    WHERE table_schema = DATABASE()
      AND table_name   = 'economy_processed_goods'
      AND column_name  = 'last_calculated_at'
);

SET @sql = IF(@col_exists = 0,
    CONCAT(
        'ALTER TABLE economy_processed_goods ',
        'ADD COLUMN production_rate_per_hour  DECIMAL(10,4) NOT NULL DEFAULT 0.0000, ',
        'ADD COLUMN consumption_rate_per_hour DECIMAL(10,4) NOT NULL DEFAULT 0.0000, ',
        'ADD COLUMN last_calculated_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP'
    ),
    'SELECT 1 /* migrate_economy_v2: columns already present */'
);

PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
