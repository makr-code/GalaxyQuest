-- GalaxyQuest - Combat strategy migration v1 (wars)
-- Adds strategy-level war tracking tables.
-- Safe to run multiple times.

USE galaxyquest;

CREATE TABLE IF NOT EXISTS wars (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    attacker_user_id INT NOT NULL,
    defender_user_id INT NOT NULL,
    status ENUM('active', 'ended') NOT NULL DEFAULT 'active',
    war_score_att INT NOT NULL DEFAULT 0,
    war_score_def INT NOT NULL DEFAULT 0,
    exhaustion_att DECIMAL(7,2) NOT NULL DEFAULT 0,
    exhaustion_def DECIMAL(7,2) NOT NULL DEFAULT 0,
    casus_belli VARCHAR(120) DEFAULT NULL,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME DEFAULT NULL,
    ended_reason VARCHAR(64) DEFAULT NULL,
    CONSTRAINT fk_wars_attacker FOREIGN KEY (attacker_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_wars_defender FOREIGN KEY (defender_user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_wars_status (status),
    INDEX idx_wars_attacker_status (attacker_user_id, status),
    INDEX idx_wars_defender_status (defender_user_id, status),
    INDEX idx_wars_started_at (started_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS war_goals (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    war_id BIGINT NOT NULL,
    side ENUM('attacker', 'defender') NOT NULL,
    goal_type VARCHAR(40) NOT NULL,
    target_id BIGINT DEFAULT NULL,
    target_value VARCHAR(120) DEFAULT NULL,
    score_value INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_war_goals_war FOREIGN KEY (war_id) REFERENCES wars(id) ON DELETE CASCADE,
    INDEX idx_war_goals_war_side (war_id, side),
    INDEX idx_war_goals_type (goal_type)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS peace_offers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    war_id BIGINT NOT NULL,
    from_user_id INT NOT NULL,
    terms_json JSON NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    status ENUM('pending', 'accepted', 'rejected', 'expired') NOT NULL DEFAULT 'pending',
    responded_at DATETIME DEFAULT NULL,
    CONSTRAINT fk_peace_offers_war FOREIGN KEY (war_id) REFERENCES wars(id) ON DELETE CASCADE,
    CONSTRAINT fk_peace_offers_from_user FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_peace_offers_war (war_id),
    INDEX idx_peace_offers_status_expiry (status, expires_at),
    INDEX idx_peace_offers_from_user (from_user_id)
) ENGINE=InnoDB;
