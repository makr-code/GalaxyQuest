-- Preserve existing war state and custom table definitions.
-- No down companion: dropping storage destroys wars, sides and peace offers.
CREATE TABLE IF NOT EXISTS alliance_wars (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL DEFAULT '',
    status ENUM('active','ended','stalemate') NOT NULL DEFAULT 'active',
    war_score_a INT NOT NULL DEFAULT 0,
    war_score_b INT NOT NULL DEFAULT 0,
    exhaustion_a DECIMAL(6,2) NOT NULL DEFAULT 0,
    exhaustion_b DECIMAL(6,2) NOT NULL DEFAULT 0,
    casus_belli VARCHAR(200) DEFAULT NULL,
    declared_by_user_id INT NOT NULL,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME DEFAULT NULL,
    ended_reason VARCHAR(80) DEFAULT NULL,
    FOREIGN KEY (declared_by_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS alliance_war_sides (
    id INT AUTO_INCREMENT PRIMARY KEY,
    war_id INT NOT NULL,
    alliance_id INT NOT NULL,
    side ENUM('a','b') NOT NULL,
    joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (war_id) REFERENCES alliance_wars(id) ON DELETE CASCADE,
    FOREIGN KEY (alliance_id) REFERENCES alliances(id) ON DELETE CASCADE,
    UNIQUE KEY unique_side (war_id, alliance_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS alliance_war_peace_offers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    war_id INT NOT NULL,
    from_alliance_id INT NOT NULL,
    terms_json TEXT NOT NULL DEFAULT ('[]'),
    status ENUM('pending','accepted','rejected','expired') NOT NULL DEFAULT 'pending',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    responded_at DATETIME DEFAULT NULL,
    FOREIGN KEY (war_id) REFERENCES alliance_wars(id) ON DELETE CASCADE,
    FOREIGN KEY (from_alliance_id) REFERENCES alliances(id) ON DELETE CASCADE
) ENGINE=InnoDB;
