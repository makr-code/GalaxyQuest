-- GalaxyQuest migration v9: quest-unlocked permanent wormhole beacons

SET @has_wh_perm := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'wormholes'
      AND COLUMN_NAME = 'is_permanent'
);

SET @sql_wh_perm := IF(
    @has_wh_perm = 0,
    'ALTER TABLE wormholes ADD COLUMN is_permanent TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active',
    'SELECT 1'
);

PREPARE stmt_wh_perm FROM @sql_wh_perm;
EXECUTE stmt_wh_perm;
DEALLOCATE PREPARE stmt_wh_perm;

CREATE TABLE IF NOT EXISTS user_wormhole_unlocks (
    user_id INT NOT NULL PRIMARY KEY,
    source_quest_code VARCHAR(64) DEFAULT NULL,
    unlocked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT IGNORE INTO faction_quests
    (faction_id, code, title, description, quest_type, requirements_json,
     reward_metal, reward_crystal, reward_deuterium, reward_rare_earth,
     reward_dark_matter, reward_rank_points, reward_standing, min_standing, difficulty, repeatable)
SELECT f.id,
       'precursor_wormhole_beacon',
       'Unlock the Ancient Beacon',
       'Decode precursor harmonics and stabilize an ancient beacon lattice to unlock permanent wormhole corridors.',
       'research',
       '{"tech":"wormhole_theory","level":5}',
       15000, 12000, 9000, 0,
       500, 180, 18, 80, 'epic', 0
FROM npc_factions f
WHERE f.code = 'precursors';

-- Seed one permanent route for players that complete the beacon unlock quest
INSERT INTO wormholes
    (endpoint_a_galaxy, endpoint_a_system, endpoint_b_galaxy, endpoint_b_system,
     stability, cooldown_until, is_active, is_permanent, label)
SELECT 1, 120, 1, 260, 100, NULL, 1, 1, 'Precursor Beacon Arc'
WHERE NOT EXISTS (
    SELECT 1 FROM wormholes
    WHERE endpoint_a_galaxy = 1 AND endpoint_a_system = 120
      AND endpoint_b_galaxy = 1 AND endpoint_b_system = 260
    LIMIT 1
);
