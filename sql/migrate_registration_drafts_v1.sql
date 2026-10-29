CREATE TABLE IF NOT EXISTS registration_drafts (
    token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    session_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    faction_id INT NOT NULL,
    planet_id INT NOT NULL,
    snapshot_json JSON NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_registration_session (session_hash),
    UNIQUE KEY uniq_registration_planet (planet_id),
    KEY idx_registration_expiry (expires_at),
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE RESTRICT,
    FOREIGN KEY (planet_id) REFERENCES planets(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_onboarding (
    user_id INT NOT NULL PRIMARY KEY,
    faction_id INT NOT NULL,
    species_code VARCHAR(30) NOT NULL,
    gameplay_style VARCHAR(30) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS registration_limits (
    ip_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    window_start DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
