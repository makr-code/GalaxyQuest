/**
 * Migration: Update System v1
 * Description: Create tables for tracking updates, releases, and update history
 */

START TRANSACTION;

-- Table: update_releases
-- Stores information about available releases from GitHub
CREATE TABLE IF NOT EXISTS update_releases (
    id INT AUTO_INCREMENT PRIMARY KEY,
    version VARCHAR(50) NOT NULL UNIQUE,
    release_name VARCHAR(255),
    description LONGTEXT,
    release_url VARCHAR(500),
    download_url VARCHAR(500),
    checksum_sha256 VARCHAR(64),
    file_size BIGINT,
    is_prerelease BOOLEAN DEFAULT FALSE,
    released_at DATETIME,
    fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_version (version),
    INDEX idx_released_at (released_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: update_history
-- Tracks all update operations, installations, and rollbacks
CREATE TABLE IF NOT EXISTS update_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    operation_type ENUM('check', 'download', 'install', 'rollback', 'verify') NOT NULL,
    from_version VARCHAR(50),
    to_version VARCHAR(50),
    status ENUM('pending', 'in_progress', 'success', 'failed') NOT NULL DEFAULT 'pending',
    admin_user_id INT,
    error_message TEXT,
    details JSON,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    INDEX idx_operation_type (operation_type),
    INDEX idx_status (status),
    INDEX idx_started_at (started_at),
    FOREIGN KEY (admin_user_id) REFERENCES actor(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table: update_configuration
-- Stores current update system configuration
CREATE TABLE IF NOT EXISTS update_configuration (
    id INT AUTO_INCREMENT PRIMARY KEY,
    config_key VARCHAR(100) NOT NULL UNIQUE,
    config_value LONGTEXT,
    config_type ENUM('string', 'integer', 'boolean', 'json') DEFAULT 'string',
    updated_by INT,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_config_key (config_key),
    FOREIGN KEY (updated_by) REFERENCES actor(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default configuration values
INSERT INTO update_configuration (config_key, config_value, config_type) VALUES
('current_version', '1.0.0', 'string'),
('last_check_at', NULL, 'string'),
('check_interval_hours', '24', 'integer'),
('auto_update_enabled', 'false', 'boolean'),
('github_owner', 'makr-code', 'string'),
('github_repo', 'GalaxyQuest', 'string'),
('minimum_version', '1.0.0', 'string'),
('update_check_url', 'https://api.github.com/repos/{owner}/{repo}/releases/latest', 'string'),
('notify_admins_on_update', 'true', 'boolean'),
('maintenance_window_hours', '2', 'integer')
ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);

-- Table: update_backups
-- Tracks version backups for rollback capability
CREATE TABLE IF NOT EXISTS update_backups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    version VARCHAR(50) NOT NULL,
    backup_path VARCHAR(500),
    backup_size BIGINT,
    database_snapshot_id INT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    is_available BOOLEAN DEFAULT TRUE,
    INDEX idx_version (version),
    INDEX idx_created_at (created_at),
    INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;
