-- Positions live on celestial_bodies, not on ephemeral star_systems cache IDs.
CREATE TABLE IF NOT EXISTS faction_homeworlds (
    faction_id INT NOT NULL PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    colony_id INT NOT NULL UNIQUE,
    kind VARCHAR(16) NOT NULL,
    placement_version VARCHAR(32) NOT NULL,
    provisional TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE RESTRICT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS npc_faction_memberships (
    user_id INT NOT NULL PRIMARY KEY,
    faction_id INT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE,
    KEY idx_npc_membership_faction (faction_id)
) ENGINE=InnoDB;
