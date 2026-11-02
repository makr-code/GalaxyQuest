-- Preserve existing science data; add only absent columns on legacy installations.
-- No down companion: removing science columns would destroy generated planet data.
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets' AND COLUMN_NAME = 'composition_family') = 0,
    'ALTER TABLE planets ADD COLUMN composition_family VARCHAR(64) NOT NULL DEFAULT ''silicate_metal''',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets' AND COLUMN_NAME = 'dominant_surface_material') = 0,
    'ALTER TABLE planets ADD COLUMN dominant_surface_material VARCHAR(64) NOT NULL DEFAULT ''basaltic_regolith''',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets' AND COLUMN_NAME = 'surface_pressure_bar') = 0,
    'ALTER TABLE planets ADD COLUMN surface_pressure_bar DOUBLE NOT NULL DEFAULT 0.0',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets' AND COLUMN_NAME = 'water_state') = 0,
    'ALTER TABLE planets ADD COLUMN water_state VARCHAR(32) NOT NULL DEFAULT ''solid''',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets' AND COLUMN_NAME = 'methane_state') = 0,
    'ALTER TABLE planets ADD COLUMN methane_state VARCHAR(32) NOT NULL DEFAULT ''gas''',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets' AND COLUMN_NAME = 'ammonia_state') = 0,
    'ALTER TABLE planets ADD COLUMN ammonia_state VARCHAR(32) NOT NULL DEFAULT ''gas''',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets' AND COLUMN_NAME = 'dominant_surface_liquid') = 0,
    'ALTER TABLE planets ADD COLUMN dominant_surface_liquid VARCHAR(32) NOT NULL DEFAULT ''none''',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets' AND COLUMN_NAME = 'radiation_level') = 0,
    'ALTER TABLE planets ADD COLUMN radiation_level VARCHAR(32) NOT NULL DEFAULT ''moderate''',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets' AND COLUMN_NAME = 'habitability_score') = 0,
    'ALTER TABLE planets ADD COLUMN habitability_score TINYINT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets' AND COLUMN_NAME = 'life_friendliness') = 0,
    'ALTER TABLE planets ADD COLUMN life_friendliness VARCHAR(32) NOT NULL DEFAULT ''life_hostile''',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets' AND COLUMN_NAME = 'species_affinity_json') = 0,
    'ALTER TABLE planets ADD COLUMN species_affinity_json JSON DEFAULT NULL',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
