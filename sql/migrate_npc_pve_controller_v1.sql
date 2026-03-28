-- GalaxyQuest - NPC/PvE LLM controller migration v1
-- Optional diagnostics table for LLM-driven faction decisions.

USE galaxyquest;

CREATE TABLE IF NOT EXISTS npc_llm_decision_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    faction_id INT NOT NULL,
    faction_code VARCHAR(32) NOT NULL,
    action_key VARCHAR(32) NOT NULL DEFAULT 'none',
    confidence DECIMAL(4,3) NOT NULL DEFAULT 0.000,
    standing_before SMALLINT NOT NULL DEFAULT 0,
    standing_after SMALLINT NOT NULL DEFAULT 0,
    status ENUM('ok','error') NOT NULL DEFAULT 'ok',
    reasoning TEXT NOT NULL,
    raw_output MEDIUMTEXT NOT NULL,
    executed TINYINT(1) NOT NULL DEFAULT 0,
    error_message VARCHAR(255) NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE,
    INDEX idx_npc_llm_user_time (user_id, created_at),
    INDEX idx_npc_llm_faction_time (faction_id, created_at),
    INDEX idx_npc_llm_status_time (status, created_at)
) ENGINE=InnoDB;
