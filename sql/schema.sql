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
    last_login DATETIME,
    last_npc_tick DATETIME DEFAULT NULL,
    ftl_drive_type VARCHAR(30) NOT NULL DEFAULT 'aereth'
        COMMENT 'Faction FTL drive: aereth|vor_tak|syl_nar|vel_ar|zhareen|kryl_tha',
    ftl_cooldown_until DATETIME DEFAULT NULL
        COMMENT 'FTL drive cooldown expiry (Vor''Tak K-F recharge)'
) ENGINE=InnoDB;

-- Generated character dossier + portrait asset references (UID-linked)
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

-- Persistent login tokens (remember-me cookies)
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

-- Application / bootstrap state
CREATE TABLE IF NOT EXISTS app_state (
    state_key VARCHAR(64) PRIMARY KEY,
    state_value VARCHAR(255) NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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

-- Planets (pure astronomical objects)
CREATE TABLE IF NOT EXISTS planets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    system_id INT DEFAULT NULL,
    galaxy INT NOT NULL DEFAULT 1,
    `system` INT NOT NULL DEFAULT 1,
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
    composition_family VARCHAR(64) NOT NULL DEFAULT 'silicate_metal',
    dominant_surface_material VARCHAR(64) NOT NULL DEFAULT 'basaltic_regolith',
    surface_pressure_bar DOUBLE NOT NULL DEFAULT 0.0,
    water_state VARCHAR(32) NOT NULL DEFAULT 'solid',
    methane_state VARCHAR(32) NOT NULL DEFAULT 'gas',
    ammonia_state VARCHAR(32) NOT NULL DEFAULT 'gas',
    dominant_surface_liquid VARCHAR(32) NOT NULL DEFAULT 'none',
    radiation_level VARCHAR(32) NOT NULL DEFAULT 'moderate',
    habitability_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
    life_friendliness VARCHAR(32) NOT NULL DEFAULT 'life_hostile',
    species_affinity_json JSON DEFAULT NULL,
    -- ── Resource deposits (finite; depleted by mining) ──────────────────────
    -- richness 0.0–2.0 (1.0 = standard; HZ terrestrial get bonus)
    richness_metal      DOUBLE NOT NULL DEFAULT 1.0,
    richness_crystal    DOUBLE NOT NULL DEFAULT 1.0,
    richness_deuterium  DOUBLE NOT NULL DEFAULT 1.0,
    richness_rare_earth DOUBLE NOT NULL DEFAULT 0.5,
    -- total reserves in raw units (0 = depleted; -1 = unlimited gas-giant deuterium)
    deposit_metal       BIGINT NOT NULL DEFAULT 5000000,
    deposit_crystal     BIGINT NOT NULL DEFAULT 2000000,
    deposit_deuterium   BIGINT NOT NULL DEFAULT 1000000,
    deposit_rare_earth  BIGINT NOT NULL DEFAULT 200000,
    FOREIGN KEY (system_id) REFERENCES star_systems(id) ON DELETE SET NULL,
    UNIQUE KEY unique_position (galaxy, `system`, position)
) ENGINE=InnoDB;

-- Colonies (player bases on planets)
CREATE TABLE IF NOT EXISTS colonies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    planet_id INT NOT NULL,
    user_id INT NOT NULL,
    name VARCHAR(64) NOT NULL DEFAULT 'Colony',
    colony_type ENUM('balanced','mining','industrial','research','agricultural','military') NOT NULL DEFAULT 'balanced',
    -- Stockpiled resources
    metal         DECIMAL(20,4) NOT NULL DEFAULT 500,
    crystal       DECIMAL(20,4) NOT NULL DEFAULT 300,
    deuterium     DECIMAL(20,4) NOT NULL DEFAULT 100,
    rare_earth    DECIMAL(20,4) NOT NULL DEFAULT 0,
    food          DECIMAL(20,4) NOT NULL DEFAULT 200,
    energy        INT NOT NULL DEFAULT 0,
    -- Population
    population    INT UNSIGNED NOT NULL DEFAULT 100,
    max_population INT UNSIGNED NOT NULL DEFAULT 500,
    -- Welfare metrics (0–100)
    happiness     TINYINT UNSIGNED NOT NULL DEFAULT 70,
    -- Public-services index: weighted average of hospital/school/security coverage (0–100)
    public_services TINYINT UNSIGNED NOT NULL DEFAULT 0,
    is_homeworld  TINYINT(1) NOT NULL DEFAULT 0,
    last_update   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

CREATE TABLE IF NOT EXISTS building_upgrade_queue (
    id INT AUTO_INCREMENT PRIMARY KEY,
    colony_id INT NOT NULL,
    building_type VARCHAR(64) NOT NULL,
    target_level INT NOT NULL,
    cost_metal INT NOT NULL DEFAULT 0,
    cost_crystal INT NOT NULL DEFAULT 0,
    cost_deuterium INT NOT NULL DEFAULT 0,
    duration_secs INT NOT NULL,
    queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME DEFAULT NULL,
    eta DATETIME DEFAULT NULL,
    status ENUM('queued','running','done','cancelled') NOT NULL DEFAULT 'queued',
    FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE CASCADE,
    INDEX idx_buq_colony_status (colony_id, status),
    INDEX idx_buq_eta (eta)
) ENGINE=InnoDB;

-- Research / technologies per user
CREATE TABLE IF NOT EXISTS research (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type VARCHAR(64) NOT NULL,
    level INT NOT NULL DEFAULT 0,
    research_start DATETIME DEFAULT NULL,
    research_end   DATETIME DEFAULT NULL,
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
    mission ENUM('attack','transport','colonize','harvest','spy','recall','survey') NOT NULL DEFAULT 'transport',
    ships_json TEXT NOT NULL,
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
    stealth_until DATETIME DEFAULT NULL
        COMMENT 'Vel''Ar FTL: fleet hidden from enemies until this timestamp',
    hull_damage_pct TINYINT UNSIGNED NOT NULL DEFAULT 0
        COMMENT 'Kryl''Tha FTL: hull degradation after swarm-tunnel jump (0-100 %)',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Wormhole network (Phase 5.3)
CREATE TABLE IF NOT EXISTS wormholes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    endpoint_a_galaxy INT NOT NULL,
    endpoint_a_system INT NOT NULL,
    endpoint_b_galaxy INT NOT NULL,
    endpoint_b_system INT NOT NULL,
    stability INT NOT NULL DEFAULT 100,
    cooldown_until DATETIME DEFAULT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    is_permanent TINYINT(1) NOT NULL DEFAULT 0,
    label VARCHAR(80) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_wormholes_a (endpoint_a_galaxy, endpoint_a_system),
    INDEX idx_wormholes_b (endpoint_b_galaxy, endpoint_b_system)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_wormhole_unlocks (
    user_id INT NOT NULL PRIMARY KEY,
    source_quest_code VARCHAR(64) DEFAULT NULL,
    unlocked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- FTL Drive: Syl'Nar gate network (buildable FTL infrastructure)
CREATE TABLE IF NOT EXISTS ftl_gates (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    owner_user_id INT NOT NULL,
    galaxy_a      INT NOT NULL,
    system_a      INT NOT NULL,
    galaxy_b      INT NOT NULL,
    system_b      INT NOT NULL,
    is_active     TINYINT(1) NOT NULL DEFAULT 1,
    health        INT NOT NULL DEFAULT 100
                  COMMENT 'Gate health 0–100; destroyed at 0',
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_gates_a (galaxy_a, system_a),
    INDEX idx_gates_b (galaxy_b, system_b)
) ENGINE=InnoDB;

-- FTL Drive: Zhareen resonance node registry (charted via survey mission)
CREATE TABLE IF NOT EXISTS ftl_resonance_nodes (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    owner_user_id  INT NOT NULL,
    galaxy         INT NOT NULL,
    `system`       INT NOT NULL,
    discovered_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cooldown_until DATETIME DEFAULT NULL
                   COMMENT '30-min cooldown per node after use',
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_node (owner_user_id, galaxy, `system`)
) ENGINE=InnoDB;

-- Leaders / Officers
-- Each leader is a named character that can be assigned to a colony or fleet.
-- When autonomy >= 2 the AI tick drives their decisions automatically.
CREATE TABLE IF NOT EXISTS leaders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(64) NOT NULL,
    role ENUM('colony_manager','fleet_commander','science_director','diplomacy_officer','trade_director') NOT NULL,
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
    FOREIGN KEY (defender_id) REFERENCES users(id) ON DELETE CASCADE,
    KEY idx_attacker_time (attacker_id, created_at),
    KEY idx_defender_time (defender_id, created_at)
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

-- ─── NPC Faction system ──────────────────────────────────────────────────────

-- Faction definitions (seeded once)
CREATE TABLE IF NOT EXISTS npc_factions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(64) NOT NULL,
    description TEXT NOT NULL,
    faction_type ENUM('military','trade','science','pirate','ancient') NOT NULL,
    aggression      TINYINT UNSIGNED NOT NULL DEFAULT 50,   -- 0-100
    trade_willingness TINYINT UNSIGNED NOT NULL DEFAULT 50, -- 0-100
    base_diplomacy  SMALLINT NOT NULL DEFAULT 0,            -- starting standing
    power_level     INT UNSIGNED NOT NULL DEFAULT 1000,
    home_galaxy_min TINYINT UNSIGNED NOT NULL DEFAULT 1,
    home_galaxy_max TINYINT UNSIGNED NOT NULL DEFAULT 9,
    color           VARCHAR(7) NOT NULL DEFAULT '#888888',
    icon            VARCHAR(4) NOT NULL DEFAULT '👾'
) ENGINE=InnoDB;

-- Per-user diplomatic standing with each faction (-100 = war, +100 = allied)
CREATE TABLE IF NOT EXISTS diplomacy (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT NOT NULL,
    faction_id INT NOT NULL,
    standing   SMALLINT NOT NULL DEFAULT 0,
    attacks_against  INT UNSIGNED NOT NULL DEFAULT 0,
    trades_completed INT UNSIGNED NOT NULL DEFAULT 0,
    quests_completed INT UNSIGNED NOT NULL DEFAULT 0,
    last_event     TEXT DEFAULT NULL,
    last_event_at  DATETIME DEFAULT NULL,
    FOREIGN KEY (user_id)    REFERENCES users(id)        ON DELETE CASCADE,
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE,
    UNIQUE KEY unique_diplomacy (user_id, faction_id)
) ENGINE=InnoDB;

-- Time-limited trade offers generated by faction AI
CREATE TABLE IF NOT EXISTS trade_offers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    faction_id       INT NOT NULL,
    offer_resource   ENUM('metal','crystal','deuterium','rare_earth','food') NOT NULL,
    offer_amount     BIGINT UNSIGNED NOT NULL DEFAULT 1000,
    request_resource ENUM('metal','crystal','deuterium','rare_earth','food') NOT NULL,
    request_amount   BIGINT UNSIGNED NOT NULL DEFAULT 1000,
    min_standing     SMALLINT NOT NULL DEFAULT -50,
    max_claims       SMALLINT UNSIGNED NOT NULL DEFAULT 5,
    claims_count     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    valid_until      DATETIME NOT NULL,
    active           TINYINT(1) NOT NULL DEFAULT 1,
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Faction-specific quest catalogue
CREATE TABLE IF NOT EXISTS faction_quests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    faction_id   INT NOT NULL,
    code         VARCHAR(64) NOT NULL UNIQUE,
    title        VARCHAR(128) NOT NULL,
    description  TEXT NOT NULL,
    quest_type   ENUM('kill','deliver','explore','build','research','spy') NOT NULL,
    requirements_json TEXT NOT NULL,
    reward_metal       INT UNSIGNED NOT NULL DEFAULT 0,
    reward_crystal     INT UNSIGNED NOT NULL DEFAULT 0,
    reward_deuterium   INT UNSIGNED NOT NULL DEFAULT 0,
    reward_rare_earth  INT UNSIGNED NOT NULL DEFAULT 0,
    reward_dark_matter INT UNSIGNED NOT NULL DEFAULT 0,
    reward_rank_points INT UNSIGNED NOT NULL DEFAULT 0,
    reward_standing    SMALLINT NOT NULL DEFAULT 10,
    min_standing       SMALLINT NOT NULL DEFAULT -100,
    difficulty         ENUM('easy','medium','hard','epic') NOT NULL DEFAULT 'medium',
    repeatable         TINYINT(1) NOT NULL DEFAULT 0,
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Per-user active/completed faction quests
CREATE TABLE IF NOT EXISTS user_faction_quests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id          INT NOT NULL,
    faction_quest_id INT NOT NULL,
    status ENUM('active','completed','failed','claimed') NOT NULL DEFAULT 'active',
    progress_json    TEXT NOT NULL,
    started_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at     DATETIME DEFAULT NULL,
    FOREIGN KEY (user_id)          REFERENCES users(id)          ON DELETE CASCADE,
    FOREIGN KEY (faction_quest_id) REFERENCES faction_quests(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ─── Seed: NPC factions ───────────────────────────────────────────────────────
INSERT IGNORE INTO npc_factions
    (code, name, description, faction_type, aggression, trade_willingness,
     base_diplomacy, power_level, home_galaxy_min, home_galaxy_max, color, icon)
VALUES
('empire',
 'Galactic Empire',
 'A vast militaristic empire controlling the core systems. Aggressive toward newcomers but can be negotiated with.',
 'military', 70, 20, -20, 5000, 1, 3, '#cc4444', '⚔'),

('guild',
 'Merchant Guild',
 'The wealthiest trading consortium in the spiral arms. Always open for business — for the right price.',
 'trade', 10, 90, 20, 1000, 4, 6, '#ddaa22', '💰'),

('science',
 'Science Collective',
 'A federation of researchers obsessed with ancient ruins and unexplored star systems.',
 'science', 20, 60, 10, 2000, 7, 8, '#4488cc', '🔬'),

('pirates',
 'Pirate Clans',
 'A loose confederation of raiders who prey on unprotected colonies and slow freighters.',
 'pirate', 90, 40, -40, 800, 1, 9, '#aa5500', '💀'),

('precursors',
 'Ancient Precursors',
 'Enigmatic remnants of a civilisation that predates the current age. Their technology is unmatched.',
 'ancient', 30, 30, 0, 9999, 5, 9, '#9944cc', '🌀');

-- ─── Seed: Faction quests ─────────────────────────────────────────────────────
INSERT IGNORE INTO faction_quests
     (faction_id, code, title, description, quest_type, requirements_json,
      reward_metal, reward_crystal, reward_deuterium, reward_rare_earth,
      reward_dark_matter, reward_rank_points, reward_standing, min_standing, difficulty, repeatable)
SELECT f.id, 'empire_tribute_metal', 'Metal Tribute',
    'The Empire demands a tribute of 10 000 metal as proof of loyalty.',
    'deliver', '{"resource":"metal","amount":10000}', 0,5000,2000,0,0,50,15,-100,'easy',1
FROM npc_factions f WHERE f.code='empire';
INSERT IGNORE INTO faction_quests
     (faction_id, code, title, description, quest_type, requirements_json,
      reward_metal, reward_crystal, reward_deuterium, reward_rare_earth,
      reward_dark_matter, reward_rank_points, reward_standing, min_standing, difficulty, repeatable)
SELECT f.id, 'empire_patrol_kill', 'Border Patrol',
    'Destroy 3 pirate ships that have been harassing imperial supply routes.',
    'kill', '{"faction":"pirates","count":3}', 8000,4000,2000,0,50,100,20,-20,'medium',0
FROM npc_factions f WHERE f.code='empire';
INSERT IGNORE INTO faction_quests
     (faction_id, code, title, description, quest_type, requirements_json,
      reward_metal, reward_crystal, reward_deuterium, reward_rare_earth,
      reward_dark_matter, reward_rank_points, reward_standing, min_standing, difficulty, repeatable)
SELECT f.id, 'guild_supply_crystal', 'Crystal Delivery',
    'The Guild needs 5 000 crystal delivered to secure a new trade route.',
    'deliver', '{"resource":"crystal","amount":5000}', 10000,0,3000,0,0,40,10,-100,'easy',1
FROM npc_factions f WHERE f.code='guild';
INSERT IGNORE INTO faction_quests
     (faction_id, code, title, description, quest_type, requirements_json,
      reward_metal, reward_crystal, reward_deuterium, reward_rare_earth,
      reward_dark_matter, reward_rank_points, reward_standing, min_standing, difficulty, repeatable)
SELECT f.id, 'guild_rare_earth', 'Rare Earth Procurement',
    'Procure 500 units of rare earth for the Guild advanced manufacturing.',
    'deliver', '{"resource":"rare_earth","amount":500}', 20000,10000,5000,0,100,150,20,0,'hard',0
FROM npc_factions f WHERE f.code='guild';
INSERT IGNORE INTO faction_quests
     (faction_id, code, title, description, quest_type, requirements_json,
      reward_metal, reward_crystal, reward_deuterium, reward_rare_earth,
      reward_dark_matter, reward_rank_points, reward_standing, min_standing, difficulty, repeatable)
SELECT f.id, 'sci_explore_system', 'Stellar Survey',
    'Visit an unexplored star system and send a probe report back.',
    'explore', '{"spy_reports":1}', 5000,5000,0,0,50,80,15,-100,'easy',0
FROM npc_factions f WHERE f.code='science';
INSERT IGNORE INTO faction_quests
     (faction_id, code, title, description, quest_type, requirements_json,
      reward_metal, reward_crystal, reward_deuterium, reward_rare_earth,
      reward_dark_matter, reward_rank_points, reward_standing, min_standing, difficulty, repeatable)
SELECT f.id, 'sci_research_lvl5', 'Knowledge is Power',
    'Reach level 5 in any research technology.',
    'research', '{"research_level":5}', 0,10000,8000,200,100,200,25,10,'medium',0
FROM npc_factions f WHERE f.code='science';
INSERT IGNORE INTO faction_quests
     (faction_id, code, title, description, quest_type, requirements_json,
      reward_metal, reward_crystal, reward_deuterium, reward_rare_earth,
      reward_dark_matter, reward_rank_points, reward_standing, min_standing, difficulty, repeatable)
SELECT f.id, 'pirate_raid_help', 'Pirate Muscle',
    'The Clans need a show of strength - win a battle against any enemy.',
    'kill', '{"battle_wins":1}', 12000,3000,0,0,0,60,20,-100,'easy',1
FROM npc_factions f WHERE f.code='pirates';
INSERT IGNORE INTO faction_quests
     (faction_id, code, title, description, quest_type, requirements_json,
      reward_metal, reward_crystal, reward_deuterium, reward_rare_earth,
      reward_dark_matter, reward_rank_points, reward_standing, min_standing, difficulty, repeatable)
SELECT f.id, 'prec_rare_earth_offering', 'The Ancient Toll',
    'The Precursors require 1 000 units of rare earth to open negotiations.',
    'deliver', '{"resource":"rare_earth","amount":1000}', 0,0,0,500,500,300,30,-100,'epic',0
FROM npc_factions f WHERE f.code='precursors';
INSERT IGNORE INTO faction_quests
     (faction_id, code, title, description, quest_type, requirements_json,
      reward_metal, reward_crystal, reward_deuterium, reward_rare_earth,
      reward_dark_matter, reward_rank_points, reward_standing, min_standing, difficulty, repeatable)
SELECT f.id, 'precursor_wormhole_beacon', 'Unlock the Ancient Beacon',
    'Decode precursor harmonics and stabilize an ancient beacon lattice to unlock permanent wormhole corridors.',
    'research', '{"tech":"wormhole_theory","level":5}', 15000,12000,9000,0,500,180,18,80,'epic',0
FROM npc_factions f WHERE f.code='precursors';

-- ─── Trade routes (automated recurring transport) ──────────────────────────────

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

-- ─── Alliance system ──────────────────────────────────────────────────────────

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

-- Planetary random events (solar flare, mineral vein, disease, archaeological find)
CREATE TABLE IF NOT EXISTS colony_events (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    colony_id   INT NOT NULL,
    event_type  ENUM('solar_flare','mineral_vein','disease','archaeological_find') NOT NULL,
    started_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at  DATETIME NOT NULL,
    FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE CASCADE,
    UNIQUE KEY unique_colony_event (colony_id)
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
