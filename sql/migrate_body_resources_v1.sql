-- Resource foundation only: inventories are staged until the economy cutover.
-- No automatic backfill: scripts/capture_body_resources.php explicitly captures
-- current legacy deposits without assuming that generated estimates are live stock.
CREATE TABLE IF NOT EXISTS body_resource_profiles (
    body_id BIGINT UNSIGNED NOT NULL,
    profile_version SMALLINT UNSIGNED NOT NULL,
    assessment ENUM('estimated','unassessed') NOT NULL,
    captured_at DATETIME NOT NULL,
    PRIMARY KEY (body_id),
    CONSTRAINT fk_profile_body FOREIGN KEY (body_id) REFERENCES celestial_bodies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS body_resource_sources (
    body_id BIGINT UNSIGNED NOT NULL,
    resource_type VARCHAR(32) NOT NULL,
    source_type ENUM('finite','regenerating','unlimited') NOT NULL,
    initial_quantity DECIMAL(20,6) DEFAULT NULL,
    remaining_quantity DECIMAL(20,6) DEFAULT NULL,
    capacity DECIMAL(20,6) DEFAULT NULL,
    regeneration_per_hour DECIMAL(20,6) NOT NULL DEFAULT 0,
    richness DECIMAL(12,6) NOT NULL,
    extraction_method VARCHAR(32) NOT NULL,
    origin ENUM('generated','legacy_snapshot') NOT NULL,
    captured_at DATETIME NOT NULL,
    PRIMARY KEY (body_id, resource_type),
    CONSTRAINT fk_resource_profile FOREIGN KEY (body_id) REFERENCES body_resource_profiles(body_id) ON DELETE CASCADE,
    CONSTRAINT ck_resource_quantity CHECK (
        (source_type = 'unlimited' AND initial_quantity IS NULL AND remaining_quantity IS NULL AND capacity IS NULL
            AND regeneration_per_hour = 0)
        OR (source_type = 'finite' AND remaining_quantity >= 0 AND remaining_quantity IS NOT NULL
            AND (initial_quantity IS NULL OR initial_quantity >= remaining_quantity)
            AND capacity IS NULL AND regeneration_per_hour = 0)
        OR (source_type = 'regenerating' AND remaining_quantity IS NOT NULL AND remaining_quantity >= 0
            AND capacity IS NOT NULL AND capacity > 0 AND remaining_quantity <= capacity
            AND (initial_quantity IS NULL OR (initial_quantity >= 0 AND initial_quantity <= capacity))
            AND regeneration_per_hour > 0)
    ),
    CONSTRAINT ck_resource_richness CHECK (richness >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
