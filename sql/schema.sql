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
    dark_matter INT UNSIGNED NOT NULL DEFAULT 0,
    rank_points INT UNSIGNED NOT NULL DEFAULT 0,
    protection_until DATETIME DEFAULT NULL,
    vacation_mode TINYINT(1) NOT NULL DEFAULT 0,
    pvp_mode TINYINT(1) NOT NULL DEFAULT 0,
    is_npc TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
) ENGINE=InnoDB;

-- Star systems
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

-- Planets (pure astronomical objects)
CREATE TABLE IF NOT EXISTS planets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    system_id INT DEFAULT NULL,
    galaxy INT NOT NULL DEFAULT 1,
    system INT NOT NULL DEFAULT 1,
    position INT NOT NULL DEFAULT 1,
    type ENUM('terrestrial','gas_giant','ice','desert','volcanic') NOT NULL DEFAULT 'terrestrial',
    planet_class ENUM(
        'rocky','super_earth','ocean',
        'gas_giant','ice_giant','hot_jupiter',
        'lava','ice_dwarf','comet_belt'
    ) NOT NULL DEFAULT 'rocky',
    diameter INT NOT NULL DEFAULT 10000,
    temp_min INT NOT NULL DEFAULT -20,
    temp_max INT NOT NULL DEFAULT 40,
    semi_major_axis_au DOUBLE NOT NULL DEFAULT 1.0,
    orbital_period_days DOUBLE NOT NULL DEFAULT 365.25,
    orbital_eccentricity DOUBLE NOT NULL DEFAULT 0.017,
    surface_gravity_g DOUBLE NOT NULL DEFAULT 1.0,
    in_habitable_zone TINYINT(1) NOT NULL DEFAULT 0,
    atmosphere_type ENUM(
        'none','thin_co2','thick_co2',
        'nitrogen_oxygen','hydrogen_helium',
        'methane','sulfuric'
    ) NOT NULL DEFAULT 'nitrogen_oxygen',
    FOREIGN KEY (system_id) REFERENCES star_systems(id) ON DELETE SET NULL,
    UNIQUE KEY unique_position (galaxy, system, position)
) ENGINE=InnoDB;

-- Colonies (player bases on planets)
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

-- Buildings on colonies
CREATE TABLE IF NOT EXISTS buildings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    colony_id INT NOT NULL,
    type VARCHAR(64) NOT NULL,
    level INT NOT NULL DEFAULT 0,
    upgrade_end DATETIME DEFAULT NULL,
    FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE CASCADE,
    UNIQUE KEY unique_building (colony_id, type)
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

-- Ships on colonies
CREATE TABLE IF NOT EXISTS ships (
    id INT AUTO_INCREMENT PRIMARY KEY,
    colony_id INT NOT NULL,
    type VARCHAR(64) NOT NULL,
    count INT NOT NULL DEFAULT 0,
    FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE CASCADE,
    UNIQUE KEY unique_ship (colony_id, type)
) ENGINE=InnoDB;

-- Fleets in motion
CREATE TABLE IF NOT EXISTS fleets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    origin_colony_id INT NOT NULL,
    target_galaxy INT NOT NULL,
    target_system INT NOT NULL,
    target_position INT NOT NULL,
    mission ENUM('attack','transport','colonize','harvest','spy','recall') NOT NULL DEFAULT 'transport',
    ships_json TEXT NOT NULL DEFAULT '{}',
    cargo_metal DECIMAL(20,4) NOT NULL DEFAULT 0,
    cargo_crystal DECIMAL(20,4) NOT NULL DEFAULT 0,
    cargo_deuterium DECIMAL(20,4) NOT NULL DEFAULT 0,
    -- 3-D galactic coordinates (light-years) for Newtonian flight mechanics
    origin_x_ly DOUBLE NOT NULL DEFAULT 0,
    origin_y_ly DOUBLE NOT NULL DEFAULT 0,
    origin_z_ly DOUBLE NOT NULL DEFAULT 0,
    target_x_ly DOUBLE NOT NULL DEFAULT 0,
    target_y_ly DOUBLE NOT NULL DEFAULT 0,
    target_z_ly DOUBLE NOT NULL DEFAULT 0,
    speed_ly_h  DOUBLE NOT NULL DEFAULT 1.0,   -- fleet speed in ly/h
    distance_ly DOUBLE NOT NULL DEFAULT 0,     -- pre-computed 3-D Euclidean distance
    departure_time DATETIME NOT NULL,
    arrival_time DATETIME NOT NULL,
    return_time DATETIME,
    returning TINYINT(1) NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Leaders / Officers
-- Each leader is a named character that can be assigned to a colony or fleet.
-- When autonomy >= 2 the AI tick drives their decisions automatically.
CREATE TABLE IF NOT EXISTS leaders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(64) NOT NULL,
    role ENUM('colony_manager','fleet_commander','science_director') NOT NULL,
    -- Assignment (at most one active assignment at a time)
    colony_id INT DEFAULT NULL,
    fleet_id  INT DEFAULT NULL,
    -- Skill points (1-10); each point adds a small multiplier
    skill_production   TINYINT UNSIGNED NOT NULL DEFAULT 1, -- colony_manager: output bonus
    skill_construction TINYINT UNSIGNED NOT NULL DEFAULT 1, -- colony_manager: build-time reduction
    skill_tactics      TINYINT UNSIGNED NOT NULL DEFAULT 1, -- fleet_commander: combat attack bonus
    skill_navigation   TINYINT UNSIGNED NOT NULL DEFAULT 1, -- fleet_commander: speed bonus
    skill_research     TINYINT UNSIGNED NOT NULL DEFAULT 1, -- science_director: research-time reduction
    skill_efficiency   TINYINT UNSIGNED NOT NULL DEFAULT 1, -- science_director: resource-cost reduction
    -- Autonomy: 0 = inactive, 1 = suggest only, 2 = full auto
    autonomy TINYINT UNSIGNED NOT NULL DEFAULT 1,
    -- Last AI decision log entry
    last_action TEXT DEFAULT NULL,
    last_action_at DATETIME DEFAULT NULL,
    -- Progression
    xp    INT UNSIGNED NOT NULL DEFAULT 0,
    level TINYINT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)   REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE SET NULL,
    FOREIGN KEY (fleet_id)  REFERENCES fleets(id)   ON DELETE SET NULL
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

-- ─── Achievement / quest system ───────────────────────────────────────────────

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

INSERT IGNORE INTO achievements
    (code, category, title, description,
     reward_metal, reward_crystal, reward_deuterium, reward_dark_matter, reward_rank_points, sort_order)
VALUES
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
('eco_metal_100k',    'economy', 'Metal Baron',
 'Accumulate 100 000 metal across all colonies.',
 0, 5000, 0, 0, 50, 110),
('eco_planets_5',     'expansion', 'Small Empire',
 'Control 5 colonies simultaneously.',
 5000, 5000, 2000, 10, 150, 120),
('eco_planets_10',    'expansion', 'Galactic Domain',
 'Control 10 colonies simultaneously.',
 10000, 10000, 5000, 25, 300, 130),
('combat_first_win',  'combat', 'Baptism of Fire',
 'Win your first battle.',
 1000, 500, 0, 5, 50, 210),
('combat_10_wins',    'combat', 'Warlord',
 'Win 10 battles.',
 0, 0, 0, 20, 200, 220),
('veteran_deathstar', 'milestone', 'Doomsday Machine',
 'Build a Death Star.',
 0, 0, 0, 100, 1000, 910),
('veteran_all_research','milestone','Omniscient',
 'Complete all research trees.',
 0, 0, 0, 50, 500, 920);
