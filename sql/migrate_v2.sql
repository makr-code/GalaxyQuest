-- GalaxyQuest – Database migration v2
-- Apply to existing installations that already have the v1 schema.
-- Safe to run multiple times (uses IF NOT EXISTS / IGNORE everywhere).

USE galaxyquest;

-- ─── Users: add new columns ───────────────────────────────────────────────────

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'dark_matter') = 0,
    'ALTER TABLE users ADD COLUMN dark_matter     INT UNSIGNED NOT NULL DEFAULT 0
        AFTER is_admin',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'rank_points') = 0,
    'ALTER TABLE users ADD COLUMN rank_points     INT UNSIGNED NOT NULL DEFAULT 0
        AFTER dark_matter',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'protection_until') = 0,
    'ALTER TABLE users ADD COLUMN protection_until DATETIME DEFAULT NULL
        AFTER rank_points',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'vacation_mode') = 0,
    'ALTER TABLE users ADD COLUMN vacation_mode   TINYINT(1) NOT NULL DEFAULT 0
        AFTER protection_until',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'pvp_mode') = 0,
    'ALTER TABLE users ADD COLUMN pvp_mode        TINYINT(1) NOT NULL DEFAULT 0
        AFTER vacation_mode',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'is_npc') = 0,
    'ALTER TABLE users ADD COLUMN is_npc          TINYINT(1) NOT NULL DEFAULT 0
        AFTER pvp_mode',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- ─── Persistent login tokens (remember me) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS remember_tokens (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    selector CHAR(18) NOT NULL UNIQUE,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_remember_user (user_id),
    INDEX idx_remember_expires (expires_at)
) ENGINE=InnoDB;

-- ─── Star systems table (new in v2) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS star_systems (
    id INT AUTO_INCREMENT PRIMARY KEY,
    galaxy_index TINYINT UNSIGNED NOT NULL,
    system_index SMALLINT UNSIGNED NOT NULL,
    x_ly DOUBLE NOT NULL DEFAULT 0,
    y_ly DOUBLE NOT NULL DEFAULT 0,
    z_ly DOUBLE NOT NULL DEFAULT 0,
    spectral_class ENUM('O','B','A','F','G','K','M') NOT NULL DEFAULT 'G',
    subtype TINYINT UNSIGNED NOT NULL DEFAULT 2,
    luminosity_class VARCHAR(4) NOT NULL DEFAULT 'V',
    mass_solar DOUBLE NOT NULL DEFAULT 1.0,
    radius_solar DOUBLE NOT NULL DEFAULT 1.0,
    temperature_k MEDIUMINT UNSIGNED NOT NULL DEFAULT 5778,
    luminosity_solar DOUBLE NOT NULL DEFAULT 1.0,
    hz_inner_au DOUBLE NOT NULL DEFAULT 0.9506,
    hz_outer_au DOUBLE NOT NULL DEFAULT 1.6765,
    frost_line_au DOUBLE NOT NULL DEFAULT 2.68,
    stellar_type ENUM('main_sequence','white_dwarf','brown_dwarf','neutron_star','giant','subdwarf') NOT NULL DEFAULT 'main_sequence',
    age_gyr DECIMAL(4,2) NOT NULL DEFAULT 5.0,
    metallicity_z DECIMAL(6,4) NOT NULL DEFAULT 0.0200,
    is_binary TINYINT(1) NOT NULL DEFAULT 0,
    is_circumbinary TINYINT(1) NOT NULL DEFAULT 0,
    companion_stellar_type ENUM('main_sequence','white_dwarf','brown_dwarf','neutron_star','giant','subdwarf') DEFAULT NULL,
    companion_spectral_class VARCHAR(4) DEFAULT NULL,
    companion_subtype TINYINT UNSIGNED DEFAULT NULL,
    companion_luminosity_class VARCHAR(4) DEFAULT NULL,
    companion_mass_solar DOUBLE DEFAULT NULL,
    companion_radius_solar DOUBLE DEFAULT NULL,
    companion_temperature_k MEDIUMINT UNSIGNED DEFAULT NULL,
    companion_luminosity_solar DOUBLE DEFAULT NULL,
    companion_separation_au DOUBLE DEFAULT NULL,
    companion_eccentricity DOUBLE DEFAULT NULL,
    stability_critical_au DOUBLE DEFAULT NULL,
    name VARCHAR(16) NOT NULL DEFAULT '',
    catalog_name VARCHAR(32) NOT NULL DEFAULT '',
    planet_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
    UNIQUE KEY unique_system (galaxy_index, system_index)
) ENGINE=InnoDB;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'star_systems'
       AND COLUMN_NAME = 'stellar_type') = 0,
    'ALTER TABLE star_systems ADD COLUMN stellar_type ENUM(''main_sequence'',''white_dwarf'',''brown_dwarf'',''neutron_star'',''giant'',''subdwarf'') NOT NULL DEFAULT ''main_sequence''
        AFTER frost_line_au',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'star_systems'
       AND COLUMN_NAME = 'age_gyr') = 0,
    'ALTER TABLE star_systems ADD COLUMN age_gyr DECIMAL(4,2) NOT NULL DEFAULT 5.0
        AFTER stellar_type',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'star_systems'
       AND COLUMN_NAME = 'metallicity_z') = 0,
    'ALTER TABLE star_systems ADD COLUMN metallicity_z DECIMAL(6,4) NOT NULL DEFAULT 0.0200
        AFTER age_gyr',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'star_systems'
       AND COLUMN_NAME = 'is_binary') = 0,
    'ALTER TABLE star_systems ADD COLUMN is_binary TINYINT(1) NOT NULL DEFAULT 0
        AFTER metallicity_z',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'star_systems'
       AND COLUMN_NAME = 'is_circumbinary') = 0,
    'ALTER TABLE star_systems ADD COLUMN is_circumbinary TINYINT(1) NOT NULL DEFAULT 0
        AFTER is_binary',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'star_systems'
       AND COLUMN_NAME = 'companion_stellar_type') = 0,
    'ALTER TABLE star_systems ADD COLUMN companion_stellar_type ENUM(''main_sequence'',''white_dwarf'',''brown_dwarf'',''neutron_star'',''giant'',''subdwarf'') DEFAULT NULL
        AFTER is_circumbinary',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'star_systems'
       AND COLUMN_NAME = 'companion_spectral_class') = 0,
    'ALTER TABLE star_systems ADD COLUMN companion_spectral_class VARCHAR(4) DEFAULT NULL
        AFTER companion_stellar_type',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'star_systems'
       AND COLUMN_NAME = 'companion_subtype') = 0,
    'ALTER TABLE star_systems ADD COLUMN companion_subtype TINYINT UNSIGNED DEFAULT NULL
        AFTER companion_spectral_class',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'star_systems'
       AND COLUMN_NAME = 'companion_luminosity_class') = 0,
    'ALTER TABLE star_systems ADD COLUMN companion_luminosity_class VARCHAR(4) DEFAULT NULL
        AFTER companion_subtype',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'star_systems'
       AND COLUMN_NAME = 'companion_mass_solar') = 0,
    'ALTER TABLE star_systems ADD COLUMN companion_mass_solar DOUBLE DEFAULT NULL
        AFTER companion_luminosity_class',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'star_systems'
       AND COLUMN_NAME = 'companion_radius_solar') = 0,
    'ALTER TABLE star_systems ADD COLUMN companion_radius_solar DOUBLE DEFAULT NULL
        AFTER companion_mass_solar',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'star_systems'
       AND COLUMN_NAME = 'companion_temperature_k') = 0,
    'ALTER TABLE star_systems ADD COLUMN companion_temperature_k MEDIUMINT UNSIGNED DEFAULT NULL
        AFTER companion_radius_solar',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'star_systems'
       AND COLUMN_NAME = 'companion_luminosity_solar') = 0,
    'ALTER TABLE star_systems ADD COLUMN companion_luminosity_solar DOUBLE DEFAULT NULL
        AFTER companion_temperature_k',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'star_systems'
       AND COLUMN_NAME = 'companion_separation_au') = 0,
    'ALTER TABLE star_systems ADD COLUMN companion_separation_au DOUBLE DEFAULT NULL
        AFTER companion_luminosity_solar',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'star_systems'
       AND COLUMN_NAME = 'companion_eccentricity') = 0,
    'ALTER TABLE star_systems ADD COLUMN companion_eccentricity DOUBLE DEFAULT NULL
        AFTER companion_separation_au',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'star_systems'
       AND COLUMN_NAME = 'stability_critical_au') = 0,
    'ALTER TABLE star_systems ADD COLUMN stability_critical_au DOUBLE DEFAULT NULL
        AFTER companion_eccentricity',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'star_systems'
       AND COLUMN_NAME = 'catalog_name') = 0,
    'ALTER TABLE star_systems ADD COLUMN catalog_name VARCHAR(32) NOT NULL DEFAULT ''''
        AFTER name',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'star_systems'
       AND COLUMN_NAME = 'planet_count') = 0,
    'ALTER TABLE star_systems ADD COLUMN planet_count TINYINT UNSIGNED NOT NULL DEFAULT 0
        AFTER catalog_name',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

CREATE TABLE IF NOT EXISTS binary_systems (
    id INT AUTO_INCREMENT PRIMARY KEY,
    primary_star_system_id INT NOT NULL UNIQUE,
    is_circumbinary TINYINT(1) NOT NULL DEFAULT 0,
    companion_stellar_type ENUM('main_sequence','white_dwarf','brown_dwarf','neutron_star','giant','subdwarf') DEFAULT NULL,
    companion_spectral_class VARCHAR(4) DEFAULT NULL,
    companion_subtype TINYINT UNSIGNED DEFAULT NULL,
    companion_luminosity_class VARCHAR(4) DEFAULT NULL,
    companion_mass_solar DOUBLE DEFAULT NULL,
    companion_radius_solar DOUBLE DEFAULT NULL,
    companion_temperature_k MEDIUMINT UNSIGNED DEFAULT NULL,
    companion_luminosity_solar DOUBLE DEFAULT NULL,
    separation_au DOUBLE NOT NULL DEFAULT 1.0,
    eccentricity DOUBLE NOT NULL DEFAULT 0.0,
    stability_critical_au DOUBLE DEFAULT NULL,
    mass_ratio DOUBLE DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (primary_star_system_id) REFERENCES star_systems(id) ON DELETE CASCADE,
    INDEX idx_binary_sep (separation_au),
    INDEX idx_binary_type (companion_stellar_type)
) ENGINE=InnoDB;

-- ─── Planets: add scientific columns ─────────────────────────────────────────

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets'
       AND COLUMN_NAME = 'system_id') = 0,
    'ALTER TABLE planets ADD COLUMN system_id INT DEFAULT NULL
        AFTER user_id',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets'
       AND COLUMN_NAME = 'planet_class') = 0,
    'ALTER TABLE planets ADD COLUMN planet_class ENUM(
        ''rocky'',''super_earth'',''ocean'',
        ''gas_giant'',''ice_giant'',''hot_jupiter'',
        ''lava'',''ice_dwarf'',''comet_belt''
    ) NOT NULL DEFAULT ''rocky''
        AFTER type',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets'
       AND COLUMN_NAME = 'semi_major_axis_au') = 0,
    'ALTER TABLE planets ADD COLUMN semi_major_axis_au DOUBLE NOT NULL DEFAULT 1.0
        AFTER temp_max',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets'
       AND COLUMN_NAME = 'orbital_period_days') = 0,
    'ALTER TABLE planets ADD COLUMN orbital_period_days DOUBLE NOT NULL DEFAULT 365.25
        AFTER semi_major_axis_au',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets'
       AND COLUMN_NAME = 'orbital_eccentricity') = 0,
    'ALTER TABLE planets ADD COLUMN orbital_eccentricity DOUBLE NOT NULL DEFAULT 0.017
        AFTER orbital_period_days',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets'
       AND COLUMN_NAME = 'surface_gravity_g') = 0,
    'ALTER TABLE planets ADD COLUMN surface_gravity_g DOUBLE NOT NULL DEFAULT 1.0
        AFTER orbital_eccentricity',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets'
       AND COLUMN_NAME = 'in_habitable_zone') = 0,
    'ALTER TABLE planets ADD COLUMN in_habitable_zone TINYINT(1) NOT NULL DEFAULT 0
        AFTER surface_gravity_g',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets'
       AND COLUMN_NAME = 'atmosphere_type') = 0,
    'ALTER TABLE planets ADD COLUMN atmosphere_type ENUM(
        ''none'',''thin_co2'',''thick_co2'',
        ''nitrogen_oxygen'',''hydrogen_helium'',
        ''methane'',''sulfuric''
    ) NOT NULL DEFAULT ''nitrogen_oxygen''
        AFTER in_habitable_zone',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets'
       AND CONSTRAINT_NAME = 'fk_planets_system_id') = 0,
    'ALTER TABLE planets ADD CONSTRAINT fk_planets_system_id
        FOREIGN KEY (system_id) REFERENCES star_systems(id) ON DELETE SET NULL',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- ─── Achievements tables (new in v2) ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS achievements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    category ENUM('tutorial','milestone','combat','economy','expansion') NOT NULL DEFAULT 'milestone',
    title VARCHAR(128) NOT NULL,
    description TEXT NOT NULL,
    reward_metal INT UNSIGNED NOT NULL DEFAULT 0,
    reward_crystal INT UNSIGNED NOT NULL DEFAULT 0,
    reward_deuterium INT UNSIGNED NOT NULL DEFAULT 0,
    reward_dark_matter INT UNSIGNED NOT NULL DEFAULT 0,
    reward_rank_points INT UNSIGNED NOT NULL DEFAULT 0,
    sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 100
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_achievements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    achievement_id INT NOT NULL,
    completed TINYINT(1) NOT NULL DEFAULT 0,
    completed_at DATETIME DEFAULT NULL,
    reward_claimed TINYINT(1) NOT NULL DEFAULT 0,
    progress INT UNSIGNED NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (achievement_id) REFERENCES achievements(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_achievement (user_id, achievement_id)
) ENGINE=InnoDB;

-- Seed achievement catalogue (idempotent)
INSERT IGNORE INTO achievements
    (code, category, title, description,
     reward_metal, reward_crystal, reward_deuterium, reward_dark_matter, reward_rank_points, sort_order)
VALUES
('tutorial_mine_3',    'tutorial',  'First Dig',
 'Upgrade your Metal Mine to level 3.',
 500,0,0,0,10, 10),
('tutorial_solar_3',   'tutorial',  'Let There Be Light',
 'Upgrade your Solar Plant to level 3.',
 0,300,0,0,10, 20),
('tutorial_spy',       'tutorial',  'Eyes in the Sky',
 'Send your first Espionage Probe.',
 0,500,0,0,20, 30),
('tutorial_transport', 'tutorial',  'First Supply Run',
 'Complete your first transport mission.',
 800,400,0,0,20, 40),
('tutorial_research',  'tutorial',  'Curious Mind',
 'Research any technology for the first time.',
 0,0,200,0,30, 50),
('tutorial_colony',    'tutorial',  'New Horizons',
 'Found your first colony.',
 2000,1000,500,5,100, 60),
('eco_metal_100k',     'economy',   'Metal Baron',
 'Accumulate 100 000 metal across all planets.',
 0,5000,0,0,50, 110),
('eco_planets_5',      'expansion', 'Small Empire',
 'Control 5 planets simultaneously.',
 5000,5000,2000,10,150, 120),
('eco_planets_10',     'expansion', 'Galactic Domain',
 'Control 10 planets simultaneously.',
 10000,10000,5000,25,300, 130),
('combat_first_win',   'combat',    'Baptism of Fire',
 'Win your first battle.',
 1000,500,0,5,50, 210),
('combat_10_wins',     'combat',    'Warlord',
 'Win 10 battles.',
 0,0,0,20,200, 220),
('veteran_deathstar',  'milestone', 'Doomsday Machine',
 'Build a Death Star.',
 0,0,0,100,1000, 910),
('veteran_all_research','milestone','Omniscient',
 'Complete all research trees.',
 0,0,0,50,500, 920);

-- ── Colony layer migration ────────────────────────────────────────────────────
-- Create colonies table if it doesn't exist
CREATE TABLE IF NOT EXISTS colonies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    planet_id INT NOT NULL,
    user_id INT NOT NULL,
    name VARCHAR(64) NOT NULL DEFAULT 'Colony',
    colony_type ENUM('balanced','mining','industrial','research','agricultural','military') NOT NULL DEFAULT 'balanced',
    metal    DECIMAL(20,4) NOT NULL DEFAULT 500,
    crystal  DECIMAL(20,4) NOT NULL DEFAULT 300,
    deuterium DECIMAL(20,4) NOT NULL DEFAULT 100,
    energy   INT NOT NULL DEFAULT 0,
    is_homeworld TINYINT(1) NOT NULL DEFAULT 0,
    last_update DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (planet_id) REFERENCES planets(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_colony (planet_id)
) ENGINE=InnoDB;

-- Legacy planet ownership is absent on the current astronomical-only schema.
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets'
       AND COLUMN_NAME = 'user_id') > 0,
    'INSERT IGNORE INTO colonies (planet_id, user_id, name, colony_type, metal, crystal, deuterium, energy, is_homeworld, last_update)
     SELECT id, user_id, name, ''balanced'', metal, crystal, deuterium, energy, is_homeworld, last_update
     FROM planets WHERE user_id IS NOT NULL AND user_id > 0',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- Add colony_id column to buildings (keep planet_id for backward compat)
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'buildings'
       AND COLUMN_NAME = 'colony_id') = 0,
    'ALTER TABLE buildings ADD COLUMN colony_id INT DEFAULT NULL',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'buildings'
       AND INDEX_NAME = 'idx_colony') = 0,
    'ALTER TABLE buildings ADD INDEX idx_colony (colony_id)',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
-- Populate colony_id from planet_id
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'buildings'
       AND COLUMN_NAME = 'planet_id') > 0,
    'UPDATE buildings b
     JOIN colonies c ON c.planet_id = b.planet_id
     SET b.colony_id = c.id
     WHERE b.colony_id IS NULL',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- Add colony_id to ships
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ships'
       AND COLUMN_NAME = 'colony_id') = 0,
    'ALTER TABLE ships ADD COLUMN colony_id INT DEFAULT NULL',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ships'
       AND INDEX_NAME = 'idx_colony') = 0,
    'ALTER TABLE ships ADD INDEX idx_colony (colony_id)',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ships'
       AND COLUMN_NAME = 'planet_id') > 0,
    'UPDATE ships s
     JOIN colonies c ON c.planet_id = s.planet_id
     SET s.colony_id = c.id
     WHERE s.colony_id IS NULL',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- Add origin_colony_id to fleets
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fleets'
       AND COLUMN_NAME = 'origin_colony_id') = 0,
    'ALTER TABLE fleets ADD COLUMN origin_colony_id INT DEFAULT NULL',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fleets'
       AND COLUMN_NAME = 'origin_planet_id') > 0,
    'UPDATE fleets f
     JOIN colonies c ON c.planet_id = f.origin_planet_id
     SET f.origin_colony_id = c.id
     WHERE f.origin_colony_id IS NULL',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- ── Fleet 3-D coordinates (Newtonian movement) ───────────────────────────────
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fleets'
       AND COLUMN_NAME = 'origin_x_ly') = 0,
    'ALTER TABLE fleets ADD COLUMN origin_x_ly DOUBLE NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fleets'
       AND COLUMN_NAME = 'origin_y_ly') = 0,
    'ALTER TABLE fleets ADD COLUMN origin_y_ly DOUBLE NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fleets'
       AND COLUMN_NAME = 'origin_z_ly') = 0,
    'ALTER TABLE fleets ADD COLUMN origin_z_ly DOUBLE NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fleets'
       AND COLUMN_NAME = 'target_x_ly') = 0,
    'ALTER TABLE fleets ADD COLUMN target_x_ly DOUBLE NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fleets'
       AND COLUMN_NAME = 'target_y_ly') = 0,
    'ALTER TABLE fleets ADD COLUMN target_y_ly DOUBLE NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fleets'
       AND COLUMN_NAME = 'target_z_ly') = 0,
    'ALTER TABLE fleets ADD COLUMN target_z_ly DOUBLE NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fleets'
       AND COLUMN_NAME = 'speed_ly_h') = 0,
    'ALTER TABLE fleets ADD COLUMN speed_ly_h  DOUBLE NOT NULL DEFAULT 1.0',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fleets'
       AND COLUMN_NAME = 'distance_ly') = 0,
    'ALTER TABLE fleets ADD COLUMN distance_ly DOUBLE NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- ── Leaders / Officers ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leaders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(64) NOT NULL,
    role ENUM('colony_manager','fleet_commander','science_director','diplomacy_officer','trade_director') NOT NULL,
    colony_id INT DEFAULT NULL,
    fleet_id  INT DEFAULT NULL,
    skill_production   TINYINT UNSIGNED NOT NULL DEFAULT 1,
    skill_construction TINYINT UNSIGNED NOT NULL DEFAULT 1,
    skill_tactics      TINYINT UNSIGNED NOT NULL DEFAULT 1,
    skill_navigation   TINYINT UNSIGNED NOT NULL DEFAULT 1,
    skill_research     TINYINT UNSIGNED NOT NULL DEFAULT 1,
    skill_efficiency   TINYINT UNSIGNED NOT NULL DEFAULT 1,
    autonomy TINYINT UNSIGNED NOT NULL DEFAULT 1,
    last_action TEXT DEFAULT NULL,
    last_action_at DATETIME DEFAULT NULL,
    xp    INT UNSIGNED NOT NULL DEFAULT 0,
    level TINYINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)   REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE SET NULL,
    FOREIGN KEY (fleet_id)  REFERENCES fleets(id)   ON DELETE SET NULL
) ENGINE=InnoDB;

ALTER TABLE leaders
    MODIFY COLUMN role ENUM('colony_manager','fleet_commander','science_director','diplomacy_officer','trade_director') NOT NULL;

-- ── Planet deposit & richness columns ────────────────────────────────────────
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets'
       AND COLUMN_NAME = 'richness_metal') = 0,
    'ALTER TABLE planets ADD COLUMN richness_metal      DOUBLE NOT NULL DEFAULT 1.0',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets'
       AND COLUMN_NAME = 'richness_crystal') = 0,
    'ALTER TABLE planets ADD COLUMN richness_crystal    DOUBLE NOT NULL DEFAULT 1.0',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets'
       AND COLUMN_NAME = 'richness_deuterium') = 0,
    'ALTER TABLE planets ADD COLUMN richness_deuterium  DOUBLE NOT NULL DEFAULT 1.0',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets'
       AND COLUMN_NAME = 'richness_rare_earth') = 0,
    'ALTER TABLE planets ADD COLUMN richness_rare_earth DOUBLE NOT NULL DEFAULT 0.5',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets'
       AND COLUMN_NAME = 'deposit_metal') = 0,
    'ALTER TABLE planets ADD COLUMN deposit_metal       BIGINT NOT NULL DEFAULT 5000000',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets'
       AND COLUMN_NAME = 'deposit_crystal') = 0,
    'ALTER TABLE planets ADD COLUMN deposit_crystal     BIGINT NOT NULL DEFAULT 2000000',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets'
       AND COLUMN_NAME = 'deposit_deuterium') = 0,
    'ALTER TABLE planets ADD COLUMN deposit_deuterium   BIGINT NOT NULL DEFAULT 1000000',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets'
       AND COLUMN_NAME = 'deposit_rare_earth') = 0,
    'ALTER TABLE planets ADD COLUMN deposit_rare_earth  BIGINT NOT NULL DEFAULT 200000',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- ── Colony population / food / welfare columns ────────────────────────────────
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'colonies'
       AND COLUMN_NAME = 'rare_earth') = 0,
    'ALTER TABLE colonies ADD COLUMN rare_earth      DECIMAL(20,4) NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'colonies'
       AND COLUMN_NAME = 'food') = 0,
    'ALTER TABLE colonies ADD COLUMN food            DECIMAL(20,4) NOT NULL DEFAULT 200',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'colonies'
       AND COLUMN_NAME = 'population') = 0,
    'ALTER TABLE colonies ADD COLUMN population      INT UNSIGNED NOT NULL DEFAULT 100',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'colonies'
       AND COLUMN_NAME = 'max_population') = 0,
    'ALTER TABLE colonies ADD COLUMN max_population  INT UNSIGNED NOT NULL DEFAULT 500',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'colonies'
       AND COLUMN_NAME = 'happiness') = 0,
    'ALTER TABLE colonies ADD COLUMN happiness       TINYINT UNSIGNED NOT NULL DEFAULT 70',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'colonies'
       AND COLUMN_NAME = 'public_services') = 0,
    'ALTER TABLE colonies ADD COLUMN public_services TINYINT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- ── NPC faction tables ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS npc_factions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(64) NOT NULL,
    description TEXT NOT NULL,
    faction_type ENUM('military','trade','science','pirate','ancient') NOT NULL,
    aggression TINYINT UNSIGNED NOT NULL DEFAULT 50,
    trade_willingness TINYINT UNSIGNED NOT NULL DEFAULT 50,
    base_diplomacy SMALLINT NOT NULL DEFAULT 0,
    power_level INT UNSIGNED NOT NULL DEFAULT 1000,
    home_galaxy_min TINYINT UNSIGNED NOT NULL DEFAULT 1,
    home_galaxy_max TINYINT UNSIGNED NOT NULL DEFAULT 9,
    color VARCHAR(7) NOT NULL DEFAULT '#888888',
    icon VARCHAR(4) NOT NULL DEFAULT '👾'
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS diplomacy (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    faction_id INT NOT NULL,
    standing SMALLINT NOT NULL DEFAULT 0,
    attacks_against INT UNSIGNED NOT NULL DEFAULT 0,
    trades_completed INT UNSIGNED NOT NULL DEFAULT 0,
    quests_completed INT UNSIGNED NOT NULL DEFAULT 0,
    last_event TEXT DEFAULT NULL,
    last_event_at DATETIME DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE,
    UNIQUE KEY unique_diplomacy (user_id, faction_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trade_offers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    faction_id INT NOT NULL,
    offer_resource ENUM('metal','crystal','deuterium','rare_earth','food') NOT NULL,
    offer_amount BIGINT UNSIGNED NOT NULL DEFAULT 1000,
    request_resource ENUM('metal','crystal','deuterium','rare_earth','food') NOT NULL,
    request_amount BIGINT UNSIGNED NOT NULL DEFAULT 1000,
    min_standing SMALLINT NOT NULL DEFAULT -50,
    max_claims SMALLINT UNSIGNED NOT NULL DEFAULT 5,
    claims_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    valid_until DATETIME NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS faction_quests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    faction_id INT NOT NULL,
    code VARCHAR(64) NOT NULL UNIQUE,
    title VARCHAR(128) NOT NULL,
    description TEXT NOT NULL,
    quest_type ENUM('kill','deliver','explore','build','research','spy') NOT NULL,
    requirements_json TEXT NOT NULL DEFAULT ('{}'),
    active TINYINT(1) NOT NULL DEFAULT 1,
    template_code VARCHAR(64) DEFAULT NULL,
    generated_by_npc TINYINT(1) NOT NULL DEFAULT 0,
    generated_timestamp DATETIME DEFAULT NULL,
    reward_metal INT UNSIGNED NOT NULL DEFAULT 0,
    reward_crystal INT UNSIGNED NOT NULL DEFAULT 0,
    reward_deuterium INT UNSIGNED NOT NULL DEFAULT 0,
    reward_rare_earth INT UNSIGNED NOT NULL DEFAULT 0,
    reward_dark_matter INT UNSIGNED NOT NULL DEFAULT 0,
    reward_rank_points INT UNSIGNED NOT NULL DEFAULT 0,
    reward_standing SMALLINT NOT NULL DEFAULT 10,
    min_standing SMALLINT NOT NULL DEFAULT -100,
    difficulty ENUM('easy','medium','hard','epic') NOT NULL DEFAULT 'medium',
    repeatable TINYINT(1) NOT NULL DEFAULT 0,
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_faction_quests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    faction_quest_id INT NOT NULL,
    status ENUM('active','completed','failed','claimed') NOT NULL DEFAULT 'active',
    progress_json TEXT NOT NULL DEFAULT ('{}'),
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (faction_quest_id) REFERENCES faction_quests(id) ON DELETE CASCADE
) ENGINE=InnoDB;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'last_npc_tick') = 0,
    'ALTER TABLE users ADD COLUMN last_npc_tick DATETIME DEFAULT NULL',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

CREATE TABLE IF NOT EXISTS user_character_profiles (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    is_npc TINYINT(1) NOT NULL DEFAULT 0,
    race VARCHAR(80) NOT NULL DEFAULT 'Unknown',
    profession VARCHAR(80) NOT NULL DEFAULT 'Wanderer',
    stance VARCHAR(80) NOT NULL DEFAULT 'Neutral',
    vita TEXT NOT NULL,
    profile_json LONGTEXT NOT NULL,
    yaml_path VARCHAR(255) NOT NULL,
    json_path VARCHAR(255) NOT NULL,
    png_path VARCHAR(255) NOT NULL DEFAULT '',
    storage_dir VARCHAR(255) NOT NULL,
    generation_status VARCHAR(40) NOT NULL DEFAULT 'generated',
    last_error TEXT DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_character_profile_user (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── Battle report indexes ─────────────────────────────────────────────────────
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battle_reports'
       AND INDEX_NAME = 'idx_attacker_time') = 0,
    'ALTER TABLE battle_reports ADD KEY idx_attacker_time (attacker_id, created_at)',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'battle_reports'
       AND INDEX_NAME = 'idx_defender_time') = 0,
    'ALTER TABLE battle_reports ADD KEY idx_defender_time  (defender_id, created_at)',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- ── Research: add start timestamp for live progress bars ──────────────────────
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'research'
       AND COLUMN_NAME = 'research_start') = 0,
    'ALTER TABLE research ADD COLUMN research_start DATETIME DEFAULT NULL AFTER research_end',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- ── Trade routes system ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_routes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    origin_colony_id INT NOT NULL,
    target_colony_id INT NOT NULL,
    cargo_metal DECIMAL(20,4) NOT NULL DEFAULT 0,
    cargo_crystal DECIMAL(20,4) NOT NULL DEFAULT 0,
    cargo_deuterium DECIMAL(20,4) NOT NULL DEFAULT 0,
    interval_hours INT UNSIGNED NOT NULL DEFAULT 24,
    last_dispatch DATETIME DEFAULT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (origin_colony_id) REFERENCES colonies(id) ON DELETE CASCADE,
    FOREIGN KEY (target_colony_id) REFERENCES colonies(id) ON DELETE CASCADE,
    UNIQUE KEY unique_route (origin_colony_id, target_colony_id),
    INDEX idx_dispatch_due (user_id, last_dispatch)
) ENGINE=InnoDB;

-- ── Alliance system ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alliances (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(64) NOT NULL,
    tag VARCHAR(4) NOT NULL UNIQUE,
    leader_user_id INT NOT NULL,
    description TEXT DEFAULT NULL,
    treasury_metal DECIMAL(20,4) NOT NULL DEFAULT 0,
    treasury_crystal DECIMAL(20,4) NOT NULL DEFAULT 0,
    treasury_deuterium DECIMAL(20,4) NOT NULL DEFAULT 0,
    treasury_dark_matter INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (leader_user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_leader (leader_user_id),
    INDEX idx_tag (tag)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS alliance_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    alliance_id INT NOT NULL,
    user_id INT NOT NULL,
    role ENUM('leader','diplomat','officer','member') NOT NULL DEFAULT 'member',
    joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    contributed_resources DECIMAL(20,4) NOT NULL DEFAULT 0,
    FOREIGN KEY (alliance_id) REFERENCES alliances(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_membership (alliance_id, user_id),
    INDEX idx_user_alliance (user_id, alliance_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS alliance_relations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    alliance_id INT NOT NULL,
    other_alliance_id INT,
    other_user_id INT,
    relation_type ENUM('nap','alliance','war','enemy','neutral') NOT NULL DEFAULT 'neutral',
    declared_by_user_id INT NOT NULL,
    declared_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME DEFAULT NULL,
    FOREIGN KEY (alliance_id) REFERENCES alliances(id) ON DELETE CASCADE,
    FOREIGN KEY (other_alliance_id) REFERENCES alliances(id) ON DELETE SET NULL,
    FOREIGN KEY (other_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (declared_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_alliance_relations (alliance_id, relation_type),
    INDEX idx_other_relations (other_alliance_id, relation_type)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS alliance_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    alliance_id INT NOT NULL,
    author_id INT NOT NULL,
    message_text TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (alliance_id) REFERENCES alliances(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_alliance_time (alliance_id, created_at DESC)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trade_proposals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    initiator_id INT NOT NULL,
    target_id INT NOT NULL,
    offer_metal      DECIMAL(20,4) NOT NULL DEFAULT 0,
    offer_crystal    DECIMAL(20,4) NOT NULL DEFAULT 0,
    offer_deuterium  DECIMAL(20,4) NOT NULL DEFAULT 0,
    request_metal    DECIMAL(20,4) NOT NULL DEFAULT 0,
    request_crystal  DECIMAL(20,4) NOT NULL DEFAULT 0,
    request_deuterium DECIMAL(20,4) NOT NULL DEFAULT 0,
    message VARCHAR(500) NOT NULL DEFAULT '',
    status ENUM('pending','accepted','rejected','cancelled','expired') NOT NULL DEFAULT 'pending',
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (initiator_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_target_status  (target_id,    status),
    INDEX idx_initiator_status (initiator_id, status)
) ENGINE=InnoDB;

-- ─── Phase 4.4 – Planetary random events ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS colony_events (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    colony_id   INT NOT NULL,
    event_type  ENUM('solar_flare','mineral_vein','disease') NOT NULL,
    started_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at  DATETIME NOT NULL,
    FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE CASCADE,
    UNIQUE KEY unique_colony_event (colony_id)
) ENGINE=InnoDB;

-- ─── Phase 5.1 – Extended stellar diversity ──────────────────────────────────
SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'star_systems'
       AND COLUMN_NAME = 'stellar_type') = 0,
    'ALTER TABLE star_systems ADD COLUMN stellar_type ENUM(''main_sequence'',''white_dwarf'',''brown_dwarf'',''neutron_star'',''giant'',''subdwarf'') NOT NULL DEFAULT ''main_sequence''
        AFTER frost_line_au',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'star_systems'
       AND COLUMN_NAME = 'age_gyr') = 0,
    'ALTER TABLE star_systems ADD COLUMN age_gyr DECIMAL(4,2) NOT NULL DEFAULT 5.0
        AFTER stellar_type',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'star_systems'
       AND COLUMN_NAME = 'metallicity_z') = 0,
    'ALTER TABLE star_systems ADD COLUMN metallicity_z DECIMAL(6,4) NOT NULL DEFAULT 0.0200
        AFTER age_gyr',
    'SELECT 1'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
