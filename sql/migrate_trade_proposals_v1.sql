-- ── trade_proposals v1 ────────────────────────────────────────────────────────
-- Player-to-player trade proposal system.
-- Safe to apply to an existing DB (IF NOT EXISTS).
-- This migration only creates the table; schema.sql already covers all other
-- tables from the legacy migrate_v2.sql file.

CREATE TABLE IF NOT EXISTS trade_proposals (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    initiator_id     INT NOT NULL,
    target_id        INT NOT NULL,
    offer_metal      DECIMAL(20,4) NOT NULL DEFAULT 0,
    offer_crystal    DECIMAL(20,4) NOT NULL DEFAULT 0,
    offer_deuterium  DECIMAL(20,4) NOT NULL DEFAULT 0,
    request_metal    DECIMAL(20,4) NOT NULL DEFAULT 0,
    request_crystal  DECIMAL(20,4) NOT NULL DEFAULT 0,
    request_deuterium DECIMAL(20,4) NOT NULL DEFAULT 0,
    message          VARCHAR(500) NOT NULL DEFAULT '',
    status           ENUM('pending','accepted','rejected','cancelled','expired') NOT NULL DEFAULT 'pending',
    expires_at       DATETIME NOT NULL,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (initiator_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id)    REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_target_status    (target_id,    status),
    INDEX idx_initiator_status (initiator_id, status)
) ENGINE=InnoDB;
