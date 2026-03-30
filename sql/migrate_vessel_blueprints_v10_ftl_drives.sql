-- GalaxyQuest migration v10: faction-specific FTL drive system
-- See FTL_DRIVE_DESIGN.md for full design rationale and balancing.

USE galaxyquest;

-- ─── Phase 1 & 2: users table extensions ─────────────────────────────────────

-- ftl_drive_type: which faction drive the player uses
-- Defaults to 'aereth' (Alcubierre Warp) as the simplest/most universal drive.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS ftl_drive_type VARCHAR(30) NOT NULL DEFAULT 'aereth'
        COMMENT 'Faction FTL drive: aereth|vor_tak|syl_nar|vel_ar|zhareen|kryl_tha';

-- ftl_cooldown_until: used by Vor''Tak K-F Drive (72h recharge)
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS ftl_cooldown_until DATETIME DEFAULT NULL
        COMMENT 'FTL drive cooldown expiry (Vor''Tak K-F recharge)';

-- ─── fleet mission ENUM: add 'survey' ─────────────────────────────────────────

ALTER TABLE fleets
    MODIFY COLUMN mission ENUM('attack','transport','colonize','harvest','spy','recall','survey')
        NOT NULL DEFAULT 'transport';

-- ─── Phase 3a: Syl'Nar gate network ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ftl_gates (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    owner_user_id INT NOT NULL,
    galaxy_a      INT NOT NULL,
    system_a      INT NOT NULL,
    galaxy_b      INT NOT NULL,
    system_b      INT NOT NULL,
    is_active     TINYINT(1) NOT NULL DEFAULT 1,
    health        INT NOT NULL DEFAULT 100
                  COMMENT 'Gate health 0–100; destroyed at 0',
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_gates_a (galaxy_a, system_a),
    INDEX idx_gates_b (galaxy_b, system_b)
) ENGINE=InnoDB;

-- ─── Phase 3b: Zhareen resonance node registry ───────────────────────────────

CREATE TABLE IF NOT EXISTS ftl_resonance_nodes (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    owner_user_id  INT NOT NULL,
    galaxy         INT NOT NULL,
    `system`       INT NOT NULL,
    discovered_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cooldown_until DATETIME DEFAULT NULL
                   COMMENT '30-min cooldown per node after use',
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_node (owner_user_id, galaxy, `system`)
) ENGINE=InnoDB;

-- ─── Seed: map existing player races → ftl_drive_type ────────────────────────
-- user_character_profiles.race contains the display name (e.g. "Vor'Tak").
-- Only update players who still have the default 'aereth'.

UPDATE users u
JOIN user_character_profiles ucp ON ucp.user_id = u.id
SET u.ftl_drive_type = CASE
    WHEN LOWER(ucp.race) LIKE '%vor%tak%'  THEN 'vor_tak'
    WHEN LOWER(ucp.race) LIKE '%syl%nar%'  THEN 'syl_nar'
    WHEN LOWER(ucp.race) LIKE '%vel%ar%'   THEN 'vel_ar'
    WHEN LOWER(ucp.race) LIKE '%zhareen%'  THEN 'zhareen'
    WHEN LOWER(ucp.race) LIKE '%aereth%'   THEN 'aereth'
    WHEN LOWER(ucp.race) LIKE '%kryl%tha%' THEN 'kryl_tha'
    ELSE 'aereth'
END
WHERE u.ftl_drive_type = 'aereth';
