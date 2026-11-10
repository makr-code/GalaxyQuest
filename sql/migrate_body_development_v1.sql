CREATE TABLE IF NOT EXISTS body_development (
    body_id BIGINT UNSIGNED NOT NULL,
    version SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    peak_population BIGINT UNSIGNED NOT NULL,
    founded_count TINYINT UNSIGNED NOT NULL,
    initialized_at BIGINT UNSIGNED NOT NULL,
    observed_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (body_id),
    CONSTRAINT fk_body_development_body FOREIGN KEY (body_id)
        REFERENCES celestial_bodies(id) ON DELETE CASCADE
) ENGINE=InnoDB;
