-- migrate_economy_v1.sql
-- Economy System Phase E1 — Processed Goods, Market & Pop-Class Database Schema
--
-- Implements the database layer for ECONOMY_DESIGN.md (GalaxyQuest).
-- Adds:
--   economy_processed_goods    — per-colony Tier-2/3/4/5 good inventories
--   economy_production_methods — active processing method per colony × building
--   economy_pop_classes        — per-colony pop class distribution (Anno principle)
--   economy_market_prices      — global market price state per good
--   economy_market_events      — active market events
--   economy_market_transactions — trade log (buy/sell records)
--   economy_policies           — per-user global economic policy + tax rates
--   economy_faction_contracts  — NPC faction trade contracts

-- ---------------------------------------------------------------------------
-- economy_processed_goods
-- Per-colony inventory for Tier-2 through Tier-5 processed goods.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS economy_processed_goods (
    id          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    colony_id   INT UNSIGNED    NOT NULL,
    good_type   VARCHAR(64)     NOT NULL,  -- GoodType enum value
    quantity    DECIMAL(14,4)   NOT NULL DEFAULT 0.0,
    capacity    DECIMAL(14,4)   NOT NULL DEFAULT 5000.0,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_colony_good (colony_id, good_type),
    KEY idx_colony (colony_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- economy_production_methods
-- Active ProcessingMethod per colony × processing building type.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS economy_production_methods (
    id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    colony_id       INT UNSIGNED    NOT NULL,
    building_type   VARCHAR(64)     NOT NULL,  -- ProcessingBuilding enum value
    method          VARCHAR(32)     NOT NULL DEFAULT 'standard',  -- ProcessingMethod
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_colony_building (colony_id, building_type),
    KEY idx_colony (colony_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- economy_pop_classes
-- Per-colony population class distribution (Anno principle).
-- pop_class: colonist | citizen | specialist | elite | transcendent
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS economy_pop_classes (
    id                  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    colony_id           INT UNSIGNED    NOT NULL,
    pop_class           VARCHAR(32)     NOT NULL,
    count               INT UNSIGNED    NOT NULL DEFAULT 0,
    satisfaction_ticks  SMALLINT        NOT NULL DEFAULT 0,
    shortage_ticks      SMALLINT        NOT NULL DEFAULT 0,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_colony_class (colony_id, pop_class),
    KEY idx_colony (colony_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- economy_market_prices
-- Global galactic market state per good.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS economy_market_prices (
    id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    good_type       VARCHAR(64)     NOT NULL,  -- GoodType or primary resource key
    supply          DECIMAL(14,4)   NOT NULL DEFAULT 100.0,
    demand          DECIMAL(14,4)   NOT NULL DEFAULT 100.0,
    price_mult      DECIMAL(8,4)    NOT NULL DEFAULT 1.0,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_good (good_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed default market prices for all goods (T2–T5 + primary resources)
INSERT IGNORE INTO economy_market_prices (good_type, supply, demand, price_mult) VALUES
    ('metal',                       100, 100, 1.0),
    ('crystal',                     100, 100, 1.0),
    ('deuterium',                   100, 100, 1.0),
    ('rare_earth',                  100, 100, 1.0),
    ('food',                        100, 100, 1.0),
    ('steel_alloy',                 100, 100, 1.0),
    ('focus_crystals',              100, 100, 1.0),
    ('reactor_fuel',                100, 100, 1.0),
    ('biocompost',                  100, 100, 1.0),
    ('electronics_components',      100, 100, 1.0),
    ('consumer_goods',              100, 100, 1.0),
    ('luxury_goods',                100, 100, 1.0),
    ('military_equipment',          100, 100, 1.0),
    ('research_kits',               100, 100, 1.0),
    ('colonization_packs',          100, 100, 1.0),
    ('neural_implants',             50,  50,  1.0),
    ('quantum_circuits',            50,  50,  1.0),
    ('bio_supplements',             50,  50,  1.0),
    ('stellar_art',                 50,  50,  1.0),
    ('advanced_propulsion',         50,  50,  1.0),
    ('void_crystals',               10,  10,  1.0),
    ('synthetic_consciousness',     10,  10,  1.0),
    ('temporal_luxuries',           10,  10,  1.0);

-- ---------------------------------------------------------------------------
-- economy_market_events
-- Active galactic market events affecting prices/demand.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS economy_market_events (
    id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    event_code      VARCHAR(64)     NOT NULL,
    label           VARCHAR(128)    NOT NULL,
    affected_good   VARCHAR(64)         NULL,  -- NULL = affects all goods
    price_mult      DECIMAL(8,4)    NOT NULL DEFAULT 1.0,
    demand_mult     DECIMAL(8,4)    NOT NULL DEFAULT 1.0,
    remaining_ticks INT             NOT NULL DEFAULT 24,
    started_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at      TIMESTAMP           NULL,
    PRIMARY KEY (id),
    KEY idx_code (event_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- economy_market_transactions
-- Trade log: buy/sell orders between colonies and the galactic market.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS economy_market_transactions (
    id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    user_id         INT UNSIGNED    NOT NULL,
    colony_id       INT UNSIGNED    NOT NULL,
    good_type       VARCHAR(64)     NOT NULL,
    direction       ENUM('buy','sell') NOT NULL,
    quantity        DECIMAL(14,4)   NOT NULL,
    price_per_unit  DECIMAL(14,4)   NOT NULL,
    total_credits   DECIMAL(14,4)   NOT NULL,
    trade_tax_rate  DECIMAL(6,4)    NOT NULL DEFAULT 0.05,
    net_credits     DECIMAL(14,4)   NOT NULL,
    transacted_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_user     (user_id),
    KEY idx_colony   (colony_id),
    KEY idx_good     (good_type),
    KEY idx_time     (transacted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- economy_policies
-- Per-user global economic policy and tax configuration.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS economy_policies (
    id                  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    user_id             INT UNSIGNED    NOT NULL,
    global_policy       VARCHAR(32)     NOT NULL DEFAULT 'free_market',
    tax_income          DECIMAL(5,4)    NOT NULL DEFAULT 0.15,
    tax_production      DECIMAL(5,4)    NOT NULL DEFAULT 0.10,
    tax_trade           DECIMAL(5,4)    NOT NULL DEFAULT 0.05,
    subsidy_agriculture TINYINT(1)      NOT NULL DEFAULT 0,
    subsidy_research    TINYINT(1)      NOT NULL DEFAULT 0,
    subsidy_military    TINYINT(1)      NOT NULL DEFAULT 0,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- economy_faction_contracts
-- NPC faction trade contracts (purchase agreements for goods).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS economy_faction_contracts (
    id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    user_id         INT UNSIGNED    NOT NULL,
    faction_id      INT UNSIGNED    NOT NULL,
    good_type       VARCHAR(64)     NOT NULL,
    quantity_per_tick DECIMAL(10,4) NOT NULL DEFAULT 0,
    price_mult      DECIMAL(8,4)    NOT NULL DEFAULT 1.0,
    direction       ENUM('supply','demand') NOT NULL,  -- supply=faction buys, demand=faction sells
    duration_ticks  INT             NOT NULL DEFAULT 100,
    remaining_ticks INT             NOT NULL DEFAULT 100,
    is_active       TINYINT(1)      NOT NULL DEFAULT 1,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_user    (user_id),
    KEY idx_faction (faction_id),
    KEY idx_active  (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
