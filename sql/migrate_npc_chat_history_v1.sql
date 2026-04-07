-- GalaxyQuest - NPC chat sessions migration v1
-- Each individual NPC conversation is stored as one session row.
-- The DB holds only metadata + a file path; messages live in JSON files on disk.
-- An LLM-generated summary is written to the row when the session is closed,
-- so future sessions can inject past-conversation context without re-reading files.

USE galaxyquest;

CREATE TABLE IF NOT EXISTS npc_chat_sessions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    faction_code VARCHAR(32) NOT NULL,
    npc_name VARCHAR(100) NOT NULL,
    chat_file VARCHAR(500) NOT NULL DEFAULT ''
        COMMENT 'Relative path to the JSON message log for this session, e.g. generated/npc_chats/u_7/vor_tak/general_drak_mol/session_1.json',
    summary TEXT DEFAULT NULL
        COMMENT 'LLM-generated summary of this session; NULL until close_npc_session is called',
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_npc_sessions_lookup (user_id, faction_code, npc_name, started_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
