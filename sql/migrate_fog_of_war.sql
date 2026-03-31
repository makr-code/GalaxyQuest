-- GalaxyQuest – Fog of War Migration
-- Run: docker compose exec db mysql -u root -proot galaxyquest < sql/migrate_fog_of_war.sql

USE galaxyquest;

-- ── Fog-of-War: per-player system visibility tracking ─────────────────────────
CREATE TABLE IF NOT EXISTS player_system_visibility (
    user_id       INT NOT NULL,
    galaxy        TINYINT UNSIGNED NOT NULL,
    `system`      SMALLINT UNSIGNED NOT NULL,
    -- 'own'    = player has a colony here        → full data, never expires
    -- 'active' = player fleet currently in system → full data, expires when fleet leaves
    -- 'stale'  = previously visited, no presence → intel_json snapshot shown
    -- (no row) = never seen                       → system name only, no planet data
    level         ENUM('own','active','stale') NOT NULL DEFAULT 'stale',
    scouted_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at    DATETIME DEFAULT NULL,         -- NULL = permanent (own/stale keep until overwritten)
    intel_json    LONGTEXT DEFAULT NULL,         -- JSON snapshot of last observed state
    PRIMARY KEY (user_id, galaxy, `system`),
    INDEX idx_vis_user_galaxy  (user_id, galaxy),
    INDEX idx_vis_expires      (expires_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Seed 'own' visibility for all existing colonies (idempotent)
INSERT IGNORE INTO player_system_visibility (user_id, galaxy, `system`, level, scouted_at, expires_at)
SELECT DISTINCT
    c.user_id,
    cb.galaxy_index,
    cb.system_index,
    'own',
    NOW(),
    NULL
FROM colonies c
JOIN celestial_bodies cb ON cb.id = c.body_id;
