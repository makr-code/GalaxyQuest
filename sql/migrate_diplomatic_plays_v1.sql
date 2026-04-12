-- migrate_diplomatic_plays_v1.sql
-- Sprint 3.2: Diplomatic Plays 4-Phase Escalation System
--
-- Adds Trust/Threat axes to the diplomacy table and creates the
-- diplomatic_plays table (Cooperation → Threat → Ultimatum → War).
--
-- Safe to run multiple times (IF NOT EXISTS / IF EXISTS guards throughout).

-- ── 1. Extend diplomacy table with Trust/Threat axes ─────────────────────────

ALTER TABLE diplomacy
  ADD COLUMN IF NOT EXISTS trust_level       DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS threat_level      DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS trust_decay_rate  DECIMAL(4,3) NOT NULL DEFAULT 0.500;

-- ── 2. Diplomatic Plays (4-phase escalation) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS diplomatic_plays (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    initiator_uid  INT NOT NULL,
    faction_id     INT NOT NULL,

    -- Current escalation phase
    phase          ENUM('cooperation','threat','ultimatum','war') NOT NULL DEFAULT 'cooperation',

    -- Lifecycle
    status         ENUM('active','resolved','cancelled','expired') NOT NULL DEFAULT 'active',

    -- What each side wants out of this play
    goal_type      VARCHAR(64)  NOT NULL DEFAULT 'diplomatic',
    player_demands JSON         NOT NULL,
    faction_demands JSON        NOT NULL,

    -- Phase timestamps
    cooperation_at  DATETIME DEFAULT NULL,
    threat_at       DATETIME DEFAULT NULL,
    ultimatum_at    DATETIME DEFAULT NULL,
    resolved_at     DATETIME DEFAULT NULL,

    -- Final outcome when status = 'resolved'
    outcome        ENUM('deal','war','capitulation','withdrawal') DEFAULT NULL,

    -- Trust/Threat snapshot at the time the play was opened
    trust_snapshot   DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    threat_snapshot  DECIMAL(5,2) NOT NULL DEFAULT 0.00,

    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (initiator_uid) REFERENCES users(id)       ON DELETE CASCADE,
    FOREIGN KEY (faction_id)    REFERENCES npc_factions(id) ON DELETE CASCADE,
    INDEX idx_dp_user    (initiator_uid),
    INDEX idx_dp_faction (faction_id),
    INDEX idx_dp_status  (status),
    INDEX idx_dp_phase   (phase)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
