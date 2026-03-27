-- GalaxyQuest – Database migration v2
-- Apply to existing installations that already have the v1 schema.
-- Safe to run multiple times (uses IF NOT EXISTS / IGNORE everywhere).

USE galaxyquest;

-- ─── Users: add new columns ───────────────────────────────────────────────────

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS dark_matter     INT UNSIGNED NOT NULL DEFAULT 0
        AFTER is_admin,
    ADD COLUMN IF NOT EXISTS rank_points     INT UNSIGNED NOT NULL DEFAULT 0
        AFTER dark_matter,
    ADD COLUMN IF NOT EXISTS protection_until DATETIME DEFAULT NULL
        AFTER rank_points,
    ADD COLUMN IF NOT EXISTS vacation_mode   TINYINT(1) NOT NULL DEFAULT 0
        AFTER protection_until;

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
    name VARCHAR(16) NOT NULL DEFAULT '',
    UNIQUE KEY unique_system (galaxy_index, system_index)
) ENGINE=InnoDB;

-- ─── Planets: add scientific columns ─────────────────────────────────────────

ALTER TABLE planets
    ADD COLUMN IF NOT EXISTS system_id INT DEFAULT NULL
        AFTER user_id,
    ADD COLUMN IF NOT EXISTS planet_class ENUM(
        'rocky','super_earth','ocean',
        'gas_giant','ice_giant','hot_jupiter',
        'lava','ice_dwarf','comet_belt'
    ) NOT NULL DEFAULT 'rocky'
        AFTER type,
    ADD COLUMN IF NOT EXISTS semi_major_axis_au DOUBLE NOT NULL DEFAULT 1.0
        AFTER temp_max,
    ADD COLUMN IF NOT EXISTS orbital_period_days DOUBLE NOT NULL DEFAULT 365.25
        AFTER semi_major_axis_au,
    ADD COLUMN IF NOT EXISTS orbital_eccentricity DOUBLE NOT NULL DEFAULT 0.017
        AFTER orbital_period_days,
    ADD COLUMN IF NOT EXISTS surface_gravity_g DOUBLE NOT NULL DEFAULT 1.0
        AFTER orbital_eccentricity,
    ADD COLUMN IF NOT EXISTS in_habitable_zone TINYINT(1) NOT NULL DEFAULT 0
        AFTER surface_gravity_g,
    ADD COLUMN IF NOT EXISTS atmosphere_type ENUM(
        'none','thin_co2','thick_co2',
        'nitrogen_oxygen','hydrogen_helium',
        'methane','sulfuric'
    ) NOT NULL DEFAULT 'nitrogen_oxygen'
        AFTER in_habitable_zone;

ALTER TABLE planets
    ADD CONSTRAINT IF NOT EXISTS fk_planets_system_id
        FOREIGN KEY (system_id) REFERENCES star_systems(id) ON DELETE SET NULL;

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
