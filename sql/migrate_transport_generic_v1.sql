-- migrate_transport_generic_v1.sql
-- Generic Transport Model v1
--
-- Adds JSON cargo payload columns to fleets and trade_routes.
-- Uses information_schema + PREPARE because MySQL 8.4 in this project
-- can fail on ADD COLUMN IF NOT EXISTS.

-- fleets.cargo_payload
SET @fleet_col_exists = (
    SELECT COUNT(1) FROM information_schema.COLUMNS
    WHERE table_schema = DATABASE()
      AND table_name = 'fleets'
      AND column_name = 'cargo_payload'
);

SET @fleet_sql = IF(
    @fleet_col_exists = 0,
    'ALTER TABLE fleets ADD COLUMN cargo_payload JSON DEFAULT NULL AFTER cargo_deuterium',
    'SELECT 1 /* fleets.cargo_payload already exists */'
);

PREPARE _fleet_stmt FROM @fleet_sql;
EXECUTE _fleet_stmt;
DEALLOCATE PREPARE _fleet_stmt;

-- trade_routes.cargo_payload
SET @route_col_exists = (
    SELECT COUNT(1) FROM information_schema.COLUMNS
    WHERE table_schema = DATABASE()
      AND table_name = 'trade_routes'
      AND column_name = 'cargo_payload'
);

SET @route_sql = IF(
    @route_col_exists = 0,
    'ALTER TABLE trade_routes ADD COLUMN cargo_payload JSON DEFAULT NULL AFTER cargo_deuterium',
    'SELECT 1 /* trade_routes.cargo_payload already exists */'
);

PREPARE _route_stmt FROM @route_sql;
EXECUTE _route_stmt;
DEALLOCATE PREPARE _route_stmt;
