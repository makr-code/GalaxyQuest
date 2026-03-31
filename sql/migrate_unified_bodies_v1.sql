-- Unified Bodies Model v1
-- Goal: support colonies on planets, moons, comets, rogue planets in one schema.
-- Safe for MySQL variants where ADD COLUMN IF NOT EXISTS is not available.

START TRANSACTION;

CREATE TABLE IF NOT EXISTS celestial_bodies (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    body_uid VARCHAR(64) NOT NULL,
    galaxy_index INT UNSIGNED NOT NULL,
    system_index INT UNSIGNED NOT NULL,
    position SMALLINT UNSIGNED DEFAULT NULL,
    parent_body_id BIGINT UNSIGNED DEFAULT NULL,
    body_type ENUM('planet','moon','comet','rogue_planet','ring_system') NOT NULL,
    parent_body_type ENUM('star','planet','moon','none') NOT NULL DEFAULT 'star',
    name VARCHAR(96) NOT NULL,
    planet_class VARCHAR(32) DEFAULT NULL,
    can_colonize TINYINT(1) NOT NULL DEFAULT 0,
    orbit_ref_au DOUBLE DEFAULT NULL,
    semi_major_axis_au DOUBLE DEFAULT NULL,
    semi_major_axis_parent_r DOUBLE DEFAULT NULL,
    orbital_period_days DOUBLE DEFAULT NULL,
    orbital_eccentricity DOUBLE DEFAULT NULL,
    mass_earth DOUBLE DEFAULT NULL,
    diameter_km INT UNSIGNED DEFAULT NULL,
    surface_gravity_g DOUBLE DEFAULT NULL,
    eq_temp_k DOUBLE DEFAULT NULL,
    atmosphere_type VARCHAR(32) DEFAULT NULL,
    ring_inner_radius_planet_r DOUBLE DEFAULT NULL,
    ring_outer_radius_planet_r DOUBLE DEFAULT NULL,
    ring_optical_depth DOUBLE DEFAULT NULL,
    ring_tilt_deg DOUBLE DEFAULT NULL,
    ring_composition VARCHAR(32) DEFAULT NULL,
    payload_json JSON DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_body_uid (body_uid),
    KEY idx_body_system (galaxy_index, system_index),
    KEY idx_body_type (body_type),
    KEY idx_parent_body_id (parent_body_id),
    CONSTRAINT fk_celestial_parent
      FOREIGN KEY (parent_body_id) REFERENCES celestial_bodies(id)
      ON DELETE SET NULL
) ENGINE=InnoDB;

-- Ensure colonies.body_id exists and is linked to celestial_bodies
SET @has_body_id := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'colonies'
      AND COLUMN_NAME = 'body_id'
);
SET @sql_add_body_id := IF(
    @has_body_id = 0,
    'ALTER TABLE colonies ADD COLUMN body_id BIGINT UNSIGNED NULL AFTER planet_id',
    'SELECT 1'
);
PREPARE stmt_add_body_id FROM @sql_add_body_id;
EXECUTE stmt_add_body_id;
DEALLOCATE PREPARE stmt_add_body_id;

SET @has_idx_body_id := (
    SELECT COUNT(*)
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'colonies'
      AND INDEX_NAME = 'idx_colonies_body_id'
);
SET @sql_add_idx_body_id := IF(
    @has_idx_body_id = 0,
    'ALTER TABLE colonies ADD INDEX idx_colonies_body_id (body_id)',
    'SELECT 1'
);
PREPARE stmt_add_idx_body_id FROM @sql_add_idx_body_id;
EXECUTE stmt_add_idx_body_id;
DEALLOCATE PREPARE stmt_add_idx_body_id;

SET @has_fk_body_id := (
    SELECT COUNT(*)
    FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND CONSTRAINT_NAME = 'fk_colonies_body_id'
      AND TABLE_NAME = 'colonies'
);
SET @sql_add_fk_body_id := IF(
    @has_fk_body_id = 0,
    'ALTER TABLE colonies ADD CONSTRAINT fk_colonies_body_id FOREIGN KEY (body_id) REFERENCES celestial_bodies(id) ON DELETE SET NULL',
    'SELECT 1'
);
PREPARE stmt_add_fk_body_id FROM @sql_add_fk_body_id;
EXECUTE stmt_add_fk_body_id;
DEALLOCATE PREPARE stmt_add_fk_body_id;

-- Backfill planet colonies where possible: map planet_id -> body row by system/position.
INSERT INTO celestial_bodies (
    body_uid,
    galaxy_index,
    system_index,
    position,
    body_type,
    parent_body_type,
    name,
    planet_class,
    can_colonize,
    semi_major_axis_au,
    orbital_period_days,
    mass_earth,
    diameter_km,
    surface_gravity_g,
    atmosphere_type,
    payload_json
)
SELECT
    CONCAT('legacy-p-', p.galaxy, '-', p.`system`, '-', p.position) AS body_uid,
    p.galaxy,
    p.`system`,
    p.position,
    'planet' AS body_type,
    'star' AS parent_body_type,
    CONCAT('Planet ', p.position) AS name,
    p.planet_class,
    CASE
        WHEN p.planet_class IN ('gas_giant','hot_jupiter','comet_belt') THEN 0
        ELSE 1
    END AS can_colonize,
    p.semi_major_axis_au,
    p.orbital_period_days,
    NULL AS mass_earth,
    p.diameter,
    p.surface_gravity_g,
    p.atmosphere_type,
    JSON_OBJECT('legacy_planet_id', p.id)
FROM planets p
LEFT JOIN celestial_bodies cb
  ON cb.body_uid = CONCAT('legacy-p-', p.galaxy, '-', p.`system`, '-', p.position)
WHERE cb.id IS NULL;

UPDATE colonies c
JOIN planets p ON p.id = c.planet_id
JOIN celestial_bodies cb ON cb.body_uid = CONCAT('legacy-p-', p.galaxy, '-', p.`system`, '-', p.position)
SET c.body_id = cb.id
WHERE c.body_id IS NULL;

COMMIT;
