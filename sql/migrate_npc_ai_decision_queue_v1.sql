-- GalaxyQuest - NPC strategic AI decision queue migration v1
-- Non-blocking queue for asynchronous macro-AI decisions (MySQL-first).

USE galaxyquest;

CREATE TABLE IF NOT EXISTS npc_ai_decision_queue (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    faction_id INT NOT NULL,
    source_scope ENUM('simulation_user_tick','manual','event') NOT NULL DEFAULT 'simulation_user_tick',
    status ENUM('queued','processing','done','failed','dead') NOT NULL DEFAULT 'queued',
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    max_attempts TINYINT UNSIGNED NOT NULL DEFAULT 3,
    available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_at DATETIME NULL DEFAULT NULL,
    completed_at DATETIME NULL DEFAULT NULL,
    dedupe_key VARCHAR(128) NOT NULL,
    payload_json JSON DEFAULT NULL,
    result_json JSON DEFAULT NULL,
    error_message VARCHAR(255) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE,
    INDEX idx_npc_ai_queue_status_available (status, available_at, id),
    INDEX idx_npc_ai_queue_user_faction_time (user_id, faction_id, created_at),
    INDEX idx_npc_ai_queue_dedupe_status (dedupe_key, status)
) ENGINE=InnoDB;
