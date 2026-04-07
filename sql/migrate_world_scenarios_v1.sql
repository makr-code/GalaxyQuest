-- ─────────────────────────────────────────────────────────────────────────────
-- REDCS: Random-Event-Driven-Conclusion System  –  Schema Migration v1
-- ─────────────────────────────────────────────────────────────────────────────

-- galactic_events: Multiplayer-ripple log (referenced in FACTION_INTRODUCTION §12.7)
CREATE TABLE IF NOT EXISTS galactic_events (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    event_type      VARCHAR(64) NOT NULL
        COMMENT 'e.g. faction_unchecked_action, scenario_conclusion, faction_advisor_success',
    faction_id      INT DEFAULT NULL
        COMMENT 'Initiating faction (NULL for neutral/global events)',
    source_user_id  INT DEFAULT NULL
        COMMENT 'Advisor/player who triggered this (NULL = NPC/engine)',
    description     TEXT,
    modifier_key    VARCHAR(64),
    modifier_value  DECIMAL(9,4),
    affected_scope  ENUM('cluster','sector','galaxy') NOT NULL DEFAULT 'cluster',
    starts_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ends_at         DATETIME NOT NULL,
    is_visible      TINYINT(1) NOT NULL DEFAULT 1,
    INDEX idx_ge_faction    (faction_id),
    INDEX idx_ge_scope_time (affected_scope, ends_at),
    FOREIGN KEY (faction_id)     REFERENCES npc_factions(id) ON DELETE SET NULL,
    FOREIGN KEY (source_user_id) REFERENCES users(id)        ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='Multiplayer-ripple events spawned by the scenario engine';

-- world_scenarios: YAML-seeded scenario definitions
CREATE TABLE IF NOT EXISTS world_scenarios (
    id                    INT AUTO_INCREMENT PRIMARY KEY,
    code                  VARCHAR(64) NOT NULL UNIQUE
        COMMENT 'Unique scenario key, e.g. iron_fleet_global_council',
    faction_id            INT DEFAULT NULL
        COMMENT 'Associated NPC faction; NULL = global scenario',
    title_de              VARCHAR(128) NOT NULL,
    description_de        TEXT NOT NULL,
    duration_hours        SMALLINT UNSIGNED NOT NULL DEFAULT 24,
    trigger_chance        DECIMAL(5,4) NOT NULL DEFAULT 0.0500
        COMMENT 'Probability per tick (0.0000–1.0000)',
    trigger_cooldown_hours SMALLINT UNSIGNED NOT NULL DEFAULT 72
        COMMENT 'Minimum hours between two activations of this scenario',
    min_player_progress   TINYINT UNSIGNED NOT NULL DEFAULT 0
        COMMENT 'Minimum average colony level required galaxy-wide to allow trigger',
    phases_json           TEXT NOT NULL DEFAULT '[]'
        COMMENT 'JSON array of phase label strings',
    conclusions_json      TEXT NOT NULL DEFAULT '[]'
        COMMENT 'JSON array of {key, weight, condition_json, title_de, description_de}',
    effects_json          TEXT NOT NULL DEFAULT '{}'
        COMMENT 'JSON map of conclusion_key → effect array',
    llm_prompt_key        VARCHAR(64) DEFAULT NULL
        COMMENT 'Optional LLM profile key for flavor-text generation',
    active                TINYINT(1) NOT NULL DEFAULT 1,
    created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='Scenario definitions, seeded from YAML files';

-- active_world_events: running scenario instances (server-global, not per-user)
CREATE TABLE IF NOT EXISTS active_world_events (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    scenario_id      INT NOT NULL,
    phase            TINYINT UNSIGNED NOT NULL DEFAULT 0
        COMMENT 'Current phase index (0-based)',
    started_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ends_at          DATETIME NOT NULL,
    conclusion_key   VARCHAR(64) DEFAULT NULL
        COMMENT 'Set when event is resolved; NULL while still active',
    resolved_at      DATETIME DEFAULT NULL,
    effects_applied  TINYINT(1) NOT NULL DEFAULT 0
        COMMENT '1 once effects have been written to the DB',
    flavor_text      TEXT DEFAULT NULL
        COMMENT 'Optional LLM-generated narrative text',
    INDEX idx_awe_open      (conclusion_key, ends_at),
    INDEX idx_awe_scenario  (scenario_id),
    FOREIGN KEY (scenario_id) REFERENCES world_scenarios(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Active/resolved scenario instances';
