-- Preserve existing definitions and cache timestamps.
-- No down companion: dropping storage would discard generated definitions.
CREATE TABLE IF NOT EXISTS glossary_cache (
    id INT AUTO_INCREMENT PRIMARY KEY,
    term_key VARCHAR(30) NOT NULL UNIQUE,
    definition_json LONGTEXT NOT NULL,
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_termkey (term_key),
    INDEX idx_generated (generated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
