-- Traders System — Database Migration
-- GalaxyQuest v2.0 — Supply/Demand-basierte Handelssystem

-- ─────────────────────────────────────────────────────────────────────────────

-- 1. NPC Traders — Handelsunternehmen pro Fraktion
CREATE TABLE IF NOT EXISTS npc_traders (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    faction_id      INT NOT NULL,
    name            VARCHAR(64) NOT NULL,
    user_id         INT NOT NULL,
    base_colony_id  INT DEFAULT NULL,
    capital_credits DECIMAL(16,2) NOT NULL DEFAULT 50000,
    
    -- Statistiken
    total_profit    DECIMAL(16,2) NOT NULL DEFAULT 0,
    active_fleets   INT UNSIGNED NOT NULL DEFAULT 0,
    max_fleets      INT UNSIGNED NOT NULL DEFAULT 3,
    
    -- Strategie
    strategy        ENUM('profit_max', 'volume', 'stabilize') NOT NULL DEFAULT 'profit_max',
    specialization  VARCHAR(32) DEFAULT NULL,
    
    last_action_at  DATETIME DEFAULT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (base_colony_id) REFERENCES colonies(id) ON DELETE SET NULL,
    INDEX idx_faction (faction_id),
    INDEX idx_active_fleets (active_fleets),
    INDEX idx_strategy (strategy)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────────────────────

-- 2. Trade Opportunities — Erkannte profitable Routen
CREATE TABLE IF NOT EXISTS trade_opportunities (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    source_system   INT NOT NULL,
    target_system   INT NOT NULL,
    resource_type   VARCHAR(32) NOT NULL,
    
    source_price    DECIMAL(10,4) NOT NULL,
    target_price    DECIMAL(10,4) NOT NULL,
    profit_margin   DECIMAL(6,2) NOT NULL,  -- Prozent, z.B. 25.50
    
    available_qty   DECIMAL(12,2) NOT NULL,
    demand_qty      DECIMAL(12,2) NOT NULL,
    actual_qty      DECIMAL(12,2) NOT NULL,  -- clamped mit available & demand
    
    transport_cost  DECIMAL(10,4) NOT NULL,
    net_profit_per_unit DECIMAL(10,4) NOT NULL,
    
    confidence      DECIMAL(4,3) NOT NULL,  -- 0.0 - 1.0
    
    expires_at      DATETIME NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_profit (profit_margin DESC),
    INDEX idx_expires (expires_at),
    INDEX idx_systems (source_system, target_system)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────────────────────

-- 3. Trader Routes — Aktive Handelsrouten mit Flotten
CREATE TABLE IF NOT EXISTS trader_routes (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    trader_id       INT NOT NULL,
    fleet_id        INT DEFAULT NULL,
    
    source_colony_id    INT NOT NULL,
    target_colony_id    INT NOT NULL,
    resource_type       VARCHAR(32) NOT NULL,
    
    quantity_planned    DECIMAL(12,2) NOT NULL,
    quantity_acquired   DECIMAL(12,2) NOT NULL DEFAULT 0,
    quantity_delivered  DECIMAL(12,2) NOT NULL DEFAULT 0,
    
    status          ENUM('planning', 'acquiring', 'in_transit', 'delivering', 'completed', 'failed') 
                    NOT NULL DEFAULT 'planning',
    
    price_paid      DECIMAL(10,4) NOT NULL DEFAULT 0,
    price_sold      DECIMAL(10,4) NOT NULL DEFAULT 0,
    expected_profit DECIMAL(16,2) NOT NULL DEFAULT 0,
    actual_profit   DECIMAL(16,2) DEFAULT NULL,
    
    departure_at    DATETIME DEFAULT NULL,
    arrival_at      DATETIME DEFAULT NULL,
    delivered_at    DATETIME DEFAULT NULL,
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (trader_id) REFERENCES npc_traders(id) ON DELETE CASCADE,
    FOREIGN KEY (fleet_id) REFERENCES fleets(id) ON DELETE SET NULL,
    FOREIGN KEY (source_colony_id) REFERENCES colonies(id),
    FOREIGN KEY (target_colony_id) REFERENCES colonies(id),
    
    INDEX idx_trader_status (trader_id, status),
    INDEX idx_fleet (fleet_id),
    INDEX idx_resource (resource_type)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────────────────────

-- 4. Market Supply/Demand — Lokale Angebot/Nachfrage pro System
CREATE TABLE IF NOT EXISTS market_supply_demand (
    galaxy_index    INT NOT NULL DEFAULT 1,
    system_index    INT NOT NULL,
    resource_type   VARCHAR(32) NOT NULL,
    
    -- Stündliche Produktion + Verbrauch
    production_per_hour     DECIMAL(16,2) NOT NULL DEFAULT 0,
    consumption_per_hour    DECIMAL(16,2) NOT NULL DEFAULT 0,
    
    -- Verfügbare Menge zum Verkauf
    available_supply        DECIMAL(16,2) NOT NULL DEFAULT 0,
    
    -- Nachgefragte Menge zum Kauf
    desired_demand          DECIMAL(16,2) NOT NULL DEFAULT 0,
    
    -- Netto-Balance (positiv=Überschuss, negativ=Mangel)
    net_balance             DECIMAL(16,2) NOT NULL DEFAULT 0,
    
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    PRIMARY KEY (galaxy_index, system_index, resource_type),
    INDEX idx_updated (updated_at)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────────────────────

-- 5. Trader Transaction Log — Audit Trail
CREATE TABLE IF NOT EXISTS trader_transactions (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    trader_id       INT NOT NULL,
    route_id        INT NOT NULL,
    
    transaction_type ENUM('bought', 'sold', 'transported') NOT NULL,
    resource_type    VARCHAR(32) NOT NULL,
    
    quantity         DECIMAL(12,2) NOT NULL,
    price_per_unit   DECIMAL(10,4) NOT NULL,
    total_credits    DECIMAL(16,2) NOT NULL,
    
    source_colony_id INT DEFAULT NULL,
    target_colony_id INT DEFAULT NULL,
    
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (trader_id) REFERENCES npc_traders(id) ON DELETE CASCADE,
    FOREIGN KEY (route_id) REFERENCES trader_routes(id) ON DELETE CASCADE,
    
    INDEX idx_trader_time (trader_id, created_at),
    INDEX idx_resource (resource_type)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration complete: Traders system tables created successfully

