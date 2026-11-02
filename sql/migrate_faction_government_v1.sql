-- Existing diplomacy data and table definitions remain untouched.
-- No down companion: dropping storage would destroy government/alliance/standing history.
CREATE TABLE IF NOT EXISTS faction_government (
    faction_id INT PRIMARY KEY,
    government_form VARCHAR(32) NOT NULL DEFAULT 'democracy',
    stability_score INT NOT NULL DEFAULT 75,
    last_form_change DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS faction_alliances (
    faction_a_id INT NOT NULL,
    faction_b_id INT NOT NULL,
    alliance_strength INT NOT NULL DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (faction_a_id, faction_b_id),
    FOREIGN KEY (faction_a_id) REFERENCES npc_factions(id) ON DELETE CASCADE,
    FOREIGN KEY (faction_b_id) REFERENCES npc_factions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS faction_standing_adjustments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    faction_id INT NOT NULL,
    adjustment INT NOT NULL,
    reason VARCHAR(128) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE
) ENGINE=InnoDB;
