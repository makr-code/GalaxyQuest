-- Security hardening v1: login attempt rate-limiting / account lockout
-- Applied automatically as Docker initdb script 014-security-v1.sql
-- Safe to run multiple times (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS login_attempts (
    ip_hash          VARCHAR(64)   NOT NULL PRIMARY KEY COMMENT 'SHA-256 of client IP',
    attempt_count    INT UNSIGNED  NOT NULL DEFAULT 0,
    first_attempt_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_until     DATETIME      NULL     DEFAULT NULL,
    INDEX idx_locked_until (locked_until)
) ENGINE=InnoDB COMMENT='Tracks consecutive failed login attempts per IP for rate-limiting';
