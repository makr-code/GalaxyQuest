-- Security v2: TOTP-based Two-Factor Authentication
-- Compatible with Microsoft Authenticator, Google Authenticator, Authy, etc.
-- Safe to run multiple times (IF NOT EXISTS / info_schema guards).

-- ── Add TOTP columns to users ────────────────────────────────────────────────

SET @dbname = DATABASE();

-- totp_enabled flag
SET @col_check = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND COLUMN_NAME = 'totp_enabled'
);
SET @sql = IF(@col_check = 0,
    'ALTER TABLE users ADD COLUMN totp_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER ftl_cooldown_until',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Active TOTP shared secret (Base32, 32 chars = 20 bytes = 160-bit key)
SET @col_check = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND COLUMN_NAME = 'totp_secret'
);
SET @sql = IF(@col_check = 0,
    'ALTER TABLE users ADD COLUMN totp_secret VARCHAR(64) NULL DEFAULT NULL AFTER totp_enabled',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Pending secret during setup (cleared once 2FA is confirmed or cancelled)
SET @col_check = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND COLUMN_NAME = 'totp_pending_secret'
);
SET @sql = IF(@col_check = 0,
    'ALTER TABLE users ADD COLUMN totp_pending_secret VARCHAR(64) NULL DEFAULT NULL AFTER totp_secret',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── Half-authenticated login sessions (password OK, awaiting TOTP) ───────────

CREATE TABLE IF NOT EXISTS totp_pending_sessions (
    token      VARCHAR(64)  NOT NULL PRIMARY KEY
                            COMMENT 'Cryptographically random hex token',
    user_id    INT          NOT NULL,
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME     NOT NULL,
    attempts   TINYINT      NOT NULL DEFAULT 0
                            COMMENT 'Tracks brute-force attempts (max 5)',
    INDEX idx_totp_user  (user_id),
    INDEX idx_totp_exp   (expires_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Temporary sessions awaiting TOTP challenge completion';

-- remember_me preference stored in the pending session so the server can
-- honour it after TOTP confirmation without trusting the client a second time.
SET @col_check = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'totp_pending_sessions' AND COLUMN_NAME = 'remember_me'
);
SET @sql = IF(@col_check = 0,
    'ALTER TABLE totp_pending_sessions ADD COLUMN remember_me TINYINT(1) NOT NULL DEFAULT 0 AFTER attempts',
    'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
