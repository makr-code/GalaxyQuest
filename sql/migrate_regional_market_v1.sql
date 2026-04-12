-- migrate_regional_market_v1.sql
-- Sprint 2.4: Regionale Marktdynamik
--
-- Adds:
--   market_regions        — named market region definitions
--   market_region_quotes  — per-region supply/demand/price state per good
--   market_region_events  — region-scoped market events (shortages, booms, etc.)
--
-- Two pre-seeded regions:
--   core_worlds      — Kernwelten (manufacturing hub, lower raw-material supply)
--   frontier_sectors — Grenzgebiete (resource-rich frontier, +20% transport cost)

-- ---------------------------------------------------------------------------
-- market_regions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS market_regions (
    id                  VARCHAR(64)    NOT NULL,
    label               VARCHAR(128)   NOT NULL,
    transport_cost_mult DECIMAL(5,4)   NOT NULL DEFAULT 1.0000,
    scope               ENUM('galaxy','sector','empire') NOT NULL DEFAULT 'galaxy',
    created_at          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed pre-defined regions (idempotent)
INSERT INTO market_regions (id, label, transport_cost_mult, scope) VALUES
    ('core_worlds',      'Kernwelten',   1.0000, 'galaxy'),
    ('frontier_sectors', 'Grenzgebiete', 1.2000, 'galaxy')
ON DUPLICATE KEY UPDATE
    label               = VALUES(label),
    transport_cost_mult = VALUES(transport_cost_mult);

-- ---------------------------------------------------------------------------
-- market_region_quotes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS market_region_quotes (
    region_id          VARCHAR(64)    NOT NULL,
    good_type          VARCHAR(64)    NOT NULL,
    supply             DECIMAL(16,4)  NOT NULL DEFAULT 100.0000,
    demand             DECIMAL(16,4)  NOT NULL DEFAULT 100.0000,
    current_price      DECIMAL(12,4)  NOT NULL DEFAULT 0.0000,
    active_events_mult DECIMAL(6,4)   NOT NULL DEFAULT 1.0000,
    updated_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (region_id, good_type),
    CONSTRAINT fk_mrq_region FOREIGN KEY (region_id) REFERENCES market_regions(id) ON DELETE CASCADE,
    INDEX idx_mrq_good (good_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed initial supply/demand per region based on ECONOMY_DESIGN.md §4
-- Core Worlds: manufactured goods surplus, raw materials scarce
-- Frontier Sectors: raw materials surplus, manufactured goods scarce (+20% transport)

INSERT INTO market_region_quotes (region_id, good_type, supply, demand, current_price) VALUES
    -- core_worlds raw materials (scarce)
    ('core_worlds', 'metal',        70.0,  100.0,  14.29),
    ('core_worlds', 'crystal',      80.0,  100.0,  18.75),
    ('core_worlds', 'deuterium',    80.0,  100.0,  25.00),
    ('core_worlds', 'rare_earth',   60.0,  100.0,  83.33),
    ('core_worlds', 'food',         90.0,  100.0,   8.89),
    -- core_worlds manufactured goods (surplus → cheaper)
    ('core_worlds', 'steel_alloy',      130.0, 100.0,  26.92),
    ('core_worlds', 'focus_crystals',   120.0, 100.0,  50.00),
    ('core_worlds', 'reactor_fuel',     110.0, 100.0,  50.00),
    ('core_worlds', 'consumer_goods',   140.0, 100.0,  57.14),
    ('core_worlds', 'luxury_goods',     130.0, 100.0, 153.85),
    ('core_worlds', 'research_kits',    120.0, 100.0, 108.33),
    -- frontier_sectors raw materials (surplus → cheaper + transport surcharge)
    ('frontier_sectors', 'metal',       140.0, 100.0,  10.29),
    ('frontier_sectors', 'crystal',     130.0, 100.0,  13.85),
    ('frontier_sectors', 'deuterium',   120.0, 100.0,  20.00),
    ('frontier_sectors', 'rare_earth',  150.0, 100.0,  40.00),
    ('frontier_sectors', 'food',         70.0, 100.0,  13.71),
    -- frontier_sectors manufactured goods (scarce + transport surcharge → expensive)
    ('frontier_sectors', 'steel_alloy',      70.0,  100.0,  72.00),
    ('frontier_sectors', 'focus_crystals',   60.0,  100.0, 144.00),
    ('frontier_sectors', 'reactor_fuel',     80.0,  100.0,  99.00),
    ('frontier_sectors', 'consumer_goods',   50.0,  100.0, 230.40),
    ('frontier_sectors', 'luxury_goods',     40.0,  100.0, 720.00),
    ('frontier_sectors', 'research_kits',    60.0,  100.0, 312.00)
ON DUPLICATE KEY UPDATE
    supply        = VALUES(supply),
    demand        = VALUES(demand),
    current_price = VALUES(current_price);

-- ---------------------------------------------------------------------------
-- market_region_events
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS market_region_events (
    id               INT            NOT NULL AUTO_INCREMENT,
    region_id        VARCHAR(64)    NOT NULL,
    event_code       VARCHAR(64)    NOT NULL,
    label            VARCHAR(128)   NOT NULL,
    affected_good    VARCHAR(64)    NULL,
    price_mult       DECIMAL(6,4)   NOT NULL DEFAULT 1.0000,
    demand_mult      DECIMAL(6,4)   NOT NULL DEFAULT 1.0000,
    remaining_ticks  INT            NOT NULL DEFAULT 0,
    started_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_mre_region FOREIGN KEY (region_id) REFERENCES market_regions(id) ON DELETE CASCADE,
    INDEX idx_mre_region_active (region_id, remaining_ticks),
    INDEX idx_mre_good (affected_good)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
