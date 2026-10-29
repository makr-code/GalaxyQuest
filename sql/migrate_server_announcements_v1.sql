CREATE TABLE IF NOT EXISTS server_announcements (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(160) NOT NULL,
    message TEXT NOT NULL,
    severity ENUM('important', 'maintenance', 'critical') NOT NULL DEFAULT 'important',
    published_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    withdrawn_at DATETIME NULL,
    INDEX idx_active_published (withdrawn_at, published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
