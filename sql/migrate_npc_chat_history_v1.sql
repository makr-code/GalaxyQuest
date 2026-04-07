-- GalaxyQuest - NPC chat history migration v1
-- Persists per-user NPC conversation turns for context-aware multi-turn chat.

USE galaxyquest;

CREATE TABLE IF NOT EXISTS npc_chat_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    faction_code VARCHAR(32) NOT NULL,
    npc_name VARCHAR(100) NOT NULL,
    role ENUM('user', 'assistant') NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_npc_chat_lookup (user_id, faction_code, npc_name, created_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
