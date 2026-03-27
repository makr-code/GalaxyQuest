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
        AFTER protection_until,
    ADD COLUMN IF NOT EXISTS pvp_mode        TINYINT(1) NOT NULL DEFAULT 0
        AFTER vacation_mode,
    ADD COLUMN IF NOT EXISTS is_npc          TINYINT(1) NOT NULL DEFAULT 0
        AFTER pvp_mode;

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
    name VARCHAR(16) NOT NULL DEFAULT '',
    catalog_name VARCHAR(32) NOT NULL DEFAULT '',
    planet_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
    UNIQUE KEY unique_system (galaxy_index, system_index)
) ENGINE=InnoDB;

ALTER TABLE star_systems
    ADD COLUMN IF NOT EXISTS catalog_name VARCHAR(32) NOT NULL DEFAULT ''
        AFTER name,
    ADD COLUMN IF NOT EXISTS planet_count TINYINT UNSIGNED NOT NULL DEFAULT 0
        AFTER catalog_name;

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

-- Populate colonies from existing planets data
INSERT IGNORE INTO colonies (planet_id, user_id, name, colony_type, metal, crystal, deuterium, energy, is_homeworld, last_update)
SELECT id, user_id, name, 'balanced', metal, crystal, deuterium, energy, is_homeworld, last_update
FROM planets WHERE user_id IS NOT NULL AND user_id > 0;

-- Add colony_id column to buildings (keep planet_id for backward compat)
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS colony_id INT DEFAULT NULL;
ALTER TABLE buildings ADD INDEX IF NOT EXISTS idx_colony (colony_id);
-- Populate colony_id from planet_id
UPDATE buildings b
  JOIN colonies c ON c.planet_id = b.planet_id
  SET b.colony_id = c.id
  WHERE b.colony_id IS NULL;

-- Add colony_id to ships
ALTER TABLE ships ADD COLUMN IF NOT EXISTS colony_id INT DEFAULT NULL;
ALTER TABLE ships ADD INDEX IF NOT EXISTS idx_colony (colony_id);
UPDATE ships s
  JOIN colonies c ON c.planet_id = s.planet_id
  SET s.colony_id = c.id
  WHERE s.colony_id IS NULL;

-- Add origin_colony_id to fleets
ALTER TABLE fleets ADD COLUMN IF NOT EXISTS origin_colony_id INT DEFAULT NULL;
UPDATE fleets f
  JOIN colonies c ON c.planet_id = f.origin_planet_id
  SET f.origin_colony_id = c.id
  WHERE f.origin_colony_id IS NULL;

-- ── Fleet 3-D coordinates (Newtonian movement) ───────────────────────────────
ALTER TABLE fleets ADD COLUMN IF NOT EXISTS origin_x_ly DOUBLE NOT NULL DEFAULT 0;
ALTER TABLE fleets ADD COLUMN IF NOT EXISTS origin_y_ly DOUBLE NOT NULL DEFAULT 0;
ALTER TABLE fleets ADD COLUMN IF NOT EXISTS origin_z_ly DOUBLE NOT NULL DEFAULT 0;
ALTER TABLE fleets ADD COLUMN IF NOT EXISTS target_x_ly DOUBLE NOT NULL DEFAULT 0;
ALTER TABLE fleets ADD COLUMN IF NOT EXISTS target_y_ly DOUBLE NOT NULL DEFAULT 0;
ALTER TABLE fleets ADD COLUMN IF NOT EXISTS target_z_ly DOUBLE NOT NULL DEFAULT 0;
ALTER TABLE fleets ADD COLUMN IF NOT EXISTS speed_ly_h  DOUBLE NOT NULL DEFAULT 1.0;
ALTER TABLE fleets ADD COLUMN IF NOT EXISTS distance_ly DOUBLE NOT NULL DEFAULT 0;

-- ── Leaders / Officers ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leaders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(64) NOT NULL,
    role ENUM('colony_manager','fleet_commander','science_director') NOT NULL,
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

-- ── Planet deposit & richness columns ────────────────────────────────────────
ALTER TABLE planets ADD COLUMN IF NOT EXISTS richness_metal      DOUBLE NOT NULL DEFAULT 1.0;
ALTER TABLE planets ADD COLUMN IF NOT EXISTS richness_crystal    DOUBLE NOT NULL DEFAULT 1.0;
ALTER TABLE planets ADD COLUMN IF NOT EXISTS richness_deuterium  DOUBLE NOT NULL DEFAULT 1.0;
ALTER TABLE planets ADD COLUMN IF NOT EXISTS richness_rare_earth DOUBLE NOT NULL DEFAULT 0.5;
ALTER TABLE planets ADD COLUMN IF NOT EXISTS deposit_metal       BIGINT NOT NULL DEFAULT 5000000;
ALTER TABLE planets ADD COLUMN IF NOT EXISTS deposit_crystal     BIGINT NOT NULL DEFAULT 2000000;
ALTER TABLE planets ADD COLUMN IF NOT EXISTS deposit_deuterium   BIGINT NOT NULL DEFAULT 1000000;
ALTER TABLE planets ADD COLUMN IF NOT EXISTS deposit_rare_earth  BIGINT NOT NULL DEFAULT 200000;

-- ── Colony population / food / welfare columns ────────────────────────────────
ALTER TABLE colonies ADD COLUMN IF NOT EXISTS rare_earth      DECIMAL(20,4) NOT NULL DEFAULT 0;
ALTER TABLE colonies ADD COLUMN IF NOT EXISTS food            DECIMAL(20,4) NOT NULL DEFAULT 200;
ALTER TABLE colonies ADD COLUMN IF NOT EXISTS population      INT UNSIGNED NOT NULL DEFAULT 100;
ALTER TABLE colonies ADD COLUMN IF NOT EXISTS max_population  INT UNSIGNED NOT NULL DEFAULT 500;
ALTER TABLE colonies ADD COLUMN IF NOT EXISTS happiness       TINYINT UNSIGNED NOT NULL DEFAULT 70;
ALTER TABLE colonies ADD COLUMN IF NOT EXISTS public_services TINYINT UNSIGNED NOT NULL DEFAULT 0;

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
    requirements_json TEXT NOT NULL DEFAULT '{}',
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
    progress_json TEXT NOT NULL DEFAULT '{}',
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (faction_quest_id) REFERENCES faction_quests(id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_npc_tick DATETIME DEFAULT NULL;

-- ── Battle report indexes ─────────────────────────────────────────────────────
ALTER TABLE battle_reports ADD KEY IF NOT EXISTS idx_attacker_time (attacker_id, created_at);
ALTER TABLE battle_reports ADD KEY IF NOT EXISTS idx_defender_time  (defender_id, created_at);
