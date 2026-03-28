-- GalaxyQuest - Gameplay model migration v1
-- Adds persistence for situations and internal faction approval history.
-- Safe to run multiple times.

USE galaxyquest;

-- ---------------------------------------------------------------------------
-- Situations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS situation_states (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    colony_id INT DEFAULT NULL,
    target_type ENUM('empire','colony','system') NOT NULL DEFAULT 'empire',
    target_id INT DEFAULT NULL,
    situation_type VARCHAR(64) NOT NULL,
    status ENUM('active','resolved','failed','cancelled') NOT NULL DEFAULT 'active',
    progress DECIMAL(6,2) NOT NULL DEFAULT 0,
    stage TINYINT UNSIGNED NOT NULL DEFAULT 1,
    approach_key VARCHAR(64) NOT NULL DEFAULT 'maintain',
    approach_locked TINYINT(1) NOT NULL DEFAULT 0,
    payload_json JSON DEFAULT NULL,
    monthly_deltas_json JSON DEFAULT NULL,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_tick_at DATETIME DEFAULT NULL,
    ended_at DATETIME DEFAULT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE SET NULL,
    INDEX idx_situation_user_status (user_id, status),
    INDEX idx_situation_target (target_type, target_id),
    INDEX idx_situation_type (situation_type),
    INDEX idx_situation_tick (status, last_tick_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS situation_stage_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    situation_id BIGINT NOT NULL,
    user_id INT NOT NULL,
    old_stage TINYINT UNSIGNED NOT NULL,
    new_stage TINYINT UNSIGNED NOT NULL,
    reason VARCHAR(128) NOT NULL DEFAULT 'progress_update',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (situation_id) REFERENCES situation_states(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_stage_log_situation (situation_id, created_at),
    INDEX idx_stage_log_user (user_id, created_at)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Internal politics / faction approval
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_faction_state (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    faction_key VARCHAR(64) NOT NULL,
    approval DECIMAL(5,2) NOT NULL DEFAULT 50.00,
    support DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    issues_json JSON DEFAULT NULL,
    last_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_user_faction (user_id, faction_key),
    INDEX idx_user_faction_approval (user_id, approval)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS faction_approval_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    faction_key VARCHAR(64) NOT NULL,
    approval_before DECIMAL(5,2) NOT NULL,
    approval_after DECIMAL(5,2) NOT NULL,
    support_before DECIMAL(5,2) DEFAULT NULL,
    support_after DECIMAL(5,2) DEFAULT NULL,
    delta_reason VARCHAR(128) NOT NULL DEFAULT 'system_update',
    source_type ENUM('situation','policy','event','manual','tick') NOT NULL DEFAULT 'tick',
    source_id BIGINT DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_faction_hist_user_time (user_id, created_at),
    INDEX idx_faction_hist_faction (faction_key, created_at),
    INDEX idx_faction_hist_source (source_type, source_id)
) ENGINE=InnoDB;

-- Optional baseline factions used by the first implementation pass.
INSERT IGNORE INTO user_faction_state (user_id, faction_key, approval, support, issues_json)
SELECT u.id, 'industrialists', 50.00, 0.00, JSON_ARRAY()
FROM users u;

INSERT IGNORE INTO user_faction_state (user_id, faction_key, approval, support, issues_json)
SELECT u.id, 'scientists', 50.00, 0.00, JSON_ARRAY()
FROM users u;

INSERT IGNORE INTO user_faction_state (user_id, faction_key, approval, support, issues_json)
SELECT u.id, 'security_bloc', 50.00, 0.00, JSON_ARRAY()
FROM users u;

INSERT IGNORE INTO user_faction_state (user_id, faction_key, approval, support, issues_json)
SELECT u.id, 'civic_union', 50.00, 0.00, JSON_ARRAY()
FROM users u;
