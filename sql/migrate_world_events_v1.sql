-- Hourly world tick: time-bounded economic world events, mail outbox and
-- per-user e-mail notification opt-out. good_key '' means "all goods"; it is
-- NOT NULL so the window idempotency key stays unique in MySQL.
CREATE TABLE IF NOT EXISTS world_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    window_id INT UNSIGNED NOT NULL,
    event_type VARCHAR(48) NOT NULL,
    scope_type ENUM('galaxy','system') NOT NULL,
    scope_id INT UNSIGNED NOT NULL,
    galaxy_index INT UNSIGNED NOT NULL,
    system_index INT UNSIGNED NOT NULL DEFAULT 0,
    good_key VARCHAR(64) NOT NULL DEFAULT '',
    modifier_json JSON NOT NULL,
    starts_at BIGINT NOT NULL,
    ends_at BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_world_events_window (window_id, event_type, scope_type, scope_id, good_key),
    KEY idx_world_events_scope (galaxy_index, system_index, ends_at),
    KEY idx_world_events_ends (ends_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS mail_outbox (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    kind VARCHAR(32) NOT NULL,
    dedupe_key VARCHAR(128) NOT NULL,
    subject VARCHAR(200) NOT NULL,
    body_text TEXT NOT NULL,
    status ENUM('pending','sent','failed','skipped') NOT NULL DEFAULT 'pending',
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    next_attempt_at BIGINT NOT NULL DEFAULT 0,
    last_error VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP NULL DEFAULT NULL,
    UNIQUE KEY uq_mail_outbox_dedupe (dedupe_key),
    KEY idx_mail_outbox_due (status, next_attempt_at),
    CONSTRAINT fk_mail_outbox_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

SET @world_events_has_mail_opt = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'email_notifications'
);
SET @world_events_mail_opt_sql = IF(
    @world_events_has_mail_opt = 0,
    'ALTER TABLE users ADD COLUMN email_notifications TINYINT(1) NOT NULL DEFAULT 1',
    'SELECT 1'
);
PREPARE world_events_mail_opt_stmt FROM @world_events_mail_opt_sql;
EXECUTE world_events_mail_opt_stmt;
DEALLOCATE PREPARE world_events_mail_opt_stmt;
