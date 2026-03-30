-- GalaxyQuest migration: Hybrid Read-Model Phase 3 – Outbox-Standardisierung
--
-- Standardises the projection_dirty_queue schema to support the shared
-- Projector Runtime introduced in lib/projection_runtime.php.
--
-- New fields:
--   event_type    – classifier for the trigger event (e.g. 'colony_updated')
--   payload_json  – optional supplementary data for the projection worker
--   status        – lifecycle state: queued | processing | done | failed
--   created_at    – when the row was first inserted (mirrors enqueued_at)
--   updated_at    – automatically updated on every row change
--   processed_at  – set when the entry is successfully projected
--
-- New indices:
--   idx_dirty_status_next    (status, next_attempt_at)  – primary worker scan
--   idx_dirty_event_created  (event_type, created_at)   – analytics / monitoring
--
-- The existing unique key on (entity_type, entity_id) is preserved to keep
-- the idempotent / coalescing behaviour of enqueue_projection_dirty().
--
-- Safe to run multiple times on MySQL 8.0+ (uses IF NOT EXISTS / IF EXISTS).

USE galaxyquest;

-- ── Add new columns to projection_dirty_queue ─────────────────────────────────

ALTER TABLE projection_dirty_queue
    ADD COLUMN IF NOT EXISTS event_type   VARCHAR(60)  NOT NULL DEFAULT ''
        COMMENT 'Event/trigger type that caused the enqueue (e.g. fleet_sent)'
        AFTER entity_id,
    ADD COLUMN IF NOT EXISTS payload_json TEXT         DEFAULT NULL
        COMMENT 'Optional supplementary JSON payload for the projection worker'
        AFTER event_type,
    ADD COLUMN IF NOT EXISTS status       ENUM('queued','processing','done','failed')
                                          NOT NULL DEFAULT 'queued'
        COMMENT 'Current lifecycle state of the queue entry'
        AFTER payload_json,
    ADD COLUMN IF NOT EXISTS created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
        COMMENT 'When this row was first created (mirrors enqueued_at)'
        AFTER next_attempt_at,
    ADD COLUMN IF NOT EXISTS updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                          ON UPDATE CURRENT_TIMESTAMP
        COMMENT 'Timestamp of the last status change'
        AFTER created_at,
    ADD COLUMN IF NOT EXISTS processed_at DATETIME     DEFAULT NULL
        COMMENT 'Set when the entry was successfully projected'
        AFTER updated_at;

-- ── Add new indices ───────────────────────────────────────────────────────────

ALTER TABLE projection_dirty_queue
    ADD INDEX IF NOT EXISTS idx_dirty_status_next   (status, next_attempt_at),
    ADD INDEX IF NOT EXISTS idx_dirty_event_created (event_type, created_at);

-- ── Back-fill created_at from enqueued_at for existing rows ──────────────────

UPDATE projection_dirty_queue
   SET created_at = enqueued_at
 WHERE created_at = '0000-00-00 00:00:00'
    OR created_at IS NULL;

-- ── Create system-snapshot read-model table (Phase 2) ────────────────────────
-- Stores a pre-computed JSON snapshot for each star system.
-- Populated by scripts/project_system_snapshots.php.

CREATE TABLE IF NOT EXISTS projection_system_snapshot (
    system_id    INT          NOT NULL,
    payload_json LONGTEXT     NOT NULL
        COMMENT 'Pre-computed JSON snapshot of the star-system read model',
    version      BIGINT       NOT NULL DEFAULT 0
        COMMENT 'Monotonically increasing version counter',
    updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                 ON UPDATE CURRENT_TIMESTAMP,
    source_tick  BIGINT       NOT NULL DEFAULT 0
        COMMENT 'Unix timestamp at which the snapshot was built',
    stale_flag   TINYINT(1)   NOT NULL DEFAULT 0
        COMMENT '1 = snapshot exists but is invalidated and awaits re-projection',
    PRIMARY KEY (system_id),
    INDEX idx_proj_system_stale   (stale_flag),
    INDEX idx_proj_system_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
