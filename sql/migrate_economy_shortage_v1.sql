-- ── Economy Shortage Events v1 ────────────────────────────────────────────────
-- Persistent shortage / starvation event log for the economy flush system.
-- Previously created inline via CREATE TABLE IF NOT EXISTS inside
-- economy_flush.php::log_shortage_event(). Moving it here avoids the DDL
-- overhead on every flush call.

CREATE TABLE IF NOT EXISTS economy_shortage_events (
    id               BIGINT       NOT NULL AUTO_INCREMENT,
    colony_id        INT          NOT NULL,
    good_type        VARCHAR(60)  NOT NULL,
    deficit_per_hour FLOAT        NOT NULL DEFAULT 0,
    severity         ENUM('shortage','starvation') NOT NULL DEFAULT 'shortage',
    started_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at      DATETIME     DEFAULT NULL,
    PRIMARY KEY (id),
    INDEX idx_se_colony  (colony_id, good_type),
    INDEX idx_se_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
