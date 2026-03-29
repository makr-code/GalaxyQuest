-- GalaxyQuest - Vessel blueprint runtime migration v5
-- Introduces `built_vessels` for individual vessel tracking (Noch offen #2).
-- Also adds `fleet_vessel_assignments` as v2 placeholder (no FKs yet, additive only).
-- Safe to run multiple times.

USE galaxyquest;

-- ── built_vessels ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS built_vessels (
    id             BIGINT AUTO_INCREMENT PRIMARY KEY,
    owner_user_id  INT NOT NULL,
    colony_id      INT NOT NULL,
    blueprint_id   BIGINT NOT NULL,
    name           VARCHAR(100) DEFAULT NULL,
    snapshot_stats_json JSON NOT NULL,
    hp_state_json       JSON NOT NULL,
    status         ENUM('docked','assigned','destroyed') NOT NULL DEFAULT 'docked',
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (colony_id)    REFERENCES colonies(id) ON DELETE CASCADE,
    FOREIGN KEY (blueprint_id) REFERENCES vessel_blueprints(id) ON DELETE CASCADE,
    INDEX idx_bv_colony (colony_id, status),
    INDEX idx_bv_user   (owner_user_id, status)
) ENGINE=InnoDB;

-- ── fleet_vessel_assignments (v2 placeholder, no FK constraints yet) ─────────

CREATE TABLE IF NOT EXISTS fleet_vessel_assignments (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    fleet_id        INT NOT NULL,
    built_vessel_id BIGINT NOT NULL,
    assigned_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_fva_vessel (built_vessel_id),
    INDEX idx_fva_fleet (fleet_id)
) ENGINE=InnoDB;
