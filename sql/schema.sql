-- GalaxyQuest Database Schema
-- Run this once to set up the database

CREATE DATABASE IF NOT EXISTS galaxyquest CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE galaxyquest;

-- Users
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(32) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_admin TINYINT(1) NOT NULL DEFAULT 0,
    -- Prestige / meta-game currency (non-farmable, awarded by achievements)
    dark_matter INT UNSIGNED NOT NULL DEFAULT 0,
    -- Rank points (computed from economy + combat milestones)
    rank_points INT UNSIGNED NOT NULL DEFAULT 0,
    -- Newbie shield: no attacks possible while NOW() < protection_until
    protection_until DATETIME DEFAULT NULL,
    -- Vacation mode: production halved, cannot be attacked
    vacation_mode TINYINT(1) NOT NULL DEFAULT 0,
    -- PvP participation: 0 = PvE-only, 1 = PvP enabled (can attack/be attacked by players)
    pvp_mode TINYINT(1) NOT NULL DEFAULT 0,
    -- Internal flag for NPC faction accounts
    is_npc TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
) ENGINE=InnoDB;

-- Star systems (scientific, procedurally generated)
-- Each row describes one star in the spiral galaxy with 3-D galactic
-- coordinates and stellar physical parameters.
CREATE TABLE IF NOT EXISTS star_systems (
    id INT AUTO_INCREMENT PRIMARY KEY,
    -- Game coordinate keys (match galaxy / system in planets table)
    galaxy_index TINYINT UNSIGNED NOT NULL,
    system_index SMALLINT UNSIGNED NOT NULL,
    -- 3-D galactic coordinates in light-years (origin = galactic centre)
    x_ly DOUBLE NOT NULL DEFAULT 0,
    y_ly DOUBLE NOT NULL DEFAULT 0,
    z_ly DOUBLE NOT NULL DEFAULT 0,
    -- Spectral classification (Harvard / MKK)
    spectral_class ENUM('O','B','A','F','G','K','M') NOT NULL DEFAULT 'G',
    subtype TINYINT UNSIGNED NOT NULL DEFAULT 2,   -- 0-9
    luminosity_class VARCHAR(4) NOT NULL DEFAULT 'V',
    -- Stellar physical properties (solar units)
    mass_solar DOUBLE NOT NULL DEFAULT 1.0,
    radius_solar DOUBLE NOT NULL DEFAULT 1.0,
    temperature_k MEDIUMINT UNSIGNED NOT NULL DEFAULT 5778,
    luminosity_solar DOUBLE NOT NULL DEFAULT 1.0,
    -- Habitable zone bounds (AU) – Kopparapu et al. 2013
    hz_inner_au DOUBLE NOT NULL DEFAULT 0.9506,
    hz_outer_au DOUBLE NOT NULL DEFAULT 1.6765,
    -- Water-ice frost line (AU)
    frost_line_au DOUBLE NOT NULL DEFAULT 2.68,
    -- Catalogue designation (e.g. "GQ-1-042")
    name VARCHAR(16) NOT NULL DEFAULT '',
    UNIQUE KEY unique_system (galaxy_index, system_index)
) ENGINE=InnoDB;

-- Planets
CREATE TABLE IF NOT EXISTS planets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    -- Link to the scientifically generated star system (nullable for legacy rows)
    system_id INT DEFAULT NULL,
    name VARCHAR(64) NOT NULL,
    galaxy INT NOT NULL DEFAULT 1,
    system INT NOT NULL DEFAULT 1,
    position INT NOT NULL DEFAULT 1,
    -- Broad planet type used by game mechanics (legacy classification)
    type ENUM('terrestrial','gas_giant','ice','desert','volcanic') NOT NULL DEFAULT 'terrestrial',
    -- Scientific planet classification
    planet_class ENUM(
        'rocky','super_earth','ocean',
        'gas_giant','ice_giant','hot_jupiter',
        'lava','ice_dwarf','comet_belt'
    ) NOT NULL DEFAULT 'rocky',
    diameter INT NOT NULL DEFAULT 10000,
    temp_min INT NOT NULL DEFAULT -20,
    temp_max INT NOT NULL DEFAULT 40,
    -- Orbital mechanics (Kepler III)
    semi_major_axis_au DOUBLE NOT NULL DEFAULT 1.0,
    orbital_period_days DOUBLE NOT NULL DEFAULT 365.25,
    orbital_eccentricity DOUBLE NOT NULL DEFAULT 0.017,
    -- Surface conditions
    surface_gravity_g DOUBLE NOT NULL DEFAULT 1.0,
    in_habitable_zone TINYINT(1) NOT NULL DEFAULT 0,
    atmosphere_type ENUM(
        'none','thin_co2','thick_co2',
        'nitrogen_oxygen','hydrogen_helium',
        'methane','sulfuric'
    ) NOT NULL DEFAULT 'nitrogen_oxygen',
    -- Resources
    metal DECIMAL(20,4) NOT NULL DEFAULT 500,
    crystal DECIMAL(20,4) NOT NULL DEFAULT 300,
    deuterium DECIMAL(20,4) NOT NULL DEFAULT 100,
    energy INT NOT NULL DEFAULT 0,
    is_homeworld TINYINT(1) NOT NULL DEFAULT 0,
    last_update DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (system_id) REFERENCES star_systems(id) ON DELETE SET NULL,
    UNIQUE KEY unique_position (galaxy, system, position)
) ENGINE=InnoDB;

-- Buildings on planets
CREATE TABLE IF NOT EXISTS buildings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    planet_id INT NOT NULL,
    type VARCHAR(64) NOT NULL,
    level INT NOT NULL DEFAULT 0,
    upgrade_end DATETIME DEFAULT NULL,
    FOREIGN KEY (planet_id) REFERENCES planets(id) ON DELETE CASCADE,
    UNIQUE KEY unique_building (planet_id, type)
) ENGINE=InnoDB;

-- Research / technologies per user
CREATE TABLE IF NOT EXISTS research (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type VARCHAR(64) NOT NULL,
    level INT NOT NULL DEFAULT 0,
    research_end DATETIME DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_research (user_id, type)
) ENGINE=InnoDB;

-- Ships on planets
CREATE TABLE IF NOT EXISTS ships (
    id INT AUTO_INCREMENT PRIMARY KEY,
    planet_id INT NOT NULL,
    type VARCHAR(64) NOT NULL,
    count INT NOT NULL DEFAULT 0,
    FOREIGN KEY (planet_id) REFERENCES planets(id) ON DELETE CASCADE,
    UNIQUE KEY unique_ship (planet_id, type)
) ENGINE=InnoDB;

-- Fleets in motion
CREATE TABLE IF NOT EXISTS fleets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    origin_planet_id INT NOT NULL,
    target_galaxy INT NOT NULL,
    target_system INT NOT NULL,
    target_position INT NOT NULL,
    mission ENUM('attack','transport','colonize','harvest','spy','recall') NOT NULL DEFAULT 'transport',
    ships_json TEXT NOT NULL DEFAULT '{}',
    cargo_metal DECIMAL(20,4) NOT NULL DEFAULT 0,
    cargo_crystal DECIMAL(20,4) NOT NULL DEFAULT 0,
    cargo_deuterium DECIMAL(20,4) NOT NULL DEFAULT 0,
    departure_time DATETIME NOT NULL,
    arrival_time DATETIME NOT NULL,
    return_time DATETIME,
    returning TINYINT(1) NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Messages
CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sender_id INT DEFAULT NULL,
    receiver_id INT NOT NULL,
    subject VARCHAR(255) NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Battle reports
CREATE TABLE IF NOT EXISTS battle_reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    attacker_id INT NOT NULL,
    defender_id INT NOT NULL,
    planet_id INT NOT NULL,
    report_json TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (attacker_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (defender_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Spy reports
CREATE TABLE IF NOT EXISTS spy_reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    owner_id INT NOT NULL,
    target_user_id INT DEFAULT NULL,
    target_planet_id INT DEFAULT NULL,
    report_json TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Galaxy map cache (populated from planets)
-- (No extra table needed; we query planets directly)

-- ─── Achievement / quest system ───────────────────────────────────────────────

-- Master catalogue of all achievements / quests
CREATE TABLE IF NOT EXISTS achievements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    -- Internal key referenced in code (e.g. 'first_mine_5')
    code VARCHAR(64) NOT NULL UNIQUE,
    -- 'tutorial' quests guide new players; 'milestone' awards veterans
    category ENUM('tutorial','milestone','combat','economy','expansion') NOT NULL DEFAULT 'milestone',
    title VARCHAR(128) NOT NULL,
    description TEXT NOT NULL,
    -- Rewards granted on completion
    reward_metal INT UNSIGNED NOT NULL DEFAULT 0,
    reward_crystal INT UNSIGNED NOT NULL DEFAULT 0,
    reward_deuterium INT UNSIGNED NOT NULL DEFAULT 0,
    reward_dark_matter INT UNSIGNED NOT NULL DEFAULT 0,
    reward_rank_points INT UNSIGNED NOT NULL DEFAULT 0,
    sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 100
) ENGINE=InnoDB;

-- Per-user achievement / quest progress
CREATE TABLE IF NOT EXISTS user_achievements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    achievement_id INT NOT NULL,
    -- NULL = not started, 0 = in progress, 1 = completed
    completed TINYINT(1) NOT NULL DEFAULT 0,
    completed_at DATETIME DEFAULT NULL,
    -- Whether the player has already collected the reward for this achievement
    reward_claimed TINYINT(1) NOT NULL DEFAULT 0,
    -- Generic progress counter (e.g. current building level, ships built …)
    progress INT UNSIGNED NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (achievement_id) REFERENCES achievements(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_achievement (user_id, achievement_id)
) ENGINE=InnoDB;

-- ─── Seed: achievement catalogue ─────────────────────────────────────────────
INSERT IGNORE INTO achievements
    (code, category, title, description,
     reward_metal, reward_crystal, reward_deuterium, reward_dark_matter, reward_rank_points, sort_order)
VALUES
-- Tutorial chain (new-player onboarding)
('tutorial_mine_3',   'tutorial', 'First Dig',
 'Upgrade your Metal Mine to level 3.',
 500, 0, 0, 0, 10, 10),
('tutorial_solar_3',  'tutorial', 'Let There Be Light',
 'Upgrade your Solar Plant to level 3.',
 0, 300, 0, 0, 10, 20),
('tutorial_spy',      'tutorial', 'Eyes in the Sky',
 'Send your first Espionage Probe.',
 0, 500, 0, 0, 20, 30),
('tutorial_transport','tutorial', 'First Supply Run',
 'Complete your first transport mission.',
 800, 400, 0, 0, 20, 40),
('tutorial_research', 'tutorial', 'Curious Mind',
 'Research any technology for the first time.',
 0, 0, 200, 0, 30, 50),
('tutorial_colony',   'tutorial', 'New Horizons',
 'Found your first colony.',
 2000, 1000, 500, 5, 100, 60),

-- Milestone – economy path
('eco_metal_100k',    'economy', 'Metal Baron',
 'Accumulate 100 000 metal across all planets.',
 0, 5000, 0, 0, 50, 110),
('eco_planets_5',     'expansion', 'Small Empire',
 'Control 5 planets simultaneously.',
 5000, 5000, 2000, 10, 150, 120),
('eco_planets_10',    'expansion', 'Galactic Domain',
 'Control 10 planets simultaneously.',
 10000, 10000, 5000, 25, 300, 130),

-- Milestone – combat path
('combat_first_win',  'combat', 'Baptism of Fire',
 'Win your first battle.',
 1000, 500, 0, 5, 50, 210),
('combat_10_wins',    'combat', 'Warlord',
 'Win 10 battles.',
 0, 0, 0, 20, 200, 220),

-- Veteran rewards (very long-term)
('veteran_deathstar', 'milestone', 'Doomsday Machine',
 'Build a Death Star.',
 0, 0, 0, 100, 1000, 910),
('veteran_all_research','milestone','Omniscient',
 'Complete all research trees.',
 0, 0, 0, 50, 500, 920);

