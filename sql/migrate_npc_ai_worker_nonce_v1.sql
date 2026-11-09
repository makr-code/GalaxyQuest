CREATE TABLE IF NOT EXISTS npc_ai_worker_nonce (
    nonce_hash CHAR(64) PRIMARY KEY,
    worker_id VARCHAR(64) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_npc_ai_worker_nonce_created (created_at)
) ENGINE=InnoDB;
