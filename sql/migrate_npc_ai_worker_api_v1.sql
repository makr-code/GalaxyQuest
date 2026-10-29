-- GalaxyQuest - NPC AI worker signed API migration v1
-- Adds worker claim ownership fields and nonce replay protection table.

USE galaxyquest;

SET @has_claimed_by_worker_id := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'npc_ai_decision_queue'
    AND COLUMN_NAME = 'claimed_by_worker_id'
);
SET @add_claimed_by_worker_id := IF(
  @has_claimed_by_worker_id = 0,
  'ALTER TABLE npc_ai_decision_queue ADD COLUMN claimed_by_worker_id VARCHAR(64) NULL AFTER locked_at',
  'SELECT 1'
);
PREPARE stmt_claimed_by_worker_id FROM @add_claimed_by_worker_id;
EXECUTE stmt_claimed_by_worker_id;
DEALLOCATE PREPARE stmt_claimed_by_worker_id;

SET @has_claim_token := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'npc_ai_decision_queue'
    AND COLUMN_NAME = 'claim_token'
);
SET @add_claim_token := IF(
  @has_claim_token = 0,
  'ALTER TABLE npc_ai_decision_queue ADD COLUMN claim_token CHAR(64) NULL AFTER claimed_by_worker_id',
  'SELECT 1'
);
PREPARE stmt_claim_token FROM @add_claim_token;
EXECUTE stmt_claim_token;
DEALLOCATE PREPARE stmt_claim_token;

SET @has_claim_expires_at := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'npc_ai_decision_queue'
    AND COLUMN_NAME = 'claim_expires_at'
);
SET @add_claim_expires_at := IF(
  @has_claim_expires_at = 0,
  'ALTER TABLE npc_ai_decision_queue ADD COLUMN claim_expires_at DATETIME NULL AFTER claim_token',
  'SELECT 1'
);
PREPARE stmt_claim_expires_at FROM @add_claim_expires_at;
EXECUTE stmt_claim_expires_at;
DEALLOCATE PREPARE stmt_claim_expires_at;

SET @has_idx_worker_claim := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'npc_ai_decision_queue'
    AND INDEX_NAME = 'idx_npc_ai_queue_worker_claim'
);
SET @add_idx_worker_claim := IF(
  @has_idx_worker_claim = 0,
  'ALTER TABLE npc_ai_decision_queue ADD INDEX idx_npc_ai_queue_worker_claim (claimed_by_worker_id, status)',
  'SELECT 1'
);
PREPARE stmt_idx_worker_claim FROM @add_idx_worker_claim;
EXECUTE stmt_idx_worker_claim;
DEALLOCATE PREPARE stmt_idx_worker_claim;

SET @has_idx_claim_token := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'npc_ai_decision_queue'
    AND INDEX_NAME = 'idx_npc_ai_queue_claim_token'
);
SET @add_idx_claim_token := IF(
  @has_idx_claim_token = 0,
  'ALTER TABLE npc_ai_decision_queue ADD INDEX idx_npc_ai_queue_claim_token (claim_token)',
  'SELECT 1'
);
PREPARE stmt_idx_claim_token FROM @add_idx_claim_token;
EXECUTE stmt_idx_claim_token;
DEALLOCATE PREPARE stmt_idx_claim_token;

CREATE TABLE IF NOT EXISTS npc_ai_worker_nonce (
    nonce_hash CHAR(64) PRIMARY KEY,
    worker_id VARCHAR(64) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_npc_ai_worker_nonce_created (created_at)
) ENGINE=InnoDB;
