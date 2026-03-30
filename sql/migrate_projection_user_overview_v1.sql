-- GalaxyQuest migration: Hybrid Read-Model Phase 1
-- Introduces projection_user_overview (read-model) and projection_dirty_queue (outbox/dirty-tracker).

USE galaxyquest;

-- ── Read-model snapshot table ─────────────────────────────────────────────────
-- Stores a pre-computed JSON payload for each user's overview response.
-- The projector worker fills/updates this table; the API reads from it.
CREATE TABLE IF NOT EXISTS projection_user_overview (
    user_id      INT          NOT NULL,
    payload_json LONGTEXT     NOT NULL,
    version      BIGINT       NOT NULL DEFAULT 0
                 COMMENT 'Monotonically increasing version counter, incremented on each projection write',
    updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                 ON UPDATE CURRENT_TIMESTAMP,
    source_tick  BIGINT       NOT NULL DEFAULT 0
                 COMMENT 'Game tick (unix timestamp) at which the projection was built',
    stale_flag   TINYINT(1)   NOT NULL DEFAULT 0
                 COMMENT '1 = entry exists but has been invalidated and awaits re-projection',
    PRIMARY KEY (user_id),
    INDEX idx_proj_overview_stale      (stale_flag),
    INDEX idx_proj_overview_updated    (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Outbox / Dirty-Queue ──────────────────────────────────────────────────────
-- Tracks users whose projection is out of date and must be re-computed.
-- Idempotent: duplicate (entity_type, entity_id) rows are coalesced via ON DUPLICATE KEY.
CREATE TABLE IF NOT EXISTS projection_dirty_queue (
    id              BIGINT        NOT NULL AUTO_INCREMENT,
    entity_type     VARCHAR(40)   NOT NULL DEFAULT 'user'
                    COMMENT 'Namespace for the entity, e.g. "user"',
    entity_id       INT           NOT NULL
                    COMMENT 'User ID (or other entity PK)',
    reason          VARCHAR(120)  NOT NULL DEFAULT ''
                    COMMENT 'Short label describing why the entry was enqueued (e.g. "fleet_sent")',
    enqueued_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    attempts        SMALLINT      NOT NULL DEFAULT 0,
    last_error      TEXT          DEFAULT NULL,
    next_attempt_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_dirty_entity   (entity_type, entity_id),
    INDEX idx_dirty_next_attempt   (next_attempt_at),
    INDEX idx_dirty_entity_id      (entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
