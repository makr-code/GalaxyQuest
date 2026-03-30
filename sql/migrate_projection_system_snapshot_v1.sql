-- GalaxyQuest migration: Hybrid Read-Model Phase 2
-- Introduces projection_system_snapshot (per-system read-model).
-- Reuses the existing projection_dirty_queue with entity_type='system'.
--
-- entity_id encoding for system entries:
--   entity_id = galaxy_index * 100000 + system_index
--   (safe for GALAXY_MAX=9, SYSTEM_MAX=25000)

USE galaxyquest;

-- ── System-Snapshot read-model table ─────────────────────────────────────────
-- Stores a pre-computed JSON payload for each (galaxy, system_index) pair.
-- The projector worker fills/updates this table; the API reads from it.
CREATE TABLE IF NOT EXISTS projection_system_snapshot (
    galaxy            INT          NOT NULL
                      COMMENT 'Galaxy index (1-based)',
    system_index      INT          NOT NULL
                      COMMENT 'System index within the galaxy (1-based)',
    payload_json      LONGTEXT     NOT NULL
                      COMMENT 'Pre-computed system descriptor JSON (star + colony aggregate)',
    owner_user_id     INT          NOT NULL DEFAULT 0
                      COMMENT 'Primary owner user_id (0 = unowned); used for fast filter',
    colony_count      INT          NOT NULL DEFAULT 0
                      COMMENT 'Denormalised count of colonies in this system',
    colony_population BIGINT       NOT NULL DEFAULT 0
                      COMMENT 'Denormalised sum of colony population in this system',
    version           BIGINT       NOT NULL DEFAULT 0
                      COMMENT 'Monotonically increasing version counter, incremented on each write',
    updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                      ON UPDATE CURRENT_TIMESTAMP,
    source_tick       BIGINT       NOT NULL DEFAULT 0
                      COMMENT 'Unix timestamp at which the snapshot was built',
    stale_flag        TINYINT(1)   NOT NULL DEFAULT 0
                      COMMENT '1 = snapshot exists but awaits re-projection',
    PRIMARY KEY (galaxy, system_index),
    INDEX idx_pss_owner   (galaxy, owner_user_id),
    INDEX idx_pss_stale   (stale_flag),
    INDEX idx_pss_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Ensure projection_dirty_queue exists (idempotent) ────────────────────────
-- The dirty queue was created in Phase 1.  This statement is a no-op if it
-- already exists; it makes Phase 2 deployable standalone when Phase 1 has
-- already been applied.
CREATE TABLE IF NOT EXISTS projection_dirty_queue (
    id              BIGINT        NOT NULL AUTO_INCREMENT,
    entity_type     VARCHAR(40)   NOT NULL DEFAULT 'user'
                    COMMENT 'Namespace for the entity, e.g. "user" or "system"',
    entity_id       INT           NOT NULL
                    COMMENT 'Encoded PK: for system entries = galaxy*100000 + system_index',
    reason          VARCHAR(120)  NOT NULL DEFAULT ''
                    COMMENT 'Short label describing why the entry was enqueued',
    enqueued_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    attempts        SMALLINT      NOT NULL DEFAULT 0,
    last_error      TEXT          DEFAULT NULL,
    next_attempt_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_dirty_entity   (entity_type, entity_id),
    INDEX idx_dirty_next_attempt   (next_attempt_at),
    INDEX idx_dirty_entity_id      (entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
