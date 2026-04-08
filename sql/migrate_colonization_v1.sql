-- GalaxyQuest – Kolonisierungssystem Migration v1
-- Neue Tabellen: sectors, sector_systems, governors, empire_edicts, empire_sprawl_cache
-- Referenz: docs/gamedesign/COLONIZATION_SYSTEM_DESIGN.md, docs/github-issues/01-colonization-db-backend.md

USE galaxyquest;

-- ──────────────────────────────────────────────────────────────────────────────
-- Sektoren: Verwaltungsregionen, die mehrere Sternensysteme zusammenfassen.
-- Ein Sektor hat einen optionalen Gouverneur und eine Hauptkolonie.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sectors (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    player_id      INT NOT NULL,
    name           VARCHAR(64) NOT NULL DEFAULT 'New Sector',
    governor_id    INT DEFAULT NULL
        COMMENT 'FK to governors.id – NULL means no governor assigned',
    capital_colony_id INT DEFAULT NULL
        COMMENT 'The central colony that anchors this sector',
    autonomy_level INT NOT NULL DEFAULT 0
        COMMENT '0 = fully centralized, 100 = fully autonomous',
    tax_rate       DECIMAL(3,2) NOT NULL DEFAULT 1.00
        COMMENT 'Income multiplier applied to sector resource output (0.50–1.50)',
    approval_rating INT NOT NULL DEFAULT 50
        COMMENT 'Population approval 0–100; below 30 triggers unrest events',
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (capital_colony_id) REFERENCES colonies(id) ON DELETE SET NULL,
    KEY idx_sectors_player (player_id)
) ENGINE=InnoDB COMMENT='Administrative regions grouping star systems under one governor';

-- ──────────────────────────────────────────────────────────────────────────────
-- Sektor-System-Zuordnung: N:M zwischen Sektoren und Sternensystemen.
-- Ein System kann nur zu einem Sektor gehören (player-scoped).
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sector_systems (
    sector_id      INT NOT NULL,
    star_system_id INT NOT NULL,
    PRIMARY KEY (sector_id, star_system_id),
    FOREIGN KEY (sector_id) REFERENCES sectors(id) ON DELETE CASCADE,
    FOREIGN KEY (star_system_id) REFERENCES star_systems(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Maps star systems to administrative sectors';

-- ──────────────────────────────────────────────────────────────────────────────
-- Gouverneure: NPC-Charaktere, die einem Sektor zugewiesen werden und den
-- AdminCap erhöhen sowie Sektor-Boni verleihen.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS governors (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    player_id   INT NOT NULL,
    npc_id      INT DEFAULT NULL
        COMMENT 'FK to npc_characters or leaders table; NULL = generic/unnamed governor',
    sector_id   INT DEFAULT NULL
        COMMENT 'Currently assigned sector; NULL = unassigned / in pool',
    admin_bonus INT NOT NULL DEFAULT 5
        COMMENT '+AdminCap provided by this governor (5–25 depending on level)',
    salary      INT NOT NULL DEFAULT 100
        COMMENT 'Credits per tick deducted from player treasury',
    appointed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (sector_id) REFERENCES sectors(id) ON DELETE SET NULL,
    KEY idx_governors_player (player_id),
    KEY idx_governors_sector (sector_id)
) ENGINE=InnoDB COMMENT='NPC governors assigned to administrative sectors';

-- ──────────────────────────────────────────────────────────────────────────────
-- Empire-Edikte: Politische Anordnungen mit empire-weiter Wirkung.
-- Jedes Edikt hat laufende Tick-Kosten (Credits) und ist on/off togglebar.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empire_edicts (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    player_id    INT NOT NULL,
    edict_type   VARCHAR(64) NOT NULL
        COMMENT 'administrative_efficiency | martial_law | free_trade | research_subsidy | colonization_drive | war_economy',
    active       TINYINT(1) NOT NULL DEFAULT 0,
    cost_per_tick INT NOT NULL DEFAULT 0
        COMMENT 'Credits deducted per economy tick while active',
    activated_at DATETIME DEFAULT NULL
        COMMENT 'Timestamp of last activation; NULL if never activated',
    UNIQUE KEY uq_edict_per_player (player_id, edict_type),
    FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE CASCADE,
    KEY idx_edicts_player_active (player_id, active)
) ENGINE=InnoDB COMMENT='Empire-wide political edicts with ongoing credit costs';

-- ──────────────────────────────────────────────────────────────────────────────
-- Empire-Sprawl-Cache: Vorberechnete Sprawl-Werte pro Spieler.
-- Wird durch ColonizationEngine::recalcSprawl() aktualisiert (je Tick).
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empire_sprawl_cache (
    player_id    INT NOT NULL PRIMARY KEY,
    sprawl_value DECIMAL(8,2) NOT NULL DEFAULT 0.00
        COMMENT 'Computed EmpireSprawl = Σ(systems×1.0) + Σ(colonies×0.5) + Σ(fleets>5×0.3)',
    admin_cap    INT NOT NULL DEFAULT 50
        COMMENT 'Total AdminCap = BaseAdminCap(50) + governor bonuses + edict bonuses',
    sprawl_pct   INT NOT NULL DEFAULT 0
        COMMENT 'Percentage: ROUND(sprawl_value / admin_cap * 100), capped at 200',
    updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Cached empire sprawl calculation, refreshed every economy tick';
