-- migrate_faction_agreements_v1.sql
-- Victoria 3-inspired faction agreement/treaty system.
-- Run once on top of the base schema.

CREATE TABLE IF NOT EXISTS faction_agreements (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    user_id          INT NOT NULL,
    faction_id       INT NOT NULL,
    agreement_type   ENUM('alliance','trade','research','non_aggression') NOT NULL,
    status           ENUM('proposed','active','rejected','cancelled','expired') NOT NULL DEFAULT 'proposed',

    -- JSON arrays of { resource, amount } or named terms like { term: 'transit_rights' }
    player_offer     JSON NOT NULL,
    faction_demand   JSON NOT NULL,

    -- Duration in game cycles (NULL = permanent until cancelled)
    duration_cycles  SMALLINT UNSIGNED DEFAULT NULL,

    -- Standing gate: player must have at least this standing to propose
    standing_requirement SMALLINT NOT NULL DEFAULT -50,

    -- Standing change applied when the agreement becomes active
    standing_reward  SMALLINT NOT NULL DEFAULT 0,

    -- Debt/leverage score at time of proposal (−100..+100)
    leverage_score   SMALLINT NOT NULL DEFAULT 0,

    -- AI-estimated acceptance probability 0–100
    ai_acceptance_pct TINYINT UNSIGNED NOT NULL DEFAULT 50,

    proposed_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    accepted_at  DATETIME DEFAULT NULL,
    expires_at   DATETIME DEFAULT NULL,

    FOREIGN KEY (user_id)    REFERENCES users(id)        ON DELETE CASCADE,
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE,
    INDEX idx_fa_user   (user_id),
    INDEX idx_fa_faction (faction_id),
    INDEX idx_fa_status  (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
