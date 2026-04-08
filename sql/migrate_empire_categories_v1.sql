-- migrate_empire_categories_v1.sql
-- Empire Categories & Espionage System
-- Ref: docs/gamedesign/EMPIRE_CATEGORIES.md, docs/github-issues/06
--
-- Tables:
--   empire_category_scores  — persistent 7-score snapshots per user
--   espionage_agents        — agents available for hire and assignment
--   espionage_missions      — active / completed espionage missions

-- ─── Empire Category Scores ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS empire_category_scores (
    id              BIGINT      NOT NULL AUTO_INCREMENT,
    user_id         INT         NOT NULL,
    score_economy   TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0–100',
    score_military  TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0–100',
    score_research  TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0–100',
    score_growth    TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0–100',
    score_stability TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0–100',
    score_diplomacy TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0–100',
    score_espionage TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0–100',
    total_score     SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'weighted sum',
    calculated_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    tick_ref        BIGINT      NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_ecs_user (user_id),
    INDEX idx_ecs_total (total_score DESC),
    INDEX idx_ecs_calc  (calculated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Espionage Agents ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS espionage_agents (
    id              INT         NOT NULL AUTO_INCREMENT,
    user_id         INT         NOT NULL,
    name            VARCHAR(80) NOT NULL,
    skill_level     TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1–10',
    specialization  ENUM(
        'sabotage','intel','counter_intel','economic','diplomatic','military'
    ) NOT NULL DEFAULT 'intel',
    status          ENUM(
        'available','on_mission','captured','retired'
    ) NOT NULL DEFAULT 'available',
    hire_cost       INT UNSIGNED NOT NULL DEFAULT 0,
    mission_id      INT         DEFAULT NULL,
    hired_at        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_ea_user   (user_id),
    INDEX idx_ea_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Espionage Missions ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS espionage_missions (
    id              INT         NOT NULL AUTO_INCREMENT,
    agent_id        INT         NOT NULL,
    owner_user_id   INT         NOT NULL,
    target_user_id  INT         DEFAULT NULL COMMENT 'NULL = neutral target',
    mission_type    ENUM(
        'gather_intel','sabotage_production','steal_research',
        'steal_credits','counter_intel','diplomatic_incident',
        'plant_agent','assassinate_leader'
    ) NOT NULL,
    target_colony_id INT        DEFAULT NULL,
    status          ENUM('active','success','failure','captured') NOT NULL DEFAULT 'active',
    success_chance  TINYINT UNSIGNED NOT NULL DEFAULT 50 COMMENT '0–100',
    reward_desc     VARCHAR(200) DEFAULT NULL,
    penalty_desc    VARCHAR(200) DEFAULT NULL,
    result_payload  JSON        DEFAULT NULL,
    started_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    duration_hours  SMALLINT UNSIGNED NOT NULL DEFAULT 4,
    resolves_at     DATETIME    NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL 4 HOUR),
    resolved_at     DATETIME    DEFAULT NULL,
    PRIMARY KEY (id),
    INDEX idx_em_agent    (agent_id),
    INDEX idx_em_owner    (owner_user_id),
    INDEX idx_em_target   (target_user_id),
    INDEX idx_em_status   (status),
    INDEX idx_em_resolves (resolves_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
