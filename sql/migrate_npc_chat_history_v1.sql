-- GalaxyQuest - NPC chat history migration v1
-- One row per conversation (user + faction + npc).
-- The actual messages are stored in a JSON file on disk; the DB only holds the path.

USE galaxyquest;

CREATE TABLE IF NOT EXISTS npc_chat_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    faction_code VARCHAR(32) NOT NULL,
    npc_name VARCHAR(100) NOT NULL,
    chat_file VARCHAR(500) NOT NULL
        COMMENT 'Relative path to the JSON message log, e.g. generated/npc_chats/u_7/vor_tak/general_drak_mol.json',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_npc_chat (user_id, faction_code, npc_name),
    INDEX idx_npc_chat_user (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
